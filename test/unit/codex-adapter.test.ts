/**
 * codex 适配器：argv 构造、事件流解析、生效模型回读、隔离副本（M8 第 3 步）。
 *
 * 写判据单列在 `codex-write-verbs.test.ts`（它守的是误报方向，分量不同）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { buildCodexArgs, buildCodexResult, codexAdapter, readonlyArgsFromProbe } from '../../src/trivium/adapters/codex.js';
import { capabilityParity } from '../../src/trivium/doctor.js';
import { defaultConfig } from '../../src/trivium/config.js';
import type { Config } from '../../src/trivium/types.js';
import {
  parseCodexEvents,
  parseCodexSessionMeta,
  succeededCommands,
} from '../../src/trivium/adapters/codex-trace.js';
import { trimCodexToml, rewriteHomePaths, prepareCodexHome } from '../../src/trivium/adapters/codex-home.js';

// ─────────────────────────── argv 构造 ───────────────────────────

test('argv：只读旗标一律由探针结论构造，不写死', () => {
  const args = buildCodexArgs({
    profile: 'qwen', model: 'qwen3.8-max', effort: 'high',
    readonlyArgs: readonlyArgsFromProbe(['-s', 'read-only']), cwd: '/proj',
  });
  assert.deepEqual(args, [
    'exec', '-p', 'qwen', '-m', 'qwen3.8-max',
    '-c', 'model_reasoning_effort=high',
    '-s', 'read-only',
    '--json', '--skip-git-repo-check', '-C', '/proj', '-',
  ]);
});

test('argv：探针没给只读旗标时不凭空补一个默认值', () => {
  /*
   * 探针把 `readonly_flags` 清空的含义是「**负对照失败**：read-only 下文件仍被创建」，
   * 不是「没测」。此时补一个「文档上写着应该管用」的默认值，等于在一台已知沙箱
   * 不可信的机器上声称只读——该侧的不可用由 availability() 拦，argv 这里不兜底。
   */
  const args = buildCodexArgs({
    profile: null, model: null, effort: null,
    readonlyArgs: readonlyArgsFromProbe([]), cwd: '/proj',
  });
  assert.ok(!args.includes('read-only'), '探针没给就不能自己造一个只读旗标出来');
});

test('argv：prompt 走 stdin（末尾 `-`），不进 argv', () => {
  const args = buildCodexArgs({
    profile: null, model: null, effort: null, readonlyArgs: [], cwd: '/proj',
  });
  assert.equal(args.at(-1), '-', '送审包是几十 KB，塞 argv 是在赌 ARG_MAX');
});

// ─────────────────────────── 事件流 ───────────────────────────

test('事件流：顶层 error 事件要被认出来（跨家族调用的唯一错误信息来源）', () => {
  /*
   * 实测形态：`-p qwen -m deepseek-flash` 时流里是
   * `{"type":"error","message":"Reconnecting... 1/5 (… Model not found: deepseek-flash)"}`，
   * 重试五次后退 1。不认这个类型，失败原因就只剩一个退出码。
   */
  const t = parseCodexEvents(
    '{"type":"thread.started","thread_id":"T1"}\n' +
      '{"type":"error","message":"Reconnecting... 1/5 (stream disconnected: Model not found: x)"}\n',
  );
  assert.equal(t.threadId, 'T1');
  assert.deepEqual(t.errors, ['Reconnecting... 1/5 (stream disconnected: Model not found: x)']);
});

test('事件流：未知 item 类型跳过而不抛（reasoning 就是实测新出现的）', () => {
  const t = parseCodexEvents(
    '{"type":"item.completed","item":{"id":"i0","type":"reasoning","text":"…"}}\n' +
      '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"OK"}}\n',
  );
  assert.ok(t.itemTypes.includes('reasoning'), '新类型要进结论，否则「重录样本」这条口径触发不了');
  assert.equal(t.finalText, 'OK');
});

test('事件流：只有成功执行的命令进写判据的入参', () => {
  const t = parseCodexEvents(
    '{"type":"item.completed","item":{"type":"command_execution","status":"completed","exit_code":0,"command":"ls"}}\n' +
      '{"type":"item.completed","item":{"type":"command_execution","status":"completed","exit_code":1,"command":"cat nope"}}\n',
  );
  assert.deepEqual(succeededCommands(t), ['ls'], '失败的命令仍留在 command_texts 给措施 b，但不进写判据');
  assert.equal(t.commands.length, 2, 'command_texts 那一侧要拿到全集');
});

// ─────────────────────────── 生效模型回读 ───────────────────────────

test('回读：session_meta 给出家族与生效模型', () => {
  // 形状取自本步真机录制（凭据与本机路径已替换）
  const meta = parseCodexSessionMeta(
    JSON.stringify({
      type: 'session_meta',
      payload: {
        session_id: 'S1', cli_version: '0.154.0', cwd: '/proj',
        model_provider: 'qwen',
        base_instructions: { text: '', provenance: { type: 'model', model: 'qwen3.8-flash' } },
      },
    }),
  );
  assert.equal(meta.modelProvider, 'qwen');
  assert.equal(meta.modelEffective, 'qwen3.8-flash', '实测它跟随 -m 覆盖，不是 profile 的意图值');
  assert.equal(meta.cliVersion, '0.154.0');
});

test('回读：拿不到就是拿不到，不得回落成别的值', () => {
  for (const bad of ['', 'not json', '{"type":"other"}', '{"type":"session_meta"}']) {
    const m = parseCodexSessionMeta(bad);
    assert.equal(m.modelEffective, null, `「${bad.slice(0, 20)}」应回读为 null`);
  }
});

// ─────────────────────────── 隔离副本 ───────────────────────────

const SAMPLE_TOML = `model = "qwen3.8-max"
model_provider = "qwen"
model_catalog_json = "~/.codex/models-qwen.json"
notify = ["/usr/bin/say"]

[projects."/Users/someone/secret-work"]
trust_level = "trusted"

[mcp_servers.node_repl]
command = "node"

[plugins."browser@bundled"]
enabled = true

[model_providers.qwen]
name = "Qwen"
base_url = "https://example.invalid/v1"
`;

test('裁剪：MCP、plugins、notify、他人项目信任表一律剥掉', () => {
  const { kept, stripped } = trimCodexToml(SAMPLE_TOML);
  assert.ok(!kept.includes('mcp_servers'), 'MCP 是独立进程通道，-s read-only 管不到它');
  assert.ok(!kept.includes('plugins'), '');
  assert.ok(!kept.includes('notify'), 'notify 是外部命令回调');
  assert.ok(!kept.includes('secret-work'), '宿主机信任过哪些目录不该进审查会话');
  assert.ok(stripped.some((k) => k.includes('mcp_servers')), '剥掉什么要逐条留痕，不能静默丢');
});

test('裁剪：模型相关键与 provider 段必须留下（否则副本跑不起来）', () => {
  const { kept } = trimCodexToml(SAMPLE_TOML);
  for (const need of ['model =', 'model_provider =', 'model_catalog_json =', '[model_providers.qwen]', 'base_url']) {
    assert.ok(kept.includes(need), `${need} 是副本可用的必要条件`);
  }
});

test('重写：~/ 路径改为副本内绝对路径，并把文件拷进来', async () => {
  /*
   * 这条守的是本步实测到的阻断项：`~` 由 **HOME** 展开，隔离 HOME 之后
   * `~/.codex/models-qwen.json` 指向 fakehome 下不存在的文件，
   * codex 直接 `Error: No such file or directory` 退出。
   */
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-cx-'));
  try {
    const src = path.join(os.homedir(), '.trivium-test-catalog.json');
    await fs.writeFile(src, '{}', 'utf8');
    const f = path.join(dir, 'config.toml');
    await fs.writeFile(f, 'model_catalog_json = "~/.trivium-test-catalog.json"\n', 'utf8');

    const r = await rewriteHomePaths(f, dir);
    const after = await fs.readFile(f, 'utf8');
    assert.ok(after.includes(dir), '值必须指向副本内的绝对路径');
    assert.ok(!after.includes('~/'), '重写后不得残留 ~ 写法');
    assert.deepEqual(r.copied, ['.trivium-test-catalog.json']);
    await fs.rm(src, { force: true });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('重写：目标不存在或不是普通文件时留痕跳过，不抛异常', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-cx-'));
  try {
    const f = path.join(dir, 'config.toml');
    await fs.writeFile(f, 'a = "~/definitely-not-here-xyz"\nb = "~/"\n', 'utf8');
    const r = await rewriteHomePaths(f, dir);
    assert.deepEqual(r.copied, []);
    assert.ok(r.rewritten.every((x) => x.includes('跳过')), '逐条留痕，不静默');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('准备：产出独立 CODEX_HOME 与独立 HOME，凭据权限收紧到 600', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-cx-'));
  const fakeSrc = path.join(dir, 'src-home');
  try {
    await fs.mkdir(fakeSrc, { recursive: true });
    await fs.writeFile(path.join(fakeSrc, 'config.toml'), SAMPLE_TOML, 'utf8');
    await fs.writeFile(path.join(fakeSrc, 'auth.json'), '{"token":"x"}', 'utf8');

    const prep = await prepareCodexHome(dir, {
      profile: null, projectRoot: '/proj', sourceHome: fakeSrc,
    });

    assert.ok(prep.fakeHome.startsWith(prep.codexHome), 'HOME 也要被覆盖，否则 skill 指令面漏进来');
    assert.ok(prep.copiedFiles.includes('auth.json'));
    const mode = (await fs.stat(path.join(prep.codexHome, 'auth.json'))).mode & 0o777;
    assert.equal(mode, 0o600, '凭据副本必须收紧权限');

    const base = await fs.readFile(path.join(prep.codexHome, 'config.toml'), 'utf8');
    assert.ok(base.includes('[projects."/proj"]'), '按当次项目根重建信任记录');
    assert.ok(!base.includes('secret-work'), '不抄宿主机整张信任表');
    assert.ok(prep.strippedKeys.length > 0, '剥离清单要能说出丢了什么');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ─────────────────────────── 能力声明 ───────────────────────────

test('能力声明：codex 是 command-trace，且被拒操作不留痕', () => {
  /*
   * **这条是变异验证逼出来的。** M8 第 3 步跑 M1 变异（把声明改成 `tool-trace`）时，
   * 全量用例无一变红——判定层按声明分档，而没有任何断言守着「声明的是什么」。
   * 声明一旦错成 tool-trace：路径不再从命令文本回填，该侧证据恒不达标；
   * rejectionRecorded 错成 true 则让「没检出写事件」被当成可信的阴性结论。
   *
   * 依据是 M6 实测 P-C1（读取路径没有结构化字段）与 P-C2（被拒命令不进事件流），
   * 后者在本步的隔离实测里再次复现。改这两个值之前先去改探针报告。
   */
  assert.equal(codexAdapter.capability.traceShape, 'command-trace');
  assert.equal(codexAdapter.capability.rejectionRecorded, false);
});

test('能力对账：声明与探针实测不符时必须被点名', () => {
  // 探针说「有结构化路径」而适配器声明 command-trace —— 其一过时了，doctor 要说出来
  const lines = capabilityParity(
    { trace_path_structured: true, rejected_command_in_trace: false },
    codexAdapter.capability,
    'codex',
  );
  assert.equal(lines.length, 1, '不符却不点名，这个字段就白登记了（EV-06 的形状）');
  assert.match(lines[0]!.message, /trace_path_structured/);

  const clean = capabilityParity(
    { trace_path_structured: false, rejected_command_in_trace: false },
    codexAdapter.capability,
    'codex',
  );
  assert.deepEqual(clean, [], '相符时不得报噪音');
});

test('能力对账：探针没测出结论（null）时不报不符', () => {
  const lines = capabilityParity(
    { trace_path_structured: null, rejected_command_in_trace: null },
    codexAdapter.capability,
    'codex',
  );
  assert.deepEqual(lines, [], '「没测过」不是「不符」——那是三态里的第三态');
});

// ─────────────────────────── 结果组装（AC-20 的硬判据） ───────────────────────────

const OUTCOME = { exitCode: 0, durationMs: 1000, commandLine: 'codex exec …' };
const PATHS = { stdout: '/run/stdout.jsonl', trace: '/run/trace.json' };
const PROBE = { version: '0.154.0', path_deny: { supported: false } };
const TRACE_OK = parseCodexEvents(
  '{"type":"thread.started","thread_id":"T9"}\n' +
    '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}\n',
);

test('组装：回读到生效模型 → 来源记 trace', () => {
  const r = buildCodexResult(
    TRACE_OK,
    { sessionId: 'T9', modelProvider: 'qwen', modelEffective: 'qwen3.8-flash', cliVersion: '0.154.0' },
    OUTCOME, PATHS, PROBE, '/proj',
  );
  assert.equal(r.model_effective, 'qwen3.8-flash');
  assert.equal(r.model_effective_source, 'trace');
});

test('组装：回读不到 → 记 unverified，且 model_effective 保持 null', () => {
  /*
   * **这条是 AC-20 的硬判据**：「生效模型仍以回读为准、不采信 profile 意图」。
   * 拿请求值冒充会让那条验收永远通过——M8 第 3 步的 M4 变异证实了缺守卫，
   * 本条就是补上的那个守卫。与 zcode 侧「绝不用 requested 冒充」是同一条纪律。
   */
  const r = buildCodexResult(
    TRACE_OK,
    { sessionId: 'T9', modelProvider: null, modelEffective: null, cliVersion: null },
    OUTCOME, PATHS, PROBE, '/proj',
  );
  assert.equal(r.model_effective, null, '拿不到就是拿不到，不得回落成请求值');
  assert.equal(r.model_effective_source, 'unverified');
});

test('组装：read_paths 恒空且 command_texts 拿全集（含失败的命令）', () => {
  const trace = parseCodexEvents(
    '{"type":"item.completed","item":{"type":"command_execution","status":"completed","exit_code":0,"command":"grep -rn x src"}}\n' +
      '{"type":"item.completed","item":{"type":"command_execution","status":"completed","exit_code":2,"command":"cat missing.ts"}}\n' +
      '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}\n',
  );
  const r = buildCodexResult(
    trace,
    { sessionId: null, modelProvider: null, modelEffective: 'm', cliVersion: null },
    OUTCOME, PATHS, PROBE, '/proj',
  );
  assert.deepEqual(r.read_paths, [], 'codex 没有结构化路径字段，由判定层从命令文本回填');
  assert.equal(r.command_texts.length, 2, '措施 b 要扫全集：泄漏企图即便失败也要检出');
  assert.deepEqual(r.write_events, [], '两条都是读命令');
});

test('组装：项目内的成功写入进 write_events，项目外进疑似档', () => {
  const trace = parseCodexEvents(
    '{"type":"item.completed","item":{"type":"command_execution","status":"completed","exit_code":0,"command":"echo x > src/a.ts"}}\n' +
      '{"type":"item.completed","item":{"type":"command_execution","status":"completed","exit_code":0,"command":"cp src/a.ts /tmp/b.ts"}}\n' +
      '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}\n',
  );
  const r = buildCodexResult(
    trace,
    { sessionId: null, modelProvider: null, modelEffective: 'm', cliVersion: null },
    OUTCOME, PATHS, PROBE, '/proj',
  );
  assert.deepEqual(r.write_events, ['echo x > src/a.ts']);
  assert.equal(r.suspected_write_events?.length, 1);
  assert.match(r.suspected_write_events![0]!.why, /项目外/);
});

// ─────────────────────────── 可用性判据 ───────────────────────────

function probeWith(over: Record<string, unknown> = {}): Config {
  const cfg = defaultConfig();
  Object.assign(cfg.probe.cli.codex!, {
    probed_at: new Date().toISOString(),
    entrypoint: '/usr/local/bin/codex',
    readonly_flags: ['-s', 'read-only'],
    exec_headless_read_ok: true,
    profiles: ['qwen'],
    providers: [{ profile: 'qwen', provider: 'qwen', model: 'qwen3.8-max', credentialed: true }],
    ...over,
  });
  return cfg;
}
const AVAIL_CTX = (cfg: Config) => ({ cfg, nodePath: process.execPath });

test('可用性：五档不可用理由互不混淆', () => {
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ['没探过', { probed_at: null }, /尚未探测/],
    ['探过但没找到入口', { entrypoint: null }, /未找到 codex 可执行文件/],
    ['沙箱负对照失败', { readonly_flags: [] }, /只读沙箱负对照失败的情形/],
    ['headless 读不到', { exec_headless_read_ok: false }, /读不到文件/],
    ['没测成（三态的第三态）', { exec_headless_read_ok: null }, /上次探测没跑完/],
  ];
  for (const [name, over, re] of cases) {
    const v = codexAdapter.availability(AVAIL_CTX(probeWith(over)));
    assert.equal(v.ok, false, `${name} 应判不可用`);
    assert.match(v.reason!, re, `${name} 的理由不该与其它档混淆`);
  }
});

test('可用性：配置的 profile 在本机不存在 → 拒，并列出已探到的', () => {
  /*
   * 这道拦截不能省：codex 对未知 profile **不报错、静默回落基底配置**
   * （`unknown_profile_rejected` 实测为 false）。不拦，用户就会以为跑的是
   * 自己写的那家、实际跑的是基底那家，而留痕里两者看不出差别。
   */
  const cfg = probeWith();
  (cfg.agents.codex as { profile: string | null }).profile = 'no-such-profile';
  const v = codexAdapter.availability(AVAIL_CTX(cfg));
  assert.equal(v.ok, false);
  assert.match(v.reason!, /no-such-profile/);
  assert.match(v.reason!, /qwen/, '要列出已探到的可用值，别把用户引向下一个错误');
});

test('可用性：profile 存在但该家族没有凭据 → 拒，并给出可粘贴的落点', () => {
  const cfg = probeWith({
    providers: [{ profile: 'qwen', provider: 'qwen', model: 'm', credentialed: false }],
  });
  const v = codexAdapter.availability(AVAIL_CTX(cfg));
  assert.equal(v.ok, false);
  assert.match(v.reason!, /model_providers\.qwen/, '要说清凭据写在哪一段');
  assert.match(v.reason!, /不代写/, '编排器不代填凭据、不改全局配置（纪律 5）');
});

test('可用性：探针齐备且家族有凭据 → 可用', () => {
  assert.deepEqual(codexAdapter.availability(AVAIL_CTX(probeWith())), { ok: true });
});
