import { test } from 'node:test';
import { modelEncodesEffort } from '../../src/trivium/adapters/agy.js';
import assert from 'node:assert/strict';
import {
  checkEvidence,
  checkPeerLeak,
  resolveTier,
  isHeterogeneous,
  failedResult,
} from '../../src/trivium/adapters/base.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { selectableCritics } from '../../src/trivium/critics.js';
import { DEFAULT_CRITICS } from '../../src/trivium/types.js';
import {
  AGENTS,
  DEFAULT_DRIVER,
  DRIVER_AGENT_IDS,
  VENDOR_MODEL_FAMILY,
  agentById,
  type AgentVendor,
} from '../../src/trivium/agents/registry.js';

const REQ = {
  min_tool_calls: 5,
  min_project_reads: 3,
  subject_path: '/proj/.reviews/t/plan/2026-09-10-t-claude.md',
  brief_path: '/proj/.reviews/t/plan/_meta/brief-gemini-R1.md',
  project_root: '/proj',
};
const OPTS = { archiveRootAbs: '/proj/.reviews' };

test('项目文件读取只算项目根之内的：读 ~/ 下的无关文件不能凑数（AC-11）', () => {
  const r = checkEvidence(
    {
      tool_calls: { read: 6, grep: 2 },
      read_paths: ['/Users/x/.zshrc', '/etc/hosts', '/proj/src/a.ts', './src/b.ts', REQ.subject_path],
      trace_path: '/runs/trace.jsonl',
      command_texts: [],
    },
    REQ,
    OPTS,
  );
  assert.equal(r.projectReads, 2, '只有 /proj/src/a.ts 与 ./src/b.ts 算项目内读取');
});

test('禁读核对做路径归一化：./ 前缀、.. 与 macOS 的 /private 前缀都能命中', () => {
  const deny = ['.reviews/t/plan/2026-09-10-t-glm.md'];
  const r = checkPeerLeak(
    ['./.reviews/t/plan/2026-09-10-t-glm.md', '/private/proj/src/../.reviews/t/plan/2026-09-10-t-glm.md'],
    deny,
    '/proj',
  );
  assert.equal(r.leaked, true);
  assert.equal(r.hits.length, 2);
  assert.equal(checkPeerLeak(['/proj/src/a.ts'], deny, '/proj').leaked, false);
});

test('证据充分时通过', () => {
  const r = checkEvidence(
    {
      tool_calls: { read: 6, grep: 2 },
      read_paths: ['/proj/src/a.ts', '/proj/src/b.ts', '/proj/doc/x.md', REQ.subject_path],
      trace_path: '/runs/trace.jsonl',
      command_texts: [],
    },
    REQ,
    OPTS,
  );
  assert.equal(r.ok, true, r.reasons.join('; '));
  assert.equal(r.projectReads, 3);
});

test('零工具调用判 no_trace（Antigravity 软拒绝的表现，AC-05 落点）', () => {
  const r = checkEvidence(
    { tool_calls: {}, read_paths: [], trace_path: null, command_texts: [] },
    REQ,
    OPTS,
  );
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => x.startsWith('no_trace')));
});

test('工具调用数不足下限判 insufficient_evidence', () => {
  const r = checkEvidence(
    { tool_calls: { read: 2 }, read_paths: ['/proj/src/a.ts'], trace_path: 't', command_texts: [] },
    REQ,
    OPTS,
  );
  assert.ok(r.reasons.some((x) => x.startsWith('insufficient_evidence')));
});

test('把 BRIEF 与被审对象反复读也过不了项目文件下限（AC-11 的防绕过）', () => {
  const r = checkEvidence(
    {
      // 工具调用总数达标，但读的全是送审材料自己
      tool_calls: { read: 10 },
      read_paths: [REQ.subject_path, REQ.brief_path],
      trace_path: 't',
      command_texts: [],
    },
    REQ,
    OPTS,
  );
  assert.equal(r.ok, false);
  assert.equal(r.projectReads, 0);
  assert.ok(r.reasons.some((x) => x.startsWith('no_project_context')));
});

test('归档根内的文件不计入项目上下文', () => {
  const r = checkEvidence(
    {
      tool_calls: { read: 8 },
      read_paths: [
        '/proj/.reviews/t/plan/2026-09-10-t-gemini.md',
        '/proj/.reviews/t/task.json',
        '/proj/src/only-one.ts',
      ],
      trace_path: 't',
      command_texts: [],
    },
    REQ,
    OPTS,
  );
  assert.equal(r.projectReads, 1, '只有 src/only-one.ts 算项目上下文');
});

test('轨迹核验：绝对路径与相对路径两种形态都能命中禁读清单（AC-04）', () => {
  const deny = ['.reviews/t/plan/2026-09-10-t-glm.md', '.env'];
  const abs = checkPeerLeak(['/proj/.reviews/t/plan/2026-09-10-t-glm.md'], deny, '/proj');
  assert.equal(abs.leaked, true);
  assert.deepEqual(abs.hits, ['/proj/.reviews/t/plan/2026-09-10-t-glm.md']);

  const rel = checkPeerLeak(['.env'], deny, '/proj');
  assert.equal(rel.leaked, true);
});

test('轨迹核验：读己方产出不算泄漏', () => {
  const deny = ['.reviews/t/plan/2026-09-10-t-glm.md'];
  const r = checkPeerLeak(
    ['/proj/.reviews/t/plan/2026-09-10-t-gemini.md', '/proj/src/a.ts'],
    deny,
    '/proj',
  );
  assert.equal(r.leaked, false);
});

/*
 * 原「四级优先级：命令行 > 主题 > profile」。主题级覆盖规范有、实现从未接线，v1.3.129 从规范删除、
 * M11 第 4 步随 routeModel 一并删去（EV-226），这里改为三级的等价断言：命令行优先于档位表格子。
 */
test('模型路由：命令行 > 档位表格子（裸 slug）', () => {
  const cfg = defaultConfig();
  const cli = resolveTier(cfg, 'gemini', 'plan', { model: 'X' });
  assert.equal(cli.model, 'X');
  // 裸 slug 只提供 model，被命令行全覆盖 ⇒ override（设计 11.5，计划三审 AGY-01）
  assert.equal(cli.tierSource, 'override');
  const legacy = resolveTier(cfg, 'gemini', 'plan');
  assert.equal(legacy.model, 'gemini-3.8-flash-high');
  assert.equal(legacy.tierSource, 'legacy');
  assert.equal(resolveTier(cfg, 'glm', 'code').model, 'GLM-5.3');
});

test('模型路由：档位表缺该阶段时返回 null 而非瞎猜', () => {
  const cfg = defaultConfig();
  cfg.profiles['bare'] = { gemini: {} };
  cfg.active_profile = 'bare';
  const r = resolveTier(cfg, 'gemini', 'plan');
  assert.equal(r.model, null);
  assert.equal(r.tierSource, null);
  assert.equal(r.missingTier, null);
});

test('异构判定：Driver 为 anthropic 时 Claude 系为同源（FR-17 / AC-18）', () => {
  assert.equal(isHeterogeneous('gemini-3.1-pro-high', 'anthropic'), true);
  assert.equal(isHeterogeneous('GLM-5.3', 'anthropic'), true);
  assert.equal(isHeterogeneous('claude-sonnet-4-6', 'anthropic'), false);
  assert.equal(isHeterogeneous('claude-opus-4-6-thinking', 'anthropic'), false);
  assert.equal(isHeterogeneous(null, 'anthropic'), true);
});

const NON_ANTHROPIC: readonly AgentVendor[] = ['openai', 'antigravity', 'zcode'];

test('EV-62：Driver 非 anthropic 时，claude 系模型不再判同源', () => {
  /*
   * EV-62 原文那一格：Driver 不是 claude，审核者用 claude 系模型时旧判据判「与主脑同源」，
   * 而主脑根本不是 claude。按当轮 Driver 的厂商名义族判定后，这一格判异构。
   */
  for (const v of NON_ANTHROPIC) {
    assert.equal(
      isHeterogeneous('claude-sonnet-4-6', v), true,
      `Driver 厂商为 ${v} 时，claude 系审核者模型不应判同源——主脑不是 claude`,
    );
  }
});

test('EV-62：Driver 非 anthropic 时，其厂商名义族判同源', () => {
  /*
   * 这几格也防「非 anthropic 一律判异构」那种退化（计划 r1 初稿的方案）：
   * 那样实现时前三格全是 true。最后一格是跨族对照，防反向退化成「一律判同族」。
   * 名义族是启发式（见 `VENDOR_MODEL_FAMILY` 的文档块），这里测的是判据本身，不是厂商事实。
   */
  assert.equal(isHeterogeneous('gemini-3.8-flash-high', 'antigravity'), false);
  assert.equal(isHeterogeneous('GLM-5.3', 'zcode'), false);
  assert.equal(isHeterogeneous('gpt-5.2', 'openai'), false);
  assert.equal(isHeterogeneous('GLM-5.3', 'antigravity'), true, '跨族：GLM 模型对 antigravity 名义族应判异构');
});

test('EV-62：VENDOR_MODEL_FAMILY 与注册表厂商集同一', () => {
  /*
   * 「每个厂商都有条目」由 `Record<AgentVendor, …>` 在编译期保证；本条补的是反方向：
   * 映射里不留注册表已经不用的厂商键（`AgentVendor` 联合类型比注册表实际用到的宽时会出现）。
   */
  assert.deepEqual(
    Object.keys(VENDOR_MODEL_FAMILY).sort(),
    [...new Set(AGENTS.map((a) => a.vendor))].sort(),
  );
});

/*
 * **锚到 `DEFAULT_CRITICS`，不再硬写 gemini / glm 两家**（M9 第 4 步，计划 §5.2）。
 *
 * AC-18 的原文锚点是「未显式覆盖时，**两边所用模型**均与主脑不同源」——
 * 主语是「本次实际会跑的那几侧」，也就是缺省入选集合，不是 profile 表里有哪些键。
 * 本步给 `profiles.*` 加了 `claude` 键（它恒为 Claude 系），硬写两家的旧断言
 * 恰好照常绿，于是用例名会开始说谎：默认 profile 从此有四个键、其中一个同源。
 *
 * 改锚是**加强**：`DEFAULT_CRITICS` 由注册表 `defaultSelected` 派生，
 * 哪天有人把 claude 标成缺省入选，这条当场红——而那正是 AC-18 要防的事。
 * 旧写法对那次改动完全失明。
 *
 * 缺省集合当前是 **codex / gemini / glm 三家**（`defaultSelected: true` 三处）。
 * 计划原稿曾写成「gemini / glm 两家」——那是一处失实断言，本步一并改正：
 * 三家都非 Claude 系，AC-18 第一句继续成立。
 */
test('缺省入选的各侧默认模型互不相同且均为非 Claude 系（AC-18）', () => {
  const cfg = defaultConfig();
  assert.ok(DEFAULT_CRITICS.length >= 2, '缺省集合至少两家，否则「两边」无从谈起');

  for (const stage of ['plan', 'code', 'bug'] as const) {
    const models = DEFAULT_CRITICS.map((c) => {
      const m = resolveTier(cfg, c, stage).model;
      assert.ok(m, `${stage} 的 ${c} 侧应有默认模型——取不到会在 review.ts 直接抛 envError`);
      // `DEFAULT_CRITICS` 只对缺省 Driver 成立（非缺省 Driver 下缺省选侧会退 64），故厂商取缺省 Driver
      assert.equal(
        isHeterogeneous(m, agentById(DEFAULT_DRIVER)!.vendor), true,
        `${stage} 的 ${c} 侧是 Claude 系（${m}）：缺省入选里出现与主脑同源的模型即违反 AC-18`,
      );
      return m;
    });
    assert.equal(
      new Set(models).size, models.length,
      `${stage} 的缺省各侧默认模型不应相同——相同模型 + 相同镜头只是把成本乘二；实得 ${models.join('、')}`,
    );
  }
});

/*
 * **AC-18 逐 Driver**（EV-62，M10a 第 4 步）。
 *
 * AC-18 的「主脑」今天可以是任一家；上一条只对缺省 Driver 成立。
 * 论域用「每家 Driver 可选的每个审核者」，不用缺省选侧：非缺省 Driver 在内置配置下
 * 缺省选侧含它自己，`resolveCriticSelection` 会退 64，而不是把它剔除。
 *
 * 本条同时咬住「判据退回不感知 Driver」：非 claude 的 Driver 下 claude 审核者可选，
 * 其默认模型是 claude 系，退回旧判据时会判同源。它也守内置配置：
 * 哪天某家默认模型改成与某个 Driver 的名义族同族，这里会红——那时停下来看，别改断言去凑。
 */
test('AC-18 逐 Driver：每家 Driver 可选的每个审核者，档位默认模型都不落在该 Driver 的名义模型族', () => {
  const cfg = defaultConfig();
  const profiles = Object.keys(cfg.profiles);
  assert.ok(profiles.length > 0, '内置配置至少一个档位，否则本条空转');
  let checked = 0;
  for (const p of profiles) {
    cfg.active_profile = p;
    for (const driver of DRIVER_AGENT_IDS) {
      const vendor = agentById(driver)!.vendor;
      for (const c of selectableCritics(cfg, driver)) {
        for (const stage of ['plan', 'code', 'bug'] as const) {
          const m = resolveTier(cfg, c, stage).model;
          assert.ok(m, `档位 ${p} 的 ${c} 侧 ${stage} 应有默认模型`);
          assert.equal(
            isHeterogeneous(m, vendor), true,
            `档位 ${p}、Driver ${driver}（${vendor}）下，${c} 侧 ${stage} 的默认模型 ${m} 落在该 Driver 的名义模型族里`,
          );
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 0, '一格都没核到：论域为空，本条空转');
});

/*
 * **claude 侧的模型路由取得到值**（M9 第 4 步，计划 §7 的 V5）。
 *
 * 它不在上一条的论域里（`defaultSelected: false`，不进缺省集合），
 * 但第 5 步 `--driver` 落地后它就会被真跑。档位解析（原 `routeModel`）取不到值时
 * `review.ts:686` 直接抛 `envError`，而那要等到运行时才现形——
 * 第 ⑥ 件（模型路由）漏配的后果就是这个，所以在这里先钉住。
 *
 * 顺带锁住 default 与 flash **不同**：两档同值会让 flash 在 claude 侧形同虚设
 * （计划双审 CODEX-05）。
 */
test('claude 侧三阶段在两档下都有模型，且两档取值不同（第 ⑥ 件）', () => {
  const cfg = defaultConfig();
  for (const stage of ['plan', 'code', 'bug'] as const) {
    cfg.active_profile = 'default';
    const d = resolveTier(cfg, 'claude', stage).model;
    cfg.active_profile = 'flash';
    const f = resolveTier(cfg, 'claude', stage).model;
    assert.ok(d && f, `${stage}：两档都要取得到值，否则 review.ts 会在运行时抛 envError`);
    assert.notEqual(
      d, f,
      `${stage}：flash 档与 default 档取值相同，flash 在 claude 侧就形同虚设（另两家都真换了一档）`,
    );
  }
});

test('失败结果构造：evidence_ok 恒为 false，字段不漏', () => {
  const r = failedResult('glm', { status: 'timeout', reason: '超时', exitCode: null, durationS: 1200 });
  assert.equal(r.critic, 'glm');
  assert.equal(r.status, 'timeout');
  assert.equal(r.evidence_ok, false);
  assert.equal(r.review_json, null);
  assert.equal(r.model_effective_source, 'unverified');
  assert.equal(r.peer_deny_applied, false);
  assert.equal(r.fail_reason, '超时');
});

// ── agy 的 --effort 与模型 slug 冲突（坑 P-16，实测踩到）──

test('模型 slug 自带档位时不再传 --effort', () => {
  // agy 1.2.0：`--model gemini-3.8-flash-high --effort medium` 会被直接拒绝
  assert.equal(modelEncodesEffort('gemini-3.8-flash-high'), true);
  assert.equal(modelEncodesEffort('gemini-3.1-pro-low'), true);
  assert.equal(modelEncodesEffort('gpt-oss-120b-medium'), true);
});

test('不带档位的 slug 仍需要 --effort', () => {
  assert.equal(modelEncodesEffort('claude-sonnet-4-6'), false);
  assert.equal(modelEncodesEffort('claude-opus-4-6-thinking'), false);
  assert.equal(modelEncodesEffort(null), false);
});

test('档位只认结尾，中间出现 high/low 不算', () => {
  assert.equal(modelEncodesEffort('gemini-high-pro'), false);
  assert.equal(modelEncodesEffort('some-lowercase'), false);
});
