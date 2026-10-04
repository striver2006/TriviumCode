/**
 * EV-209：建仓步骤失败显式化。
 *
 * 此前 `initFixtureRepo` 的六步裸调用不看 git 的结果，git 缺失或某一步失败时静默建出残缺的夹具；
 * 探针夹具在之后的工作树哈希处抛出、已建目录无人删，doctor 的四段探针调用没有 try，崩成「内部错误」。
 *
 * 三组，全部零配额（只用本机 git、假 git 与假入口，不拉任何真实 CLI）：
 *   U：`initFixtureRepo` 直测——逐步查结果、第一步失败即停、空目录恒有 HEAD；成文函数喂合成 `RunResult`（不真等 30 秒）；
 *   P：两个夹具工厂——建到一半抛出时删掉已建目录、抛 `ProbeFixtureError`，删不掉时残留提示接在原因后面；
 *   D：doctor 层经四侧假入口——该侧一条 blocker、落盘结论不动、其余侧照常；claude 记忆一格出 warning。
 *
 * 每格在 `scratchDir` 建私有根，钉 `HOME`、`TMPDIR`（在假家目录下，家目录归一测得出 `~/tmp/…`）与 `PATH`（假 git 在前），
 * 残留断言只数私有 `TMPDIR`。收尾在 finally 里还原环境、逐层恢复权限后整删私有根。涉及权限的格 root 下跳过。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import YAML from 'yaml';
import { scratchDir } from '../helpers/scratch.js';
import { FAKE_GIT_STDERR, FAKE_GIT_STDOUT_LINE, FIXTURE_STEP_KEYS, writeFakeGit } from '../helpers/fake-git.js';
import {
  FIXTURE_REPO_STEPS,
  fixtureRepoStepError,
  initFixtureRepo,
} from '../../src/trivium/util/git.js';
import { run, type RunResult } from '../../src/trivium/util/exec.js';
import {
  createFixture,
  createMemoryFixture,
  fixtureResidueText,
  ProbeFixtureError,
} from '../../src/trivium/probes/fixture.js';
import { guardFixture, memoryFixtureWarning, probeFixtureBlocker, runDoctor } from '../../src/trivium/doctor.js';
import { agentConfigOf, defaultConfig, defaultProbe } from '../../src/trivium/config.js';
import { ZCODE_BUILTIN_PROVIDER_ENV, type ZcodeInvokeOptions, type ZcodeInvokeOutcome } from '../../src/trivium/adapters/zcode.js';
import type { Config } from '../../src/trivium/types.js';

const ROOT = process.getuid?.() === 0;
const ORIG_PATH = process.env['PATH'] ?? '';
const PROBE_PREFIX = 'trivium-probe-';
const MEM_PREFIX = 'trivium-probe-mem-';

interface World {
  base: string;
  home: string;
  /** 钉成 TMPDIR 的目录，在假家目录下 */
  tmp: string;
  /** 假 git 与假入口所在目录，钉在 PATH 最前 */
  bin: string;
  /** 假 git 的调用日志与计数文件 */
  log: string;
  counter: string;
}

async function world(): Promise<World> {
  const base = await fs.realpath(await scratchDir('trivium-fri-'));
  const home = path.join(base, 'home');
  const tmp = path.join(home, 'tmp');
  const bin = path.join(base, 'bin');
  await fs.mkdir(tmp, { recursive: true });
  await writeFakeGit(bin);
  return { base, home, tmp, bin, log: path.join(base, 'git.log'), counter: path.join(base, 'git.count') };
}

/** 逐层恢复权限（每层先 chmod 自身再列目录）后整删；删不掉就抛、让本格红 */
async function drop(base: string): Promise<void> {
  const walk = async (d: string): Promise<void> => {
    await fs.chmod(d, 0o700).catch(() => {});
    const entries = await fs.readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of entries) if (e.isDirectory()) await walk(path.join(d, e.name));
  };
  await walk(base);
  await fs.rm(base, { recursive: true, force: true, maxRetries: 3 });
}

/**
 * 钉住 HOME / TMPDIR / PATH 与假 git 的开关跑 fn；结束还原环境、整删私有根。
 * `extra` 里给了 `PATH` 就用它（「没有 git」那几格），否则假 git 在前、其后是原 PATH。
 */
async function inWorld<T>(w: World, extra: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const env: Record<string, string | undefined> = {
    HOME: w.home,
    TMPDIR: w.tmp,
    PATH: `${w.bin}${path.delimiter}${ORIG_PATH}`,
    FAKE_GIT_LOG: w.log,
    FAKE_GIT_COUNTER: w.counter,
    ...extra,
  };
  const keys = [
    ...new Set([...Object.keys(env), 'FAKE_GIT_FAIL', 'FAKE_GIT_NTH', 'FAKE_GIT_CODE', 'FAKE_GIT_LOCK', 'FAKE_GIT_STDOUT_ONLY']),
  ];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) {
    const v = env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await drop(w.base);
  }
}

/** 私有 TMPDIR 下以 prefix 开头的条目（记忆夹具也以 `trivium-probe-` 开头，主夹具要排掉它） */
async function left(w: World, prefix: string, exclude?: string): Promise<string[]> {
  const all = await fs.readdir(w.tmp).catch(() => [] as string[]);
  return all.filter((e) => e.startsWith(prefix) && !(exclude && e.startsWith(exclude))).map((e) => path.join(w.tmp, e));
}

async function gitCalls(w: World): Promise<string[]> {
  return (await fs.readFile(w.log, 'utf8').catch(() => '')).split('\n').filter(Boolean);
}

/** 合成一个 `RunResult`（成文函数直测用） */
function rr(over: Partial<RunResult>): RunResult {
  return {
    code: 0, signal: null, stdout: '', stderr: '', durationMs: 1,
    timedOut: false, earlyStopped: false, truncated: false, commandLine: 'git',
    ...over,
  };
}

/** 假 git 第 n 步退 code 时，`initFixtureRepo` 应抛的文案 */
const stepFail = (n: number, code = 1): string =>
  fixtureRepoStepError(n, rr({ code, stderr: `${FAKE_GIT_STDERR.join('\n')}\n` }));

// ─────────────────────────── U：initFixtureRepo 直测 ───────────────────────────

test('U1 有内容的目录、真 git：建出带基线提交的仓库，提交树里有那几个文件', async () => {
  const w = await world();
  await inWorld(w, {}, async () => {
    const dir = path.join(w.base, 'repo');
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), 'hi\n');
    await fs.writeFile(path.join(dir, 'src/a.ts'), 'export {};\n');
    await initFixtureRepo(dir);
    const head = await run('git', ['rev-parse', 'HEAD'], { cwd: dir });
    assert.equal(head.code, 0, head.stderr);
    const ls = await run('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: dir });
    assert.deepEqual(ls.stdout.trim().split('\n').sort(), ['README.md', 'src/a.ts']);
  });
});

test('U2 空目录、真 git：照样有 HEAD，树是空树（决策二，--allow-empty）', async () => {
  const w = await world();
  await inWorld(w, {}, async () => {
    const dir = path.join(w.base, 'empty');
    await fs.mkdir(dir);
    await initFixtureRepo(dir);
    const tree = await run('git', ['rev-parse', 'HEAD^{tree}'], { cwd: dir });
    assert.equal(tree.code, 0, `空目录建仓后应有 HEAD：${tree.stderr}`);
    assert.equal(tree.stdout.trim(), '4b825dc642cb6eb9a060e54bf8d69288fbee4904', '应是空树');
  });
});

test('U3 PATH 里没有 git：第 1 步就抛，原因是启动失败（ENOENT）', async () => {
  const w = await world();
  const noGit = path.join(w.base, 'no-git');
  await fs.mkdir(noGit);
  await inWorld(w, { PATH: noGit }, async () => {
    const dir = path.join(w.base, 'repo');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'f'), 'x');
    await assert.rejects(initFixtureRepo(dir), (e: Error) => {
      assert.equal(e.message, '建仓第 1/6 步「初始化仓库」失败：git 启动失败（spawn git ENOENT）');
      assert.equal(e.message, fixtureRepoStepError(1, rr({ code: null, stderr: '\n[spawn error] spawn git ENOENT' })));
      return true;
    });
  });
});

for (let n = 1; n <= FIXTURE_REPO_STEPS.length; n++) {
  const key = FIXTURE_STEP_KEYS[n - 1]!;
  test(`U${n + 3} 假 git 让第 ${n} 步「${FIXTURE_REPO_STEPS[n - 1]!.name}」退 128：抛出带步骤与 stderr 头三行，后面的步骤一次都没调`, async () => {
    const w = await world();
    await inWorld(w, { FAKE_GIT_FAIL: key, FAKE_GIT_CODE: '128' }, async () => {
      const dir = path.join(w.base, 'repo');
      await fs.mkdir(dir);
      await fs.writeFile(path.join(dir, 'f'), 'x');
      await assert.rejects(initFixtureRepo(dir), (e: Error) => {
        assert.equal(e.message, stepFail(n, 128));
        assert.equal(
          e.message,
          `建仓第 ${n}/6 步「${FIXTURE_REPO_STEPS[n - 1]!.name}」失败：退出码 128：fake git line 1 / fake git line 2 / fake git line 3`,
        );
        return true;
      });
      const calls = await gitCalls(w);
      assert.equal(calls.length, n, `应恰好调了前 ${n} 步：\n${calls.join('\n')}`);
      assert.deepEqual(calls, FIXTURE_REPO_STEPS.slice(0, n).map((s) => s.args.join(' ')));
    });
  });
}

test('U10 提交基线失败而 stderr 为空：原因取 stdout 那一行（git commit 的「无可提交」写在 stdout）', async () => {
  const w = await world();
  await inWorld(w, { FAKE_GIT_FAIL: 'commit', FAKE_GIT_STDOUT_ONLY: '1' }, async () => {
    const dir = path.join(w.base, 'repo');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'f'), 'x');
    await assert.rejects(initFixtureRepo(dir), {
      message: `建仓第 6/6 步「提交基线」失败：退出码 1：${FAKE_GIT_STDOUT_LINE}`,
    });
  });
});

test('U11 成文函数直测：超时先于信号；信号、启动失败（有无 spawn 消息）各一句', () => {
  // ① run 超时时先置 timedOut 再发 SIGTERM，那次的 signal 也非空——先判信号会说成「被信号终止」（计划双审 AGY-03）
  assert.equal(
    fixtureRepoStepError(2, rr({ code: null, signal: 'SIGTERM', timedOut: true })),
    '建仓第 2/6 步「配置提交者邮箱」失败：30 秒内未结束，已终止',
  );
  assert.equal(
    fixtureRepoStepError(5, rr({ code: null, signal: 'SIGKILL' })),
    '建仓第 5/6 步「暂存全部文件」失败：被信号 SIGKILL 终止',
  );
  assert.equal(
    fixtureRepoStepError(1, rr({ code: null, stderr: '\n[spawn error] spawn git ENOENT' })),
    '建仓第 1/6 步「初始化仓库」失败：git 启动失败（spawn git ENOENT）',
  );
  assert.equal(
    fixtureRepoStepError(1, rr({ code: null, stderr: '' })),
    '建仓第 1/6 步「初始化仓库」失败：git 启动失败（原因不明）',
  );
  // 非零退出而两路输出都空：不拼空的冒号
  assert.equal(fixtureRepoStepError(3, rr({ code: 2 })), '建仓第 3/6 步「配置提交者名称」失败：退出码 2');
});

// ─────────────────────────── P：两个夹具工厂 ───────────────────────────

test('P1 createFixture：提交基线失败——抛 ProbeFixtureError、原因带步骤、无残留', async () => {
  const w = await world();
  await inWorld(w, { FAKE_GIT_FAIL: 'commit' }, async () => {
    await assert.rejects(createFixture(), (e: unknown) => {
      assert.ok(e instanceof ProbeFixtureError, String(e));
      assert.equal(e.kind, 'main');
      assert.equal(e.residue, null);
      assert.equal(e.message, `建探针夹具失败：${stepFail(6)}`);
      return true;
    });
    assert.deepEqual(await left(w, PROBE_PREFIX), []);
  });
});

test('P2 createMemoryFixture：提交基线失败——同上，kind 是 memory', async () => {
  const w = await world();
  await inWorld(w, { FAKE_GIT_FAIL: 'commit' }, async () => {
    await assert.rejects(createMemoryFixture(), (e: unknown) => {
      assert.ok(e instanceof ProbeFixtureError, String(e));
      assert.equal(e.kind, 'memory');
      assert.equal(e.residue, null);
      assert.equal(e.message, `建探针夹具失败：${stepFail(6)}`);
      return true;
    });
    assert.deepEqual(await left(w, PROBE_PREFIX), []);
  });
});

test('P3 createFixture：PATH 里没有 git——原因是第 1 步启动失败、无残留', async () => {
  const w = await world();
  const noGit = path.join(w.base, 'no-git');
  await fs.mkdir(noGit);
  await inWorld(w, { PATH: noGit }, async () => {
    await assert.rejects(createFixture(), (e: unknown) => {
      assert.ok(e instanceof ProbeFixtureError, String(e));
      assert.equal(e.message, '建探针夹具失败：建仓第 1/6 步「初始化仓库」失败：git 启动失败（spawn git ENOENT）');
      return true;
    });
    assert.deepEqual(await left(w, PROBE_PREFIX), []);
  });
});

test('P4 createFixture：工作树哈希那次暂存失败——原因是 workTreeHash 的原文，夹具与临时索引都不留', async () => {
  const w = await world();
  await inWorld(w, { FAKE_GIT_FAIL: 'index-add' }, async () => {
    await assert.rejects(createFixture(), (e: unknown) => {
      assert.ok(e instanceof ProbeFixtureError, String(e));
      assert.match(e.message, /^建探针夹具失败：git add to temp index failed: fake git line 1/);
      return true;
    });
    assert.deepEqual(await left(w, PROBE_PREFIX), []);
    assert.deepEqual(await left(w, 'trivium-index-'), []);
  });
});

for (const [name, kind, factory, prefix, exclude] of [
  ['P5 createFixture', 'main', createFixture, PROBE_PREFIX, MEM_PREFIX],
  ['P6 createMemoryFixture', 'memory', createMemoryFixture, MEM_PREFIX, undefined],
] as const) {
  test(`${name}：失败且目录删不掉——残留提示整句接在原因后面、residue 等于它`, { skip: ROOT && 'root 下只读目录锁不住' }, async () => {
    const w = await world();
    await inWorld(w, { FAKE_GIT_FAIL: 'commit', FAKE_GIT_LOCK: '1' }, async () => {
      const err = await factory().then(
        () => assert.fail('应当抛出'),
        (e: unknown) => e,
      );
      assert.ok(err instanceof ProbeFixtureError, String(err));
      const dirs = await left(w, prefix, exclude);
      assert.equal(dirs.length, 1, '本格就是要摆出删不掉：私有 TMPDIR 下应恰有一个残留');
      const want = fixtureResidueText(kind, dirs[0]!, 'EACCES');
      assert.match(want, /^⚠️ 探针夹具删除失败（EACCES）：~\/tmp\/trivium-probe-/, '家目录归一');
      assert.equal(err.residue, want);
      assert.equal(err.message, `建探针夹具失败：${stepFail(6)}；${want}`);
    });
  });
}

test('P7 TMPDIR 不存在：建临时目录本身失败也包成 ProbeFixtureError、residue 为 null', async () => {
  const w = await world();
  await inWorld(w, { TMPDIR: path.join(w.base, 'no-such-tmp') }, async () => {
    await assert.rejects(createFixture(), (e: unknown) => {
      assert.ok(e instanceof ProbeFixtureError, String(e));
      assert.equal(e.residue, null);
      assert.match(e.message, /^建探针夹具失败：ENOENT/);
      return true;
    });
  });
});

// ─────────────────────────── D：doctor 层（四侧假入口）───────────────────────────

/** 假 agy：`--version`、`models` 应答；其余（headless 读一类）吐一行、退 1 */
const AGY_BODY = `
const argv = process.argv.slice(2);
if (argv[0] === '--version') { process.stdout.write('1.2.16\\n'); process.exit(0); }
if (argv[0] === 'models') { process.stdout.write('fake-model\\tFake Model\\n'); process.exit(0); }
process.stdout.write('fake agy: refused\\n');
process.exit(1);
`;

/** 假 codex：照 probe-fixture-cleanup 的替身，去掉摆锁；exec 一类吐最小 header 后退 1（零配额，坑清单：不吐 header 要等 31 秒） */
const CODEX_BODY = `
const argv = process.argv.slice(2);
const env = process.env;
if (argv[0] === '--version') { process.stdout.write('codex-cli 0.160.0\\n'); process.exit(0); }
if (argv[0] === 'debug' && argv[1] === 'models') {
  if ((env.CODEX_HOME || '').includes('trivium-codexhome-')) process.exit(1);
  process.stdout.write(JSON.stringify({ models: [{ slug: 'fake-model', visibility: 'list' }] }));
  process.exit(0);
}
if (argv.includes('--help')) { process.stdout.write('Usage: codex exec [OPTIONS] [PROMPT]\\n'); process.exit(0); }
process.stderr.write('model: fake-model\\n--------\\nfake codex: refused\\n');
process.exit(1);
`;

/** 假 claude：`--version` 答版本；其余等 stdin 结束后回一轮通用成功事件 */
const CLAUDE_BODY = `
const argv = process.argv.slice(2);
if (argv.includes('--version')) { process.stdout.write('9.9.9 (Fake Claude)\\n'); process.exit(0); }
function emit(o) { process.stdout.write(JSON.stringify(o) + '\\n'); }
process.stdin.on('data', function () {});
process.stdin.on('end', function () {
  emit({ type: 'system', subtype: 'init', tools: ['Read', 'Grep', 'Glob'], model: 'claude-haiku-4-5-20251001', session_id: 'fake-session' });
  emit({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.001, session_id: 'fake-session' });
  process.exit(0);
});
process.stdin.resume();
`;

/** 假 zcode 入口（只给旗标探针与版本探针用；headless 走 invoke 桩）：照 probe-fixture-cleanup 的形态 */
const ZCODE_ENTRY = `
const env = process.env;
const argv = process.argv.slice(2);
if (argv[0] === 'version') { process.stdout.write('zcode 0.16.9\\n'); process.exit(0); }
if (!env.${ZCODE_BUILTIN_PROVIDER_ENV}) { process.stderr.write('无法定位 CLI ZCode Built-in Provider Config：/x\\n'); process.exit(1); }
for (const rejected of ['--max-turns', '--settings']) {
  if (argv.includes(rejected)) { process.stderr.write("Unknown option '" + rejected + "'.\\n"); process.exit(1); }
}
process.stderr.write('Error: Model creation failed (traceId: fake)\\n');
process.exit(1);
`;

const ZCODE_CLI_CONFIG = {
  model: { main: 'bigmodel-coding-plan/GLM-5.3', lite: 'bigmodel-coding-plan/GLM-5.3' },
  provider: {
    'bigmodel-coding-plan': {
      name: 'BigModel Coding Plan', kind: 'anthropic', source: 'custom', enabled: true,
      options: { apiKey: 'fake-id.fake-secret', baseURL: 'https://example.invalid' },
      models: { 'GLM-5.3': {} },
    },
  },
};

const SIDES = ['agy', 'zcode', 'codex', 'claude'] as const;
type Side = (typeof SIDES)[number];
const OLD_STAMP = '2000-01-01T00:00:00.000Z';

/** 预置的旧结论：版本号与戳都可辨认；claude 另带一格 `project_memory_blocked: true` 供 D6 断言「这一格没动」 */
function preset(side: Side): Record<string, unknown> {
  const base = (defaultProbe().cli as unknown as Record<string, Record<string, unknown>>)[side] ?? {};
  return {
    ...base,
    version: `old-${side}`,
    probed_at: OLD_STAMP,
    ...(side === 'claude' ? { project_memory_blocked: true } : {}),
  };
}

interface DoctorWorld {
  cfg: Config;
  projectRoot: string;
  triviumDir: string;
  codexBin: string;
  claudeBin: string;
  zcode: { cliConfigPath: string; invoke: (o: ZcodeInvokeOptions) => Promise<ZcodeInvokeOutcome> };
}

async function writeEntry(w: World, name: string, src: string): Promise<string> {
  const p = path.join(w.bin, name);
  await fs.writeFile(p, `#!${process.execPath}\n${src}`, { mode: 0o755 });
  return p;
}

/** 四侧假入口与 doctor 的配置；`withPreset` 时把旧结论同时放进传入的配置与落盘的 config.local.yaml */
async function doctorWorld(w: World, withPreset: boolean): Promise<DoctorWorld> {
  const agyBin = await writeEntry(w, 'agy', AGY_BODY);
  const codexBin = await writeEntry(w, 'codex', CODEX_BODY);
  const claudeBin = await writeEntry(w, 'claude', CLAUDE_BODY);

  const zEntry = path.join(w.base, 'app/Resources/glm/zcode.cjs');
  await fs.mkdir(path.dirname(zEntry), { recursive: true });
  await fs.writeFile(zEntry, ZCODE_ENTRY, 'utf8');
  await fs.mkdir(path.join(w.base, 'app/Resources/config/provider'), { recursive: true });
  await fs.writeFile(path.join(w.base, 'app/Resources/config/provider/zcode-builtin.json'), '{}', 'utf8');
  const cliConfigPath = path.join(w.base, 'cli-config.json');
  await fs.writeFile(cliConfigPath, JSON.stringify(ZCODE_CLI_CONFIG), { mode: 0o600 });
  const invoke = async (): Promise<ZcodeInvokeOutcome> => ({
    envelope: null, exitCode: 1, timedOut: false, stdout: '', stderr: 'Error: Model creation failed (traceId: fake)',
    commandLine: 'stub', durationMs: 5, failureKind: 'other',
  });

  // codex：钉住的 CODEX_HOME 里放一份 profile，探针才会在夹具活着时走进 exec 段（坑清单）
  const codexHome = path.join(w.home, '.codex');
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(path.join(codexHome, 'fake.config.toml'), 'model = "fake-model"\nmodel_provider = "fake"\n', { mode: 0o600 });

  const cfg = defaultConfig();
  agentConfigOf(cfg, 'gemini', 'antigravity').bin = agyBin;
  agentConfigOf(cfg, 'glm', 'zcode').entry = zEntry;
  const triviumDir = path.join(w.base, 'trivium');
  const projectRoot = path.join(w.base, 'proj');
  await fs.mkdir(triviumDir, { recursive: true });
  await fs.mkdir(projectRoot, { recursive: true });
  if (withPreset) {
    const cli = cfg.probe.cli as Record<string, unknown>;
    for (const s of SIDES) cli[s] = preset(s);
    await fs.writeFile(
      path.join(triviumDir, 'config.local.yaml'),
      YAML.stringify({ probe: { cli: Object.fromEntries(SIDES.map((s) => [s, preset(s)])) } }),
      'utf8',
    );
  }
  return { cfg, projectRoot, triviumDir, codexBin, claudeBin, zcode: { cliConfigPath, invoke } };
}

const ARM_STUBS = {
  modelOverrideProbe: async () => ({ override: null, requested: null, observed: null, why: '桩' }),
  modelOverrideFullCopyProbe: async () => ({
    override: null, requested: null, observed: null, why: '桩', replacedPaths: [], hostCredentialEnv: [],
  }),
};

function doctorIn(d: DoctorWorld, only: Side | null, skipModelCalls = false) {
  return runDoctor({
    projectRoot: d.projectRoot,
    triviumDir: d.triviumDir,
    config: d.cfg,
    skipModelCalls,
    only,
    zcodeProbe: { cliConfigPath: d.zcode.cliConfigPath, ...ARM_STUBS, invoke: d.zcode.invoke },
    probeBins: { codex: d.codexBin, claude: d.claudeBin },
  });
}

async function diskCli(d: DoctorWorld): Promise<Record<string, Record<string, unknown> | undefined>> {
  const raw = YAML.parse(await fs.readFile(path.join(d.triviumDir, 'config.local.yaml'), 'utf8')) as {
    probe?: { cli?: Record<string, Record<string, unknown>> };
  };
  return raw.probe?.cli ?? {};
}

const isFixtureBlocker = (b: string): boolean => b.includes('本轮没有探测成：建探针夹具失败：');
/** 夹具工厂对「提交基线退 1」包出的错误（期望文案用措辞函数算，不在用例里复制） */
const commitFailure = (kind: 'main' | 'memory'): ProbeFixtureError => new ProbeFixtureError(kind, new Error(stepFail(6)), null);

for (const side of SIDES) {
  const n = SIDES.indexOf(side) + 1;
  test(`D${n} doctor --only ${side}：夹具没建起来——不抛，恰一条该侧 blocker（逐字），该侧结论与落盘都原样、无残留`, async () => {
    const w = await world();
    await inWorld(w, { FAKE_GIT_FAIL: 'commit', FAKE_GIT_NTH: '1' }, async () => {
      const d = await doctorWorld(w, true);
      const rep = await doctorIn(d, side);
      assert.deepEqual(rep.blockers.filter(isFixtureBlocker), [probeFixtureBlocker(side, commitFailure('main'))], rep.blockers.join('\n'));
      assert.deepEqual(rep.probe.cli[side], preset(side), '该侧结论应原样保留');
      assert.deepEqual((await diskCli(d))[side], preset(side), '落盘的该侧结论应一个字节不动');
      assert.deepEqual(await left(w, PROBE_PREFIX), []);
      assert.deepEqual(await left(w, 'trivium-index-'), []);
    });
  });
}

test('D5 doctor 全段：第一段（agy）夹具没建起来——agy 一条 blocker，后面三侧照常探完、各自刷新', async () => {
  const w = await world();
  await inWorld(w, { FAKE_GIT_FAIL: 'commit', FAKE_GIT_NTH: '1' }, async () => {
    const d = await doctorWorld(w, true);
    const started = new Date().toISOString();
    const rep = await doctorIn(d, null);
    assert.deepEqual(rep.blockers.filter(isFixtureBlocker), [probeFixtureBlocker('agy', commitFailure('main'))], rep.blockers.join('\n'));
    assert.deepEqual(rep.probe.cli.agy, preset('agy'));
    const disk = await diskCli(d);
    assert.deepEqual(disk['agy'], preset('agy'));
    for (const s of ['zcode', 'codex', 'claude'] as const) {
      const got = rep.probe.cli[s] as { probed_at: string | null; version: string | null };
      assert.ok(got.probed_at !== null && got.probed_at >= started, `${s} 应已探过：probed_at=${got.probed_at}`);
      assert.notEqual(got.version, `old-${s}`, `${s} 的版本号应已刷新`);
      assert.equal((disk[s] as { probed_at?: string } | undefined)?.probed_at, got.probed_at, `${s} 应已落盘`);
    }
    assert.ok(!rep.warnings.some((x) => x.includes('项目记忆一格本轮没有探测成')), rep.warnings.join('\n'));
    assert.deepEqual(await left(w, PROBE_PREFIX), []);
  });
});

test('D6 doctor --only claude：记忆夹具（第 2 次提交）没建起来——一条 warning、不拦，主夹具各格已刷新、记忆格原样', async () => {
  const w = await world();
  await inWorld(w, { FAKE_GIT_FAIL: 'commit', FAKE_GIT_NTH: '2' }, async () => {
    const d = await doctorWorld(w, true);
    const started = new Date().toISOString();
    const rep = await doctorIn(d, 'claude');
    const want = memoryFixtureWarning(commitFailure('memory').message);
    assert.deepEqual(rep.warnings.filter((x) => x.includes('项目记忆一格本轮没有探测成')), [want], rep.warnings.join('\n'));
    assert.deepEqual(rep.blockers.filter(isFixtureBlocker), [], '记忆格失败不该出夹具 blocker');
    const claude = rep.probe.cli.claude as { probed_at: string | null; project_memory_blocked: unknown; version: string | null };
    assert.ok(claude.probed_at !== null && claude.probed_at >= started, '主夹具各格已花配额，结论要保住');
    assert.equal(claude.version, '9.9.9');
    assert.equal(claude.project_memory_blocked, true, '记忆格没刷新，保持预置值');
    const disk = (await diskCli(d))['claude'] as { probed_at?: string; project_memory_blocked?: unknown };
    assert.equal(disk.probed_at, claude.probed_at);
    assert.equal(disk.project_memory_blocked, true);
    assert.deepEqual(await left(w, PROBE_PREFIX), []);
  });
});

test('D7 doctor --only agy、盘上从没有 agy 的结论：一条 blocker，notes 里没有「尚无探针实现」那句', async () => {
  const w = await world();
  await inWorld(w, { FAKE_GIT_FAIL: 'commit' }, async () => {
    const d = await doctorWorld(w, false);
    const rep = await doctorIn(d, 'agy');
    assert.equal(rep.blockers.filter(isFixtureBlocker).length, 1, rep.blockers.join('\n'));
    assert.ok(!rep.notes.some((n) => n.includes('尚无探针实现')), rep.notes.join('\n'));
  });
});

test('D8 guardFixture：只接 ProbeFixtureError；普通异常原样重抛、不记失败', async () => {
  const fails: string[] = [];
  const boom = new Error('boom');
  await assert.rejects(guardFixture('agy', async () => { throw boom; }, (b) => fails.push(b)), (e) => e === boom);
  // 不用 deepEqual(fails, [])：它的断言签名会把 fails 收窄成 never[]
  assert.equal(fails.length, 0);
  const pfe = new ProbeFixtureError('main', new Error('git 坏了'), null);
  const r = await guardFixture('agy', async () => { throw pfe; }, (b) => fails.push(b));
  assert.equal(r, null);
  assert.deepEqual(fails, [probeFixtureBlocker('agy', pfe)]);
  assert.equal(
    fails[0],
    'Antigravity（agy）本轮没有探测成：建探针夹具失败：git 坏了。该侧落盘的探针结论原样保留（从未探过则仍为空），修好后重跑 trivium doctor --only agy',
  );
  assert.equal(await guardFixture('agy', async () => 42, (b) => fails.push(b)), 42);
  assert.equal(fails.length, 1);
});

test('D9 doctor --only zcode --no-model-calls：zcode 仍建夹具（只读旗标探针在夹具里跑），失败照样一条 blocker、不抛', async () => {
  const w = await world();
  await inWorld(w, { FAKE_GIT_FAIL: 'commit' }, async () => {
    const d = await doctorWorld(w, true);
    const rep = await doctorIn(d, 'zcode', true);
    assert.deepEqual(rep.blockers.filter(isFixtureBlocker), [probeFixtureBlocker('zcode', commitFailure('main'))], rep.blockers.join('\n'));
    assert.deepEqual(rep.probe.cli.zcode, preset('zcode'));
    assert.deepEqual(await left(w, PROBE_PREFIX), []);
  });
});

test('措辞：记忆格 warning 逐字', () => {
  assert.equal(
    memoryFixtureWarning('建探针夹具失败：x'),
    'Claude Code（claude）项目记忆一格本轮没有探测成：建探针夹具失败：x。' +
      '其余各格已刷新；project_memory_blocked 沿用的是上一次的结论（从未探过则仍为空），修好后重跑 trivium doctor --only claude',
  );
});
