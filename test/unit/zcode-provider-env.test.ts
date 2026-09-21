/**
 * ZCode 0.16.9 provider 配置注入（坑 P-28 / P-29 / P-30）。
 *
 * 背景：0.16.9 的 `zcode.cjs` 按**入口目录**推算 `zcode-builtin.json`，应用包布局下推算不到，
 * 独立拉起时先于参数解析就报「无法定位 CLI ZCode Built-in Provider Config」退出。
 * 桌面端起 CLI 靠 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` / `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`
 * 传路径；适配层此前只透传 `HOME`。
 *
 * 用例用一个**假入口脚本**（node 跑的 .cjs）按真实 CLI 的三种 stderr 形态应答，
 * 不碰真实 ZCode、不花配额：
 *   - 没拿到内置变量 → 打「Built-in Provider Config」那行，退 1（P-28 形态）
 *   - 拿到了且 argv 含被拒旗标 → 打 `Unknown option '<flag>'`（参数解析在配置定位之后）
 *   - 其余 → 打 `Error: Model creation failed`，退 1（空 HOME、无凭据的停点）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  invokeZcode,
  zcodeProviderConfigPaths,
  zcodeProviderEnv,
  ZCODE_BUILTIN_PROVIDER_ENV,
  ZCODE_PERSONAL_PROVIDER_ENV,
  ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE,
} from '../../src/trivium/adapters/zcode.js';
import { probeReadonlyFlags } from '../../src/trivium/probes/zcode.js';
import { runDoctor } from '../../src/trivium/doctor.js';
import { agentConfigOf, defaultConfig, defaultProbe } from '../../src/trivium/config.js';

const REAL_ENTRY = '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs';

/** 假入口：模拟 0.16.9 的「provider 配置定位 → 参数解析 → 模型创建」顺序，并把收到的 env 记到日志 */
const FAKE_ENTRY_SOURCE = `
const fs = require('node:fs');
const env = process.env;
if (env.FAKE_ZCODE_LOG) {
  fs.appendFileSync(env.FAKE_ZCODE_LOG, JSON.stringify({
    argv: process.argv.slice(2),
    builtin: env.${ZCODE_BUILTIN_PROVIDER_ENV} ?? null,
    personal: env.${ZCODE_PERSONAL_PROVIDER_ENV} ?? null,
    home: env.HOME ?? null,
  }) + '\\n');
}
const argv = process.argv.slice(2);
if (argv[0] === 'version') {
  // 版本子命令不读 provider 配置（0.16.9 实测，P-28）——探针也据此只清不给
  process.stdout.write('zcode 0.16.9\\n');
  process.exit(0);
}
if (!env.${ZCODE_BUILTIN_PROVIDER_ENV}) {
  process.stderr.write('无法定位 CLI ZCode Built-in Provider Config：/x/provider/zcode-builtin.json, /config/provider/zcode-builtin.json\\n');
  process.exit(1);
}
if (env.FAKE_ZCODE_FLAG_ZERO_EXIT) {
  // 旗标探针路径上退 0：零配额前提被打破的形态（本该停在模型层）
  process.stdout.write(JSON.stringify({ sessionId: 'sess_fake', response: 'OK', usage: {}, eventCount: 1 }, null, 2) + '\\n');
  process.exit(0);
}
if (env.FAKE_ZCODE_WEIRD_FAIL) {
  // 「参数解析同样没发生」的未识别形态：既不报 Unknown option，也没有模型/凭据层停点
  process.stderr.write('Error: kernel panic in module loader\\n');
  process.exit(1);
}
for (const rejected of ['--max-turns', '--settings']) {
  if (argv.includes(rejected)) {
    process.stderr.write("Unknown option '" + rejected + "'. To specify a positional argument starting with a '-', place it at the end.\\n");
    process.exit(1);
  }
}
if (env.FAKE_ZCODE_NOISY_OK) {
  // 正常跑通、但 stderr 里出现同一个名词（诊断行）——退出码门控之前这会被判成布局失败
  process.stderr.write('debug: resolved CLI ZCode Built-in Provider Config from env\\n');
  process.stdout.write(JSON.stringify({ sessionId: 'sess_fake', response: 'OK', usage: {}, eventCount: 1 }, null, 2) + '\\n');
  process.exit(0);
}
if (env.FAKE_ZCODE_ECHO_ENV) {
  process.stdout.write('AI SDK Warning: noise line\\n');
  process.stdout.write(JSON.stringify({
    sessionId: 'sess_fake',
    response: JSON.stringify({ builtin: env.${ZCODE_BUILTIN_PROVIDER_ENV}, personal: env.${ZCODE_PERSONAL_PROVIDER_ENV} ?? null, home: env.HOME }),
    usage: {},
    eventCount: 1,
  }, null, 2) + '\\n');
  process.exit(0);
}
process.stderr.write('Error: Model creation failed (traceId: fake)\\n');
process.exit(1);
`;

/**
 * 摆出应用包布局：`<root>/Resources/glm/zcode.cjs` 与 `<root>/Resources/config/provider/zcode-builtin.json`
 * 是兄弟目录。`withBuiltin=false` 时不放内置文件，模拟布局变了 / 文件丢了。
 */
async function layout(opts: { withBuiltin: boolean; withPersonal: boolean }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-zprov-'));
  const entry = path.join(root, 'Resources/glm/zcode.cjs');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, FAKE_ENTRY_SOURCE, 'utf8');
  const builtin = path.join(root, 'Resources/config/provider/zcode-builtin.json');
  if (opts.withBuiltin) {
    await fs.mkdir(path.dirname(builtin), { recursive: true });
    await fs.writeFile(builtin, '{}', 'utf8');
  }
  const userHome = path.join(root, 'home');
  const personal = path.join(userHome, '.zcode/v2/provider_config.json');
  if (opts.withPersonal) {
    await fs.mkdir(path.dirname(personal), { recursive: true });
    await fs.writeFile(personal, '{}', { encoding: 'utf8', mode: 0o600 });
  }
  const cwd = path.join(root, 'proj');
  await fs.mkdir(cwd, { recursive: true });
  return {
    root, entry, builtin, userHome, personal, cwd,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

// ── 路径派生：纯函数 ──

test('内置配置路径按入口派生：Resources/glm/zcode.cjs → Resources/config/provider/zcode-builtin.json', async () => {
  const p = await zcodeProviderConfigPaths(REAL_ENTRY, '/Users/u');
  assert.equal(p.builtin, '/Applications/ZCode.app/Contents/Resources/config/provider/zcode-builtin.json');
  assert.equal(p.personal, '/Users/u/.zcode/v2/provider_config.json');
});

test('个人配置路径跟用户目录走，不跟入口走（config_copy 的假 HOME 下也要指向真实那份）', async () => {
  const p = await zcodeProviderConfigPaths('/opt/elsewhere/glm/zcode.cjs', '/home/real');
  assert.equal(p.builtin, '/opt/elsewhere/config/provider/zcode-builtin.json');
  assert.equal(p.personal, '/home/real/.zcode/v2/provider_config.json');
});

test('软链入口先 realpath 再取兄弟目录：派生落在真实安装布局上，不落在软链所在目录', async () => {
  const L = await layout({ withBuiltin: true, withPersonal: false });
  try {
    // 形如 /usr/local/bin/zcode.cjs → <app>/Resources/glm/zcode.cjs
    const binDir = path.join(L.root, 'bin');
    await fs.mkdir(binDir, { recursive: true });
    const link = path.join(binDir, 'zcode.cjs');
    await fs.symlink(L.entry, link);
    const p = await zcodeProviderConfigPaths(link, '/home/real');
    assert.equal(p.builtin, await fs.realpath(L.builtin), '解软链后才是真实布局里的那份');
    assert.notEqual(p.builtin, path.join(L.root, 'config/provider/zcode-builtin.json'));
    // 相对入口按 cwd 解析后同样要解软链，不能落到 process.cwd()
    assert.deepEqual(
      await zcodeProviderConfigPaths(path.relative(process.cwd(), link), '/home/real'),
      p,
    );
  } finally {
    await L.cleanup();
  }
});

test('入口不存在（软链断了 / 布局变了）时回落到词法路径，不抛', async () => {
  const p = await zcodeProviderConfigPaths('/nonexistent-zcode/Resources/glm/zcode.cjs', '/home/real');
  assert.equal(p.builtin, '/nonexistent-zcode/Resources/config/provider/zcode-builtin.json');
});

// ── 存在性门控 ──

test('两份都在 → 两个变量都给，值为绝对路径', async () => {
  const L = await layout({ withBuiltin: true, withPersonal: true });
  try {
    const env = await zcodeProviderEnv(L.entry, L.userHome);
    assert.deepEqual(env, {
      [ZCODE_BUILTIN_PROVIDER_ENV]: await fs.realpath(L.builtin),
      [ZCODE_PERSONAL_PROVIDER_ENV]: L.personal,
    });
  } finally {
    await L.cleanup();
  }
});

test('文件不在 → 该键值为 undefined（不是缺席）：宿主环境里预置的同名变量必须被删掉', async () => {
  const L = await layout({ withBuiltin: false, withPersonal: false });
  try {
    const env = await zcodeProviderEnv(L.entry, L.userHome);
    assert.deepEqual(env, {
      [ZCODE_BUILTIN_PROVIDER_ENV]: undefined,
      [ZCODE_PERSONAL_PROVIDER_ENV]: undefined,
    });
    // 键必须在场——`run()` 只对「值为 undefined 的键」执行删除，键缺席就是原样透传
    assert.ok(Object.hasOwn(env, ZCODE_BUILTIN_PROVIDER_ENV));
    assert.ok(Object.hasOwn(env, ZCODE_PERSONAL_PROVIDER_ENV));
  } finally {
    await L.cleanup();
  }
  const M = await layout({ withBuiltin: true, withPersonal: false });
  try {
    assert.deepEqual(await zcodeProviderEnv(M.entry, M.userHome), {
      [ZCODE_BUILTIN_PROVIDER_ENV]: await fs.realpath(M.builtin),
      [ZCODE_PERSONAL_PROVIDER_ENV]: undefined,
    });
  } finally {
    await M.cleanup();
  }
});

// ── invokeZcode：唯一执行点真的把变量递给了子进程 ──

test('invokeZcode 把内置变量递给子进程，且 HOME 副本覆盖不影响它', async () => {
  const L = await layout({ withBuiltin: true, withPersonal: false });
  const fakeHome = path.join(L.root, 'run-home');
  await fs.mkdir(fakeHome, { recursive: true });
  process.env['FAKE_ZCODE_ECHO_ENV'] = '1';
  try {
    const out = await invokeZcode({
      entry: L.entry, node: process.execPath, cwd: L.cwd, prompt: 'ok',
      readonlyArgs: ['--mode', 'plan'], homeDir: fakeHome, userHome: L.userHome, timeoutMs: 30_000,
    });
    assert.equal(out.failureKind, 'none');
    assert.ok(out.envelope, '假入口按真实形态先打一行告警再打 envelope，抠得出来');
    const seen = JSON.parse(out.envelope!.response) as { builtin: string; personal: string | null; home: string };
    assert.equal(seen.builtin, await fs.realpath(L.builtin), '内置路径按入口派生，是绝对路径');
    assert.equal(seen.personal, null, '个人那份不在 → 键被删；不传 userHome 时这里吃的是开发机真实存在的那份');
    assert.equal(seen.home, fakeHome, 'HOME 仍按 config_copy 档指向运行副本');
  } finally {
    delete process.env['FAKE_ZCODE_ECHO_ENV'];
    await L.cleanup();
  }
});

test('内置文件不在 → 不注入，CLI 原话进 failureKind=provider_config_unresolved（退出码非 0 且 stderr 命中）', async () => {
  const L = await layout({ withBuiltin: false, withPersonal: false });
  try {
    const out = await invokeZcode({
      entry: L.entry, node: process.execPath, cwd: L.cwd, prompt: 'ok',
      readonlyArgs: [], homeDir: null, timeoutMs: 30_000,
    });
    assert.equal(out.failureKind, 'provider_config_unresolved');
    assert.equal(out.envelope, null);
    assert.match(out.stderr, ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE);
  } finally {
    await L.cleanup();
  }
});

test('退出码门控：正常退 0 而 stderr 里出现同一名词（诊断行）→ 不判成布局失败', async () => {
  const L = await layout({ withBuiltin: true, withPersonal: false });
  process.env['FAKE_ZCODE_NOISY_OK'] = '1';
  try {
    const out = await invokeZcode({
      entry: L.entry, node: process.execPath, cwd: L.cwd, prompt: 'ok',
      readonlyArgs: [], homeDir: null, timeoutMs: 30_000,
    });
    assert.equal(out.exitCode, 0);
    assert.match(out.stderr, ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE, '名词确实出现在 stderr 里');
    assert.equal(out.failureKind, 'none', '裸正则不看退出码时，这一次成功的调用会被判成 provider_config_unresolved');
  } finally {
    delete process.env['FAKE_ZCODE_NOISY_OK'];
    await L.cleanup();
  }
});

test('宿主环境预置了同名变量 → 子进程必须拿不到：只追加不清除等于原样透传', async () => {
  const L = await layout({ withBuiltin: false, withPersonal: false });
  const log = path.join(L.root, 'calls.jsonl');
  process.env['FAKE_ZCODE_LOG'] = log;
  const decoyBuiltin = path.join(L.root, 'decoy-builtin.json');
  const decoyPersonal = path.join(L.root, 'decoy-personal.json');
  process.env[ZCODE_BUILTIN_PROVIDER_ENV] = decoyBuiltin;
  process.env[ZCODE_PERSONAL_PROVIDER_ENV] = decoyPersonal;
  try {
    // 两份都不在 → 两个键都被删；假入口据此走「定位不到」那一支，而不是拿着诱饵路径往下跑。
    // **必须传 userHome**：不传就吃真实 os.homedir()，开发机上个人那份真实存在，
    // 于是个人键是「被真实路径覆盖」而非「被删」，断言只靠内置那一半侥幸成立（r3 CODEX-F01-02）。
    const out = await invokeZcode({
      entry: L.entry, node: process.execPath, cwd: L.cwd, prompt: 'ok',
      readonlyArgs: [], homeDir: null, userHome: L.userHome, timeoutMs: 30_000,
    });
    assert.equal(out.failureKind, 'provider_config_unresolved');
    // 直接看子进程收到了什么：两个诱饵都不得出现
    const seen = JSON.parse((await fs.readFile(log, 'utf8')).trim()) as {
      builtin: string | null; personal: string | null;
    };
    assert.equal(seen.builtin, null, '内置诱饵必须被删，不是被覆盖');
    assert.equal(seen.personal, null, '个人诱饵必须被删——这一半正是旧用例没锁住的');
  } finally {
    delete process.env['FAKE_ZCODE_LOG'];
    delete process.env[ZCODE_BUILTIN_PROVIDER_ENV];
    delete process.env[ZCODE_PERSONAL_PROVIDER_ENV];
    await L.cleanup();
  }
});

test('failureKind 的判据只认英文名词片段，中文前缀换了也认得出', () => {
  assert.match('无法定位 CLI ZCode Built-in Provider Config：a, b', ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE);
  assert.match('Cannot locate CLI ZCode Built-in Provider Config: a, b', ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE);
  assert.doesNotMatch('Error: Model creation failed (traceId: x)', ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE);
});

// ── probeReadonlyFlags：第三态与「只注入内置」 ──

test('P-29：provider 配置定位失败时七个候选全部 indeterminate，一个都不算接受', async () => {
  const L = await layout({ withBuiltin: false, withPersonal: true });
  try {
    const r = await probeReadonlyFlags(L.entry, process.execPath, L.cwd);
    assert.deepEqual(r.accepted, [], '2026-09-19 那次 doctor 就是在这里把 7 个候选全记成了接受');
    assert.deepEqual(r.rejected, []);
    assert.equal(r.indeterminate.length, 7);
  } finally {
    await L.cleanup();
  }
});

test('P-28 / P-30：内置文件在 → 参数解析结论可判；只注入内置那份、个人那份一次都不给', async () => {
  const L = await layout({ withBuiltin: true, withPersonal: true });
  const log = path.join(L.root, 'calls.jsonl');
  process.env['FAKE_ZCODE_LOG'] = log;
  // 诱饵：宿主环境里预置两个路径。旧实现只追加不清除，个人那份会原样透传进空 HOME 的探针，
  // 而它自带默认模型——七个候选就是七次真实模型调用。断言的是「子进程拿不到」，不是「我没给」
  process.env[ZCODE_BUILTIN_PROVIDER_ENV] = path.join(L.root, 'decoy-builtin.json');
  process.env[ZCODE_PERSONAL_PROVIDER_ENV] = path.join(L.root, 'decoy-personal.json');
  try {
    const r = await probeReadonlyFlags(L.entry, process.execPath, L.cwd);
    assert.deepEqual(r.indeterminate, []);
    assert.deepEqual(
      r.rejected.sort(),
      ['--max-turns 40', '--settings /nonexistent-probe-settings.json'].sort(),
    );
    assert.ok(r.accepted.includes('--mode plan'));
    assert.ok(r.accepted.some((f) => f.startsWith('--disallowed-tools')));

    const calls = (await fs.readFile(log, 'utf8')).trim().split('\n')
      .map((l) => JSON.parse(l) as { builtin: string | null; personal: string | null; home: string | null });
    assert.equal(calls.length, 7, '七个候选各拉起一次');
    const realBuiltin = await fs.realpath(L.builtin);
    for (const c of calls) {
      assert.equal(c.builtin, realBuiltin, '内置变量每次都给');
      assert.equal(c.personal, null, '个人配置自带默认模型，给了它空 HOME 就挡不住真实模型调用（P-30）');
      assert.notEqual(c.home, os.homedir(), 'HOME 仍指向空目录');
      assert.notEqual(c.home, L.userHome);
    }
  } finally {
    delete process.env['FAKE_ZCODE_LOG'];
    delete process.env[ZCODE_BUILTIN_PROVIDER_ENV];
    delete process.env[ZCODE_PERSONAL_PROVIDER_ENV];
    await L.cleanup();
  }
});

// ── 探针空壳 ──

test('defaultProbe 的 zcode 段带 provider_config: null（未探过 ≠ 未找到）', () => {
  assert.equal(defaultProbe().cli.zcode!.provider_config, null);
});

// ── 正向证据判据：判不出就不记接受（r4 CODEX-01）──

test('未识别的失败形态 → 全部 indeterminate，一条都不回落成接受', async () => {
  const L = await layout({ withBuiltin: true, withPersonal: false });
  process.env['FAKE_ZCODE_WEIRD_FAIL'] = '1';
  try {
    const r = await probeReadonlyFlags(L.entry, process.execPath, L.cwd);
    assert.deepEqual(r.accepted, [], '否定式判据会把这七个全记成接受——与 P-29 同类污染，只是换了成因');
    assert.deepEqual(r.rejected, []);
    assert.equal(r.indeterminate.length, 7);
    assert.match(r.indeterminate[0]!.why, /未识别的失败形态（退出码 1）/);
    assert.match(r.indeterminate[0]!.why, /kernel panic/, '成因要带上 stderr 首行，否则又得复跑一次探针才知道');
  } finally {
    delete process.env['FAKE_ZCODE_WEIRD_FAIL'];
    await L.cleanup();
  }
});

// ── doctor 的 warnings 档（r4 CODEX-03）──
//
// 放在本文件而不是新开一个：这两条要用上面的 layout() 与假入口摆形态，
// 而「旗标本轮未判定」正是本文件这套装置唯一能摆出来的场景。

async function doctorOnZcode(entry: string, projectRoot: string) {
  const cfg = defaultConfig();
  agentConfigOf(cfg, 'glm', 'zcode').entry = entry;
  const triviumDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-doctor-'));
  try {
    // triviumDir 下没有 bin/trivium ⇒ checkWrapper 返回空，不引入无关 blocker；
    // 探针结论写进这个临时目录，不碰真实仓库
    return await runDoctor({ projectRoot, triviumDir, config: cfg, skipModelCalls: true, only: 'zcode' });
  } finally {
    await fs.rm(triviumDir, { recursive: true, force: true });
  }
}

test('旗标本轮未判定 → 出 warnings，而不是拦人', async () => {
  const L = await layout({ withBuiltin: true, withPersonal: false });
  process.env['FAKE_ZCODE_WEIRD_FAIL'] = '1';
  try {
    const rep = await doctorOnZcode(L.entry, L.cwd);
    assert.equal(rep.warnings.length, 1, '唯一住户：本轮未判定');
    assert.match(rep.warnings[0]!, /本轮未判定/);
    assert.ok(
      !rep.blockers.some((b) => b.includes('未实测到任何可用的只读参数组合')),
      '旗标 blocker 只在判定完成时才拦——本轮没判成，拦它就是把布局/环境问题报成能力缺失',
    );
  } finally {
    delete process.env['FAKE_ZCODE_WEIRD_FAIL'];
    await L.cleanup();
  }
});

test('旗标探针退 0 → 仍记接受，但要出声（零配额前提被打破）', async () => {
  const L = await layout({ withBuiltin: true, withPersonal: false });
  process.env['FAKE_ZCODE_FLAG_ZERO_EXIT'] = '1';
  try {
    const r = await probeReadonlyFlags(L.entry, process.execPath, L.cwd);
    assert.equal(r.accepted.length, 7, '退 0 证明 argv 吃完了，结论照记接受');
    assert.deepEqual(r.zeroExit, r.accepted, '但七次全是靠退 0 判的——这在本探针里意味着配额被烧了');
    const rep = await doctorOnZcode(L.entry, L.cwd);
    assert.ok(
      rep.warnings.some((w) => w.includes('退 0') && w.includes('零配额')),
      '成本异常要被看见：r3 给「turn 里不退」加了 killTree，「跑完并成功」此前无人说话',
    );
    assert.deepEqual(rep.blockers, [], '出声不等于拦人——结论本身是对的');
  } finally {
    delete process.env['FAKE_ZCODE_FLAG_ZERO_EXIT'];
    await L.cleanup();
  }
});

test('宿主预置两个 provider 变量 → doctor note 说明编排器独占（RUNBOOK 口径的运行时半边）', async () => {
  const L = await layout({ withBuiltin: true, withPersonal: false });
  process.env[ZCODE_BUILTIN_PROVIDER_ENV] = path.join(L.root, 'decoy-builtin.json');
  try {
    const rep = await doctorOnZcode(L.entry, L.cwd);
    assert.ok(
      rep.notes.some((n) => n.includes('独占') && n.includes(ZCODE_BUILTIN_PROVIDER_ENV)),
      '独占口径哪天被改回「尊重宿主值」，这条要当场红——r4 §五 说「摆形态要改测试进程环境」不成立，' +
        '同文件的诱饵用例本来就在改它（r5 CODEX-05）',
    );
  } finally {
    delete process.env[ZCODE_BUILTIN_PROVIDER_ENV];
    await L.cleanup();
  }
});

test('warnings 不影响阻断判定：有告警但 blockers 为空', async () => {
  const L = await layout({ withBuiltin: true, withPersonal: false });
  process.env['FAKE_ZCODE_WEIRD_FAIL'] = '1';
  try {
    const rep = await doctorOnZcode(L.entry, L.cwd);
    assert.ok(rep.warnings.length > 0);
    // cli.ts 的 ok 与退出码都取 `blockers.length === 0`：这条空断言就是那个档位定义。
    // 谁把告警塞进 blockers（或反过来把该拦的塞进 warnings），这里当场红。
    assert.deepEqual(rep.blockers, []);
  } finally {
    delete process.env['FAKE_ZCODE_WEIRD_FAIL'];
    await L.cleanup();
  }
});
