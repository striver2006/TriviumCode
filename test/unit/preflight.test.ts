import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import YAML from 'yaml';
import {
  parsePreflightScope, checkModelSlugs, runPreflight, commitAuthCache, renderPreflight, checkZcodeRuntimeSelection } from '../../src/trivium/preflight.js';
import { TRIVIUM_DIR, defaultConfig, patchProbe } from '../../src/trivium/config.js';
import { runDoctor } from '../../src/trivium/doctor.js';
import { initFixtureRepo } from '../../src/trivium/util/git.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { Config, Ctx, ProbeSection } from '../../src/trivium/types.js';

function freshProbe(cfg: Config): void {
  const now = new Date().toISOString();
  cfg.probe.generated_at = now;
  const agy = cfg.probe.cli.agy!;
  agy.entrypoint = '/nonexistent/agy';
  agy.version = '1.2.0';
  agy.probed_at = now;
  agy.models = ['gemini-3.1-pro-high', 'gemini-3.8-flash-high', 'gemini-3.8-flash-low'];
  const zcode = cfg.probe.cli.zcode!;
  zcode.entrypoint = '/nonexistent/zcode.cjs';
  zcode.version = '0.16.5';
  zcode.probed_at = now;
  zcode.models = ['GLM-5.3', 'GLM-5.3-Flash', 'bigmodel/GLM-5.3', 'bigmodel/GLM-5.3-Flash'];
  zcode.model_id_form = 'bigmodel/GLM-5.3';
  zcode.readonly_flags = ['--mode plan', '--disallowed-tools Write,Edit'];
  /*
   * 下面两个字段是 M8 第 3 步补的：`checkReadonlyCapability` 改为遍历适配器自己的
   * `availability()` 之后，判据比原先那个弱化版更严（原版不查 zcode 的
   * `--disallowed-tools` 硬前置，也不查两家的 headless 能力）。
   * 夹具跟着补齐，不是为了让断言变绿——**变严的是判据，而变严是对的**：
   * 预检与适配器对「这一侧能不能用」曾给出两个答案（计划双审 GLM-06）。
   */
  agy.headless_read_ok = true;
  // 探针**当时实际验证过**的只读 Agent 名。新判据查的是这个，而不是「agent.md 文件在不在」——
  // 探针若以默认 Agent 探测，只读白名单就从未被验证过，那时说「可用」是失实的。
  agy.agent = 'trivium-critic';
  zcode.response_field = '.response';
}

async function fakeCtx(mutate?: (c: Config) => void): Promise<Ctx> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-pf-'));
  await fs.writeFile(path.join(root, 'x.ts'), 'export const x = 1;\n');
  await initFixtureRepo(root);
  const cfg = defaultConfig();
  freshProbe(cfg);
  mutate?.(cfg);
  return {
    config: cfg,
    projectRoot: root,
    archiveRoot: path.join(root, '.reviews'),
    triviumDir: path.join(root, '.trivium'),
    sources: ['<test>'],
  };
}

// ── scope 解析（GLM-02）──

test('--stage 接受 plan|code|bug|all', () => {
  for (const s of ['plan', 'code', 'bug', 'all'] as const) {
    assert.equal(parsePreflightScope(s), s);
  }
});

test('--stage 拒绝其它取值与缺省，退 64', () => {
  for (const bad of ['stage1', 'ALL', '']) {
    assert.throws(() => parsePreflightScope(bad || null), (e: { code?: number }) => {
      assert.equal(e.code, EXIT.USAGE);
      return true;
    });
  }
});

// ── slug 校验（GLM-01）──

test('默认 profile 的 slug 全部合法', async () => {
  const ctx = await fakeCtx();
  assert.equal(checkModelSlugs(ctx.config, 'plan').ok, true);
  assert.equal(checkModelSlugs(ctx.config, 'all').ok, true, '--stage all 校验三个阶段');
});

test('gemini 侧非法覆盖 → 不合格并列出可用值，退 64', async () => {
  const ctx = await fakeCtx();
  const r = checkModelSlugs(ctx.config, 'plan', { gemini: 'gemini-9.9-nope' });
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, EXIT.USAGE);
  assert.match(r.detail, /gemini-9\.9-nope/);
  assert.match(r.detail, /可用值/);
  assert.match(r.detail, /gemini-3\.1-pro-high/);
});

test('glm 侧非法覆盖同样被拦（此前因模型清单为空而空转）', async () => {
  const ctx = await fakeCtx();
  const r = checkModelSlugs(ctx.config, 'plan', { glm: 'GLM-999-nope' });
  assert.equal(r.ok, false);
  assert.match(r.detail, /不在 ZCode 模型目录中/);
});

test('glm 侧短名合法（适配层会补 providerId 前缀）', async () => {
  const ctx = await fakeCtx();
  assert.equal(checkModelSlugs(ctx.config, 'plan', { glm: 'GLM-5.3' }).ok, true);
  assert.equal(checkModelSlugs(ctx.config, 'plan', { glm: 'bigmodel/GLM-5.3' }).ok, true);
});

test('模型清单为空时不误判（探针未采集到就跳过该项）', async () => {
  const ctx = await fakeCtx((c) => {
    c.probe.cli.agy!.models = [];
    c.probe.cli.zcode!.models = [];
  });
  assert.equal(checkModelSlugs(ctx.config, 'plan', { gemini: 'anything' }).ok, true);
});

// ───────── 预检怎么**消费**逐 profile 目录（代码双审 CODEX-04：此前零断言） ─────────

/**
 * 上一版只锁了适配器钩子本身，**没锁预检有没有用上它**：
 * 把 `preflight.ts` 里调用 `catalogModelsFor` 的那两行删掉，全部用例照样绿——
 * 变异报红的那两条红在适配器侧。「钩子对」有锁，「钩子被用上」没锁。
 */
function codexCtxWith(
  profile: string | null,
  byProfile: Record<string, string[]>,
  baseModels: string[],
  errors: Record<string, string> = {},
) {
  return async () => {
    const ctx = await fakeCtx((c) => {
      (c.agents as Record<string, unknown>)['codex'] = {
        vendor: 'openai', bin: null, profile,
        effort: { plan: 'high', code: 'high', bug: 'high' },
      };
      c.probe.cli.codex!.models = baseModels;
      c.probe.cli.codex!.models_visible = baseModels;
      c.probe.cli.codex!.models_by_profile = byProfile;
      c.probe.cli.codex!.models_by_profile_errors = errors;
    });
    return ctx;
  };
}

test('预检：只在基底目录里的 slug，按本 profile 的目录判非法并点名', async () => {
  /*
   * 这正是 E-4 的「误放」：`qwen3.8-max` 在基底目录里，但 deepseek 端点不供它——
   * 上一版预检放行，到 turn.failed 才失败，违背 AC-16「把失败挡在花钱之前」。
   */
  const ctx = await codexCtxWith('deepseek', { deepseek: ['deepseek-flash'] }, ['qwen3.8-max'])();
  const r = checkModelSlugs(ctx.config, 'plan', { codex: 'qwen3.8-max' }, ['codex']);
  assert.equal(r.ok, false, '预检必须拦住它，而不是留给端点拒');
  assert.match(r.detail, /deepseek/, '报错要指名是按哪个 profile 的目录判的');
});

test('预检：该 profile 自己的默认模型必须放行（误杀方向）', async () => {
  // deepseek-flash 不在基底（qwen）目录里——上一版会把这个本可跑通的配置拒掉
  const ctx = await codexCtxWith('deepseek', { deepseek: ['deepseek-flash'] }, ['qwen3.8-max'])();
  assert.equal(checkModelSlugs(ctx.config, 'plan', { codex: 'deepseek-flash' }, ['codex']).ok, true);
});

test('预检：目录采集失败 → 回落基底校验，且把回落这件事说出来', async () => {
  /*
   * 代码双审 CODEX-01 的预检侧锁例：失败不得静默变成放行，
   * 也不得静默变成「按基底判」——两者都要在输出里看得见。
   */
  const ctx = await codexCtxWith('deepseek', {}, ['qwen3.8-max'], { deepseek: 'debug models 退 1' })();
  const r = checkModelSlugs(ctx.config, 'plan', { codex: 'qwen3.8-max' }, ['codex']);
  assert.equal(r.ok, true, '回落之后基底目录里有它，照常通过');
  assert.match(r.detail, /回落/, '回落必须出现在预检输出里，不能静默');
  assert.match(r.detail, /退 1/, '要带上真实原因');
});

test('预检：回落后仍判非法时，报错要说清是回落（bad × fallback 组合）', async () => {
  /*
   * 代码双审 CODEX-08：上一版这一路只写「不在 <label> 模型目录中，可用值：…」并列出**基底**名单，
   * 只字不提「本该用该 profile 的目录而采集失败」。用户照报错去基底名单里挑模型，
   * 而端点执行的是 profile 目录——误杀方向的新误导。四条新锁例都走 ok/unverifiable，
   * 这一格此前无用例。
   */
  const ctx = await codexCtxWith('deepseek', {}, ['qwen3.8-max'], { deepseek: 'debug models 退 1' })();
  const r = checkModelSlugs(ctx.config, 'plan', { codex: 'nope-not-there' }, ['codex']);
  assert.equal(r.ok, false);
  assert.match(r.detail, /退 1/, '报错要先说清本次是回落，再说不在名单里');
});

test('预检：该 profile 渲染不出目录 → 记「未实际校验」，与回落分开表述', async () => {
  const ctx = await codexCtxWith('gpt', { gpt: [], qwen: ['qwen3.8-max'] }, ['qwen3.8-max'])();
  const r = checkModelSlugs(ctx.config, 'plan', { codex: 'anything' }, ['codex']);
  assert.equal(r.ok, true);
  assert.match(r.detail, /未实际校验/);
});

test('profile 缺该阶段模型时报不合格', async () => {
  const ctx = await fakeCtx((c) => {
    c.profiles['bare'] = { gemini: {} };
    c.active_profile = 'bare';
  });
  const r = checkModelSlugs(ctx.config, 'plan');
  assert.equal(r.ok, false);
  assert.match(r.detail, /未定义模型且无覆盖/);
});

// ── 探针新鲜度：快速失败，不拉 doctor（AGY-03 / GLM-08）──

test('从未探针 → 退 69，且明确说明不自动拉起 doctor', async () => {
  const ctx = await fakeCtx((c) => {
    c.probe.generated_at = null;
  });
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true });
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, EXIT.ENV);
  const c = r.checks.find((x) => !x.ok)!;
  assert.match(c.detail, /手动运行 `trivium doctor`/);
  assert.match(c.detail, /刻意\*\*不\*\*自动拉起/);
});

test('探针过期 → 退 69 并指引手动执行', async () => {
  const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const ctx = await fakeCtx((c) => {
    c.probe.generated_at = old;
    /*
     * TTL 按**键**判定（GLM-03），所以要逐键设旧。
     * 只改 `generated_at` 已经不等于过期了——这正是本步要的语义：
     * 全局时间戳被任何一次 doctor 刷新，让它决定新鲜度，
     * `doctor --only codex` 就会把没重探的键一并刷成「新鲜」。
     */
    for (const p of Object.values(c.probe.cli)) if (p) p.probed_at = old;
  });
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true });
  assert.equal(r.ok, false);
  assert.match(r.checks.find((x) => !x.ok)!.detail, /已全部过期/);
});

// ── 当轮 Driver 提示（M9 第 5 步，T-10）──

test('预检：--driver 非缺省时多打一行提示，且它是 ok:true 不是一次失败', async () => {
  const ctx = await fakeCtx();
  const r = await runPreflight({
    ctx, scope: 'plan', skipAuthCheck: true,
    driver: 'gemini', driverEnabled: false,
  });
  const hint = r.checks.find((c) => c.name === '当轮 Driver');
  assert.ok(hint, '非缺省 Driver 时应当有一行可见提示');
  /*
   * **必须 `ok: true`**。`runPreflight` 里多处用 `checks.every((c) => c.ok)` 做短路、
   * `exitCode` 由 `find((c) => !c.ok)` 决定——判 false 会把一条**提示**变成一次
   * **失败**，而且因为它排在最前面，会把后面所有检查一起短路掉。
   */
  assert.equal(hint.ok, true, '提示判成失败会把整个预检短路掉');
  assert.match(hint.detail, /gemini/);
  assert.match(
    hint.detail, /仅用于选侧判定/,
    'driverEnabled 为 false 时要说清「该值仅用于选侧判定」——放行而不说明就是静默降低门槛',
  );
  // 提示不参与成败：本次失败与否应当只由真正的检查项决定
  assert.equal(
    r.checks.filter((c) => !c.ok).some((c) => c.name === '当轮 Driver'), false,
  );
});

test('预检：--driver 已启用为 Driver 时，提示里不带「仅用于选侧判定」那句', async () => {
  /*
   * 「非缺省**且已启用**」这一臂在 M9 时的真实注册表下构造不出来（那时只有缺省 Driver 启用）；
   * M10a 第 3 步四家翻开之后，生产路径上传进来的恒为 true，反倒是 false 那一臂只剩注入测试能走到。
   * 预检这一层接受的是布尔入参，两臂都可以直接构造；`resolveDriver` 那一层
   * 另开了 `descriptors` 注入口（见 critics.test.ts），两处都不留「验不了」的臂。
   */
  const ctx = await fakeCtx();
  const r = await runPreflight({
    ctx, scope: 'plan', skipAuthCheck: true,
    driver: 'codex', driverEnabled: true,
  });
  const hint = r.checks.find((c) => c.name === '当轮 Driver')!;
  assert.equal(hint.ok, true);
  assert.equal(hint.detail, 'codex');
});

test('预检：缺省 Driver 不打这行提示（每次都打等于没打）', async () => {
  const ctx = await fakeCtx();
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true });
  assert.equal(
    r.checks.some((c) => c.name === '当轮 Driver'), false,
    '绝大多数运行都是缺省 Driver；每次多打一行会把真正的异常淹掉',
  );
});

test('探针过期时后续检查不再执行（快速失败，不白烧配额）', async () => {
  const ctx = await fakeCtx((c) => {
    c.probe.generated_at = null;
  });
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true });
  assert.equal(r.checks.length, 1, `应只跑第一项就停，实际跑了 ${r.checks.length} 项`);
});

// ── 命令 A 的编译测试检查（§14.1 / GLM-02）──

test('--stage all 会校验全部三个阶段的 slug（GLM-02）', async () => {
  const ctx = await fakeCtx((c) => {
    // 只把 code 阶段的 gemini 模型改成非法值
    c.profiles['default']!.gemini!.code = 'gemini-9.9-nope';
  });
  assert.equal(checkModelSlugs(ctx.config, 'plan').ok, true, 'plan 阶段本身合法');
  const all = checkModelSlugs(ctx.config, 'all');
  assert.equal(all.ok, false, '--stage all 必须覆盖到 code 阶段的非法值');
  assert.match(all.detail, /gemini\/code/);
});

test('单阶段 scope 不执行 verify 检查', async () => {
  const ctx = await fakeCtx();
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true });
  assert.equal(
    r.checks.some((c) => c.name === '编译测试命令已配置'),
    false,
    'verify 检查只属于 --stage all',
  );
});

// ── 零工件（AC-16 / GLM-05）──

test('预检失败时不写探活缓存', async () => {
  const ctx = await fakeCtx((c) => {
    c.probe.generated_at = null;
  });
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true });
  assert.equal(r.ok, false);
  await commitAuthCache(ctx, r);
  await assert.rejects(
    fs.access(path.join(ctx.triviumDir, 'config.local.yaml')),
    '预检失败不得留下任何写入',
  );
});

test('预检失败时不创建归档根（可写性探测用父目录权限）', async () => {
  const ctx = await fakeCtx((c) => {
    c.probe.cli.zcode!.readonly_flags = [];
  });
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true });
  assert.equal(r.ok, false);
  await assert.rejects(fs.access(ctx.archiveRoot), '严禁为探测可写性而创建 .reviews/');
});

test('渲染器把失败项与退出码都写清楚', async () => {
  const ctx = await fakeCtx((c) => {
    c.probe.cli.agy!.entrypoint = null;
  });
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true });
  const out = renderPreflight(r);
  assert.match(out, /✗/);
  assert.match(out, /不会产生任何工件/);
  assert.match(out, new RegExp(String(r.exitCode)));
});

// ── 缓存并发（GLM-07）──

test('并发 patchProbe 不丢更新（经全局锁串行化）', async () => {
  const ctx = await fakeCtx();
  await fs.mkdir(ctx.triviumDir, { recursive: true });
  await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      patchProbe(ctx.triviumDir, (p) => {
        p.auth = {
          ...(p.auth ?? {}),
          [i % 2 === 0 ? 'gemini' : 'glm']: {
            checked_at: new Date().toISOString(),
            cli_version: `v${i}`,
            fingerprint: `f${i}`,
            ok: true,
          },
        };
      }),
    ),
  );
  const YAML = await import('yaml');
  const raw = await fs.readFile(path.join(ctx.triviumDir, 'config.local.yaml'), 'utf8');
  const parsed = YAML.parse(raw) as { probe: { auth: Record<string, unknown> } };
  assert.equal(
    Object.keys(parsed.probe.auth).length,
    2,
    '两侧的缓存都应存在——丢更新会只剩一侧',
  );
});

// ── 回归：部分探测不得用 null 覆盖既有结论（真跑时踩过）──

test('回归：--no-model-calls 保留上一次探到的 agy 结论', async () => {
  const { probeAgy } = await import('../../src/trivium/probes/agy.js');
  const existing = {
    bin: '/usr/bin/agy', version: '1.2.0', models: ['m1'],
    entrypoint: '/x/agy', version_probe: null, probed_at: new Date().toISOString(),
    headless_read_ok: true, json_schema_ok: true, pty_required: false,
    path_deny: { supported: false, rule_syntax: null, method: 'tested', attempts: ['a'], coverage_complete: null, file_shape_verified: null },
    scratch_paths: [], isolation: 'shared' as const, read_strategy: 'default' as const,
  };
  const { probe } = await probeAgy(null, 'trivium-critic', {
    skipModelCalls: true,
    existing,
  });
  assert.equal(probe.headless_read_ok, true, '不得被覆盖成 null');
  assert.equal(probe.json_schema_ok, true);
  assert.equal(probe.path_deny.supported, false);
  assert.equal(probe.path_deny.method, 'tested');
});

test('回归：--no-model-calls 保留上一次探到的 zcode 结论', async () => {
  const { probeZcode } = await import('../../src/trivium/probes/zcode.js');
  /*
   * `model_override` 用 `'env'`——探针臂**永远不会**产出的值（代码双审 r2 CODEX-01）。
   * 此前写 `'config_copy'`：在装了 ZCode.app 的机器上，`null` 入口会回落到绝对路径候选、探针臂真跑，
   * 实测结果恰好也是 `config_copy`，「保留旧值」的语义根本没被测到；CI 上入口不存在则早退、恒真。
   * 再把探针臂换成恒返回「未判定」的桩：这条用例测的就只剩「未判定 ⇒ 保留」这一件事。
   */
  const existing = {
    entrypoint: '/x/zcode.cjs', version: '0.16.5',
    version_probe: null, probed_at: new Date().toISOString(),
    readonly_flags: ['--mode plan'], model_override: 'env' as const,
    trace_source: '/log/{date}.jsonl', trace_args_source: '/rollout/{sessionId}.jsonl',
    response_field: 'response',
    path_deny: { supported: false, rule_syntax: null, method: 'tested', attempts: [], coverage_complete: null, file_shape_verified: null },
    scratch_paths: [], isolation: 'home_copy' as const,
    model_id_form: 'p/GLM-5.3', models: ['GLM-5.3'],
  };
  const { probe } = await probeZcode(null, process.execPath, {
    skipModelCalls: true,
    existing,
    modelOverrideProbe: async () => ({ override: null, requested: null, observed: null, why: '桩：本轮未判定' }),
    // 同形第二臂同理（EV-82 小主题第一段）：不注入就会在装了 ZCode.app 的机器上读真实 cli/config.json 并真实拉起
    modelOverrideFullCopyProbe: async () => ({
      override: null, requested: null, observed: null, why: '桩：本轮未判定', replacedPaths: [], hostCredentialEnv: [],
    }),
  });
  assert.equal(probe.response_field, 'response', '不得被覆盖成 null');
  assert.equal(probe.model_override, 'env', '探针臂未判定时必须保留旧值——桩永远不会产出 env，改成别的值即现形');
  assert.equal(probe.model_id_form, 'p/GLM-5.3');
});

test('无既有结论时仍从默认值起步（首次探测）', async () => {
  const { probeAgy } = await import('../../src/trivium/probes/agy.js');
  const { probe } = await probeAgy(null, 'trivium-critic', { skipModelCalls: true });
  assert.equal(probe.headless_read_ok, null);
  assert.equal(probe.path_deny.supported, null);
});

// ── doctor 的分段落盘（审查意见 GLM-08）──

test('doctor 探完一侧即中途落盘，且 --only 不碰未探的那一侧', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ckpt-'));
  const triviumDir = path.join(root, '.trivium');
  await fs.mkdir(triviumDir, { recursive: true });

  // 先摆一份「上一次探到的」zcode 结论
  await patchProbe(triviumDir, (cur) => {
    cur.cli.zcode!.response_field = 'response';
    cur.cli.zcode!.version = '0.16.5';
  });

  /*
   * 关键：调用方传进来的 config.probe **故意不含**这份 zcode 结论
   * （模拟配置合并链没把 config.local.yaml 读进来，或两次 doctor 并发）。
   * checkpoint 若整段 Object.assign，zcode 就会被擦成默认值——
   * 那正是 GLM-08 当初修掉的问题。
   */
  const cfg = defaultConfig();
  await runDoctor({
    config: cfg, projectRoot: root, triviumDir,
    only: 'agy', skipModelCalls: true,
  });

  const onDisk = YAML.parse(
    await fs.readFile(path.join(triviumDir, 'config.local.yaml'), 'utf8'),
  ) as { probe: ProbeSection };

  assert.ok(onDisk.probe.host, 'env 段必须已落盘——中途写过一次');
  assert.ok(onDisk.probe.generated_at, 'generated_at 应已写入');
  assert.equal(
    onDisk.probe.cli.zcode!.response_field,
    'response',
    '--only agy 不得覆盖 zcode 段',
  );
  assert.equal(onDisk.probe.cli.zcode!.version, '0.16.5');
});

test('--only zcode 同样不碰 agy 段', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ckpt3-'));
  const triviumDir = path.join(root, '.trivium');
  await fs.mkdir(triviumDir, { recursive: true });
  await patchProbe(triviumDir, (cur) => {
    cur.cli.agy!.version = '1.2.0';
    cur.cli.agy!.headless_read_ok = true;
  });

  // 两条模型覆盖臂注入合成配置与桩（代码双审 r2 CODEX-03 扫出的第二处）：本用例只关心分段落盘，
  // 不注入就会在装了 ZCode.app 的机器上读真实 cli/config.json 并真实拉起
  const cliConfigPath = path.join(root, 'cli-config.json');
  await fs.writeFile(cliConfigPath, '{"provider":{},"model":{}}', 'utf8');
  await runDoctor({
    config: defaultConfig(), projectRoot: root, triviumDir,
    only: 'zcode', skipModelCalls: true,
    zcodeProbe: {
      cliConfigPath,
      modelOverrideProbe: async () => ({ override: null, requested: null, observed: null, why: '桩：本轮未判定' }),
      modelOverrideFullCopyProbe: async () => ({
        override: null, requested: null, observed: null, why: '桩：本轮未判定', replacedPaths: [], hostCredentialEnv: [],
      }),
    },
  });

  const onDisk = YAML.parse(
    await fs.readFile(path.join(triviumDir, 'config.local.yaml'), 'utf8'),
  ) as { probe: ProbeSection };
  assert.equal(onDisk.probe.cli.agy!.version, '1.2.0');
  assert.equal(onDisk.probe.cli.agy!.headless_read_ok, true);
});

/*
 * ── 「无法校验」是第三态，不是通过（M7b 第 6 步）──
 *
 * 上面那条「模型清单为空时不误判」只锁了**不判失败**。它当时对应的实现是
 * `if (models.length > 0 && …)`——目录为空就整段跳过、静默通过，于是
 * 「校验过了」和「没得校验」在输出里长得一模一样。
 *
 * 第 6 步把厂商分派从「按 Agent 身份穷尽」改成「按 vendor 查表」之后，
 * 这个第三态还多了一个来源：**新厂商根本没有模型目录探针**。桩 Agent 就是。
 * 判它失败会让零改动验收被自己打红；静默通过则等于对第三家的模型只字不提。
 * 所以取第三态：不拦，但说出来。
 */
test('模型目录为空时不判失败，但必须在输出里点名是哪几侧没被实际校验', async () => {
  const ctx = await fakeCtx((c) => {
    c.probe.cli.agy!.models = [];
    c.probe.cli.zcode!.models = [];
  });
  const r = checkModelSlugs(ctx.config, 'plan');
  assert.equal(r.ok, true, '没有目录可比对不等于配错了，不能拦');
  assert.match(r.detail, /未实际校验/, '「没得校验」必须在输出里可见，否则与「校验通过」无从区分');
  for (const side of ['gemini', 'glm'] as const) {
    assert.match(r.detail, new RegExp(side), `未校验的侧要逐个点名，缺 ${side}`);
  }
});

test('模型目录齐备时不出现「未实际校验」字样（避免恒真提示）', async () => {
  const ctx = await fakeCtx();
  const r = checkModelSlugs(ctx.config, 'plan', {}, ['gemini', 'glm']);
  assert.equal(r.ok, true);
  assert.doesNotMatch(
    r.detail, /未实际校验/,
    '两侧目录都在却仍打这句提示的话，它就成了永远显示的噪音，真有缺口时没人会注意',
  );
});

test('一侧有目录一侧没有：只点名没有的那一侧', async () => {
  const ctx = await fakeCtx((c) => {
    c.probe.cli.zcode!.models = [];
  });
  const r = checkModelSlugs(ctx.config, 'plan');
  assert.equal(r.ok, true);
  assert.match(r.detail, /glm/, '没目录的那侧要点名');
  assert.doesNotMatch(
    r.detail, /未实际校验[^\n]*gemini/,
    '有目录的那侧已经真校验过了，不该混进「未校验」清单',
  );
});

/*
 * ── 版本校验的「无从查」第三态（M6 第 1 步）──
 *
 * 三种原因各一条，且都要**点名**。合成一条「未校验」是不够的：
 * 三种原因的出路不同——没记录方式该重跑 doctor，运行时不认识说明该侧当前不支持，
 * 正则非法说明盘上被改坏了。说不清原因，用户只能瞎试。
 *
 * 第一条同时是 GLM-01 要求的配套：stub 集成夹具改成新形状之后，
 * 「旧盘迁移后走第三态」这条真实路径要有人**断言**它，
 * 而不是像之前那样让它默默顶替掉版本比对的覆盖。
 */

/** 造一个入口真实存在、可控 version_probe 的探针段 */
function probeWithVersionProbe(c: Config, vp: unknown): void {
  const now = new Date().toISOString();
  c.probe.generated_at = now;
  const agy = c.probe.cli.agy!;
  agy.probed_at = now;
  agy.entrypoint = process.execPath; // node 自己一定存在，才走得到取版本那一步
  agy.version = 'whatever';
  agy.version_probe = vp as never;
  agy.models = ['gemini-3.8-flash-high'];
  // 另一侧压成「没探过」，免得它的失败盖过本条要看的检查项
  c.probe.cli.zcode!.probed_at = null;
}

function coverageDetail(r: { checks: { name: string; detail: string }[] }): string {
  return r.checks.find((x) => x.name === '版本漂移检查覆盖面')?.detail ?? '';
}

test('第三态①：探针没记录取版本方式时点名，不判失败', async () => {
  const ctx = await fakeCtx((c) => probeWithVersionProbe(c, null));
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true });
  const detail = coverageDetail(r);
  assert.match(detail, /agy/, '必须点名是哪一侧');
  assert.match(detail, /未记录取版本的方式/, '必须说清原因——出路是重跑 doctor');
  assert.ok(
    r.checks.find((x) => x.name === '版本漂移检查覆盖面')?.ok,
    '无从查不判失败：判失败会让刚迁移过来的旧盘直接跑不动',
  );
});

test('第三态②：不认识的运行时被点名，而不是静默按直接执行处理', async () => {
  /*
   * GLM-03 的回归。原实现写的是 `runner === 'node' ? … : <直接执行 entrypoint>`，
   * 于是 'python' 会被静默当成「直接执行」，跑出一个看不懂的错。
   */
  const ctx = await fakeCtx((c) =>
    probeWithVersionProbe(c, { runner: 'python', args: ['-V'], extract: null }),
  );
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true });
  const detail = coverageDetail(r);
  assert.match(detail, /不认识的运行时/);
  assert.match(detail, /python/, '要说出是哪个运行时，否则用户不知道改什么');
});

test('第三态③：extract 不是合法正则时点名，而不是抛 JS 原始栈', async () => {
  /*
   * GLM-07 的回归。盘上被改坏时，`new RegExp('(')` 会抛 SyntaxError 一路穿到
   * cli.ts 的全局 catch，用户看到 JS 正则错误——而该做的是重跑 doctor。
   */
  const ctx = await fakeCtx((c) =>
    probeWithVersionProbe(c, { runner: null, args: ['--version'], extract: '(' }),
  );
  /*
   * `critics: ['gemini']` 是 M8 第 3 步补的，表达本条用例**本来就有**的意图——
   * `probeWithVersionProbe` 的注释写着「另一侧压成没探过，免得它的失败盖过本条要看的
   * 检查项」。此前靠把 `probed_at` 压成 null 让它隐身，而只读能力检查收敛到适配器
   * `availability()` 之后，**入选侧没探过 = 不可用**，预检会如实拦下（这是对的：
   * 本次要用它，用必失败，快速失败优于中途失败）。所以改用「不选它」来表达不测它。
   */
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true, critics: ['gemini'] });
  const detail = coverageDetail(r);
  assert.match(detail, /不是合法正则/);
  assert.equal(r.ok, true, '盘上一个字段被改坏不该让整个预检以 JS 异常收场');
});

/*
 * ── TTL 按键判定（M6 第 1 步，审查意见 GLM-03）──
 *
 * 两条不变量在改造前都不成立：
 *   ① `probeIsFresh` 只看全局 `generated_at`，任何一次 doctor 都刷新它，
 *      于是 `--only X` 会把其它侧的**过期**结论一并刷成「新鲜」；
 *   ② 末次 checkpoint 的标签三元回落（`only === 'env'` 时落 'zcode'）
 *      会把本次根本没探过的段按起点 clone 整段写回。
 */

test('全局时间戳新鲜但某键过期时，该键判为不新鲜', async () => {
  /*
   * 这条直指判定本身，是上面那条落盘断言杀不掉的变异面。
   *
   * 构造的正是 `doctor --only <另一侧>` 跑完的盘面：全局 `generated_at` 刚被刷新，
   * 而 zcode 的按键时间戳还停在 30 天前。若 `cliProbeIsFresh` 退回去看全局戳，
   * 它会把这份**过期**结论报成新鲜——preflight 于是拿着陈旧的 entrypoint 与
   * readonly_flags 继续跑，而那正是 TTL 要防的事。
   *
   * 起草时这条漏了：原先只断言「盘上的 probed_at 字段没被改写」，
   * 那是数据没被污染，不等于判定用了它。变异验证当场打脸（实现改回全局判定，
   * 全部 29 条照绿），才补上本例。
   */
  const { cliProbeIsFresh, probeIsFresh, staleCliProbes } = await import(
    '../../src/trivium/config.js'
  );
  const cfg = defaultConfig();
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 30 * 86_400_000).toISOString();

  cfg.probe.generated_at = now; // 全局戳刚被另一侧的 doctor 刷新
  cfg.probe.cli.agy!.probed_at = now;
  cfg.probe.cli.zcode!.probed_at = old;

  assert.equal(cliProbeIsFresh(cfg, 'agy'), true, '刚探过的那侧是新鲜的');
  assert.equal(
    cliProbeIsFresh(cfg, 'zcode'), false,
    '没重探的那侧必须仍判过期——全局时间戳被刷新不该让它蒙混过关',
  );
  assert.equal(probeIsFresh(cfg), true, '还有一侧新鲜，整体不算全部过期');
  assert.ok(
    staleCliProbes(cfg).includes('zcode'),
    '过期的那侧必须被点名，否则用户不知道该重探谁',
  );
});

test('--only 一侧不刷新另一侧的新鲜度', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ttl-'));
  const triviumDir = path.join(root, TRIVIUM_DIR);
  await fs.mkdir(triviumDir, { recursive: true });

  // zcode 侧摆一份 30 天前的旧结论
  const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
  await patchProbe(triviumDir, (cur) => {
    cur.cli.zcode!.entrypoint = '/x/zcode.cjs';
    cur.cli.zcode!.version = '0.16.5';
    cur.cli.zcode!.probed_at = old;
  });

  // 只探 agy
  await runDoctor({
    config: defaultConfig(), projectRoot: root, triviumDir,
    only: 'agy', skipModelCalls: true,
  });

  const onDisk = YAML.parse(
    await fs.readFile(path.join(triviumDir, 'config.local.yaml'), 'utf8'),
  ) as { probe: ProbeSection };

  assert.equal(
    onDisk.probe.cli.zcode!.probed_at, old,
    '--only agy 不得刷新 zcode 的按键时间戳——否则过期结论会蒙混过关',
  );
  assert.ok(onDisk.probe.generated_at, '全局时间戳照常刷新（它记的是「段整体何时写过」）');
  assert.notEqual(
    onDisk.probe.generated_at, old,
    '全局时间戳与按键时间戳是两个语义，不该同步',
  );
});

test('--only env 不写任何厂商段', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-envonly-'));
  const triviumDir = path.join(root, TRIVIUM_DIR);
  await fs.mkdir(triviumDir, { recursive: true });

  await patchProbe(triviumDir, (cur) => {
    cur.cli.zcode!.response_field = 'response';
    cur.cli.zcode!.version = '0.16.5';
    cur.cli.agy!.version = '1.2.0';
  });

  /*
   * 关键：传进去的 config.probe 是**默认值**（不含上面那份结论）。
   * 末次 checkpoint 若借用厂商标签（原实现 `only === 'env'` 时落 'zcode'），
   * 就会把默认值当成 zcode 结论整段写回，把盘上的擦掉。
   */
  await runDoctor({
    config: defaultConfig(), projectRoot: root, triviumDir,
    only: 'env', skipModelCalls: true,
  });

  const onDisk = YAML.parse(
    await fs.readFile(path.join(triviumDir, 'config.local.yaml'), 'utf8'),
  ) as { probe: ProbeSection };

  assert.equal(onDisk.probe.cli.zcode!.response_field, 'response', '--only env 不得动 zcode 段');
  assert.equal(onDisk.probe.cli.zcode!.version, '0.16.5');
  assert.equal(onDisk.probe.cli.agy!.version, '1.2.0', '--only env 不得动 agy 段');
  assert.ok(onDisk.probe.host, 'env 段本身要写');
});

/*
 * ── 探针段键集随注册表派生（验收 ②）──
 *
 * 这条守的是「新增一家 CLI 不必改 doctor」。断言用**注册表实际登记的全集**，
 * 不写死家数——写死的话，加一家时这条测试自己会先绿着骗人。
 */
test('defaultProbe 的键集恒等于注册表的 cliName 全集', async () => {
  const { defaultProbe } = await import('../../src/trivium/config.js');
  const { ALL_CLI_NAMES } = await import('../../src/trivium/agents/registry.js');
  assert.deepEqual(
    Object.keys(defaultProbe().cli).sort(),
    [...ALL_CLI_NAMES].sort(),
    '探针段键集必须与注册表 cliName 全集逐项相等',
  );
});

test('--only 的取值集合随注册表派生，每一家已登记 CLI 都合法', async () => {
  const { ALL_CLI_NAMES } = await import('../../src/trivium/agents/registry.js');
  const { isDoctorOnly, DOCTOR_ONLY_ENV } = await import('../../src/trivium/doctor.js');

  for (const name of ALL_CLI_NAMES) {
    assert.ok(isDoctorOnly(name), `--only ${name} 必须是合法取值（不得退 64）`);
  }
  assert.ok(isDoctorOnly(DOCTOR_ONLY_ENV), '环境段也是合法取值');
  assert.ok(!isDoctorOnly('__not_a_cli__'), '没登记的名字仍要退 64，别把校验放没了');
});

/*
 * ── 这里原本还有一条「已登记但尚无探针实现的 CLI 给确定答复」的用例 ──
 *
 * 它连同 `PROBE_IMPLEMENTED` 清单一起，于 **M6 第 3 步删除**：四家探针全部接入后
 * 「未实现的 CLI」这个集合空了，用例的前提不复存在。
 *
 * **删除是那条用例自己要求的**——它里面写着「全部接入后 unimplemented 为空集，
 * 紧跟的断言会红，那就是提醒删除本用例的机器信号」。本步 claude 探针接上之后
 * 它如期红了，于是照它说的办。这比留一条永远测不到东西的用例诚实。
 *
 * `doctor` 里那段「尚无探针实现」的答复逻辑**保留**：它是给第五家准备的，
 * 接入新 CLI 而探针还没写时仍会走到。届时若想恢复覆盖，把本注释连同
 * 那条用例（见 git history，M6 第 2 步的版本）一起取回即可。
 */

// ── ZCode 运行期选模警告（EV-82 第三段 r3 §4.2）：只警告、不拒跑 ──

test('checkZcodeRuntimeSelection：只在 glm 入选且读数为 reorder_ineffective 时出 ok:true 的 ⚠️ 项', () => {
  const cfg = defaultConfig();
  assert.equal(checkZcodeRuntimeSelection(cfg, ['glm']), null, '未探过不出项');
  for (const v of ['honored', 'reorder_needed', null] as const) {
    cfg.probe.cli.zcode!.runtime_selection = v;
    assert.equal(checkZcodeRuntimeSelection(cfg, ['glm']), null, `${v} 不出项`);
  }
  cfg.probe.cli.zcode!.runtime_selection = 'reorder_ineffective';
  const w = checkZcodeRuntimeSelection(cfg, ['codex', 'glm']);
  assert.ok(w);
  assert.equal(w!.ok, true, '不拒跑');
  assert.match(w!.detail, /^⚠️ .*reorder_ineffective/);
  assert.equal(checkZcodeRuntimeSelection(cfg, ['codex', 'gemini']), null, 'glm 未入选不出项');
});
