/**
 * `writeAtomic` / `renameOverwriting` 的 win32 有界重试（EV-260）回归锚。
 *
 * 全部情形经注入参数构造（platform / delaysMs / rename），macOS 上同样跑出 win32 分支；
 * `delaysMs` 注入小值避免真实等待。POSIX 分支的行为锚（T4）钉「单次直通、错误透传、tmp 不清」。
 *
 * 变异必红口径（T8，删改实现后下列断言必红）：
 *   - 删掉重试循环（win32 也单次抛）→ T1×3「恰 3 次」变 1、T2×3「恰 3 次」变 1、T6 以 EPERM 拒绝而失败（A 的首试抛出后无重试，pA 立即拒绝——快速红，不是挂起）；
 *   - 删掉 `onExhausted` 清理 → T2×3 的「无 .tmp-*」红；
 *   - 三码判定改宽（如收 ENOENT）→ T3「恰 1 次」红；
 *   - 三码漏任一（如只判 EPERM）→ T1×3 / T2×3 的 EACCES、EBUSY 格红；
 *   - 改缺省延迟表数值或长度 → T10 红（预算论证建立在具体表值上）；
 *   - 删掉 onExhausted 的异常防护（AGY-01）→ T9 抛出的是清理错误而非原始错误。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { renameOverwriting, WIN_RENAME_RETRY_DELAYS_MS, writeAtomic } from '../../src/trivium/util/fsx.js';
import { scratchDir } from '../helpers/scratch.js';

const RETRYABLE_CODES = ['EPERM', 'EACCES', 'EBUSY'] as const;

const errOf = (code: string, tag = ''): NodeJS.ErrnoException =>
  Object.assign(new Error(`injected ${code}${tag ? ` (${tag})` : ''}`), { code });

/** 目录里还剩几个 writeAtomic 的临时文件（`${target}.tmp-…` 形状） */
const tmpLeftovers = async (dir: string): Promise<string[]> =>
  (await fs.readdir(dir)).filter((n) => n.includes('.tmp-'));

/** 真实改名，但对本机瞬时争用（杀毒/索引按住刚写的文件，EV-260 现场本尊）自带测试侧的内部重试 */
async function renameForReal(from: string, to: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if ((code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') && i < 100) {
        await new Promise((r) => setTimeout(r, 20));
        continue;
      }
      throw e;
    }
  }
}

/** 脚本步的成功哨兵（不能用 null：nullish 会撞上 ?? 的兜底分支） */
const OK_STEP = Symbol('ok');

/** 注入的改名函数：按脚本逐次执行（错误实例即抛、OK_STEP 落真实改名），并数调用次数 */
function scriptedRename(outcomes: Array<NodeJS.ErrnoException | typeof OK_STEP>): {
  rename: (from: string, to: string) => Promise<void>;
  calls: () => number;
} {
  let i = 0;
  const rename = (from: string, to: string): Promise<void> => {
    const outcome = outcomes[i++];
    if (outcome === undefined) return Promise.reject(errOf('EPROTO', 'script exhausted'));
    if (outcome !== OK_STEP) return Promise.reject(outcome);
    return renameForReal(from, to);
  };
  return { rename, calls: () => i };
}

test('T1×3：win32 前两次抛可重试码、第三次成功——三码各一格；无 tmp 残留', async () => {
  for (const code of RETRYABLE_CODES) {
    const dir = await scratchDir('trivium-fsxwa-');
    const target = path.join(dir, 'status.json');
    const { rename, calls } = scriptedRename([errOf(code, '1st'), errOf(code, '2nd'), OK_STEP]);
    await writeAtomic(target, `content-${code}`, { platform: 'win32', delaysMs: [1, 1], rename });
    assert.equal(calls(), 3, `${code}：恰 3 次尝试`);
    assert.equal(await fs.readFile(target, 'utf8'), `content-${code}`);
    assert.deepEqual(await tmpLeftovers(dir), [], `${code}：成功后无 tmp 残留`);
  }
});

test('T2×3：win32 一直失败——三码各一格；抛最后一次的原始错误对象且 tmp 已清', async () => {
  for (const code of RETRYABLE_CODES) {
    const dir = await scratchDir('trivium-fsxwa-');
    const target = path.join(dir, 'status.json');
    const last = errOf(code, 'last');
    const { rename, calls } = scriptedRename([errOf(code, '1st'), errOf(code, '2nd'), last]);
    await assert.rejects(
      writeAtomic(target, 'x', { platform: 'win32', delaysMs: [1, 1], rename }),
      (e: unknown) => e === last,
      `${code}：抛出的是最后一次注入的同一错误对象（引用相等，不包装）`,
    );
    assert.equal(calls(), 3, `${code}：恰 3 次尝试（delays 2 档 + 首次）`);
    assert.deepEqual(await tmpLeftovers(dir), [], `${code}：耗尽后 tmp 已清`);
  }
});

test('T3：win32 非重试类错误码立即抛出——恰 1 次、tmp 不清（与原先行为一致）', async () => {
  const dir = await scratchDir('trivium-fsxwa-');
  const target = path.join(dir, 'status.json');
  const { rename, calls } = scriptedRename([errOf('ENOENT')]);
  await assert.rejects(writeAtomic(target, 'x', { platform: 'win32', delaysMs: [1, 1], rename }), { code: 'ENOENT' });
  assert.equal(calls(), 1, '非三码不进重试循环');
  assert.equal((await tmpLeftovers(dir)).length, 1, '立即抛出的路径不清 tmp（POSIX 与 win32 同形）');
});

test('T4：非 win32 不重试——darwin 与 linux 各一格；恰 1 次、错误透传、tmp 不清', async () => {
  for (const platform of ['darwin', 'linux'] as const) {
    const dir = await scratchDir('trivium-fsxwa-');
    const target = path.join(dir, 'status.json');
    const { rename, calls } = scriptedRename([errOf('EPERM')]);
    await assert.rejects(writeAtomic(target, 'x', { platform, delaysMs: [1, 1], rename }), { code: 'EPERM' });
    assert.equal(calls(), 1, `${platform}：单次直通，EPERM 也不重试`);
    assert.equal((await tmpLeftovers(dir)).length, 1, `${platform}：tmp 不清（POSIX 分支行为与原先逐字相同）`);
  }
});

test('T5：win32 首次成功——恰 1 次、内容正确、无 tmp', async () => {
  const dir = await scratchDir('trivium-fsxwa-');
  const target = path.join(dir, 'status.json');
  const { rename, calls } = scriptedRename([OK_STEP]);
  await writeAtomic(target, 'fresh', { platform: 'win32', delaysMs: [1, 1], rename });
  assert.equal(calls(), 1);
  assert.equal(await fs.readFile(target, 'utf8'), 'fresh');
  assert.deepEqual(await tmpLeftovers(dir), []);
});

test('T6：后写者胜（形式语义）——最后一次成功的 rename 胜；重试只延后同一覆盖动作', async () => {
  // 注释口径（计划 r2 §4.1，CODEX-02）：钉的是「最后一次成功 rename 胜」的形式语义；
  // 「延迟者内容较旧」的方向不在此断言，由计划 §3.5 的逐文件分析承接。
  const dir = await scratchDir('trivium-fsxwa-');
  const target = path.join(dir, 'status.json');
  let aCalls = 0;
  let aFirstEntered!: () => void;
  const aEntered = new Promise<void>((r) => {
    aFirstEntered = r;
  });
  let bFinished!: () => void;
  const bDoneGate = new Promise<void>((r) => {
    bFinished = r;
  });
  const renameA = (from: string, to: string): Promise<void> => {
    if (aCalls++ === 0) {
      aFirstEntered();
      // 首试挂起：等 B 完整落地后才以 EPERM 失败，制造「A 的重试排在 B 之后」的确定次序
      return bDoneGate.then(() => Promise.reject(errOf('EPERM', 'A 首试让位')));
    }
    return renameForReal(from, to);
  };
  const pA = writeAtomic(target, 'A', { platform: 'win32', delaysMs: [1], rename: renameA });
  await aEntered; // A 的首试已进入（挂起中），tmp-A 已写下
  // 隔开毫秒：tmp 名 = pid + Date.now()（毫秒粒度），B 与 A 同毫秒取名会撞同一个 tmp 路径
  // （B 覆写 A 的 tmp 并 rename 走，A 的重试拿到 ENOENT）——这是 tmp 名形状的已知边界，
  // 生产面各目标或经锁/链串行、或跨进程（pid 不同），不触发（代码双审 CODEX-01，测试侧隔离）
  await new Promise((r) => setTimeout(r, 3));
  await writeAtomic(target, 'B', { platform: 'win32', delaysMs: [], rename: renameForReal });
  assert.equal(await fs.readFile(target, 'utf8'), 'B', 'B 先完整落地');
  bFinished(); // 放行 A 的首试失败 → 1 ms 退避 → 重试覆盖
  await pA;
  assert.equal(await fs.readFile(target, 'utf8'), 'A', '后执行的 rename 胜（A 的重试在 B 之后完成覆盖）');
  assert.deepEqual(await tmpLeftovers(dir), []);
});

test('T7：renameOverwriting 直用（stashVoidedOutput 同形）——目录 rename 的 win32 重试', async () => {
  // 重试后成功
  {
    const dir = await scratchDir('trivium-fsxwa-');
    const src = path.join(dir, 'out');
    const dst = path.join(dir, 'voided');
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(path.join(src, 'result.json'), '{}');
    let calls = 0;
    await renameOverwriting(src, dst, {
      platform: 'win32',
      delaysMs: [1],
      rename: (f, t) => (++calls === 1 ? Promise.reject(errOf('EBUSY')) : renameForReal(f, t)),
    });
    assert.equal(calls, 2);
    assert.equal(await fs.readFile(path.join(dst, 'result.json'), 'utf8'), '{}');
    await assert.rejects(fs.access(src), '源目录已挪走');
  }
  // 耗尽：抛最后一次原始错误；不带 onExhausted 时不碰源路径
  {
    const dir = await scratchDir('trivium-fsxwa-');
    const src = path.join(dir, 'out');
    const dst = path.join(dir, 'voided');
    await fs.mkdir(src, { recursive: true });
    const last = errOf('EACCES', 'last');
    await assert.rejects(
      renameOverwriting(src, dst, {
        platform: 'win32',
        delaysMs: [1],
        rename: (_f, _t) => Promise.reject(last),
      }),
      (e: unknown) => e === last,
    );
    await fs.access(src); // 源还在：原语不清理 from（清理决策归调用方）
  }
});

test('T9：onExhausted 自身异常不顶替原始错误（AGY-01）', async () => {
  const last = errOf('EPERM', 'rename-last');
  await assert.rejects(
    renameOverwriting('from-x', 'to-y', {
      platform: 'win32',
      delaysMs: [],
      rename: (_f, _t) => Promise.reject(last),
      onExhausted: () => Promise.reject(errOf('EACCES', 'cleanup-boom')),
    }),
    (e: unknown) => e === last,
    '抛出的必须是 rename 的原始错误，不是清理回调的错误',
  );
});

test('T10：缺省重试表钉值——6 次尝试、总睡眠 775 ms（预算论证的受保护事实，代码双审 CODEX-03 / CLAUDE-01）', () => {
  assert.deepEqual([...WIN_RENAME_RETRY_DELAYS_MS], [25, 50, 100, 200, 400]);
  assert.equal(
    WIN_RENAME_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0),
    775,
    '总睡眠上界 775 ms：Hook 15 s 占 5%、取锁等待 4 s 占 19% 的论证全部建立在这个数上',
  );
});
