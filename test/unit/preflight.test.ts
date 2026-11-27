import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import YAML from 'yaml';
import {
  parsePreflightScope, checkModelSlugs, runPreflight, commitAuthCache, renderPreflight, checkZcodeRuntimeSelection,
  checkHeartbeatThreshold, checkDeprecatedConfigKeys, checkSharedReadRoots, type PreflightResult } from '../../src/trivium/preflight.js';
import type { CriticAdapter } from '../../src/trivium/adapters/base.js';
import { DEFAULT_HEARTBEAT_STALE_S, TRIVIUM_DIR, defaultConfig, patchProbe } from '../../src/trivium/config.js';
import { runDoctor } from '../../src/trivium/doctor.js';
import { initFixtureRepo } from '../../src/trivium/util/git.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { Config, CriticId, Ctx, ProbeSection } from '../../src/trivium/types.js';
import { AGENTS, DEFAULT_DRIVER, guardProfileOf } from '../../src/trivium/agents/registry.js';
import { mergeHooks, type InitReport } from '../../src/trivium/init.js';
import { REPO_ROOT } from '../helpers/fixture.js';
import { scratchDir } from '../helpers/scratch.js';
import { isolateEntryScanHome } from '../helpers/entry-scan-home.js';

// 2026-10-20 试验性解除 win32 整文件跳过（第二批适配）：主体是 preflight 检查项的纯逻辑与
// 临时目录夹具，实测后按结果定去留。macOS/Linux 行为零变化。
//
// CODEX_HOME 隔离：`vendorProfilesFor` 读**真实** ~/.codex 的 <name>.config.toml 名单
// （profileNamesAuthoritative），而 defaultConfig 把 codex profile 钉在 qwen——不隔离的话，
// 「名单里有没有 qwen」取决于开发机（作者机器恰好有 qwen.config.toml 才绿）。这里给测试进程
// 指一个只含 qwen 空壳的临时 CODEX_HOME，名单恒为 ['qwen']，与机器状态解耦。
const isolatedCodexHome = await (async () => {
  const { writeFile } = await import('node:fs/promises');
  // 经 scratchDir 登记、进程退出时删（EV-208 守卫；双平台统一时由裸 mkdtemp 改来）
  const dir = await scratchDir('trivium-pf-codexhome-');
  await writeFile(path.join(dir, 'qwen.config.toml'), '# preflight 测试隔离名单（空壳）\n');
  process.env['CODEX_HOME'] = dir;
  return dir;
})();
void isolatedCodexHome;
{

// doctor / preflight 的共享读取面扫描读空夹具，不读真实家目录（EV-240，计划双审 CODEX-01 / GLM-01）
isolateEntryScanHome();

const emptyReport = (): InitReport => ({ created: [], updated: [], skipped: [], notes: [] });

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
  zcode.models = ['GLM-5.4', 'GLM-5.3', 'GLM-5.3-Flash', 'bigmodel/GLM-5.4', 'bigmodel/GLM-5.3', 'bigmodel/GLM-5.3-Flash'];
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
  const root = await scratchDir('trivium-pf-');
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

test('从未探针 → 退 69，终端里手动跑 doctor；/dual-* 里按入选各侧自动校准（EV-251）', async () => {
  const ctx = await fakeCtx((c) => {
    c.probe.generated_at = null;
  });
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true });
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, EXIT.ENV);
  const c = r.checks.find((x) => !x.ok)!;
  assert.match(c.detail, /手动运行 `trivium doctor`/);
  assert.match(c.detail, /自动校准/);
  // 旧说法（「配额已烧而结论未落盘」）已过时：doctor 每探完一段就落盘
  assert.doesNotMatch(c.detail, /结论未落盘/);
  assert.equal(c.recalibrate?.fixable, true);
  assert.equal(r.recalibration?.eligible, true);
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

/*
 * M10b 第 3 步（B1）起这一行带护栏等级；原先「尚未启用为 Driver，该值仅用于选侧判定」那一支
 * 在生产路径上走不到（`resolveDriver` 对未启用者退 64），随 `driverEnabled` 入参一并删除。
 * 用例按护栏形态三档各一条（取值经注册表派生，不写死哪家是哪档），外加缺省 Driver 的两格。
 */
const byProfile = (p: ReturnType<typeof guardProfileOf>) => AGENTS.find((a) => a.driverEnabled && guardProfileOf(a) === p);

test('预检：--driver 非缺省时多打一行，带护栏等级，且它是 ok:true 不是一次失败', async () => {
  const ctx = await fakeCtx();
  const none = byProfile('l2-none')!;
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true, driver: none.id });
  const hint = r.checks.find((c) => c.name === '当轮 Driver');
  assert.ok(hint, '非缺省 Driver 时应当有一行可见提示');
  /*
   * **必须 `ok: true`**。`runPreflight` 里多处用 `checks.every((c) => c.ok)` 做短路、
   * `exitCode` 由 `find((c) => !c.ok)` 决定——判 false 会把一条**提示**变成一次
   * **失败**，而且因为它排在最前面，会把后面所有检查一起短路掉。
   */
  assert.equal(hint.ok, true, '提示判成失败会把整个预检短路掉');
  assert.match(hint.detail, new RegExp(`^${none.id} · 护栏 L2（该载体没有 Hook 机制`));
  assert.equal(hint.warn, undefined, '登记的 L2 是已知形态、入口资产已明示，不是缺口');
  assert.doesNotMatch(hint.detail, /仅用于选侧判定/, '死分支已删，这句不该再出现');
});

test('预检：有尽力拦截 Hook 的 L2 载体，文案写「不兜底」与五个生效前提，不说「无事前写拦截」', async () => {
  const ctx = await fakeCtx();
  const best = byProfile('l2-hook')!;
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true, driver: best.id });
  const hint = r.checks.find((c) => c.name === '当轮 Driver')!;
  assert.match(hint.detail, /L2（有尽力拦截的 Hook：.*不兜底——只在桌面端、已信任、主代理、matcher 覆盖、不超时时生效）/);
  assert.doesNotMatch(hint.detail, /没有事前拦截/, '与 glm 实况相反的说法（r10 §3.1.3）');
});

test('预检：缺省 Driver、Hook 配置在场 ⇒ 不打这行（每次都打等于没打）', async () => {
  const ctx = await fakeCtx();
  await mergeHooks(ctx.projectRoot, path.join(REPO_ROOT, 'skills/dual-critic/hooks/hooks.json'), emptyReport(), false);
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true });
  assert.equal(
    r.checks.some((c) => c.name === '当轮 Driver'), false,
    '绝大多数运行都是缺省 Driver；每次多打一行会把真正的异常淹掉',
  );
});

test('预检：缺省 Driver 登记 L1 而 Hook 配置不在场 ⇒ 降为 L2，打一行 ⚠️ 并进 warnings（B1）', async () => {
  const ctx = await fakeCtx(); // 夹具里没有 .claude/settings.json
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true });
  const hint = r.checks.find((c) => c.name === '当轮 Driver');
  assert.ok(hint, 'L1 的前提（Hook 在场）不成立时必须让人看见');
  assert.equal(hint.ok, true, '降级是提示，不是失败：审批前复核等补偿照样在');
  assert.equal(hint.warn, true);
  assert.match(hint.detail, new RegExp(`^⚠️ ${DEFAULT_DRIVER} · 护栏 L2（登记 L1，但 .* 不在场`));
  assert.match(hint.detail, /trivium hooks --agent/, '要给出修复出口');
  assert.ok(r.warnings.some((w) => w.name === '当轮 Driver'));
  assertWarnInvariant(r);
});

test('探针过期时后续检查不再执行（快速失败，不白烧配额）', async () => {
  const ctx = await fakeCtx((c) => {
    c.probe.generated_at = null;
  });
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true });
  /*
   * 「当轮 Driver」那一行是排在探针之前的**信息项**（本夹具没有 Hook 配置，缺省 Driver 会带一行降级提示，
   * M10b 第 3 步 B1），不是检查；本条要钉的是「探针过期之后不再往下跑」，所以把它剔掉再数。
   */
  const real = r.checks.filter((c) => c.name !== '当轮 Driver');
  assert.deepEqual(real.map(c => c.name), ['Driver 会话声明', '模型 slug 合法', '档位组合合法', '探针结论存在'], '参数检查先于环境检查，环境失败后不执行探活');
  assert.equal(real.at(-1)!.ok, false);
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
    entrypoint: '', version: '0.16.9',
    version_probe: null, probed_at: new Date().toISOString(),
    readonly_flags: ['--mode plan'], model_override: 'env' as const,
    trace_source: '/log/{date}.jsonl', trace_args_source: '/rollout/{sessionId}.jsonl',
    response_field: 'response',
    path_deny: { supported: false, rule_syntax: null, method: 'tested', attempts: [], coverage_complete: null, file_shape_verified: null },
    scratch_paths: [], isolation: 'home_copy' as const,
    model_id_form: 'p/GLM-5.3', models: ['GLM-5.3'],
  };
  /*
   * 合成入口与合成 cli 配置（EV-94 ①）：原先传 `null` 入口，装了 ZCode.app 的机器上回落到 `/Applications/...` 候选、
   * 真实跑七次旗标候选与版本探针；CI 上入口不在则早退，模型覆盖臂根本走不到——两台机器测的不是同一件事。
   * 合成入口：`version` 打版本号，其余调用一律报 `Unknown option` 退 1（旗标臂七个候选全判拒绝、零配额）；
   * 合成 cli 配置只为让 `cliConfigured` 门控确定地放行、进到下面两个桩。
   */
  const dir = await scratchDir('trivium-zentry-');
  const entry = path.join(dir, 'zcode.cjs');
  await fs.writeFile(entry, [
    'const a = process.argv.slice(2);',
    "if (a[0] === 'version') { console.log('zcode 0.16.9'); process.exit(0); }",
    "process.stderr.write(\"Unknown option '\" + a[6] + \"'\\n\");",
    'process.exit(1);',
  ].join('\n') + '\n');
  const cliConfigPath = path.join(dir, 'cli-config.json');
  await fs.writeFile(cliConfigPath, '{}\n');
  existing.entrypoint = await fs.realpath(entry);
  const armCalls = { whitelist: 0, fullCopy: 0 };
  const { probe } = await probeZcode(entry, process.execPath, {
    skipModelCalls: true,
    existing,
    cliConfigPath,
    modelOverrideProbe: async () => {
      armCalls.whitelist++;
      return { override: null, requested: null, observed: null, why: '桩：本轮未判定' };
    },
    // 同形第二臂同理（EV-82 小主题第一段）：不注入就会读 cli 配置并拉起入口
    modelOverrideFullCopyProbe: async () => {
      armCalls.fullCopy++;
      return { override: null, requested: null, observed: null, why: '桩：本轮未判定', replacedPaths: [], hostCredentialEnv: [] };
    },
  });
  assert.equal(probe.entrypoint, existing.entrypoint, '入口应是合成入口，不得回落到本机安装的 ZCode.app');
  assert.equal(probe.version, '0.16.9', '版本取自合成入口');
  assert.ok(armCalls.whitelist === 1 && armCalls.fullCopy >= 1, `两个探针臂都应走到（${JSON.stringify(armCalls)}）`);
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
  const root = await scratchDir('trivium-ckpt-');
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
  const root = await scratchDir('trivium-ckpt3-');
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
  const root = await scratchDir('trivium-ttl-');
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
  const root = await scratchDir('trivium-envonly-');
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
  // 两条收尾通道都要指到（EV-122 计划 r2 §3.4）：副本源临时缺失的那一轮出声的是后者
  assert.ok(w!.detail.includes('请求的模型没有生效') && w!.detail.includes('本次没有做模型覆盖'), w!.detail);
  assert.equal(checkZcodeRuntimeSelection(cfg, ['codex', 'gemini']), null, 'glm 未入选不出项');
});

// ── 警告这一级（EV-123）：`warn` 由代码置位，`warnings` 恒在 ──

/**
 * 口径断言：凡通过项 detail 任一行（去缩进后）以 ⚠️ 起头，必带 `warn`。
 * 它顶住的是「下一次有人新增一条 ⚠️ 通过项却忘了置 `warn`」——那条提示就又回到
 * 「躺在工具结果里、没人念」的老样子（r2 双审 CODEX-04 ≡ AGY-02 ≡ GLM-03）。
 */
function assertWarnInvariant(r: PreflightResult): void {
  for (const c of r.checks) {
    const flagged = c.ok && c.detail.split('\n').some((l) => l.trimStart().startsWith('⚠️'));
    if (flagged) assert.equal(c.warn, true, `「${c.name}」带 ⚠️ 却没标 warn：\n${c.detail}`);
  }
  assert.deepEqual(
    r.warnings,
    r.checks.filter((c) => c.warn).map((c) => ({ name: c.name, detail: c.detail })),
    'warnings 必须恰是 warn 项的汇总',
  );
}

/** 只实现 `modelOverrideSource` 的假适配器：本组用例只看 ④″，其余成员用不到 */
function overrideOnly(src: string): CriticAdapter {
  return { modelOverrideSource: () => src } as unknown as CriticAdapter;
}

async function missingPath(): Promise<string> {
  const d = await scratchDir('trivium-ovr-');
  return path.join(d, '.zcode/cli/config.json'); // 不创建：「文件不在」
}

test('warnings 恒在：无警告时为空数组，渲染末行与今天逐字相同', async () => {
  const ctx = await fakeCtx((c) => probeWithVersionProbe(c, { runner: null, args: ['--version'], extract: '(' }));
  const present = path.join(await scratchDir('trivium-ovr-'), 'config.json');
  await fs.writeFile(present, '{}');
  // 必须跳过探活（不跳会真去探活、耗配额）；「探活已跳过」与覆盖面两条 warn 下面单独剥掉
  const r = await runPreflight({
    ctx, scope: 'plan', skipAuthCheck: true, critics: ['gemini'],
    adapters: { gemini: overrideOnly(present) },
  });
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.warnings), 'warnings 必须恒在');
  assert.equal(r.checks.some((c) => c.name.endsWith('模型覆盖副本源')), false, '副本源在就不出项');
  assertWarnInvariant(r);
  // 只剩「探活已跳过」与覆盖面两条 warn；把它们去掉之后的渲染与今天同形
  const quiet: PreflightResult = { ...r, checks: r.checks.map((c) => ({ ...c, warn: undefined })), warnings: [] };
  const out = renderPreflight(quiet);
  assert.equal(out.split('\n').at(-1), '✓ 预检通过', '无警告时末行与今天逐字相同');
  assert.doesNotMatch(out, /⚠ /);
});

test('④″：入选侧的副本源不在 ⇒ 出一条 ok:true 的 warn 项，进 warnings，不改退出码', async () => {
  const ctx = await fakeCtx((c) => probeWithVersionProbe(c, { runner: null, args: ['--version'], extract: '(' }));
  const r = await runPreflight({
    ctx, scope: 'plan', skipAuthCheck: true, critics: ['gemini'],
    adapters: { gemini: overrideOnly(await missingPath()) },
  });
  assert.equal(r.ok, true, '只警告、不拒跑');
  assert.equal(r.exitCode, EXIT.OK);
  const item = r.checks.find((c) => c.name.endsWith('模型覆盖副本源'));
  assert.ok(item, '副本源不在必须出项');
  assert.equal(item!.ok, true);
  assert.equal(item!.warn, true);
  assert.ok(r.warnings.some((w) => w.name === item!.name), '必须进 warnings');
  // ④″ 在探活之前：它不花配额，前面失败就不该轮到探活
  const idx = (n: string) => r.checks.findIndex((c) => c.name === n);
  assert.ok(idx(item!.name) < idx('探活'), '副本源检查必须排在探活之前');
  assertWarnInvariant(r);
});

test('C5 与副本源各出一条 ⇒ 两条都进 warnings；渲染用 ⚠ 且末行报条数', async () => {
  const ctx = await fakeCtx((c) => {
    probeWithVersionProbe(c, { runner: null, args: ['--version'], extract: '(' });
    // C5 按入选侧的 cliName 取探针读数，与厂商无关；这里借 agy 那格构造它
    (c.probe.cli.agy as { runtime_selection?: unknown }).runtime_selection = 'reorder_ineffective';
  });
  const r = await runPreflight({
    ctx, scope: 'plan', skipAuthCheck: true, critics: ['gemini'],
    adapters: { gemini: overrideOnly(await missingPath()) },
  });
  const names = r.warnings.map((w) => w.name);
  assert.ok(names.some((n) => n.endsWith('运行期选模')), `C5 必须进 warnings：${names.join('、')}`);
  assert.ok(names.some((n) => n.endsWith('模型覆盖副本源')), `副本源必须进 warnings：${names.join('、')}`);
  assert.ok(names.includes('探活'), '「探活已跳过」同样是 warn');
  assert.ok(names.includes('版本漂移检查覆盖面'), '覆盖面项同样是 warn');
  assertWarnInvariant(r);
  const out = renderPreflight(r);
  assert.match(out, /\n {2}⚠ .*模型覆盖副本源/);
  assert.match(out.split('\n').at(-1)!, new RegExp(`^✓ 预检通过（含 ${r.warnings.length} 条警告）$`));
});

test('模型 slug 合法：有侧没实际校验时通过但标 warn（按集合置位，不看文案）', async () => {
  const ctx = await fakeCtx((c) => { c.probe.cli.agy!.models = []; });
  const r = checkModelSlugs(ctx.config, 'plan', {}, ['gemini']);
  assert.equal(r.ok, true);
  assert.equal(r.warn, true, '「没测到 ≠ 测通过」：未实际校验必须进转述通道');
  const quiet = checkModelSlugs((await fakeCtx()).config, 'plan', {}, ['gemini', 'glm']);
  assert.equal(quiet.warn, undefined, '都校验到了就不标，免得成为恒真提示');
});

test('runPreflight：slug 的未校验行同样进 warnings', async () => {
  const ctx = await fakeCtx((c) => {
    probeWithVersionProbe(c, { runner: null, args: ['--version'], extract: '(' });
    c.probe.cli.agy!.models = [];
  });
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true, critics: ['gemini'], adapters: {} });
  assert.ok(r.warnings.some((w) => w.name === '模型 slug 合法'), r.warnings.map((w) => w.name).join('、'));
  assertWarnInvariant(r);
});

test('现有 ⚠️ 项一律标 warn：C5、覆盖面、探活已跳过', async () => {
  const cfg = defaultConfig();
  cfg.probe.cli.zcode!.runtime_selection = 'reorder_ineffective';
  assert.equal(checkZcodeRuntimeSelection(cfg, ['glm'])!.warn, true, 'C5');
  const ctx = await fakeCtx((c) => probeWithVersionProbe(c, null));
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true, critics: ['gemini'], adapters: {} });
  assert.equal(r.checks.find((c) => c.name === '版本漂移检查覆盖面')?.warn, true, '覆盖面');
  assert.equal(r.checks.find((c) => c.name === '探活')?.warn, true, '探活已跳过');
  // 反向：「当轮 Driver」是信息，不是缺口
  const d = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true, critics: ['gemini'], adapters: {}, driver: 'codex' });
  assert.equal(d.checks.find((c) => c.name === '当轮 Driver')?.warn, undefined);
  assertWarnInvariant(r);
  assertWarnInvariant(d);
});

// ── EV-160：失联阈值不大于心跳间隔 ⇒ 只警告项（心跳阈值事前告警计划 r2 §6.1） ──

const withStale = (s: number) => (c: Config): void => {
  probeWithVersionProbe(c, { runner: null, args: ['--version'], extract: '(' });
  c.review.heartbeat_stale_s = s;
};

test('EV-160 U2：checkHeartbeatThreshold——盖住一个心跳周期就不出项；没盖住出 ok:true 的 warn 项，正文四项齐备', () => {
  const cfg = defaultConfig();
  assert.equal(cfg.review.heartbeat_stale_s, DEFAULT_HEARTBEAT_STALE_S, '缺省配置与出口句的缺省值同源');
  for (const s of [120, 30.5]) {
    cfg.review.heartbeat_stale_s = s;
    assert.equal(checkHeartbeatThreshold(cfg), null, `阈值 ${s} s 不出项`);
  }
  for (const s of [30, 29.5, 2]) {
    cfg.review.heartbeat_stale_s = s;
    const item = checkHeartbeatThreshold(cfg);
    assert.ok(item, `阈值 ${s} s 必须出项`);
    assert.equal(item!.name, '失联阈值');
    assert.equal(item!.ok, true, '只警告、不拒跑');
    assert.equal(item!.warn, true);
    assert.ok(item!.detail.startsWith('⚠️ '), item!.detail);
    // 生效阈值（按配置原值打印，非整数不取整）与心跳间隔
    assert.ok(item!.detail.includes(`review.heartbeat_stale_s = ${s} s，不大于工作进程的心跳间隔 30 s`), item!.detail);
    // 后果：每一轮越过阈值 ⇒ 被判失联；失联报错推荐 --cancel；照做结束健康轮次
    assert.match(item!.detail, /每一轮审查里它的未更新时长都会反复越过这个阈值/);
    // 等于间隔那一格按概率（判定是严格大于）：正文要说出「越接近越难碰上」，不把保守多告警写成必然（代码双审 r1 CODEX-01）
    assert.match(item!.detail, /阈值越接近 30 s，越过的时段越短、被轮询碰上的机会越小/);
    assert.match(item!.detail, /健康的工作进程也会被判失联/);
    assert.match(item!.detail, /失联报错会推荐 trivium review --cancel，照做会结束一个健康的轮次/);
    // 出口：调回缺省值以上；有意为之可忽略
    assert.ok(item!.detail.includes(`把阈值调回 ${DEFAULT_HEARTBEAT_STALE_S} 以上（缺省值）即可避免`), item!.detail);
    assert.match(item!.detail, /若是有意为之（比如构造失联的测试），可忽略这条/);
  }
});

test('EV-160 P1：阈值 2 s ⇒ 预检照常通过、退出码不变，「失联阈值」进 warnings，排在副本源之后、探活之前', async () => {
  const ctx = await fakeCtx(withStale(2));
  const r = await runPreflight({
    ctx, scope: 'plan', skipAuthCheck: true, critics: ['gemini'],
    adapters: { gemini: overrideOnly(await missingPath()) },
  });
  assert.equal(r.ok, true, '只警告、不拒跑');
  assert.equal(r.exitCode, EXIT.OK);
  assert.ok(r.warnings.some((w) => w.name === '失联阈值'), r.warnings.map((w) => w.name).join('、'));
  const idx = (pred: (n: string) => boolean) => r.checks.findIndex((c) => pred(c.name));
  const hb = idx((n) => n === '失联阈值');
  assert.ok(idx((n) => n.endsWith('模型覆盖副本源')) < hb, '副本源在前（与 startRun 的汇总顺序一致）');
  assert.ok(hb < idx((n) => n === '探活'), '排在探活之前：不花配额的项不该等到最贵的一项之后');
  assertWarnInvariant(r);
});

test('EV-160 P2：阈值 120 s（缺省）⇒ 不出「失联阈值」', async () => {
  const ctx = await fakeCtx(withStale(120));
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true, critics: ['gemini'], adapters: {} });
  assert.equal(r.ok, true);
  assert.equal(r.checks.some((c) => c.name === '失联阈值'), false);
  assertWarnInvariant(r);
});

test('EV-160 P3：预检侧的边界——30 s（等于间隔）出、30.5 s（略大于）不出', async () => {
  for (const [s, expected] of [[30, true], [30.5, false]] as const) {
    const ctx = await fakeCtx(withStale(s));
    const r = await runPreflight({ ctx, scope: 'all', skipAuthCheck: true, critics: ['gemini'], adapters: {} });
    assert.equal(r.warnings.some((w) => w.name === '失联阈值'), expected, `阈值 ${s} s`);
  }
});

test('EV-160 P4：前面有失败项（探针缺失）时不出——与 ④′ / ④″ 同一短路', async () => {
  const ctx = await fakeCtx((c) => {
    withStale(2)(c);
    c.probe.generated_at = null;
  });
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true, critics: ['gemini'], adapters: {} });
  assert.equal(r.ok, false, '前提：探针缺失即失败');
  assert.equal(r.checks.some((c) => c.name === '失联阈值'), false, '失败之后不再出只警告项');
});

// ── 两个空配置项收口（EV-30 ① / EV-15）：已废弃键只在预检与 doctor 提示一条（计划 r2 §3.3 / §3.6 U5、U6） ──

/** 往合并后的配置里放已废弃键（模拟磁盘源写了它们） */
const withDeprecated = (opts: { gate?: boolean; agents?: boolean }) => (c: Config): void => {
  const raw = c as unknown as { gate: Record<string, unknown>; agents: Record<string, Record<string, unknown>> };
  if (opts.gate) raw.gate['max_check_retries'] = 3;
  if (opts.agents) raw.agents['gemini']!['readonly_commands'] = ['git log', 'ls'];
};

test('U5 预检：带已废弃键 ⇒ 照常通过、退出码不变，「已废弃配置键」进 warnings、以 ⚠️ 起头，排在失联阈值之后与模型 slug 之前', async () => {
  const ctx = await fakeCtx((c) => {
    withStale(2)(c);
    withDeprecated({ gate: true, agents: true })(c);
  });
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true, critics: ['gemini'], adapters: {} });
  assert.equal(r.ok, true, '只警告、不拒跑');
  assert.equal(r.exitCode, EXIT.OK);
  const w = r.warnings.find((x) => x.name === '已废弃配置键');
  assert.ok(w, r.warnings.map((x) => x.name).join('、'));
  assert.ok(w.detail.startsWith('⚠️ '), w.detail);
  assert.ok(w.detail.includes('gate.max_check_retries、agents.gemini.readonly_commands'), w.detail);
  const idx = (name: string) => r.checks.findIndex((c) => c.name === name);
  assert.ok(idx('失联阈值') >= 0 && idx('失联阈值') < idx('已废弃配置键'), '排在失联阈值之后');
  assert.ok(idx('模型 slug 合法') < idx('已废弃配置键'), '参数检查先于环境告警');
  assertWarnInvariant(r);
});

test('U5′ 预检：不带已废弃键 ⇒ 不出该项；checkDeprecatedConfigKeys 对缺省配置返回 null', async () => {
  assert.equal(checkDeprecatedConfigKeys(defaultConfig()), null);
  // 前提与 EV-160 P2 相同：探针齐备、阈值缺省，预检能走到 ④⁗
  const ctx = await fakeCtx(withStale(120));
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true, critics: ['gemini'], adapters: {} });
  assert.equal(r.ok, true);
  assert.equal(r.checks.some((c) => c.name === '已废弃配置键'), false);
  assertWarnInvariant(r);
});

/** doctor 只跑环境段：不碰任何审查员 CLI，也不花配额 */
async function doctorEnvOnly(cfg: Config): Promise<Awaited<ReturnType<typeof runDoctor>>> {
  const root = await scratchDir('trivium-dep-');
  const triviumDir = path.join(root, TRIVIUM_DIR);
  await fs.mkdir(triviumDir, { recursive: true });
  return runDoctor({ config: cfg, projectRoot: root, triviumDir, only: 'env', skipModelCalls: true });
}

test('U6 doctor：带两键 ⇒ warnings 含正文、阻断不受影响；只带一键 ⇒ 正文只列该键；不带 ⇒ 不含', async () => {
  const base = await doctorEnvOnly(defaultConfig());
  assert.equal(base.warnings.some((w) => w.includes('已废弃的键')), false, '不带两键不该提示');

  const both = defaultConfig();
  withDeprecated({ gate: true, agents: true })(both);
  const r2 = await doctorEnvOnly(both);
  const n2 = r2.warnings.filter((w) => w.includes('已废弃的键'));
  assert.equal(n2.length, 1, '只提示一条');
  assert.ok(n2[0]!.includes('gate.max_check_retries、agents.gemini.readonly_commands'), n2[0]);
  assert.ok(!n2[0]!.startsWith('⚠'), '正文不带 ⚠️——人读出口 warn() 自带');
  assert.deepEqual(r2.blockers, base.blockers, '提示不得改变阻断项');

  const one = defaultConfig();
  withDeprecated({ gate: true })(one);
  const r1 = await doctorEnvOnly(one);
  const n1 = r1.warnings.find((w) => w.includes('已废弃的键'));
  assert.ok(n1, '只带一键也要提示');
  assert.ok(n1.includes('已废弃的键：gate.max_check_retries。'), n1);
  assert.ok(!n1.includes('readonly_commands'), `没写的键不得出现：${n1}`);
});

/** EV-227（M12 批次 4）：档位表 Agent 级 effort；`cell` 同时放一个阶段格子 {model, effort}（不该被报） */
const withAgentLevelEffort = (cell: boolean) => (c: Config): void => {
  const raw = c as unknown as { profiles: Record<string, Record<string, Record<string, unknown>>> };
  raw.profiles['default']!['gemini']!['effort'] = 'high';
  if (cell) raw.profiles['default']!['glm']!['plan'] = { model: 'GLM-5.3', effort: 'high' };
};

test('U5″ 预检：带档位表 Agent 级 effort（EV-227）⇒ 照常通过、退出码不变，「已废弃配置键」点名它、不点名阶段格子', async () => {
  const ctx = await fakeCtx((c) => {
    withStale(120)(c);
    withAgentLevelEffort(false)(c);
  });
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true, critics: ['gemini'], adapters: {} });
  assert.equal(r.ok, true, '只警告、不拒跑');
  assert.equal(r.exitCode, EXIT.OK);
  const w = r.warnings.find((x) => x.name === '已废弃配置键');
  assert.ok(w, r.warnings.map((x) => x.name).join('、'));
  assert.ok(w.detail.startsWith('⚠️ '), w.detail);
  assert.ok(w.detail.includes('已废弃的键：profiles.default.gemini.effort。'), w.detail);
  assertWarnInvariant(r);
});

test('U6′ doctor：带档位表 Agent 级 effort（EV-227）⇒ 恰一条提示、只点名 Agent 级、阻断不变', async () => {
  const base = await doctorEnvOnly(defaultConfig());
  const cfg = defaultConfig();
  withAgentLevelEffort(true)(cfg);
  const r = await doctorEnvOnly(cfg);
  const n = r.warnings.filter((w) => w.includes('已废弃的键'));
  assert.equal(n.length, 1, '只提示一条');
  assert.ok(n[0]!.includes('已废弃的键：profiles.default.gemini.effort。'), n[0]);
  assert.ok(!n[0]!.includes('glm'), `阶段格子的 effort 不得出现：${n[0]}`);
  assert.deepEqual(r.blockers, base.blockers, '提示不得改变阻断项');
});

/*
 * EV-240 方案 A（M12 批次 5，用户 D-11；计划 r2 §2.3 / §4 U6）：共享读取面同名入口只告警、不阻断，
 * 只看本轮 Driver ∪ 入选审核者里登记了额外读取根的那几家。家目录一律注入夹具。
 * 读/不读共享根的家经注册表派生，不写死是哪几家。
 */
const sharedReader = AGENTS.find((a) => a.entrySkillExtraReadRoots.length > 0 && a.driverEnabled && a.criticEnabled)!;
const nonReader = AGENTS.find((a) => a.entrySkillExtraReadRoots.length === 0 && a.criticEnabled && a.id !== DEFAULT_DRIVER)!;

async function dirtySharedHome(): Promise<string> {
  const home = await scratchDir('trivium-pf-shared-');
  const d = path.join(home, sharedReader.entrySkillExtraReadRoots[0]!, 'dual-run');
  await fs.mkdir(d, { recursive: true });
  await fs.writeFile(path.join(d, 'SKILL.md'), '---\nname: dual-run\n---\n别家的\n');
  return home;
}

test('U6 checkSharedReadRoots：相关家都不读共享根 ⇒ null；有一家读 ⇒ 一条 warn、ok 为真、无退出码；干净 ⇒ null', async () => {
  const dirty = await dirtySharedHome();
  const clean = await scratchDir('trivium-pf-shared-');
  assert.equal(await checkSharedReadRoots([DEFAULT_DRIVER, nonReader.id], { home: dirty, env: {} }), null,
    '本轮没有读共享根的家：与本轮无关，不出项');
  const hit = await checkSharedReadRoots([DEFAULT_DRIVER, sharedReader.id], { home: dirty, env: {} });
  assert.ok(hit);
  assert.equal(hit.ok, true);
  assert.equal(hit.warn, true);
  assert.equal(hit.exitCode, undefined);
  assert.equal(hit.name, '共享读取面同名入口');
  assert.ok(hit.detail.startsWith('⚠️ 共享读取面 ~/'), hit.detail);
  // 预检侧不传场合词，结尾仍是「本次预检」（EV-246 给 `--start` 加了场合参数，缺省值不能漂）
  assert.ok(hit.detail.endsWith('（不影响本次预检）'), hit.detail);
  assert.ok(hit.detail.includes(sharedReader.display), hit.detail);
  assert.ok(!hit.detail.includes(dirty), hit.detail);
  assert.equal(await checkSharedReadRoots([DEFAULT_DRIVER, sharedReader.id], { home: clean, env: {} }), null);
});

test('U6c checkSharedReadRoots：扫描出错 ⇒ 退化为一条告警，场合词同样取参数（缺省「本次预检」，`--start` 传「本次运行」）', async () => {
  /*
   * 代码双审 GLM-01：catch 分支也插值了场合词，此前没有用例走到它。扫描对文件系统异常很宽容（`exists`、`readdir` 都吞错），
   * 造不出抛错；注入口的 `home` 传非字符串时，`sharedReadRootTargets` 在 try 之内拼路径就抛 TypeError，稳定走到 catch。
   */
  const broken = { home: 42 as unknown as string, env: {} };
  for (const [occasion, args] of [['本次预检', []], ['本次运行', ['本次运行']]] as const) {
    const r = await checkSharedReadRoots([DEFAULT_DRIVER, sharedReader.id], broken, ...args);
    assert.ok(r);
    assert.equal(r.ok, true, '扫描出错不能把预检 / --start 变成失败');
    assert.equal(r.warn, true);
    assert.equal(r.exitCode, undefined);
    assert.equal(r.name, '共享读取面同名入口');
    assert.ok(r.detail.startsWith(`⚠️ 共享读取面检查没做成（不影响${occasion}）：`), r.detail);
  }
});

test('U6 预检：Driver 读共享根而审核者不读 ⇒ 照样出一项（Driver 算相关）；照常通过、退出码不变、进 warnings', async () => {
  const dirty = await dirtySharedHome();
  const ctx = await fakeCtx(withStale(120));
  const r = await runPreflight({
    ctx, scope: 'plan', skipAuthCheck: true, critics: [nonReader.id as CriticId], adapters: {},
    driver: sharedReader.id, entryScanEnv: { home: dirty, env: {} },
  });
  assert.equal(r.ok, true, '只警告、不拒跑');
  assert.equal(r.exitCode, EXIT.OK);
  assert.ok(r.warnings.some((w) => w.name === '共享读取面同名入口'), r.warnings.map((w) => w.name).join('、'));
  const idx = (name: string) => r.checks.findIndex((c) => c.name === name);
  assert.ok(idx('失联阈值') < idx('共享读取面同名入口'), '排在只告警项之后');
  assert.ok(idx('共享读取面同名入口') < idx('归档与 git 可用'), '排在 ⑥ 之前');
  assertWarnInvariant(r);
});

test('U6 预检：缺省 Driver + 只选不读共享根的审核者 ⇒ 共享根再脏也不出项', async () => {
  const dirty = await dirtySharedHome();
  const ctx = await fakeCtx(withStale(120));
  const r = await runPreflight({
    ctx, scope: 'plan', skipAuthCheck: true, critics: [nonReader.id as CriticId], adapters: {},
    entryScanEnv: { home: dirty, env: {} },
  });
  assert.equal(r.ok, true);
  assert.equal(r.checks.some((c) => c.name === '共享读取面同名入口'), false);
});

// ─────────────── 共享根残留（主题 M12-共享根残留检测，计划 r2 §4 U8） ───────────────

/** 共享根里只有 10-16 形态的运行时拷贝、没有同名入口 */
async function residueSharedHome(): Promise<string> {
  const home = await scratchDir('trivium-pf-shared-');
  const d = path.join(home, sharedReader.entrySkillExtraReadRoots[0]!, 'dual-critic');
  await fs.mkdir(path.join(d, 'schema'), { recursive: true });
  await fs.mkdir(path.join(d, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(d, 'SKILL.md'), '---\nname: dual-critic\ndescription: 过时的拷贝\n---\n');
  return home;
}

test('U8 共享根只有残留：只看本轮相关的家，出项时只告警、ok 为真、无退出码', async () => {
  const home = await residueSharedHome();
  assert.equal(await checkSharedReadRoots([DEFAULT_DRIVER, nonReader.id], { home, env: {} }), null,
    '本轮没有读共享根的家：不出项');
  const hit = await checkSharedReadRoots([DEFAULT_DRIVER, sharedReader.id], { home, env: {} });
  assert.ok(hit);
  assert.equal(hit.ok, true);
  assert.equal(hit.warn, true);
  assert.equal(hit.exitCode, undefined);
  assert.ok(hit.detail.includes('份本产品的历史拷贝'), hit.detail);
  assert.ok(!hit.detail.includes('同名入口，'), hit.detail);
  assert.ok(!hit.detail.includes(home), hit.detail);
  assert.ok(await checkSharedReadRoots([sharedReader.id, nonReader.id], { home, env: {} }), 'Driver 读共享根同样算相关');
});

test('U8 预检：共享根只有残留、本轮 Driver 读它 ⇒ 照常通过、退出码不变、进 warnings', async () => {
  const home = await residueSharedHome();
  const ctx = await fakeCtx(withStale(120));
  const r = await runPreflight({
    ctx, scope: 'plan', skipAuthCheck: true, critics: [nonReader.id as CriticId], adapters: {},
    driver: sharedReader.id, entryScanEnv: { home, env: {} },
  });
  assert.equal(r.ok, true, '只警告、不拒跑');
  assert.equal(r.exitCode, EXIT.OK);
  const w = r.warnings.find((x) => x.name === '共享读取面同名入口');
  assert.ok(w, r.warnings.map((x) => x.name).join('、'));
  assert.ok(w.detail.includes('份本产品的历史拷贝'), w.detail);
  assertWarnInvariant(r);
});

}
