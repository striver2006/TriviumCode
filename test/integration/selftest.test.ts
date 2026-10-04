import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { ASSET_ROOT, BUNDLE, bundleMissing, bundleSkipReason } from '../helpers/fixture.js';
import { run } from '../../src/trivium/util/exec.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { STUB_ENV_VAR } from '../../src/trivium/adapters/stub.js';
import { DEFAULT_CRITICS } from '../../src/trivium/types.js';

/**
 * `doctor --selftest` 本身的回归（交付物 8）。
 *
 * 它是新用户装完之后唯一能问「到底装好了没有」的命令，所以它自己坏了必须被发现：
 * 一个永远报通过的自检比没有自检更糟。
 */

async function selftest(args: string[] = [], env: Record<string, string | undefined> = {}) {
  return run(process.execPath, [BUNDLE, 'doctor', '--selftest', ...args], {
    // 故意不在项目根跑：selftest 用自己的临时夹具，不该依赖当前目录是不是已 init
    cwd: '/tmp',
    env: { TRIVIUM_ASSET_ROOT: ASSET_ROOT, [STUB_ENV_VAR]: undefined, ...env },
    timeoutMs: 300_000,
  });
}

test('自检整体通过，且每一步都被列出', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await selftest();
  assert.equal(r.code, EXIT.OK, `自检应通过：\n${r.stdout}\n${r.stderr}`);
  const out = r.stdout + r.stderr;
  assert.match(out, /自检：✅ 通过（(\d+)\/\1 步）/, '通过时分子分母必须相等');

  /*
   * 逐条点名几个最关键的不变量，防止步骤被悄悄删掉而自检仍然「通过」。
   *
   * **这里的措辞不得写死侧数**：原先点的是「两侧审查文档均已落盘」，
   * 而 selftest 的步骤名随缺省集合派生（r12 CODEX-04 ≡ GLM-03 改的就是这个）。
   * 缺省集合一变，这条断言会因为一个纯文案差异变红，掩盖它真正要守的东西
   * ——「落盘核验这一步还在不在」。
   */
  for (const key of [
    '双审启动', '双审收敛', '审查文档均已落盘',
    '裁决未齐备时禁止提交', '裁决未齐备时禁止收工',
    '裁决完整性校验通过', '工件齐备', '裁决齐备后放行提交',
    '禁止主脑自行产出', '编译测试出口真实执行', '复盘可生成', '重跑抬升 -r2',
  ]) {
    assert.match(out, new RegExp(key), `自检必须覆盖「${key}」`);
  }

  /*
   * 落盘核验必须**逐侧**点名，不能只看那一行在不在。
   *
   * r12 三侧独立指出：该步骤曾只断言两个写死的后缀，缺省集合的首侧没落盘也照样绿。
   * 这条断言锁住修复本身——步骤名里的家数得跟缺省集合对得上。
   */
  assert.match(
    out,
    new RegExp(`工件齐备（AC-01：原稿 \\+ ${DEFAULT_CRITICS.length} 侧审查 \\+ 裁决件`),
    `工件计数必须随缺省集合派生（当前 ${DEFAULT_CRITICS.length} 侧），不得停在「四件套」`,
  );
});

test('必须写明未覆盖的边界——别让人把它读成「那几家 CLI 能用」', { skip: bundleMissing && bundleSkipReason }, async () => {
  const r = await selftest();
  const out = r.stdout + r.stderr;
  assert.match(out, /本次自检\*\*未\*\*覆盖/);
  assert.match(out, /桩适配器/);
  assert.match(out, /trivium doctor.*trivium preflight|preflight/s, '必须指向真正能验各侧 CLI 的命令');
});

test('不在项目根、当前项目未 init 也能跑', { skip: bundleMissing && bundleSkipReason }, async () => {
  // cwd 是 /tmp，那里没有 .trivium/config.yaml。装完还没 init 的时刻正是最需要它的时候
  const r = await selftest();
  assert.equal(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stdout + r.stderr, /不在 git 仓库|尚未初始化/);
});

/**
 * 私有临时目录（EV-207）：下面几格把自检的 `TMPDIR` 钉到这里，跑完能数清它留下了什么；
 * 收尾只删本格 mkdtemp 的返回值，不拿自检输出里的路径去删。`TMPDIR` 在假家目录下，家目录归一能测出 `~/tmp/…`。
 */
async function privateTmp(tag: string): Promise<{ base: string; home: string; tmp: string }> {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `trivium-${tag}-`)));
  const home = path.join(base, 'home');
  const tmp = path.join(home, 'tmp');
  await fs.mkdir(tmp, { recursive: true });
  return { base, home, tmp };
}

/** 先逐层恢复权限（每层先 chmod 自身再列目录）再整删；删不掉打一行，不吞 */
async function dropPrivateTmp(base: string): Promise<void> {
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
  await fs.rm(base, { recursive: true, force: true, maxRetries: 3 }).catch((e: unknown) => {
    console.warn(`selftest.test：私有目录没删掉，请手工删除 ${base}（${(e as NodeJS.ErrnoException).code ?? String(e)}）`);
  });
}

async function selftestEntries(tmp: string): Promise<string[]> {
  return (await fs.readdir(tmp)).filter((n) => n.startsWith('trivium-selftest-')).sort();
}

test('EV-207 ST1 通过时清理夹具：夹具仓库与运行目录一起删掉，系统临时目录里不留任何 trivium-selftest-*', { skip: bundleMissing && bundleSkipReason }, async () => {
  const w = await privateTmp('st1');
  try {
    const clean = await selftest([], { TMPDIR: w.tmp, HOME: w.home });
    assert.equal(clean.code, EXIT.OK, `${clean.stdout}${clean.stderr}`);
    assert.match(clean.stdout, /夹具已清理/, `通过时应清理夹具：\n${clean.stdout}`);
    // 此前会剩一个 `trivium-selftest-XXXXXX-runs`（运行根是夹具根的兄弟目录，无人删）
    assert.deepEqual(await selftestEntries(w.tmp), []);
  } finally {
    await dropPrivateTmp(w.base);
  }
});

test('EV-207 ST3 --keep-fixture 时整个父目录保留：给出夹具仓库与运行目录，两者同父', { skip: bundleMissing && bundleSkipReason }, async () => {
  const w = await privateTmp('st3');
  try {
    const kept = await selftest(['--keep-fixture'], { TMPDIR: w.tmp, HOME: w.home });
    assert.equal(kept.code, EXIT.OK, `${kept.stdout}${kept.stderr}`);
    const p = /夹具保留在 (\S+)/.exec(kept.stdout);
    assert.ok(p, `--keep-fixture 应保留并给出路径：\n${kept.stdout}`);
    const root = p[1]!;
    const entries = await selftestEntries(w.tmp);
    assert.equal(entries.length, 1, `私有 TMPDIR 下只该有一个自检目录：${entries.join(', ')}`);
    const parent = path.join(w.tmp, entries[0]!);
    assert.equal(root, path.join(parent, 'repo'));
    assert.ok(
      kept.stdout.includes(`运行目录（worker 日志、交接文件与状态文件）在 ${path.join(parent, 'runs')}；两者同在 ${parent} 下`),
      `保留时要给出运行目录与父目录：\n${kept.stdout}`,
    );
    // 运行目录里真有本次运行：<repoId>/<run_id>/status.json
    const runFiles = await listFilesUnder(path.join(parent, 'runs'));
    assert.ok(runFiles.some((f) => f.endsWith('/status.json')), `运行目录里应有本次运行的 status.json：${runFiles.join(', ')}`);
    // 夹具必须真是「故意留洞」的项目（§17.3），否则拿去手工验收没有意义
    const payment = await fs.readFile(`${root}/src/payment.ts`, 'utf8');
    assert.match(payment, /故意留的洞/);
    assert.match(payment, /幂等/);
  } finally {
    await dropPrivateTmp(w.base);
  }
});

test('环境坏掉时如实报失败并保留夹具，绝不假装通过', { skip: bundleMissing && bundleSkipReason }, async () => {
  const w = await privateTmp('stbad');
  try {
    const r = await selftest([], { TRIVIUM_ASSET_ROOT: '/nonexistent/assets', TMPDIR: w.tmp, HOME: w.home });
    assert.equal(r.code, EXIT.FAIL, '资产根不存在时必须失败');
    const out = r.stdout + r.stderr;
    assert.match(out, /自检：❌ 未通过/);
    assert.match(out, /lenses\.yaml/, '要指出具体缺什么');

    const p = /夹具保留在 (\S+)/.exec(out);
    assert.ok(p, '失败时必须保留夹具供排查');
    assert.equal((await selftestEntries(w.tmp)).length, 1, '失败时整个父目录保留');
  } finally {
    // EV-207：不再按输出里的路径删（那只删得到夹具仓库），整删本格私有目录
    await dropPrivateTmp(w.base);
  }
});

async function listFilesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) await walk(abs);
      else out.push(abs);
    }
  };
  await walk(dir);
  return out;
}

/**
 * EV-207 ST2（由 EV-204 S3 改造）：自检通过而临时目录删不掉——结论不变（退 0、N/N 步），给出残留提示、不说「夹具已清理」。
 *
 * EV-204 修的是：`finish` 里的裸递归删除抛出，而调用处是不带 await 的 `return finish(…)`，拒绝穿出 runSelftest，
 * 一次已经得出结论的自检崩成内部错误。EV-207 起删的是夹具仓库 `repo/` 与运行根 `runs/` 的父目录，
 * 提示给出的是父目录、措辞覆盖两者，且系统临时目录里不再有兄弟 `-runs`。
 *
 * 摆锁：`GIT_CONFIG_GLOBAL` 指向私有配置挂 git clean 过滤器（`core.attributesFile`），只在 `GIT_INDEX_FILE` 为空
 * （即 `initFixtureRepo` 的普通 `git add`，不是 `workTreeHash` 的临时索引）且 cwd 在钉住的 `TMPDIR` 下时，
 * 往夹具仓库的**父目录**摆只读锁 `trvlock/`——在工作树之外，不影响任何一步。
 * **git 机制前提**：`GIT_CONFIG_GLOBAL`（约 git 2.32 起）、clean 过滤器继承 git 的环境且 cwd 是工作树根；本机 git 2.54.0 实测。
 * 过滤器第一次被调就写标记，先断言标记在。涉及权限，root 下跳过。
 */
test('EV-207 ST2 临时目录删不掉时结论不变、提示给出父目录且覆盖运行目录，不说「夹具已清理」', { skip: (bundleMissing && bundleSkipReason) || (process.getuid?.() === 0 && 'root 下只读目录锁不住') }, async () => {
  const w = await privateTmp('stc');
  const mark = path.join(w.base, 'filter-ran');
  try {
    const script = path.join(w.base, 'lock.sh');
    await fs.writeFile(
      script,
      [
        `: > '${mark}'`,
        'if [ -z "${GIT_INDEX_FILE:-}" ]; then',
        `  case "$(pwd -P)" in '${w.tmp}'/*)`,
        '    p=$(cd .. && pwd -P)',
        '    if [ ! -d "$p/trvlock" ]; then mkdir "$p/trvlock" && : > "$p/trvlock/f" && chmod 500 "$p/trvlock"; fi ;;',
        '  esac',
        'fi',
        'cat',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(path.join(w.base, 'attributes'), '* filter=trvlock\n', 'utf8');
    await fs.writeFile(
      path.join(w.base, 'gitconfig'),
      `[core]\n\tattributesFile = ${path.join(w.base, 'attributes')}\n[filter "trvlock"]\n\tclean = sh '${script}'\n`,
      'utf8',
    );

    const r = await selftest([], { TMPDIR: w.tmp, HOME: w.home, GIT_CONFIG_GLOBAL: path.join(w.base, 'gitconfig') });
    await fs.access(mark).catch(() => {
      assert.fail('过滤器一次都没被调到——是 git 机制前提不成立（GIT_CONFIG_GLOBAL 等），不是被测改动的问题');
    });
    const out = r.stdout + r.stderr;
    assert.equal(r.code, EXIT.OK, `删不掉临时目录不该改写自检结论：\n${out}`);
    assert.match(out, /自检：✅ 通过（(\d+)\/\1 步）/);
    const entries = await selftestEntries(w.tmp);
    assert.equal(entries.length, 1, `私有 TMPDIR 下只该剩被锁住的那一个父目录、没有兄弟 -runs：${entries.join(', ')}`);
    await fs.access(path.join(w.tmp, entries[0]!, 'trvlock'));
    const m = /自检临时目录删除失败（(EACCES|EPERM)）：(~\/tmp\/trivium-selftest-[^/\s]+) 仍在——([^\n]*)/.exec(out);
    assert.ok(m, `残留提示形态不符（要错误码与家目录归一的父目录路径）：\n${out}`);
    assert.equal(m[2], `~/tmp/${entries[0]}`, '提示给出的是父目录本身');
    assert.match(m[3]!, /夹具仓库.*运行目录/, '措辞要覆盖夹具仓库与运行目录两者');
    assert.doesNotMatch(out, /夹具已清理/, '没删掉就不能说已清理');
  } finally {
    await dropPrivateTmp(w.base);
  }
});
