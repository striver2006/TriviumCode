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
import { buildCodexArgs, buildCodexResult, codexAdapter, providerSection, readonlyArgsFromProbe } from '../../src/trivium/adapters/codex.js';
import { capabilityParity } from '../../src/trivium/doctor.js';
import { judgeSide, renderGuardWarnings } from '../../src/trivium/guard.js';
import { COMMAND_TRACE_CAPABILITY } from '../../src/trivium/adapters/base.js';
import { TRIVIUM_DIR, defaultConfig } from '../../src/trivium/config.js';
import type { Config } from '../../src/trivium/types.js';
import {
  parseCodexEvents,
  parseCodexSessionMeta,
  succeededCommands,
} from '../../src/trivium/adapters/codex-trace.js';
import { trimCodexToml, rewriteHomePaths, prepareCodexHome } from '../../src/trivium/adapters/codex-home.js';

// WIN_FILE_SKIP（Windows 移植）：断言 POSIX 权限位语义（0600/0500/0000），NTFS 无对应物
// macOS/Linux 行为零变化；Windows 侧等价语义见 test/unit/platform-win.test.ts 与取消标记相关用例。
if (process.platform === 'win32') {
  console.log('skip（win32）: 断言 POSIX 权限位语义（0600/0500/0000），NTFS 无对应物');
} else {

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
// codex 无路径级 deny 机制，「逐文件形态验没验过」这个问题在本族不成立 ⇒ null（EV-42）
const PROBE = { version: '0.154.0', path_deny: { file_shape_verified: null } };
const TRACE_OK = parseCodexEvents(
  '{"type":"thread.started","thread_id":"T9"}\n' +
    '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}\n',
);

test('组装：回读到生效模型 → 来源记 trace', () => {
  const r = buildCodexResult(
    TRACE_OK,
    { sessionId: 'T9', modelProvider: 'qwen', modelEffective: 'qwen3.8-flash', cliVersion: '0.154.0' },
    OUTCOME, PATHS, PROBE, '/proj', null,
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
    OUTCOME, PATHS, PROBE, '/proj', null,
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
    OUTCOME, PATHS, PROBE, '/proj', null,
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
    OUTCOME, PATHS, PROBE, '/proj', null,
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

// ───────────── C 批：契约消费方与指纹（r9 双审 GLM-05 / GLM-10） ─────────────

test('疑似写有人读出口：判定告警里点得出条数与理由', () => {
  /*
   * r9 双审 GLM-05：契约注释承诺「进 doctor 输出」，而全仓没有任何消费方——
   * 「宣称了不存在的消费方」正是 EV-06 那个形态。
   * 这一档不判失守，但必须看得见：它记的是「命中写形态却判不实」的命令，
   * 恰是排查只读问题时最该先看的几条。
   */
  const result = buildCodexResult(
    parseCodexEvents(
      '{"type":"item.completed","item":{"type":"command_execution","status":"completed","exit_code":0,"command":"cp src/a.ts /tmp/leak.ts"}}\n' +
        '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}\n',
    ),
    { sessionId: null, modelProvider: null, modelEffective: 'm', cliVersion: null },
    OUTCOME, PATHS, PROBE, '/proj', null,
  );
  assert.equal(result.suspected_write_events?.length, 1, '结果里要带着它');

  const req = {
    critic: 'codex' as const, stage: 'code' as const, model: 'm', effort: null,
    brief_text: '', brief_path: '/proj/b.md', subject_path: '/proj/subject.md',
    project_root: '/proj', out_dir: '/tmp/out', timeout_s: 60,
    min_tool_calls: 0, min_project_reads: 0, deny_paths: [],
  };
  const verdict = judgeSide(defaultConfig(), 'codex', result, null, req as never, {
    degraded: [],
    archiveRootAbs: '/proj/.reviews', projectRoot: '/proj',
    triviumDir: '/proj/' + TRIVIUM_DIR, runRoot: '/tmp/runs',
    capability: COMMAND_TRACE_CAPABILITY,
  });
  assert.equal(verdict.suspectedWrites.length, 1, '判定结果要带着它，否则渲染层拿不到');
  assert.equal(verdict.readonlyBreach, false, '疑似档不驱动只读失守');

  const notes = renderGuardWarnings({
    sides: { codex: verdict }, drift: { changed: false, files: [], related: [] },
    driftAction: 'ok', fingerprintChangedFiles: [], unattributedDriftFiles: [],
  } as never);
  assert.ok(
    notes.some((n) => n.includes('疑似写入') && n.includes('/tmp/leak.ts')),
    `告警里要点名条数与命令，实得：${notes.join(' / ')}`,
  );
});

test('探活指纹：基底 config.toml 的 provider 段参与指纹，其余杂项不参与', () => {
  // r9 双审 GLM-10：provider 定义可能只写在基底里，在那里轮换凭据不该让缓存继续沿用
  const withProvider = `model = "m"\n[plugins."x"]\nenabled = true\n\n[model_providers.qwen]\nexperimental_bearer_token = "AAA"\n`;
  const rotated = withProvider.replace('AAA', 'BBB');
  const noisyOnly = withProvider.replace('enabled = true', 'enabled = false');

  const a = providerSection(withProvider);
  assert.ok(a?.includes('[model_providers.qwen]'), '要抽出 provider 段');
  assert.ok(!a!.includes('plugins'), '与鉴权无关的段不得进指纹——否则缓存恒失效');
  assert.notEqual(providerSection(rotated), a, '轮换凭据必须改变指纹');
  assert.equal(providerSection(noisyOnly), a, '只改 plugins 不该动指纹');
  assert.equal(providerSection('model = "m"\n'), null, '没有 provider 段就返回 null');
});

// ───────── provider 与 profile 两个维度（AC-20 互可区分，计划双审 GLM-01 / CODEX-03） ─────────

test('组装：provider 回读值进结果，且与生效模型是两个独立维度', () => {
  /*
   * 夹具用的是**本步真机实测的原始回读值**，不是构造的：
   *   codex exec -p qwen -m deepseek-v4-pro  →  exit 0
   *   session_meta: model_provider=qwen, base_instructions.provenance.model=deepseek-v4-pro
   *
   * 它证明「同一个模型名可以挂在两个 provider 下」，因此
   * 「两次 model_effective 不同 ⇒ 跑了两个模型家族」这个推断不成立。
   * 真实形态比编的值钱——E-1 这条缺陷正是靠这次实跑才被发现的。
   */
  const r = buildCodexResult(
    TRACE_OK,
    { sessionId: 'T9', modelProvider: 'qwen', modelEffective: 'deepseek-v4-pro', cliVersion: '0.154.0' },
    OUTCOME, PATHS, PROBE, '/proj', 'qwen',
  );
  assert.equal(r.model_provider, 'qwen', 'provider 必须如实入档——上一版解析了却丢掉了');
  assert.equal(r.model_effective, 'deepseek-v4-pro');
  assert.notEqual(r.model_provider, r.model_effective, '两个维度不得互相顶替');
});

test('组装：profile 是请求值、provider 是回读值，两者绝不互相渗透', () => {
  /*
   * 这条守的是 AC-20 末句「生效模型仍以回读为准、不采信 profile 意图」。
   * 变异 M2（把 profile_requested 填成 meta.modelProvider）必须红在这里。
   */
  const r = buildCodexResult(
    TRACE_OK,
    { sessionId: 'T9', modelProvider: 'zai', modelEffective: 'glm-5.3', cliVersion: null },
    OUTCOME, PATHS, PROBE, '/proj', 'glm',
  );
  assert.equal(r.profile_requested, 'glm', '请求值取自配置，不是回读来的');
  assert.equal(r.model_provider, 'zai', '回读值取自会话文件');
  assert.notEqual(
    r.profile_requested, r.model_provider,
    'profile 名与 provider 名是两个概念：本机 glm→zai、gpt→openai 就不相等（计划双审 GLM-02）',
  );
});

test('组装：回读不到 provider 时记 null，不拿请求值顶替', () => {
  const r = buildCodexResult(
    TRACE_OK,
    { sessionId: 'T9', modelProvider: null, modelEffective: null, cliVersion: null },
    OUTCOME, PATHS, PROBE, '/proj', 'qwen',
  );
  assert.equal(r.model_provider, null, '拿不到就是拿不到——用 profile 名冒充会让 AC-20 永远通过');
  assert.equal(r.profile_requested, 'qwen', '请求值本来就有，不受回读失败影响');
});

// ───────── 逐 profile 模型目录（D4-1 = C″，计划双审 CODEX-05 / CODEX-11） ─────────

function cfgWith(profile: string | null, byProfile: Record<string, string[]>, baseModels: string[]): Config {
  const c = defaultConfig();
  (c.agents as Record<string, unknown>)['codex'] = {
    vendor: 'openai', bin: null, profile,
    effort: { plan: 'high', code: 'high', bug: 'high' },
  };
  c.probe.cli.codex!.models = baseModels;
  c.probe.cli.codex!.models_by_profile = byProfile;
  return c;
}

test('目录：按本次 profile 取，不再拿基底目录顶替', () => {
  /*
   * 取值来自本机真实形态：基底（qwen）目录里没有 deepseek-flash，
   * 而 deepseek profile 自己的目录里有它——它正是该 profile 的默认模型。
   * 上一版拿基底那份校验，会把这个**本可跑通**的配置拒掉（误杀）。
   */
  const cfg = cfgWith('deepseek', { deepseek: ['deepseek-flash', 'deepseek-v4-pro'], qwen: ['qwen3.8-max'] }, ['qwen3.8-max']);
  const got = codexAdapter.catalogModelsFor!(cfg);
  assert.equal(got?.kind, 'catalog');
  assert.deepEqual(got?.kind === 'catalog' ? got.models : null, ['deepseek-flash', 'deepseek-v4-pro']);
});

test('目录：没配 profile → 用基底的**可见**子集，不是含隐藏项的全集', () => {
  /*
   * 代码双审 GLM-03：上一版这一支直接返回 null 回落 `probe.models`，
   * 而那是**含 `visibility: "hide"` 的全集**。于是隐藏项在 codex 的**默认形态**
   * （未配 profile）上照样放行——修复只覆盖了配了 profile 的那一半。
   */
  const cfg = cfgWith(null, {}, ['qwen3.8-max', 'gpt-reserve']);
  cfg.probe.cli.codex!.models_visible = ['qwen3.8-max'];
  const got = codexAdapter.catalogModelsFor!(cfg);
  assert.equal(got?.kind, 'catalog');
  assert.deepEqual(
    got?.kind === 'catalog' ? got.models : null, ['qwen3.8-max'],
    '隐藏项 gpt-reserve 不得出现在判据里',
  );
});

test('目录：旧留痕 + 没配 profile → 回落基底，绝不降级成放行', () => {
  /*
   * M8 第 4 步之前落盘的 config.local.yaml 既没有 models_visible 也没有 models_by_profile。
   * 此时若返回「无法校验」，调用方会**放行**——把一道既有拦截变成 fail-open，
   * 正是 RV-B1 那一族的形态。
   */
  const cfg = cfgWith(null, {}, ['qwen3.8-max']);
  assert.equal(
    codexAdapter.catalogModelsFor!(cfg), null,
    '旧留痕要回落到本步之前的行为：不更准，但也不更松',
  );
});

test('目录：旧留痕 + 配了 profile → fallback（回落且说出来），不静默', () => {
  /*
   * 代码双审 CODEX-05：上一版这一格返回 null ⇒ 预检**静默**拿含隐藏项的基底全集校验，
   * 而 `types.ts` 的契约文字承诺的是「记为 unverifiable、不静默通过」——承诺与实现对不上。
   * 走 fallback 两头都顾：照常校验（不 fail-open），且回落这件事进预检输出。
   */
  const cfg = cfgWith('deepseek', {}, ['qwen3.8-max']);
  const got = codexAdapter.catalogModelsFor!(cfg);
  assert.equal(got?.kind, 'fallback');
  assert.ok(got?.kind === 'fallback' && got.why.includes('doctor'), '要告诉用户怎么修');
});

test('目录：本 profile 采集失败 → fallback（回落且说出原因），不是 unverifiable', () => {
  /*
   * **本条是代码双审 CODEX-01 的锁例。** 上一版把「子进程失败」与「确认没有目录」
   * 压成同一个空清单，消费方据此记「无法校验」而放行——一次 `debug models` 超时
   * 就能让刚建起来的 slug 拦截静默失效，而给出的原因（「该机可能未配置
   * model_catalog_json」）是数据支撑不了的。
   */
  const cfg = cfgWith('deepseek', { qwen: ['qwen3.8-max'] }, ['qwen3.8-max']);
  cfg.probe.cli.codex!.models_by_profile_errors = { deepseek: 'codex debug models 退 1' };
  const got = codexAdapter.catalogModelsFor!(cfg);
  assert.equal(got?.kind, 'fallback', '没测到 ≠ 测出来没有：这一格必须回落而不是放行');
  assert.ok(got?.kind === 'fallback' && got.why.includes('退 1'), '回落要带上真实原因，不许编');
});

test('目录：采到了、确实为空 → unverifiable（这一格才是「测出来没有」）', () => {
  // 一台只装官方 auth.json、没配 model_catalog_json 的普通 codex 安装是常态（CODEX-11）
  const cfg = cfgWith('gpt', { deepseek: ['deepseek-flash'], gpt: [] }, ['qwen3.8-max']);
  const got = codexAdapter.catalogModelsFor!(cfg);
  assert.equal(got?.kind, 'unverifiable');
  assert.ok(got?.kind === 'unverifiable' && got.why.includes('gpt'), '说不出来要说出来：文案要指名是哪个 profile');
});

test('目录：探针没有本 profile 的任何结论 → fallback，不假装「目录为空」', () => {
  // 配置里写了一个 $CODEX_HOME 下不存在的 profile：那是 availability 的活，不是本函数的
  const cfg = cfgWith('nosuch', { qwen: ['qwen3.8-max'] }, ['qwen3.8-max']);
  const got = codexAdapter.catalogModelsFor!(cfg);
  assert.equal(got?.kind, 'fallback');
});

// ───────── 目录解析：visibility 过滤（代码双审 GLM-04，此前零锁例） ─────────

test('解析：隐藏项进 models、不进 visible', async () => {
  /*
   * `visibility` 过滤是 P-25 缓解的**核心机制**，而上一版没有任何用例咬得住它——
   * 新增用例全部经构造好的数据进消费方，把这一行删掉不会红任何一条。
   * 抽成纯函数就是为了让它可锁（「加了守卫不等于守卫被守着」）。
   */
  const { parseCodexModelCatalog } = await import('../../src/trivium/probes/codex.js');
  const json = JSON.stringify({
    models: [
      { slug: 'deepseek-flash', visibility: 'list' },
      { slug: 'deepseek-v4-pro', visibility: 'list' },
      { slug: 'gpt-reserve', visibility: 'hide' },
      { slug: 'codex-auto-review', visibility: 'hide' },
    ],
  });
  const got = parseCodexModelCatalog(json);
  assert.deepEqual(got?.models, ['deepseek-flash', 'deepseek-v4-pro', 'gpt-reserve', 'codex-auto-review']);
  assert.deepEqual(
    got?.visible, ['deepseek-flash', 'deepseek-v4-pro'],
    '端点的合法名单只认可见项——本机实测 -p deepseek 的报错逐字列的就是这两个',
  );
});

test('解析：visibility 字段缺失按可见处理（宁可少拦一个，不因厂商加字段而全表不可用）', async () => {
  const { parseCodexModelCatalog } = await import('../../src/trivium/probes/codex.js');
  const got = parseCodexModelCatalog(JSON.stringify({ models: [{ slug: 'a' }, { slug: 'b', visibility: 'hide' }] }));
  assert.deepEqual(got?.visible, ['a']);
});

test('解析：不是 JSON → null（与「解析出空目录」不是一回事）', async () => {
  const { parseCodexModelCatalog } = await import('../../src/trivium/probes/codex.js');
  assert.equal(parseCodexModelCatalog('error: unexpected argument'), null, '解析失败要与空目录分得开');
  assert.deepEqual(parseCodexModelCatalog(JSON.stringify({ models: [] }))?.visible, [], '空目录是合法结果，不是 null');
});

// ───────── provider 的 base_url（AC-20 的第四种「通过而无意义」形态，CODEX-03） ─────────

test('provider：base_url 归一到 host，userinfo 与 query 一律不入库', async () => {
  const { providerBaseUrl } = await import('../../src/trivium/probes/codex.js');
  const toml = [
    '[model_providers.alpha]',
    'base_url = "https://api.example.com/v1"',
    /*
     * 占位值必须以 `secrets.ts` 的 `PLACEHOLDER` 前缀开头（`placeholder` / `example` /
     * `dummy` / `your_` …）。第一版写的是 `sk-must-not-leak`——不在白名单、熵又够高，
     * **被本项目自己的密钥扫描判成真凭据，当场拒绝归档落盘**（`toml-bearer-token` 规则）。
     * 那是扫描器在正确工作：夹具里的假凭据长得像真的，等于给未来的误判留种子。
     */
    'experimental_bearer_token = "placeholder-not-a-real-token"',
    '',
    '[model_providers.beta]',
    'base_url = "https://api.example.com/v1"',
  ].join('\n');
  assert.equal(providerBaseUrl(toml, 'alpha'), 'api.example.com', '只留 host，路径与 scheme 都不需要');
  assert.equal(
    providerBaseUrl(toml, 'beta'), 'api.example.com',
    '两个不同的 provider id 指向同一个 endpoint——provider 名互异证明不了家族互异',
  );
  assert.equal(providerBaseUrl(toml, 'nosuch'), null, '段不存在记 null，不猜');

  /*
   * 代码双审 CODEX-06：URL 的 userinfo 与 query 是承载凭据的常见形态，
   * 而判据只需要 host。原串入库等于把凭据面扩到 config.local.yaml 与 doctor 输出。
   */
  const withCreds = [
    '[model_providers.leaky]',
    'base_url = "https://user:sk-secret-value@gw.example.com/v1?key=sk-another"',
  ].join('\n');
  const got = providerBaseUrl(withCreds, 'leaky');
  assert.equal(got, 'gw.example.com');
  assert.ok(!String(got).includes('sk-'), 'userinfo 与 query 里的凭据一律不得落盘');

  const bad = '[model_providers.weird]\nbase_url = "not a url"';
  assert.equal(providerBaseUrl(bad, 'weird'), null, '解析不出 host 就整串丢弃，不做尽力截取');
});

}
