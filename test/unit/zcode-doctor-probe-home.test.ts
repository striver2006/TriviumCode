/**
 * EV-194：doctor 的 zcode headless 探针与 path_deny 否定对照要探**审查运行那条选模路径**。
 *
 * 此前两次真实调用都以真实 HOME 拉起、个人 provider 配置被注入，0.16.9 直接用它的 `defaultModelSelection`——
 * 探的是个人缺省模型；2026-10-02 个人缺省指向已停用的 provider，headless 连报 `Model creation failed`，
 * 失败即返回，其后几项结论全都不刷新，而审查要用的 GLM 订阅完好。现在与 `authProbe`（EV-136）同形。
 *
 * 装置：
 *   - `invoke` 用桩，记下每次入参；成功时在 `storageRedirectRoot` 下按递给 CLI 的落点键写日志与 rollout——
 *     只有从落点根回读才拿得到桩写的模型；
 *   - `HOME` 钉到临时目录并**摆一份个人配置**（不摆则注入与否观测相同，退回旧写法的变异杀不死）；
 *   - `TMPDIR` 钉到本用例私有目录（计划双审 CODEX-07）：`trivium-zcode-doctor-*` 只在那里面列举，
 *     并发的 `npm test` 与变异轮干扰不到；用例结束整删，变异留下的残留随之清掉；
 *   - 假入口只给旗标探针与版本探针用（headless 与 path_deny 走桩），三条模型覆盖臂用桩。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  describeZcodeProbedPath,
  zcodeProbeModel,
  zcodeTempDirResidueText,
  ZCODE_HEADLESS_NOT_OK_HINT,
  zcodeStorageRedirectEnv,
  ZCODE_BUILTIN_PROVIDER_ENV,
  type ZcodeHomePrep,
  type ZcodeInvokeOptions,
  type ZcodeInvokeOutcome,
} from '../../src/trivium/adapters/zcode.js';
import { probeZcode, ZCODE_HEADLESS_UNREFRESHED, type ZcodeHeadlessUnrefreshedBranch } from '../../src/trivium/probes/zcode.js';
import { runDoctor, zcodeHeadlessUnrefreshedWarning } from '../../src/trivium/doctor.js';
import { agentConfigOf, defaultConfig } from '../../src/trivium/config.js';
import type { ZcodeProbe } from '../../src/trivium/types.js';

/** 模块加载时的系统临时目录：各用例的私有根建在它下面，用例里的 `os.tmpdir()` 则被钉到私有根 */
const SYSTEM_TMP = os.tmpdir();
const RUN_PREFIX = 'trivium-zcode-doctor-';

/** 假入口：版本子命令答版本；没拿到内置变量报布局错；被拒旗标报 Unknown option；其余停在模型层（零配额形态） */
const FAKE_ENTRY = `
const env = process.env;
const argv = process.argv.slice(2);
if (argv[0] === 'version') { process.stdout.write('zcode 0.16.9\\n'); process.exit(0); }
if (!env.${ZCODE_BUILTIN_PROVIDER_ENV}) { process.stderr.write('无法定位 CLI ZCode Built-in Provider Config：/x\\n'); process.exit(1); }
if (env.FAKE_LOCK_HOME) {
  // 旗标探针的空 HOME 删不掉（EV-198 D18）：HOME 下只读子目录里放一个文件，七次拉起幂等；摆不出退 3
  const fs = require('node:fs');
  const locked = env.HOME + '/locked';
  try {
    if (!fs.existsSync(locked)) { fs.mkdirSync(locked); fs.writeFileSync(locked + '/f', 'x'); fs.chmodSync(locked, 0o500); }
  } catch (e) { process.stderr.write('FAKE_LOCK_HOME：' + e.message + '\\n'); process.exit(3); }
}
for (const rejected of ['--max-turns', '--settings']) {
  if (argv.includes(rejected)) { process.stderr.write("Unknown option '" + rejected + "'.\\n"); process.exit(1); }
}
process.stderr.write('Error: Model creation failed (traceId: fake)\\n');
process.exit(1);
`;

/** 副本源：首位与 model.main 都是 GLM-5.3，请求 Flash 才看得出覆盖与置首做了 */
const CLI_CONFIG = {
  model: { main: 'bigmodel-coding-plan/GLM-5.3', lite: 'bigmodel-coding-plan/GLM-5.3' },
  provider: {
    'bigmodel-coding-plan': {
      name: 'BigModel Coding Plan', kind: 'anthropic', source: 'custom', enabled: true,
      options: { apiKey: 'fake-id.fake-secret', baseURL: 'https://example.invalid' },
      models: { 'GLM-5.3': {}, 'GLM-5.3-Flash': {} },
    },
  },
};
const REQUESTED = 'GLM-5.3-Flash';
const LOG_MODEL = 'stub-provider/STUB-MODEL';

/**
 * 既有结论：每格都与本轮会写出的值不同，「保留」与「刷新」才分得开。
 * `responseField` 给 `'response'` 是 EV-196 的形态：旧值让 headless blocker 不触发，失败只能靠 warning 被看见。
 */
function existingProbe(entry: string, responseField: 'response' | null = null): ZcodeProbe {
  return {
    entrypoint: entry, version: '0.16.9', version_probe: null, probed_at: '2026-01-01T00:00:00.000Z',
    readonly_flags: [], model_override: 'config_copy',
    trace_source: null, trace_args_source: null, response_field: responseField,
    path_deny: { supported: false, rule_syntax: null, method: 'old-method', attempts: [], coverage_complete: null, file_shape_verified: null },
    scratch_paths: ['old.txt'], isolation: 'home_copy', model_id_form: 'old-provider/OLD', models: [],
  };
}

async function world(opts: { cliConfigRaw?: string | null } = {}) {
  const base = await fs.mkdtemp(path.join(SYSTEM_TMP, 'trivium-dprobe-'));
  const privTmp = path.join(base, 'tmp');
  await fs.mkdir(privTmp);
  const entry = path.join(base, 'app/Resources/glm/zcode.cjs');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, FAKE_ENTRY, 'utf8');
  await fs.mkdir(path.join(base, 'app/Resources/config/provider'), { recursive: true });
  await fs.writeFile(path.join(base, 'app/Resources/config/provider/zcode-builtin.json'), '{}', 'utf8');
  const home = path.join(base, 'home');
  // 个人配置恒摆着：旧写法会把它注入，新写法在副本支必须省略
  await fs.mkdir(path.join(home, '.zcode/v2'), { recursive: true });
  await fs.writeFile(path.join(home, '.zcode/v2/provider_config.json'), '{}', { mode: 0o600 });
  const cliConfigPath = path.join(base, 'cli-config.json');
  if (opts.cliConfigRaw !== null) {
    await fs.writeFile(cliConfigPath, opts.cliConfigRaw ?? JSON.stringify(CLI_CONFIG), { mode: 0o600 });
  }
  return { base, privTmp, entry, home, cliConfigPath };
}
type World = Awaited<ReturnType<typeof world>>;

/** 钉住 HOME 与 TMPDIR 跑 fn，结束还原并整删本用例的私有根 */
async function inWorld<T>(w: World, fn: () => Promise<T>): Promise<T> {
  const saved = { HOME: process.env['HOME'], TMPDIR: process.env['TMPDIR'] };
  process.env['HOME'] = w.home;
  process.env['TMPDIR'] = w.privTmp;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
const cleanup = (w: World) => fs.rm(w.base, { recursive: true, force: true });

/** 私有临时根下还留着的探针运行目录（应恒为空） */
async function leftovers(w: World): Promise<string[]> {
  return (await fs.readdir(w.privTmp)).filter((e) => e.startsWith(RUN_PREFIX));
}

interface Call { opts: ZcodeInvokeOptions; modelMain: string | null }

/**
 * `invokeZcode` 的桩。成功时按递给 CLI 的落点键写日志与 rollout：
 *   - 日志：`ZCODE_LOG_DIR` 下；`midnight` 时拆两片，启动事件（带 `context.model`）在前一天那片；
 *   - rollout：存储根下 `cli/rollout/model-io-<sessionId>.jsonl`（CLI 由存储根派生 rollout 目录）。
 * 副本里的 `model.main` 在调用当时读出（探完副本即删）。
 */
function stubInvoke(
  calls: Call[],
  mode: {
    fail?: boolean; throws?: boolean; midnight?: boolean; brokenShard?: boolean; noEnvelope?: boolean;
    /**
     * 让临时目录删不掉的三种摆法（EV-197）：
     *   - `sibling`：落点下一个只读子目录里放一个文件（副本所在的 cli/ 照样删得掉）；
     *   - `copyGone`：同 sibling，另先把副本删掉——「目录删不掉、副本已不在」，不依赖递归删除的先后顺序；
     *   - `cli`：副本所在的 `.zcode/cli` 改只读，副本删不掉；
     *   - `opaque`：`.zcode` 整个不可读，删不进去、也查不了副本在不在（只在第二次调用时锁，免得挡住 path_deny 写日志）。
     */
    lock?: 'sibling' | 'copyGone' | 'cli' | 'opaque';
  } = {},
) {
  return async (o: ZcodeInvokeOptions): Promise<ZcodeInvokeOutcome> => {
    let modelMain: string | null = null;
    if (o.homeDir) {
      try {
        modelMain = (JSON.parse(await fs.readFile(path.join(o.homeDir, '.zcode/cli/config.json'), 'utf8')) as typeof CLI_CONFIG).model.main;
      } catch {
        modelMain = null;
      }
    }
    calls.push({ opts: { ...o }, modelMain });
    if (mode.throws) throw new Error('桩：拉起抛错');
    const base = { commandLine: 'stub', durationMs: 5, timedOut: false };
    if (mode.fail) {
      // 结构化根因只在落点日志里（CLI 失败时 envelope 为空，取不到 sessionId）
      if (o.storageRedirectRoot) {
        const logDir = zcodeStorageRedirectEnv(o.storageRedirectRoot)['ZCODE_LOG_DIR']!;
        await fs.mkdir(logDir, { recursive: true });
        await fs.writeFile(
          path.join(logDir, 'zcode-2026-10-03.jsonl'),
          JSON.stringify({ sessionId: 'sess_failed', event: 'turn.failed', error: { message: 'Model creation failed', cause: { message: 'Select a model before continuing' } } }) + '\n',
          'utf8',
        );
      }
      return { ...base, envelope: null, exitCode: 1, stdout: '', stderr: 'Error: Model creation failed (traceId: fake)', failureKind: 'other' };
    }
    // 退 0 但 stdout 里没有 JSON envelope（EV-196 第三支）：两次调用都这样答，path_deny 照跑
    if (mode.noEnvelope) return { ...base, envelope: null, exitCode: 0, stdout: 'not json', stderr: '', failureKind: 'none' };
    const sessionId = `sess_stub${calls.length}`;
    if (o.storageRedirectRoot) {
      const env = zcodeStorageRedirectEnv(o.storageRedirectRoot);
      const logDir = env['ZCODE_LOG_DIR']!;
      await fs.mkdir(logDir, { recursive: true });
      const start = JSON.stringify({ sessionId, event: 'session.started', context: { model: LOG_MODEL } });
      const later = JSON.stringify({ sessionId, event: 'tool.call.completed', context: { toolName: 'Read' } });
      // 读不了的分片：名为 *.jsonl 的子目录，readFile 必失败（代码双审 r1 CODEX-02）
      if (mode.brokenShard) await fs.mkdir(path.join(logDir, 'zcode-2026-10-01.jsonl'), { recursive: true });
      // 删不掉的临时目录（EV-194 代码双审 r1 CODEX-01；EV-197 代码双审 GLM-01 扩成四种摆法）
      if (mode.lock === 'sibling' || mode.lock === 'copyGone') {
        const locked = path.join(o.storageRedirectRoot, 'locked');
        await fs.mkdir(locked, { recursive: true });
        await fs.writeFile(path.join(locked, 'f'), 'x');
        await fs.chmod(locked, 0o500);
        if (mode.lock === 'copyGone' && o.homeDir) await fs.rm(path.join(o.homeDir, '.zcode/cli/config.json'), { force: true });
      }
      if (mode.midnight) {
        await fs.writeFile(path.join(logDir, 'zcode-2026-10-02.jsonl'), start + '\n', 'utf8');
        await fs.writeFile(path.join(logDir, 'zcode-2026-10-03.jsonl'), later + '\n', 'utf8');
      } else {
        await fs.writeFile(path.join(logDir, 'zcode-2026-10-03.jsonl'), `${start}\n${later}\n`, 'utf8');
      }
      const rolloutDir = path.join(env['ZCODE_STORAGE_DIR']!, 'cli', 'rollout');
      await fs.mkdir(rolloutDir, { recursive: true });
      await fs.writeFile(
        path.join(rolloutDir, `model-io-${sessionId}.jsonl`),
        JSON.stringify({ model: { providerId: 'stub-rollout', modelId: 'ROLL', source: 'stub-source' } }) + '\n',
        'utf8',
      );
      // 这两种锁要在本次写完日志与 rollout 之后上
      if (mode.lock === 'cli') await fs.chmod(path.join(o.storageRedirectRoot, '.zcode/cli'), 0o500);
      if (mode.lock === 'opaque' && calls.length >= 2) await fs.chmod(path.join(o.storageRedirectRoot, '.zcode'), 0o000);
    }
    return {
      ...base,
      envelope: { sessionId, traceId: null, turnId: null, response: 'nothing', usage: {}, eventCount: 1, keys: ['sessionId', 'response', 'usage', 'eventCount'] },
      exitCode: 0, stdout: '', stderr: '', failureKind: 'none',
    };
  };
}

/** 把桩上的锁全解开（顺序：先 .zcode 再 cli），用例收尾时调；解不开的忽略 */
async function unlock(calls: Call[]): Promise<void> {
  const root = calls[0]?.opts.storageRedirectRoot;
  if (!root) return;
  for (const d of [path.join(root, '.zcode'), path.join(root, '.zcode/cli'), path.join(root, 'locked')]) {
    await fs.chmod(d, 0o700).catch(() => {});
  }
}

const ARM_STUBS = {
  modelOverrideProbe: async () => ({ override: null, requested: null, observed: null, why: '桩' }),
  modelOverrideFullCopyProbe: async () => ({
    override: null, requested: null, observed: null, why: '桩', replacedPaths: [], hostCredentialEnv: [],
  }),
};

async function probeIn(
  w: World,
  calls: Call[],
  extra: { launchModel?: string | null; mode?: Parameters<typeof stubInvoke>[1]; responseField?: 'response' | null; skipModelCalls?: boolean } = {},
) {
  return inWorld(w, () =>
    probeZcode(w.entry, process.execPath, {
      existing: existingProbe(w.entry, extra.responseField ?? null),
      ...(extra.skipModelCalls ? { skipModelCalls: true } : {}),
      cliConfigPath: w.cliConfigPath,
      ...ARM_STUBS,
      ...('launchModel' in extra ? { launchModel: extra.launchModel } : { launchModel: REQUESTED }),
      invoke: stubInvoke(calls, extra.mode),
    }),
  );
}

test('D1 副本支：headless 与 path_deny 共用一份副本 HOME、不注入个人配置、落点根在副本下，回读从落点根读，探完即删', async () => {
  const w = await world();
  try {
    const calls: Call[] = [];
    const { probe, notes } = await probeIn(w, calls);

    assert.equal(calls.length, 2, 'headless 一次 + path_deny 一次');
    const [h, d] = calls.map((c) => c.opts) as [ZcodeInvokeOptions, ZcodeInvokeOptions];
    assert.ok(h.homeDir, '没给副本 HOME ⇒ 走的是真实 HOME 与个人缺省（EV-194 根因）');
    assert.ok(h.homeDir!.startsWith(w.privTmp), `副本 HOME 要在本次 mkdtemp 的临时目录下：${h.homeDir}`);
    assert.notEqual(h.homeDir, w.home);
    assert.equal(h.omitPersonalProviderConfig, true, '副本支注入个人配置 ⇒ CLI 仍用个人缺省');
    assert.equal(h.storageRedirectRoot, h.homeDir, '副本支的落点根就是副本 HOME（与 authProbe / run() 同一式子）');
    // path_deny 与 headless 同一份
    assert.equal(d.homeDir, h.homeDir, 'path_deny 否定对照也要跑在同一份副本上');
    assert.equal(d.omitPersonalProviderConfig, true);
    assert.equal(d.storageRedirectRoot, h.storageRedirectRoot);
    assert.ok(d.readonlyArgs.some((a) => a.startsWith('Read(')), '第二次调用确是 path_deny 否定对照');
    // 按档位覆盖并置首：副本 model.main 写成请求模型
    assert.equal(calls[0]!.modelMain, `bigmodel-coding-plan/${REQUESTED}`);

    assert.equal(probe.response_field, 'response', 'response_field 被本轮刷新');
    assert.equal(probe.model_id_form, LOG_MODEL, 'model_id_form 只有从落点根的日志回读才拿得到');
    assert.ok(notes.some((n) => n.includes('model.source=stub-source')), 'rollout 也要从落点根读到');
    assert.notEqual(probe.path_deny.method, 'old-method', 'path_deny 被本轮刷新');
    assert.deepEqual(probe.scratch_paths, [], 'scratch_paths 被本轮刷新（夹具工作树无改动）');
    assert.ok(
      notes.some((n) => n.startsWith('headless / path_deny 探的是：') && n.includes(`模型 bigmodel-coding-plan/${REQUESTED}`) && n.includes('与审查运行同一选模路径')),
      notes.join('\n'),
    );
    assert.deepEqual(await leftovers(w), [], '临时运行目录（含副本凭据）未删');
  } finally {
    await cleanup(w);
  }
});

test('D2 退路（档位未给模型）：真实 HOME、注入个人配置、落点根照设，详情说清是 ZCode 自选、不带家目录', async () => {
  const w = await world();
  try {
    const calls: Call[] = [];
    const { probe, notes } = await probeIn(w, calls, { launchModel: null });
    assert.equal(calls.length, 2);
    for (const { opts } of calls) {
      assert.equal(opts.homeDir ?? null, null);
      assert.equal(opts.omitPersonalProviderConfig, false, '退路与审查运行同：真实 HOME 下照常注入个人配置');
      assert.ok(opts.storageRedirectRoot, '退路支也要设落点根，否则 CLI 产物落进真实 HOME');
      assert.ok(opts.storageRedirectRoot!.startsWith(w.privTmp), String(opts.storageRedirectRoot));
      assert.ok(!opts.storageRedirectRoot!.startsWith(w.home));
    }
    assert.equal(probe.model_id_form, LOG_MODEL, '退路支同样从落点根回读');
    const line = notes.find((n) => n.startsWith('headless / path_deny 探的是：'));
    assert.ok(line, notes.join('\n'));
    assert.match(line!, /真实 HOME 下 ZCode 自选的缺省模型/);
    assert.match(line!, /档位未给模型，退回真实 HOME 与个人配置/);
    // 只看本题这一行：provider_config 那条既有 note 本就写明「按用户目录 X 取」，不在本题范围
    assert.ok(!line!.includes(w.home), `详情不得带出家目录绝对路径：${line}`);
    assert.deepEqual(await leftovers(w), []);
  } finally {
    await cleanup(w);
  }
});

test('D3 副本源缺失：门控先拦，整段跳过、零次真实调用（退路的「副本源缺失」一格在 doctor 侧不可达）', async () => {
  const w = await world({ cliConfigRaw: null });
  try {
    const calls: Call[] = [];
    const { probe, notes } = await probeIn(w, calls);
    assert.equal(calls.length, 0);
    assert.ok(notes.some((n) => n.includes('跳过需要真实模型调用的 ZCode 探针')));
    assert.equal(probe.model_id_form, 'old-provider/OLD');
    assert.deepEqual(await leftovers(w), []);
  } finally {
    await cleanup(w);
  }
});

test('D4 headless 失败：失败 note 带探的是哪条路径，几项结论保留旧值，临时目录照删', async () => {
  const w = await world();
  try {
    const calls: Call[] = [];
    const { probe, notes } = await probeIn(w, calls, { mode: { fail: true } });
    assert.equal(calls.length, 1, '失败即返回，path_deny 不跑');
    const line = notes.find((n) => n.startsWith('ZCode headless 失败'));
    assert.ok(line, notes.join('\n'));
    assert.match(line!, new RegExp(`ZCode headless 失败（other，模型 bigmodel-coding-plan/${REQUESTED.replace('.', '\\.')}）：Error: Model creation failed`));
    // 日志随临时目录删除：结构化根因要在删之前取进 note（EV-194 编码时补）
    assert.ok(line!.endsWith('；日志根因：Select a model before continuing'), line);
    // 「探的是」那行只在 headless 通过后才出：失败时 path_deny 没跑（代码双审 r1 CODEX-06）
    assert.ok(!notes.some((n) => n.startsWith('headless / path_deny 探的是：')), notes.join('\n'));
    assert.equal(probe.response_field, null);
    assert.equal(probe.model_id_form, 'old-provider/OLD');
    assert.equal(probe.path_deny.method, 'old-method');
    assert.deepEqual(probe.scratch_paths, ['old.txt']);
    assert.deepEqual(await leftovers(w), [], '失败路径也要删临时目录（副本里有凭据）');
  } finally {
    await cleanup(w);
  }
});

test('D5 拉起抛错：错误原样上抛，临时目录照删', async () => {
  const w = await world();
  try {
    const calls: Call[] = [];
    await assert.rejects(probeIn(w, calls, { mode: { throws: true } }), /桩：拉起抛错/);
    assert.equal(calls.length, 1);
    assert.deepEqual(await leftovers(w), [], '抛错路径也要删临时目录');
  } finally {
    await cleanup(w);
  }
});

test('D6 副本源不是合法 JSON：不拉起、不退回真实 HOME，note 说清并保留旧结论', async () => {
  const w = await world({ cliConfigRaw: '{not json' });
  try {
    const calls: Call[] = [];
    const { probe, notes } = await probeIn(w, calls);
    assert.equal(calls.length, 0, '副本源坏了就不该拉起——退回真实 HOME 探的又不是审查那条路径');
    assert.ok(notes.some((n) => n.includes('读取或解析失败') && n.includes('保留上一次的结论')), notes.join('\n'));
    assert.equal(probe.model_id_form, 'old-provider/OLD');
    assert.equal(probe.path_deny.method, 'old-method');
    assert.deepEqual(await leftovers(w), []);
  } finally {
    await cleanup(w);
  }
});

test('D7 限定失败 / 置首挪不动：详情不把请求模型冒充成实际模型', async () => {
  // 限定失败：请求的模型不在副本源里
  const w1 = await world();
  try {
    const calls: Call[] = [];
    const { notes } = await probeIn(w1, calls, { launchModel: 'NOPE-9' });
    assert.equal(calls[0]!.opts.omitPersonalProviderConfig, true, '限定失败与 run() 同：副本照建、个人配置不注入');
    assert.equal(calls[0]!.modelMain, CLI_CONFIG.model.main, '不改 model.main');
    assert.ok(notes.some((n) => n.startsWith('headless / path_deny 探的是：cli/config.json 原有的 model.main（')), notes.join('\n'));
  } finally {
    await cleanup(w1);
  }
  // 置首挪不动：JS 对象恒把整数样键名排在前面，provider「123」永远在首位
  const shape = {
    model: CLI_CONFIG.model,
    provider: { '123': { name: 'n', kind: 'anthropic', enabled: true, options: {}, models: { X: {} } }, ...CLI_CONFIG.provider },
  };
  const w2 = await world({ cliConfigRaw: JSON.stringify(shape) });
  try {
    const calls: Call[] = [];
    const { notes } = await probeIn(w2, calls);
    assert.ok(
      notes.some((n) => /^headless \/ path_deny 探的是：模型 bigmodel-coding-plan\/GLM-5\.3-Flash（置首未生效：.+；实际生效模型未核）/.test(n)),
      notes.join('\n'),
    );
  } finally {
    await cleanup(w2);
  }
});

test('D7 describeZcodeProbedPath 四档措辞（认证探活与 doctor 探针同源）', () => {
  const base: ZcodeHomePrep = { homeDir: '/x/home', route: 'config_copy', qualified: 'p/M', cause: null, reorder: null };
  const home = os.homedir();
  assert.equal(
    describeZcodeProbedPath({ ...base, homeDir: null, route: 'global', qualified: null, cause: 'source_missing', reason: `未找到 ${home}/.zcode/cli/config.json` }),
    '真实 HOME 下 ZCode 自选的缺省模型（未找到 ~/.zcode/cli/config.json）',
  );
  assert.equal(
    describeZcodeProbedPath({ ...base, route: 'global', qualified: null, cause: 'qualify_failed', reason: '不在目录里' }),
    'cli/config.json 原有的 model.main（不在目录里）',
  );
  assert.equal(
    describeZcodeProbedPath({ ...base, reorder: { variant: 'requested-first', applied: false, kind: 'not_movable', reason: '挪不了' } }),
    '模型 p/M（置首未生效：挪不了；实际生效模型未核）',
  );
  assert.equal(describeZcodeProbedPath(base), '模型 p/M');
});

test('D8 doctor 层接线：探针请求的是档位 plan 阶段的 glm 模型（与认证探活同一定义）', async () => {
  const w = await world();
  try {
    const cfg = defaultConfig();
    agentConfigOf(cfg, 'glm', 'zcode').entry = w.entry;
    cfg.profiles[cfg.active_profile]!.glm!.plan = REQUESTED;
    assert.equal(zcodeProbeModel(cfg), REQUESTED);
    const triviumDir = path.join(w.base, 'trivium');
    const projectRoot = path.join(w.base, 'proj');
    await fs.mkdir(triviumDir);
    await fs.mkdir(projectRoot);
    const calls: Call[] = [];
    await inWorld(w, () =>
      runDoctor({
        projectRoot, triviumDir, config: cfg, skipModelCalls: false, only: 'zcode',
        zcodeProbe: { cliConfigPath: w.cliConfigPath, ...ARM_STUBS, invoke: stubInvoke(calls) },
      }),
    );
    assert.equal(calls.length, 2);
    assert.equal(calls[0]!.modelMain, `bigmodel-coding-plan/${REQUESTED}`, 'doctor 没把档位模型传进探针 ⇒ 走退路、不覆盖');
    assert.equal(calls[0]!.opts.omitPersonalProviderConfig, true);
    assert.deepEqual(await leftovers(w), []);
  } finally {
    await cleanup(w);
  }
});

test('D9 跨午夜：启动事件在前一天那片日志里，生效模型照样回读得到（与审查运行同一文件集合口径）', async () => {
  const w = await world();
  try {
    const calls: Call[] = [];
    const { probe } = await probeIn(w, calls, { mode: { midnight: true } });
    assert.equal(probe.model_id_form, LOG_MODEL, '只取最新一片会读不到启动事件');
  } finally {
    await cleanup(w);
  }
});

test('D9b 日志里有读不了的分片：单片失败跳过，照样回读，不抛（代码双审 r1 CODEX-02）', async () => {
  const w = await world();
  try {
    const calls: Call[] = [];
    const { probe } = await probeIn(w, calls, { mode: { midnight: true, brokenShard: true } });
    assert.equal(probe.model_id_form, LOG_MODEL);
  } finally {
    await cleanup(w);
  }
});

test('D10 临时目录删除失败：不抛、结论照常刷新，note 说清残留在哪（代码双审 r1 CODEX-01）', { skip: process.getuid?.() === 0 }, async () => {
  const w = await world();
  const calls: Call[] = [];
  try {
    // 锁住副本所在的 cli/：副本删不掉，提示才该说「含真实凭据」（EV-197 起按残留目录里还有没有副本判）
    const { probe, notes } = await probeIn(w, calls, { mode: { lock: 'cli' } });
    assert.equal(probe.response_field, 'response', '删除失败不得把已探的结论一起丢掉');
    assert.equal(probe.model_id_form, LOG_MODEL);
    const line = notes.find((n) => n.startsWith('⚠️ 探针临时目录删除失败'));
    assert.ok(line, notes.join('\n'));
    assert.match(line!, /（EACCES）/);
    assert.match(line!, /含真实凭据，请手工删除/);
    const left = await leftovers(w);
    assert.equal(left.length, 1, '确有一个残留（本格就是要摆出删不掉）');
    // 与认证探活同一函数（EV-197）；上面三段字面断言保留，免得只比函数输出成了自我循环（计划双审 CODEX-03）
    const want = await inWorld(w, async () => zcodeTempDirResidueText('探针', path.join(w.privTmp, left[0]!), 'EACCES', 'credential'));
    assert.equal(line, want);
  } finally {
    await unlock(calls);
    await cleanup(w);
  }
});

test('D10b 退路支删不掉：没有副本就不说「含真实凭据」（EV-197 计划双审 GLM-02）', { skip: process.getuid?.() === 0 }, async () => {
  const w = await world();
  const calls: Call[] = [];
  try {
    const { notes } = await probeIn(w, calls, { launchModel: null, mode: { lock: 'sibling' } });
    assert.equal(calls[0]!.opts.homeDir ?? null, null, '本格摆的是退路支');
    const line = notes.find((n) => n.startsWith('⚠️ 探针临时目录删除失败'));
    assert.ok(line, notes.join('\n'));
    assert.match(line!, /其中没有 cli\/config\.json 副本，是本次探测的 CLI 产物，请手工删除$/);
    assert.doesNotMatch(line!, /含真实凭据/);
  } finally {
    await unlock(calls);
    await cleanup(w);
  }
});

test('D10c 副本支、目录删不掉而副本已不在：按现场说「没有副本」，不按写入时的情形推断（EV-197 代码双审 GLM-01）', { skip: process.getuid?.() === 0 }, async () => {
  const w = await world();
  const calls: Call[] = [];
  try {
    const { notes } = await probeIn(w, calls, { mode: { lock: 'copyGone' } });
    assert.ok(calls[0]!.opts.homeDir, '本格摆的是副本支（写入时确有副本）');
    const line = notes.find((n) => n.startsWith('⚠️ 探针临时目录删除失败'));
    assert.ok(line, notes.join('\n'));
    assert.match(line!, /其中没有 cli\/config\.json 副本，是本次探测的 CLI 产物，请手工删除$/);
    assert.doesNotMatch(line!, /含真实凭据/);
  } finally {
    await unlock(calls);
    await cleanup(w);
  }
});

test('D10d .zcode 整个不可读：查不了副本在不在就按有副本说，宁可多提醒（EV-197 代码双审 GLM-01）', { skip: process.getuid?.() === 0 }, async () => {
  const w = await world();
  const calls: Call[] = [];
  try {
    const { notes } = await probeIn(w, calls, { mode: { lock: 'opaque' } });
    assert.equal(calls.length, 2);
    const line = notes.find((n) => n.startsWith('⚠️ 探针临时目录删除失败'));
    assert.ok(line, notes.join('\n'));
    assert.match(line!, /其中的 cli\/config\.json 副本含真实凭据，请手工删除$/);
  } finally {
    await unlock(calls);
    await cleanup(w);
  }
});

// ── EV-198：三条探针臂的临时目录删不掉 ──────────────────────────────────

test('D18 三条探针臂的残留提示：各紧跟该臂的结论 note 推一次，结论照常写入；不给提示时不多出任何一行（EV-198）', { skip: process.getuid?.() === 0 }, async () => {
  const w = await world();
  const stubs = (withResidue: boolean) => ({
    modelOverrideProbe: async () => ({
      override: 'global' as const, requested: null, observed: null, why: '桩',
      ...(withResidue ? { tempDirResidue: 'RES-白名单臂' } : {}),
    }),
    modelOverrideFullCopyProbe: async (_e: string, _n: string, _c: string, o: { variant?: 'as-is' | 'requested-first' } = {}) => ({
      override: 'global' as const, requested: null, observed: null, why: '桩', replacedPaths: [], hostCredentialEnv: [],
      ...(withResidue ? { tempDirResidue: o.variant === 'requested-first' ? 'RES-同形臂置首支' : 'RES-同形臂原样支' } : {}),
    }),
  });
  const run = (withResidue: boolean) =>
    inWorld(w, () =>
      probeZcode(w.entry, process.execPath, {
        existing: existingProbe(w.entry), skipModelCalls: true, cliConfigPath: w.cliConfigPath, ...stubs(withResidue),
      }),
    );
  try {
    const base = await run(false);
    assert.equal(base.notes.some((n) => n.includes('临时目录删除失败') || n.startsWith('RES-')), false, base.notes.join('\n'));

    process.env['FAKE_LOCK_HOME'] = '1';
    let r: Awaited<ReturnType<typeof run>>;
    try {
      r = await run(true);
    } finally {
      delete process.env['FAKE_LOCK_HOME'];
    }
    const { probe, notes } = r;
    assert.deepEqual(probe.readonly_flags, base.probe.readonly_flags, '旗标结论照常写入、与不锁时相同');
    assert.ok(probe.readonly_flags.includes('--mode plan'));
    assert.equal(probe.model_override, 'global');
    assert.equal(probe.model_override_full_copy, 'global');

    const at = (pred: (n: string) => boolean, what: string) => {
      const hits = notes.flatMap((n, i) => (pred(n) ? [i] : []));
      assert.equal(hits.length, 1, `${what} 应恰好一条：\n${notes.join('\n')}`);
      return hits[0]!;
    };
    const flagRes = at((n) => n.startsWith('⚠️ 探针临时目录删除失败（EACCES）') && n.includes('trivium-flagprobe-'), '旗标探针的残留提示');
    assert.match(notes[flagRes]!, /其中没有 cli\/config\.json 副本/);
    const moRes = at((n) => n === 'RES-白名单臂', '白名单臂的残留提示');
    const fcRes = at((n) => n === 'RES-同形臂原样支', '同形臂原样支的残留提示');
    const roRes = at((n) => n === 'RES-同形臂置首支', '同形臂置首支的残留提示');
    // 紧跟各臂的结论 note（计划 r2 §2.4）
    assert.ok(notes[flagRes - 1]!.startsWith('readonly_flags 接受='), notes[flagRes - 1]);
    assert.ok(notes[moRes - 1]!.startsWith('model_override=global'), notes[moRes - 1]);
    assert.ok(notes[fcRes - 1]!.startsWith('model_override_full_copy=global'), notes[fcRes - 1]);
    assert.ok(fcRes < roRes, '置首支在原样支之后');
    assert.ok(roRes < at((n) => n.startsWith('runtime_selection='), 'runtime_selection note'), '置首支的提示在 runtime_selection 判定之前推');
  } finally {
    for (const e of await fs.readdir(w.privTmp).catch(() => [] as string[])) {
      await fs.chmod(path.join(w.privTmp, e, 'locked'), 0o700).catch(() => {});
    }
    await cleanup(w);
  }
});

// ── EV-196：进了真实调用段却没刷新 response_field ─────────────────────────

const FOUR = ['response_field', 'path_deny', 'scratch_paths', 'model_id_form'];

test('D11 headless 失败：带出 headless_failed 与沿用的四项，旧 response_field 原样留着', async () => {
  const w = await world();
  try {
    const calls: Call[] = [];
    const r = await probeIn(w, calls, { mode: { fail: true }, responseField: 'response' });
    assert.deepEqual(r.headlessUnrefreshed, { branch: 'headless_failed', carried: FOUR });
    assert.equal(r.probe.response_field, 'response', '旧值留着——正是 blocker 不触发的那一格');
    assert.ok(r.notes.some((n) => n.startsWith('ZCode headless 失败（')), r.notes.join('\n'));
  } finally {
    await cleanup(w);
  }
});

test('D12 副本源不是合法 JSON：带出 source_unreadable 与沿用的四项，零次拉起', async () => {
  const w = await world({ cliConfigRaw: '{not json' });
  try {
    const calls: Call[] = [];
    const r = await probeIn(w, calls, { responseField: 'response' });
    assert.equal(calls.length, 0);
    assert.deepEqual(r.headlessUnrefreshed, { branch: 'source_unreadable', carried: FOUR });
    assert.ok(r.notes.some((n) => n.startsWith('副本源 ') && n.includes('读取或解析失败：')), r.notes.join('\n'));
  } finally {
    await cleanup(w);
  }
});

test('D13 退 0 却抠不出 envelope：带出 no_envelope，只沿用 response_field 与 model_id_form，path_deny 照跑照刷', async () => {
  const w = await world();
  try {
    const calls: Call[] = [];
    const r = await probeIn(w, calls, { mode: { noEnvelope: true }, responseField: 'response' });
    assert.equal(calls.length, 2, '这一支不返回，path_deny 照跑');
    assert.deepEqual(r.headlessUnrefreshed, { branch: 'no_envelope', carried: ['response_field', 'model_id_form'] });
    assert.equal(r.probe.response_field, 'response');
    assert.equal(r.probe.model_id_form, 'old-provider/OLD');
    assert.notEqual(r.probe.path_deny.method, 'old-method', 'path_deny 被本轮刷新，不在沿用之列');
    assert.deepEqual(r.probe.scratch_paths, [], 'scratch_paths 被本轮刷新');
    assert.ok(r.notes.includes('ZCode stdout 中抠不出 JSON envelope'), r.notes.join('\n'));
  } finally {
    await cleanup(w);
  }
});

test('D14 成功、显式跳过、cli 配置缺失三格：都不带（跳过真实调用不算没刷新）', async () => {
  const ok = await world();
  try {
    const r = await probeIn(ok, [], { responseField: 'response' });
    assert.equal(r.probe.response_field, 'response');
    assert.equal(r.headlessUnrefreshed, null, '成功路径不带');
  } finally {
    await cleanup(ok);
  }
  const skip = await world();
  try {
    const calls: Call[] = [];
    const r = await probeIn(skip, calls, { responseField: 'response', skipModelCalls: true });
    assert.equal(calls.length, 0);
    assert.equal(r.headlessUnrefreshed, null, '--no-model-calls 不进真实调用段');
  } finally {
    await cleanup(skip);
  }
  const noCli = await world({ cliConfigRaw: null });
  try {
    const calls: Call[] = [];
    const r = await probeIn(noCli, calls, { responseField: 'response' });
    assert.equal(calls.length, 0);
    assert.equal(r.headlessUnrefreshed, null, 'cli 配置缺失不进真实调用段');
  } finally {
    await cleanup(noCli);
  }
});

/** doctor 层跑一轮（只探 zcode），既有结论里的 response_field 是 'response' */
async function doctorIn(w: World, mode: Parameters<typeof stubInvoke>[1]) {
  const cfg = defaultConfig();
  agentConfigOf(cfg, 'glm', 'zcode').entry = w.entry;
  cfg.profiles[cfg.active_profile]!.glm!.plan = REQUESTED;
  cfg.probe.cli.zcode = existingProbe(w.entry, 'response');
  const triviumDir = await fs.mkdtemp(path.join(w.base, 'trivium-'));
  const projectRoot = path.join(w.base, 'proj');
  await fs.mkdir(projectRoot, { recursive: true });
  const calls: Call[] = [];
  return inWorld(w, () =>
    runDoctor({
      projectRoot, triviumDir, config: cfg, skipModelCalls: false, only: 'zcode',
      zcodeProbe: { cliConfigPath: w.cliConfigPath, ...ARM_STUBS, invoke: stubInvoke(calls, mode) },
    }),
  );
}
const isOurs = (s: string) => s.startsWith('ZCode headless 探针本轮进了真实调用');

test('D15 doctor 层：headless 失败只多一条 warning，blockers 与成功轮逐项相同（不拦、退出语义不变）', async () => {
  const w = await world();
  try {
    const good = await doctorIn(w, {});
    const bad = await doctorIn(w, { fail: true });
    assert.deepEqual(good.warnings.filter(isOurs), [], '成功轮不出');
    const mine = bad.warnings.filter(isOurs);
    assert.equal(mine.length, 1, bad.warnings.join('\n'));
    assert.deepEqual(bad.warnings.filter((x) => !isOurs(x)), good.warnings, '其余 warning 不受影响');
    // 字面断言（不只比函数输出）：哪一支、沿用哪几项、为什么要紧、根因在哪
    assert.match(mine[0]!, /没刷新 response_field（headless 调用失败）/);
    assert.match(mine[0]!, /response_field \/ path_deny \/ scratch_paths \/ model_id_form 沿用的是上一次的结论/);
    assert.match(mine[0]!, /审查运行走同一条选模路径，大概率同样跑不通/);
    assert.match(mine[0]!, /根因见含「ZCode headless 失败」的那条 \[zcode\] note/);
    assert.equal(mine[0], zcodeHeadlessUnrefreshedWarning({ branch: 'headless_failed', carried: FOUR }));
    // 不拦：blockers 与成功轮逐项相同，doctor 的退出码只由 blockers 决定
    assert.deepEqual(bad.blockers, good.blockers);
    assert.ok(!bad.blockers.includes(ZCODE_HEADLESS_NOT_OK_HINT), '旧值 response 让既有 blocker 照旧不触发（出路二未取）');
    assert.equal(bad.probe.cli.zcode?.response_field, 'response', '结论照旧沿用、不置空');
  } finally {
    await cleanup(w);
  }
});

test('D16 doctor 层三支逐一：warning 点名该支，且它指向的 note 字面确实在该轮 [zcode] note 里', async () => {
  const cases: Array<{ branch: ZcodeHeadlessUnrefreshedBranch; raw?: string; mode: Parameters<typeof stubInvoke>[1] }> = [
    { branch: 'source_unreadable', raw: '{not json', mode: {} },
    { branch: 'headless_failed', mode: { fail: true } },
    { branch: 'no_envelope', mode: { noEnvelope: true } },
  ];
  for (const c of cases) {
    const w = await world(c.raw === undefined ? {} : { cliConfigRaw: c.raw });
    try {
      const rep = await doctorIn(w, c.mode);
      const t = ZCODE_HEADLESS_UNREFRESHED[c.branch];
      const mine = rep.warnings.filter(isOurs);
      assert.equal(mine.length, 1, `${c.branch}：${rep.warnings.join('\n')}`);
      assert.ok(mine[0]!.includes(`（${t.what}）`), mine[0]);
      assert.ok(mine[0]!.includes(`${t.carried.join(' / ')} 沿用的是上一次的结论`), mine[0]);
      assert.ok(
        rep.notes.some((n) => n.startsWith('[zcode] ') && n.includes(t.noteKey)),
        `${c.branch}：warning 指向「${t.noteKey}」，该轮 note 里却没有\n${rep.notes.join('\n')}`,
      );
      assert.ok(!rep.blockers.includes(ZCODE_HEADLESS_NOT_OK_HINT), c.branch);
    } finally {
      await cleanup(w);
    }
  }
});

test('D17 既有结论 response_field 为 null 时 blocker 照出、warning 也出——两者不互斥（计划 r2 §6 R1 定案；代码双审 GLM-02）', async () => {
  const w = await world();
  try {
    const cfg = defaultConfig();
    agentConfigOf(cfg, 'glm', 'zcode').entry = w.entry;
    cfg.profiles[cfg.active_profile]!.glm!.plan = REQUESTED;
    cfg.probe.cli.zcode = existingProbe(w.entry, null);
    const triviumDir = await fs.mkdtemp(path.join(w.base, 'trivium-'));
    const projectRoot = path.join(w.base, 'proj');
    await fs.mkdir(projectRoot, { recursive: true });
    const rep = await inWorld(w, () =>
      runDoctor({
        projectRoot, triviumDir, config: cfg, skipModelCalls: false, only: 'zcode',
        zcodeProbe: { cliConfigPath: w.cliConfigPath, ...ARM_STUBS, invoke: stubInvoke([], { fail: true }) },
      }),
    );
    assert.ok(rep.blockers.includes(ZCODE_HEADLESS_NOT_OK_HINT), rep.blockers.join('\n'));
    assert.equal(rep.warnings.filter(isOurs).length, 1, rep.warnings.join('\n'));
  } finally {
    await cleanup(w);
  }
});
