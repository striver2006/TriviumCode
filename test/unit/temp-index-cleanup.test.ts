/**
 * EV-204：`workTreeHash` 临时索引目录与自检夹具的删除收尾，以及 `src/` 全树的递归删除守卫。
 *
 * 此前 `workTreeHash` 的 finally 是裸 `fs.rm({ recursive: true, force: true })`，`force` 只吞 ENOENT：
 * 删不掉时哈希已经算出来却被删除异常顶替，git 某一步失败时删除异常还会顶替真正的失败原因。
 * 自检两处同形：建夹具失败那一处因 `root` 尚未赋值而走不到，`finish` 那一处的拒绝穿出 runSelftest。
 *
 * 四组，全部零配额（只用本机 git，自检不起打包 CLI）：
 *   G：`workTreeHash` 直测——删成功、删不掉照常返回哈希、git 步骤失败与超时时报原始错误、提示逐字且同一进程只打一次；
 *   S：`runSelftest` 经注入口换掉建夹具的最后一步（`initFixtureRepo`），`mkdtemp` 与 `made.dir` 赋值仍走生产路径；
 *      `finish` 那一支的行为级用例在 `test/integration/selftest.test.ts`（打包 CLI）；
 *   W：`src/` 全树的递归删除按豁免表逐文件计数（计划 r2 §2.5）。
 *
 * **摆锁法**：git clean 过滤器。`workTreeHash` 的 `add -A` 对每个文件跑过滤器（临时索引由 `read-tree HEAD` 填充、
 * 没有 stat 信息），过滤器子进程继承 git 的环境——包括 `GIT_INDEX_FILE`。脚本在它所在的目录里建 `locked/`、
 * 放文件 `f`、改 0o500（空的只读目录锁不住），最后 `cat` 原样输出，哈希不变。
 * **git 机制前提**（计划双审 CODEX-03）：clean 过滤器继承 git 的环境；`filter.<名>.required`（G3）。本机 git 2.54.0 实测。
 * 过滤器第一次被调就写标记文件，用例先断言标记在——「环境没跑过滤器」与「改动错了」是两种红。
 *
 * **错误码取实际值**（计划双审 CODEX-02）：只读子目录里删文件在 APFS 非 root 下是 EACCES，不是 Node 契约；
 * 断言码属于 {EACCES, EPERM}，期望措辞用同一个实际码拼。涉及权限的格 root 下跳过。
 * 收尾在 finally 里**重新列**私有根恢复权限再整删（EV-200：被测函数抛出时，依赖其返回值的收尾收不了）。
 * 每格钉 `TMPDIR` / `HOME` 到私有根，`TMPDIR` 在假家目录下，家目录归一能测出 `~/tmp/…`。
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { REPO_ROOT } from '../helpers/fixture.js';
import { countRecursiveRm, tsFiles } from '../helpers/recursive-rm.js';
import { GitTimeoutError, indexResidueText, initFixtureRepo, workTreeHash } from '../../src/trivium/util/git.js';
import { renderSelftest, runSelftest, selftestResidueText } from '../../src/trivium/selftest.js';
import { run } from '../../src/trivium/util/exec.js';

const SYSTEM_TMP = os.tmpdir();
const ROOT = process.getuid?.() === 0;
const LOCK_CODES = new Set(['EACCES', 'EPERM']);

/** 文件结束时兜底整删各格私有根（每格自己的 finally 已删，这里只防中途崩）；删不掉就打出来、不吞 */
const CREATED: string[] = [];
after(async () => {
  for (const d of CREATED) {
    await unlockAll(d);
    await fs.rm(d, { recursive: true, force: true, maxRetries: 3 }).catch((e: unknown) => {
      console.warn(`temp-index-cleanup：私有根没删掉，请手工删除 ${d}（${(e as NodeJS.ErrnoException).code ?? String(e)}）`);
    });
  }
});

interface World {
  base: string;
  home: string;
  /** 钉成 TMPDIR 的目录，在假家目录下 */
  tmp: string;
  repo: string;
  /** 过滤器第一次被调时写的标记 */
  mark: string;
}

async function world(): Promise<World> {
  const base = await fs.realpath(await fs.mkdtemp(path.join(SYSTEM_TMP, 'trivium-tic-')));
  CREATED.push(base);
  const home = path.join(base, 'home');
  const tmp = path.join(home, 'tmp');
  const repo = path.join(base, 'repo');
  await fs.mkdir(tmp, { recursive: true });
  await fs.mkdir(path.join(repo, 'src'), { recursive: true });
  await fs.writeFile(path.join(repo, 'README.md'), '# 夹具\n', 'utf8');
  await fs.writeFile(path.join(repo, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
  await initFixtureRepo(repo);
  return { base, home, tmp, repo, mark: path.join(base, 'filter-ran') };
}

/** 把私有根下每个目录恢复成 0o700：被锁的子目录不在固定位置，重新列一遍（不依赖被测函数的返回值） */
async function unlockAll(base: string): Promise<void> {
  const walk = async (d: string): Promise<void> => {
    await fs.chmod(d, 0o700).catch(() => {});
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) if (e.isDirectory()) await walk(path.join(d, e.name));
  };
  await walk(base);
}

/** 钉住 HOME / TMPDIR 跑 fn；结束还原环境、恢复权限、整删私有根 */
async function inWorld<T>(w: World, fn: () => Promise<T>): Promise<T> {
  const saved = { HOME: process.env['HOME'], TMPDIR: process.env['TMPDIR'] };
  process.env['HOME'] = w.home;
  process.env['TMPDIR'] = w.tmp;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await unlockAll(w.base);
    await fs.rm(w.base, { recursive: true, force: true, maxRetries: 3 });
  }
}

/**
 * 给夹具仓库挂锁过滤器。脚本只在 `GIT_INDEX_FILE` 所在目录落在 `w.tmp` 下时上锁（即 `workTreeHash` 的临时索引），
 * 其余情形只 `cat`。`fail`：锁完读掉输入后退 1（配 `required` 让 `git add` 失败）；`sleepS`：锁完睡几秒（造超时）。
 */
async function armLock(w: World, opts: { fail?: boolean; sleepS?: number } = {}): Promise<void> {
  const script = path.join(w.base, 'lock.sh');
  const lines = [
    `: > '${w.mark}'`,
    'd=$(dirname "${GIT_INDEX_FILE:-.}")',
    `case "$d" in '${w.tmp}'/*)`,
    '  if [ ! -d "$d/locked" ]; then mkdir "$d/locked" && : > "$d/locked/f" && chmod 500 "$d/locked"; fi ;;',
    'esac',
    ...(opts.sleepS ? [`sleep ${opts.sleepS}`] : []),
    ...(opts.fail ? ['cat > /dev/null', 'exit 1'] : ['cat']),
    '',
  ];
  await fs.writeFile(script, lines.join('\n'), 'utf8');
  await fs.mkdir(path.join(w.repo, '.git', 'info'), { recursive: true });
  await fs.writeFile(path.join(w.repo, '.git', 'info', 'attributes'), '* filter=trvlock\n', 'utf8');
  await run('git', ['config', 'filter.trvlock.clean', `sh '${script}'`], { cwd: w.repo });
  if (opts.fail) await run('git', ['config', 'filter.trvlock.required', 'true'], { cwd: w.repo });
}

async function indexDirs(w: World): Promise<{ name: string; locked: boolean }[]> {
  const out: { name: string; locked: boolean }[] = [];
  for (const n of (await fs.readdir(w.tmp)).filter((x) => x.startsWith('trivium-index-')).sort()) {
    const locked = await fs.stat(path.join(w.tmp, n, 'locked')).then(() => true, () => false);
    out.push({ name: n, locked });
  }
  return out;
}

async function assertFilterRan(w: World): Promise<void> {
  await fs.access(w.mark).catch(() => {
    assert.fail('过滤器一次都没被调到——是 git 机制前提不成立（版本或配置），不是被测改动的问题');
  });
}

// ─────────────────────────── G：workTreeHash 直测 ───────────────────────────

test('G1 删成功：返回 40 位十六进制，临时索引目录不留', async () => {
  const w = await world();
  await inWorld(w, async () => {
    const h = await workTreeHash(w.repo);
    assert.match(h, /^[0-9a-f]{40}$/);
    assert.deepEqual(await indexDirs(w), []);
  });
});

test('G2 删不掉照常返回已算出的哈希，不抛', { skip: ROOT && 'root 下只读目录锁不住' }, async () => {
  const w = await world();
  await inWorld(w, async () => {
    const baseline = await workTreeHash(w.repo);
    await armLock(w);
    const h = await workTreeHash(w.repo);
    await assertFilterRan(w);
    assert.equal(h, baseline, '过滤器原样输出，哈希应与不挂过滤器时逐字相同');
    const left = await indexDirs(w);
    assert.equal(left.length, 1, '应恰好留下一个临时索引目录');
    assert.ok(left[0]!.locked, '留下的应是带锁的那个');
  });
});

test('G3 git 步骤失败时抛的是原始错误，不被删除失败顶替', { skip: ROOT && 'root 下只读目录锁不住' }, async () => {
  const w = await world();
  await inWorld(w, async () => {
    await armLock(w, { fail: true });
    await assert.rejects(workTreeHash(w.repo), (e: Error) => {
      assert.match(e.message, /git add to temp index failed/);
      assert.doesNotMatch(e.message, /EACCES|EPERM|ENOTEMPTY/, `删除错误顶替了原始错误：${e.message}`);
      return true;
    });
    await assertFilterRan(w);
    const left = await indexDirs(w);
    assert.equal(left.length, 1);
    assert.ok(left[0]!.locked, '临时索引目录应带锁留下——证明删除确实失败过、而且没顶替');
  });
});

test('G3b git 步骤超时时抛的仍是 GitTimeoutError，不被删除失败顶替', { skip: ROOT && 'root 下只读目录锁不住' }, async () => {
  const w = await world();
  await inWorld(w, async () => {
    await armLock(w, { sleepS: 5 });
    await assert.rejects(workTreeHash(w.repo, { timeoutMs: 300 }), (e: unknown) => {
      assert.ok(e instanceof GitTimeoutError, `应为 GitTimeoutError，实际：${String(e)}`);
      assert.equal(e.timedOut, true);
      assert.equal(e.what, 'add');
      return true;
    });
    await assertFilterRan(w);
    const left = await indexDirs(w);
    assert.equal(left.length, 1);
    assert.ok(left[0]!.locked);
  });
});

test('G4 提示逐字、家目录归一，同一进程连续两次删不掉只提示一次（子进程）', { skip: ROOT && 'root 下只读目录锁不住' }, async () => {
  const w = await world();
  await inWorld(w, async () => {
    await armLock(w);
    const gitJs = new URL('../../src/trivium/util/git.js', import.meta.url).href;
    const code = [
      'const { workTreeHash } = await import(process.env.TIC_GITJS);',
      'await workTreeHash(process.env.TIC_REPO);',
      'await workTreeHash(process.env.TIC_REPO);',
    ].join('\n');
    const r = await run(process.execPath, ['--input-type=module', '-e', code], {
      env: { HOME: w.home, TMPDIR: w.tmp, TIC_GITJS: gitJs, TIC_REPO: w.repo },
      timeoutMs: 60_000,
    });
    assert.equal(r.code, 0, `子进程应正常结束：${r.stderr}`);
    await assertFilterRan(w);
    const left = await indexDirs(w);
    assert.equal(left.length, 2, '两次都删不掉，两个目录都应留下');
    assert.ok(left.every((d) => d.locked));

    const lines = r.stderr.split('\n').filter((l) => l.length > 0);
    assert.equal(lines.length, 1, `stderr 应恰好一行：\n${r.stderr}`);
    const m = /删除失败（([A-Z]+)）：~\/tmp\/(trivium-index-[^ ]+) 仍在/.exec(lines[0]!);
    assert.ok(m, `提示形态不符（要错误码与 ~ 归一的路径）：${lines[0]}`);
    assert.ok(LOCK_CODES.has(m[1]!), `错误码 ${m[1]} 不在 {EACCES, EPERM} 内`);
    assert.ok(left.some((d) => d.name === m[2]), `提示里的目录 ${m[2]} 不是留下的那两个之一`);
    // indexResidueText 在本进程算：本进程的 HOME 此刻也钉在 w.home
    assert.equal(lines[0], `⚠️  ${indexResidueText(path.join(w.tmp, m[2]!), m[1]!)}`);
  });
});

// ─────────────────────────── S：selftest 收尾 ───────────────────────────

/** 不会被调到：建夹具这一步就失败了 */
const NEVER_CALLED = '/nonexistent/trivium-selftest-never-called.cjs';

test('S1 建夹具失败且删不掉：报的仍是建夹具失败的原因，残留提示另放、目录给出', { skip: ROOT && 'root 下只读目录锁不住' }, async () => {
  const w = await world();
  await inWorld(w, async () => {
    const r = await runSelftest({ selfScript: NEVER_CALLED }, {
      initFixtureRepo: async (dir) => {
        await fs.mkdir(path.join(dir, 'locked'));
        await fs.writeFile(path.join(dir, 'locked', 'f'), '', 'utf8');
        await fs.chmod(path.join(dir, 'locked'), 0o500);
        throw new Error('造的建夹具失败');
      },
    });
    assert.equal(r.ok, false);
    assert.deepEqual(r.steps.map((s) => [s.name, s.ok, s.detail]), [['创建夹具仓库', false, '造的建夹具失败']]);
    assert.ok(r.fixtureRoot.startsWith(path.join(w.tmp, 'trivium-selftest-')), `fixtureRoot 应是那个目录：${r.fixtureRoot}`);
    await fs.access(r.fixtureRoot);
    const m = /删除失败（([A-Z]+)）/.exec(r.cleanupResidue ?? '');
    assert.ok(m && LOCK_CODES.has(m[1]!), `残留提示缺错误码：${r.cleanupResidue}`);
    assert.equal(r.cleanupResidue, selftestResidueText(r.fixtureRoot, m[1]!));
    assert.match(r.cleanupResidue!, /：~\/tmp\/trivium-selftest-/, '路径要家目录归一');
    assert.equal(r.kept, false);
  });
});

test('S2 建夹具失败而删掉了：无残留提示，fixtureRoot 为空、目录已不在', async () => {
  const w = await world();
  await inWorld(w, async () => {
    const r = await runSelftest({ selfScript: NEVER_CALLED }, {
      initFixtureRepo: async () => {
        throw new Error('造的建夹具失败');
      },
    });
    assert.equal(r.ok, false);
    assert.equal(r.steps[0]!.detail, '造的建夹具失败');
    assert.equal(r.cleanupResidue, null);
    assert.equal(r.fixtureRoot, '');
    assert.deepEqual((await fs.readdir(w.tmp)).filter((n) => n.startsWith('trivium-selftest-')), []);
  });
});

test('S4 渲染：有残留提示时打这一句、不说「夹具已清理」；没有时原样', () => {
  const base = { ok: true, steps: [], fixtureRoot: '/x', kept: false, notCovered: [] };
  const residue = selftestResidueText('/x/trivium-selftest-abc', 'EACCES');
  const withResidue = renderSelftest({ ...base, cleanupResidue: residue });
  assert.ok(withResidue.includes(residue), withResidue);
  assert.doesNotMatch(withResidue, /夹具已清理/);
  assert.match(renderSelftest({ ...base, cleanupResidue: null }), /夹具已清理/);
});

// ─────────────────────────── W：src/ 全树守卫 ───────────────────────────

/**
 * 有意保留的递归删除（计划 r2 §2.5、§3）。计数**相等**才过：新增一处当场红，豁免项改掉而表没更新也红。
 * - `fsx.ts` × 1：`tryRemoveTempDir` 本体（带 maxRetries、失败不抛）；
 * - `install.ts` × 3：用户在终端主动执行的安装 / 卸载，删的是安装落点，删不掉直接报错由人当场处理；
 * - `lock.ts` × 1：`resetStopBlockCount`，四个调用点里三处是已生效操作的后置清理，另登 EV-206。
 */
const RECURSIVE_RM_EXEMPT: Record<string, number> = {
  'src/install.ts': 3,
  'src/trivium/lock.ts': 1,
  'src/trivium/util/fsx.ts': 1,
};

test('W src/ 全树的递归删除只剩豁免表里的那几处，其余一律经 tryRemoveTempDir', async () => {
  const files = await tsFiles(path.join(REPO_ROOT, 'src'));
  assert.ok(files.length > 50, `只扫到 ${files.length} 个文件——扫描写错了会让本条永绿`);
  const hits: Record<string, number> = {};
  for (const { name, src } of files) {
    const k = countRecursiveRm(src);
    if (k > 0) hits[name.split(path.sep).join('/')] = k;
  }
  assert.deepEqual(
    hits,
    RECURSIVE_RM_EXEMPT,
    'src/ 下递归删除（rm / rmdir / rmSync 带 recursive）的分布与豁免表不符：删不掉会从 finally 抛出、顶替原结果（EV-204）。' +
      '新增的改调 util/fsx.ts 的 tryRemoveTempDir；确属有意保留的在豁免表登记理由；豁免项已改掉的从表里删去',
  );
});
