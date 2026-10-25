/**
 * EV-254：doctor claude 段路线稳定性比对的语义边界——经 `runDoctor` + 假 CLI + 注入目录臂端到端。
 *
 * ## 要钉住的两类变化
 *
 * 比对在探测前后各按调用方配置解析一次路线指纹。指纹里的入口（`nativeBin`）与 `version`
 * 取自盘上结论，新值是本次探针自己测的——CLI 升过级、盘上还没有结论（全新安装）时它们必然不同，
 * 但那不是「探测期间路线变了」，由登记按快照重算即可（N / P 格：不得出 blocker，路线按新版本登记）。
 * 真正在探测期间会变的是现读环境的几项：网关 env 摘要、profile 文件、包装器内容、包装器路径
 * （R 格：仍须出 blocker、删该路线登记、清空只读旗标）。
 *
 * 修复前首跑引导把新探针写回调用方配置，比对的「后」一次因此读到本次测量值，N1/N2/P1/P2 必出 blocker；
 * 所以 N / P 格同时断言「调用方配置未被改动」（`probeClaude` 的契约）。
 *
 * ## 装置
 *
 * - 假 CLI：`--version` 吐 `FAKE_CLAUDE_VERSION`（缺省 9.9.9）；其余 `-p` 调用一律「跑通、吐一句话」，
 *   带 `--json-schema` 的那次吐一份合规结构化结果。形态照 `claude-structured-probe.test.ts`，
 *   那份文件头注释里登记的「不模拟的形态」在这里同样不模拟——本文件只断言**路线变化这一条** blocker 的有无。
 * - 每格独立：`scratchDir` 建家目录与项目根、`HOME` 钉到本格家目录（finally 复原）、独立的 `defaultConfig()`。
 * - 目录臂注入桩：记下入参路线，返回「Read 已证实」的最小证据；R / N4 格在桩里改环境，制造「探测期间」的变化。
 * - 盘上旧结论**不经 `runDoctor` 构造**（否则它本身也受被测代码影响）：直接调 `probeClaude`（不传 config，
 *   不进目录臂），再照 `doctor.ts` 的登记写法记进 `routes`。
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { defaultConfig } from '../../src/trivium/config.js';
import { runDoctor, CLAUDE_ROUTE_CHANGED_BLOCKER, type DoctorOptions, type DoctorReport } from '../../src/trivium/doctor.js';
import { probeClaude } from '../../src/trivium/probes/claude.js';
import { resolveClaudeRoute, claudeProbeForRoute, claudeRouteKey, type ClaudeRoute } from '../../src/trivium/adapters/claude-route.js';
import type { Config } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';
import { isolateEntryScanHome } from '../helpers/entry-scan-home.js';
import { ASSET_ROOT } from '../helpers/fixture.js';

// WIN_FILE_SKIP（Windows 移植）：shebang 假 CLI / 活体 POSIX 信号语义（登记 Bug 清单 §3.1 集成残余）
// macOS/Linux 行为零变化；Windows 侧待 EV-253 实测时顺带复核（Bug 清单 §3.1 第 15 条）。
if (process.platform === 'win32') {
  console.log('skip（win32）: shebang 假 CLI / 活体 POSIX 信号语义（登记 Bug 清单 §3.1 集成残余）');
} else {

// doctor 的共享读取面扫描读空夹具，不读真实家目录（EV-240）
isolateEntryScanHome();

const NEW_VERSION = '9.9.9';
const OLD_VERSION = '9.9.8';
const PROFILE = 'fx';

let script = '';
let fakeBin = '';

before(async () => {
  const work = await scratchDir('trivium-route-stability-');
  script = path.join(work, 'fake-claude.cjs');
  await fs.writeFile(script, [
    'const argv = process.argv.slice(2);',
    "if (argv.includes('--version')) {",
    "  process.stdout.write((process.env.FAKE_CLAUDE_VERSION || '9.9.9') + ' (Fake Claude)\\n');",
    '  process.exit(0);',
    '}',
    'function emit(o) { process.stdout.write(JSON.stringify(o) + "\\n"); }',
    'process.stdin.resume();',
    "process.stdin.on('end', () => {",
    "  const structured = argv.includes('--json-schema');",
    "  emit({ type: 'system', subtype: 'init', tools: structured ? ['Read', 'Grep', 'Glob', 'StructuredOutput'] : ['Read', 'Grep', 'Glob'], model: 'claude-haiku-4-5-20251001', session_id: 'fake-session' });",
    "  const result = structured ? JSON.stringify({ schema: 'trivium.review.v1', verdict: 'approve', summary: 'fake summary', findings: [] }) : 'ok';",
    "  emit({ type: 'result', subtype: 'success', is_error: false, result, total_cost_usd: 0.001, session_id: 'fake-session' });",
    '  process.exit(0);',
    '});',
    '',
  ].join('\n'));
  fakeBin = await shellEntry(work, 'claude');
});

/** 一个转发到假 CLI 的 sh 入口；包装器（`cld`）与 native 入口副本都用它——追加注释行不影响行为 */
async function shellEntry(dir: string, name: string): Promise<string> {
  const file = path.join(dir, name);
  await fs.writeFile(file, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  return file;
}

interface Cell {
  home: string;
  projectRoot: string;
  triviumDir: string;
  cfg: Config;
}

/** 本格的家目录、项目根与独立配置；`HOME` 等环境变量由 `withEnv` 钉住 */
async function makeCell(): Promise<Cell> {
  const home = await scratchDir('trivium-route-stability-home-');
  const projectRoot = await scratchDir('trivium-route-stability-proj-');
  const triviumDir = path.join(projectRoot, '.trivium');
  await fs.mkdir(triviumDir);
  return { home, projectRoot, triviumDir, cfg: defaultConfig() };
}

async function withEnv<T>(patch: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const old: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(patch)) { old[k] = process.env[k]; process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

async function writeProfile(home: string, extra = ''): Promise<string> {
  const dir = path.join(home, '.claude', 'profiles');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${PROFILE}.env`);
  await fs.writeFile(file, `export ANTHROPIC_MODEL=fixture-model\n${extra}`);
  return file;
}

async function writeSettingsEnv(home: string, value: string): Promise<string> {
  const dir = path.join(home, '.claude');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'settings.json');
  await fs.writeFile(file, JSON.stringify({ env: { ANTHROPIC_BASE_URL: value } }));
  return file;
}

/**
 * 盘上旧结论：直接 `probeClaude`（不传 config ⇒ 不进目录臂、不受首跑引导影响）测一份，
 * 再照 `doctor.ts` 的登记写法记进 `routes[路线键]`（指纹按含该快照的配置与快照版本重算）。
 */
async function recordConclusion(cfg: Config, profile: string | null, entry: string, version: string): Promise<void> {
  const { probe } = await withEnv({ FAKE_CLAUDE_VERSION: version }, () => probeClaude(entry, {}));
  assert.equal(probe.version, version);
  const snapshot = { ...probe, route_profile: profile };
  delete snapshot.routes;
  const withSnapshot: Config = { ...cfg, probe: { ...cfg.probe, cli: { ...cfg.probe.cli, claude: snapshot } } };
  cfg.probe.cli.claude = { ...snapshot, routes: { [claudeRouteKey(profile)]: { profile,
    fingerprint: resolveClaudeRoute(withSnapshot, profile, version).fingerprint, probe: snapshot } } };
}

type DirectoryStub = NonNullable<DoctorOptions['claudeDirectoryProbe']>;

/** 目录臂桩：记下入参路线，先跑 `during`（制造探测期间的变化），再返回「Read 已证实」的最小证据 */
function directoryStub(seen: ClaudeRoute[], during?: () => Promise<void>): DirectoryStub {
  return async (input) => {
    seen.push(input.route);
    if (during) await during();
    return { verified: { Read: true }, arms: [{} as Awaited<ReturnType<DirectoryStub>>['arms'][number]],
      cleanup: null, sourceHash: null, denyPaths: [], settingsJson: null, failure: null, notes: [] };
  };
}

async function doctor(c: Cell, profile: string | null, stub: DirectoryStub): Promise<DoctorReport> {
  return runDoctor({ projectRoot: c.projectRoot, triviumDir: c.triviumDir, config: c.cfg, only: 'claude',
    probeBins: { claude: fakeBin }, modelOverrides: { claude: 'stub/0.0.0' }, claudeDirectoryProbe: stub,
    ...(profile !== null ? { tierFlags: { claude: { vendorProfile: profile } } } : {}) });
}

/** N / P 格：不判路线变化，路线按新版本登记且可被消费，只读旗标保留，调用方配置未被改动 */
function assertRegistered(label: string, report: DoctorReport, cfg: Config, frozen: Config, profile: string | null): void {
  assert.ok(!report.blockers.includes(CLAUDE_ROUTE_CHANGED_BLOCKER), `${label}：本次探测自身带来的变化不得判路线变化：${JSON.stringify(report.blockers)}`);
  const root = report.probe.cli.claude!;
  const entry = root.routes?.[claudeRouteKey(profile)];
  assert.ok(entry, `${label}：路线登记缺失`);
  assert.equal(entry.probe.version, NEW_VERSION, `${label}：路线须按新版本登记`);
  assert.ok(root.readonly_flags.length > 0, `${label}：只读旗标不得被清空`);
  assert.equal(claudeProbeForRoute({ ...cfg, probe: report.probe }, profile)?.version, NEW_VERSION, `${label}：登记须可被消费`);
  assert.deepEqual(cfg, frozen, `${label}：调用方配置不得被改动（probeClaude 契约）`);
}

/** R 格：探测期间真实的路线变化仍须判失效 */
function assertInvalidated(label: string, report: DoctorReport, profile: string | null): void {
  assert.ok(report.blockers.includes(CLAUDE_ROUTE_CHANGED_BLOCKER), `${label}：探测期间路线真的变了，必须判失效：${JSON.stringify(report.blockers)}`);
  const root = report.probe.cli.claude!;
  assert.equal(root.routes?.[claudeRouteKey(profile)], undefined, `${label}：该路线登记须删除`);
  assert.deepEqual(root.readonly_flags, [], `${label}：只读旗标须清空`);
  assert.deepEqual(root.directory_deny_verified, {});
  assert.equal(root.directory_deny_fingerprint, null);
}

function assertDirectoryRecorded(label: string, report: DoctorReport, seen: ClaudeRoute[], profile: string | null): void {
  const root = report.probe.cli.claude!;
  assert.deepEqual(root.directory_deny_verified, { Read: true }, `${label}：目录事实须落盘`);
  assert.ok(root.directory_deny_fingerprint, `${label}：目录指纹须落盘`);
  assert.equal(root.routes?.[claudeRouteKey(profile)]?.fingerprint, seen[0]!.fingerprint, `${label}：登记的路线就是目录臂实测的那条`);
}

/** profile 格的配置：家目录放 profile 文件、`profile_bin` 指向本格包装器 */
async function profileCell(): Promise<{ c: Cell; wrapper: string; profileFile: string }> {
  const c = await makeCell();
  const profileFile = await writeProfile(c.home);
  const wrapper = await shellEntry(c.home, 'cld');
  const agent = c.cfg.agents.claude; assert.ok(agent?.vendor === 'anthropic'); agent.profile_bin = wrapper;
  return { c, wrapper, profileFile };
}

const pinned = (c: Cell, extra: Record<string, string> = {}): Record<string, string> =>
  ({ HOME: c.home, TRIVIUM_ASSET_ROOT: ASSET_ROOT, FAKE_CLAUDE_VERSION: NEW_VERSION, ...extra });

// ── native ───────────────────────────────────────────────────────────

test('N1 native 全新安装：盘上无结论、未配 bin——不判路线变化，首跑引导给目录臂拿到入口，路线按新版本登记', async () => {
  const c = await makeCell();
  await withEnv(pinned(c), async () => {
    const frozen = structuredClone(c.cfg);
    assert.equal(c.cfg.probe.cli.claude?.entrypoint ?? null, null, '前提：盘上没有入口');
    const seen: ClaudeRoute[] = [];
    const report = await doctor(c, null, directoryStub(seen));
    assertRegistered('N1', report, c.cfg, frozen, null);
    assert.equal(seen.length, 1, '目录臂应恰好被调一次');
    assert.equal(seen[0]!.bin, fakeBin, '首跑引导：目录臂拿到的路线入口是本次实测的入口');
    assert.equal(seen[0]!.nativeBin, fakeBin);
    assertDirectoryRecorded('N1', report, seen, null);
  });
});

test('N2 native 版本变化：盘上记旧版本、实测新版本——不判路线变化，路线改按新版本登记', async () => {
  const c = await makeCell();
  await withEnv(pinned(c), async () => {
    await recordConclusion(c.cfg, null, fakeBin, OLD_VERSION);
    const oldFingerprint = c.cfg.probe.cli.claude!.routes!.native!.fingerprint;
    const frozen = structuredClone(c.cfg);
    const seen: ClaudeRoute[] = [];
    const report = await doctor(c, null, directoryStub(seen));
    assertRegistered('N2', report, c.cfg, frozen, null);
    assert.notEqual(report.probe.cli.claude!.routes!.native!.fingerprint, oldFingerprint, 'N2：新版本的登记指纹应与旧登记不同');
    assertDirectoryRecorded('N2', report, seen, null);
  });
});

test('N3 native 版本一致（对照）：不判路线变化，登记照常', async () => {
  const c = await makeCell();
  await withEnv(pinned(c), async () => {
    await recordConclusion(c.cfg, null, fakeBin, NEW_VERSION);
    const frozen = structuredClone(c.cfg);
    const seen: ClaudeRoute[] = [];
    const report = await doctor(c, null, directoryStub(seen));
    assertRegistered('N3', report, c.cfg, frozen, null);
    assertDirectoryRecorded('N3', report, seen, null);
  });
});

test('N4 边界锚：缺省 native 配置下探测期间改入口二进制与无关环境——比对恒判稳定，只有目录事实作废', async () => {
  /*
   * 钉的是计划第一节边界 3：未配 bin、未开 settings_env_source 时，修复后指纹七项在探测期间都不会变，
   * 这条 blocker 对该形态恒不触发；剩下的保护是目录臂窗口内的目录指纹（入口与 native 二进制内容）。
   * 日后若加强路线比对（例如把二进制内容纳入），本格要连同设计 §12 与 Bug 清单第 15 条一起改。
   */
  const c = await makeCell();
  const entry = await shellEntry(c.home, 'claude-entry');
  await withEnv(pinned(c), async () => {
    await recordConclusion(c.cfg, null, entry, NEW_VERSION);
    const frozen = structuredClone(c.cfg);
    const seen: ClaudeRoute[] = [];
    const report = await runDoctor({ projectRoot: c.projectRoot, triviumDir: c.triviumDir, config: c.cfg, only: 'claude',
      probeBins: { claude: entry }, modelOverrides: { claude: 'stub/0.0.0' },
      claudeDirectoryProbe: directoryStub(seen, async () => {
        await fs.appendFile(entry, '# rotated during probe\n');
        await writeSettingsEnv(c.home, 'https://fixture-b.invalid');
        await fs.mkdir(path.join(c.home, '.local', 'bin'), { recursive: true });
        await shellEntry(path.join(c.home, '.local', 'bin'), 'cld');
      }) });
    assertRegistered('N4', report, c.cfg, frozen, null);
    const root = report.probe.cli.claude!;
    assert.deepEqual(root.directory_deny_verified, {}, 'N4：入口二进制变了，目录事实须作废');
    assert.equal(root.directory_deny_fingerprint, null);
    assert.match(report.directoryEvidence?.failure ?? '', /绑定未取得或发生变化/);
  });
});

// ── profile ──────────────────────────────────────────────────────────

test('P1 profile 全新安装：不判路线变化，目录臂拿到实测入口，profile 路线按新版本登记', async () => {
  const { c, wrapper } = await profileCell();
  await withEnv(pinned(c), async () => {
    const frozen = structuredClone(c.cfg);
    const seen: ClaudeRoute[] = [];
    const report = await doctor(c, PROFILE, directoryStub(seen));
    assertRegistered('P1', report, c.cfg, frozen, PROFILE);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.bin, wrapper);
    assert.equal(seen[0]!.nativeBin, fakeBin, '首跑引导：profile 路线的 native 入口取本次实测');
    assertDirectoryRecorded('P1', report, seen, PROFILE);
  });
});

test('P2 profile 版本变化：不判路线变化，profile 路线改按新版本登记', async () => {
  const { c } = await profileCell();
  await withEnv(pinned(c), async () => {
    await recordConclusion(c.cfg, PROFILE, fakeBin, OLD_VERSION);
    const frozen = structuredClone(c.cfg);
    const seen: ClaudeRoute[] = [];
    const report = await doctor(c, PROFILE, directoryStub(seen));
    assertRegistered('P2', report, c.cfg, frozen, PROFILE);
    assertDirectoryRecorded('P2', report, seen, PROFILE);
  });
});

test('P3 profile 版本一致（对照）：不判路线变化，登记照常', async () => {
  const { c } = await profileCell();
  await withEnv(pinned(c), async () => {
    await recordConclusion(c.cfg, PROFILE, fakeBin, NEW_VERSION);
    const frozen = structuredClone(c.cfg);
    const seen: ClaudeRoute[] = [];
    const report = await doctor(c, PROFILE, directoryStub(seen));
    assertRegistered('P3', report, c.cfg, frozen, PROFILE);
  });
});

// ── 探测期间真实的路线变化 ───────────────────────────────────────────

test('R1 native 网关 env 摘要在探测期间变了：仍判失效', async () => {
  const c = await makeCell();
  const agent = c.cfg.agents.claude; assert.ok(agent?.vendor === 'anthropic'); agent.settings_env_source = 'user_settings';
  await withEnv(pinned(c), async () => {
    await writeSettingsEnv(c.home, 'https://fixture-a.invalid');
    await recordConclusion(c.cfg, null, fakeBin, NEW_VERSION);
    const report = await doctor(c, null, directoryStub([], async () => { await writeSettingsEnv(c.home, 'https://fixture-b.invalid'); }));
    assertInvalidated('R1', report, null);
  });
});

test('R2 profile 文件在探测期间被改：仍判失效', async () => {
  const { c, profileFile } = await profileCell();
  await withEnv(pinned(c), async () => {
    await recordConclusion(c.cfg, PROFILE, fakeBin, NEW_VERSION);
    const report = await doctor(c, PROFILE, directoryStub([], async () => {
      await fs.appendFile(profileFile, 'export ANTHROPIC_DEFAULT_OPUS_MODEL=fixture-other\n');
    }));
    assertInvalidated('R2', report, PROFILE);
  });
});

test('R5 profile 文件在探测期间被删（探测后解析抛出，走 catch）：仍判失效', async () => {
  // R1～R4 走「指纹不等」；这一格守比对处 try/catch 那条相邻路径（代码审 GLM-01）
  const { c, profileFile } = await profileCell();
  await withEnv(pinned(c), async () => {
    await recordConclusion(c.cfg, PROFILE, fakeBin, NEW_VERSION);
    const report = await doctor(c, PROFILE, directoryStub([], async () => { await fs.rm(profileFile); }));
    assertInvalidated('R5', report, PROFILE);
  });
});

test('R3 包装器内容在探测期间被改：仍判失效', async () => {
  const { c, wrapper } = await profileCell();
  await withEnv(pinned(c), async () => {
    await recordConclusion(c.cfg, PROFILE, fakeBin, NEW_VERSION);
    const report = await doctor(c, PROFILE, directoryStub([], async () => { await fs.appendFile(wrapper, '# rotated during probe\n'); }));
    assertInvalidated('R3', report, PROFILE);
  });
});

test('R4 包装器入口在探测期间变了（未配 profile_bin，现找的 cld 换了一个）：仍判失效', async () => {
  const c = await makeCell();
  await writeProfile(c.home);
  const pathDir = await scratchDir('trivium-route-stability-path-');
  const firstWrapper = await shellEntry(pathDir, 'cld');
  await withEnv(pinned(c, { PATH: `${pathDir}${path.delimiter}${process.env['PATH'] ?? ''}` }), async () => {
    assert.equal(resolveClaudeRoute(c.cfg, PROFILE).bin, firstWrapper, '前提：探测前现找到的是 PATH 里那个包装器');
    await recordConclusion(c.cfg, PROFILE, fakeBin, NEW_VERSION);
    const report = await doctor(c, PROFILE, directoryStub([], async () => {
      await fs.mkdir(path.join(c.home, '.local', 'bin'), { recursive: true });
      await shellEntry(path.join(c.home, '.local', 'bin'), 'cld');
    }));
    assertInvalidated('R4', report, PROFILE);
  });
});

}
