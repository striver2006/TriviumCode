/**
 * 注册表对账（计划 §2.1）。
 *
 * 两类断言：
 *   1. **派生一致性**：types 的三张表、命名正则、前缀正则全部与注册表逐项相符；
 *   2. **grep 级对账**：`src/` 下除注册表与适配器外，不得出现具体 Agent 字面量。
 *
 * 第 2 类是本文件存在的主要理由。计划审查（run 20260913T115435Z）两侧合计
 * 查出 12 处硬编码，其中 8 处是我在原稿里自称「已补全」之后才被审出来的——
 * 人工清单维持不住完整性，因此完整性改由机器对账保证：新写的字面量当场红，
 * 而不是等到接入第五家 Agent 时以难定位的故障复现。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  AGENTS,
  ALL_AGENT_IDS,
  ALL_FINDING_PREFIXES,
  CRITIC_AGENT_IDS,
  DEFAULT_CRITIC_AGENT_IDS,
  DEFAULT_DRIVER,
  DEFAULT_MAX_CRITICS,
  deriveDefaultCritics,
  type AgentDescriptor,
  agentByFindingId,
  agentByFindingPrefix,
  agentById,
  findingPrefixAlternation,
  isAgentId,
  suffixAlternation,
} from '../../src/trivium/agents/registry.js';
import { CRITICS, CRITIC_PREFIX, CRITIC_VENDOR } from '../../src/trivium/types.js';
// 第 5 条的 import 禁令只管 `adapters/` 不得引用 `probes/`，不管测试——
// 反向对账必须拿到探针的常量本体，否则「黑名单跟不上探针新增项」这个方向守不住。
import { READONLY_INVARIANTS } from '../../src/trivium/probes/claude.js';
import { CODEX_READONLY_INVARIANTS } from '../../src/trivium/probes/codex.js';
import { validateRunMeta } from '../../src/trivium/schemas.js';
import { looksLikeRoleArtifact, parseArtifactName } from '../../src/trivium/naming.js';
import { isFallbackId } from '../../src/trivium/disposition.js';
import { REPO_ROOT } from '../helpers/fixture.js';

// ─────────────────────── 1. 注册表自身的不变式 ───────────────────────

test('注册表：id / 后缀 / 前缀三者互不重复，且 suffix 恒等于 id', () => {
  const ids = new Set(AGENTS.map((a) => a.id));
  const suffixes = new Set(AGENTS.map((a) => a.suffix));
  const prefixes = new Set(AGENTS.map((a) => a.findingPrefix));

  assert.equal(ids.size, AGENTS.length, 'Agent id 有重复');
  assert.equal(suffixes.size, AGENTS.length, '归档后缀有重复');
  assert.equal(prefixes.size, AGENTS.length, '意见前缀有重复——两家共用前缀会让来源反推失效');

  for (const a of AGENTS) {
    assert.equal(a.suffix, a.id, `${a.id} 的 suffix 必须等于 id`);
  }
});

/*
 * ── 缺省入选集合的两条不变量（r12 CODEX-05）──
 *
 * 这两条守卫在 `deriveDefaultCritics` 里，而真实注册表**恰好都满足**它们——
 * 于是「守卫在不在」与「守卫守得对不对」在生产路径上无法区分。
 * 下面用构造的注册表逐条把它们撞红一次：这正是本项目「加了守卫不等于守卫守对了东西」
 * 这条纪律要求的验证，也是 r12 AGY-01 那类失效（守卫还在、守的东西没了）的预防。
 */
const FAKE_AGENT = (over: Partial<AgentDescriptor>): AgentDescriptor => ({
  id: 'claude',
  display: 'x',
  label: 'x',
  vendor: 'anthropic',
  cliName: 'x',
  suffix: 'claude',
  findingPrefix: 'X',
  criticEnabled: true,
  defaultSelected: true,
  driverEnabled: false,
  guardLevel: 'L2',
  hookConfigTarget: null,
  instructionFiles: [],
  criticReadsInstructionFiles: true,
  entrySkillRoot: { homeRel: '.x', skillsRel: 'skills' },
  entryInvocation: '/{name}',
  entrySkillExtraReadRoots: [],
  ...over,
});

test('缺省集合：defaultSelected 真被消费——标了就进集合，没标就不进', () => {
  const picked = deriveDefaultCritics([
    FAKE_AGENT({ id: 'claude', suffix: 'claude', defaultSelected: true }),
    FAKE_AGENT({ id: 'codex', suffix: 'codex', defaultSelected: false }),
    FAKE_AGENT({ id: 'gemini', suffix: 'gemini', defaultSelected: true }),
  ]);
  assert.deepEqual(
    [...picked],
    ['claude', 'gemini'],
    'defaultSelected 必须是唯一判据——派生若改回按 criticEnabled 取，这里会多出 codex',
  );
});

test('缺省集合：标了 defaultSelected 却没 criticEnabled → 加载期抛错', () => {
  assert.throws(
    () => deriveDefaultCritics([FAKE_AGENT({ criticEnabled: false, defaultSelected: true })]),
    /defaultSelected 却没有 criticEnabled/,
    '这种组合会让默认配置一跑就被 critics.ts 拒掉，必须在登记处拦下',
  );
});

test('缺省集合：项数超过 max_critics 内置默认 → 加载期抛错', () => {
  const four = (['claude', 'codex', 'gemini', 'glm'] as const).map((id) =>
    FAKE_AGENT({ id, suffix: id, defaultSelected: true }),
  );
  assert.throws(
    () => deriveDefaultCritics(four, DEFAULT_MAX_CRITICS),
    /超过内置上限 max_critics=3/,
    '越界现场本该在这里，而不是「每个项目 init 出来的配置都判错」',
  );
  // 同一份注册表，把上限抬上去就该通过——锁住「抬上限」确实是那条出路
  assert.equal(deriveDefaultCritics(four, 4).length, 4, '抬高上限后应当放行');
});

test('缺省集合：真实注册表当前未顶满上限时，仍要留有明确记录', () => {
  assert.ok(
    DEFAULT_CRITIC_AGENT_IDS.length <= DEFAULT_MAX_CRITICS,
    '真实注册表必须满足上限——这条是上面构造用例的生产侧对照',
  );
});

test('注册表：意见前缀不得互为前缀', () => {
  /*
   * `agentByFindingId` 按第一个连字符切分，因此前缀本身不含连字符即可区分。
   * 但若某天出现 `GLM` 与 `GLMX` 这类，人读编号时仍会混淆，提前拦住。
   */
  for (const a of AGENTS) {
    assert.ok(!a.findingPrefix.includes('-'), `${a.id} 的前缀不得含连字符`);
    for (const b of AGENTS) {
      if (a.id === b.id) continue;
      assert.ok(
        !b.findingPrefix.startsWith(a.findingPrefix),
        `前缀 ${b.findingPrefix} 以 ${a.findingPrefix} 开头，会造成来源反推歧义`,
      );
    }
  }
});

test('注册表：默认 Driver 必须是已登记且允许作 Driver 的 Agent', () => {
  const d = agentById(DEFAULT_DRIVER);
  assert.ok(d, '默认 Driver 未登记');
  assert.equal(d!.driverEnabled, true, '默认 Driver 的 driverEnabled 为假');
});

// ─────────────────────── 2. 派生表与注册表一致 ───────────────────────

test('派生：types 的 CRITICS / CRITIC_VENDOR / CRITIC_PREFIX 与注册表逐项相符', () => {
  assert.deepEqual([...CRITICS], [...CRITIC_AGENT_IDS]);

  for (const c of CRITICS) {
    const a = agentById(c)!;
    assert.equal(CRITIC_VENDOR[c], a.vendor, `${c} 的 vendor 不一致`);
    assert.equal(CRITIC_PREFIX[c], a.findingPrefix, `${c} 的意见前缀不一致`);
  }
});

test('派生：工件名正则认全部已登记后缀', () => {
  for (const id of ALL_AGENT_IDS) {
    const parsed = parseArtifactName(`2026-09-13-某主题-${id}.md`);
    assert.ok(parsed, `工件名解析不认后缀 ${id}——该 Agent 的历史留痕会对解析器整体不可见`);
    assert.equal(parsed!.role, id);
    assert.ok(looksLikeRoleArtifact(`2026-09-13-某主题-${id}.md`), `AC-07 检查器不识别后缀 ${id}`);
  }
});

test('派生：fallback 编号正则认全部已登记前缀', () => {
  for (const p of ALL_FINDING_PREFIXES) {
    assert.ok(isFallbackId(`${p}-F1`), `fallback 编号正则不认前缀 ${p}`);
  }
  assert.ok(!isFallbackId('NOPE-F1'), '未登记前缀不该被认成 fallback');
});

test('派生：交替正则片段与注册表次序一致', () => {
  assert.equal(findingPrefixAlternation(), ALL_FINDING_PREFIXES.join('|'));
  assert.equal(suffixAlternation(), ALL_AGENT_IDS.join('|'));
});

// ─────────────── 3. 反推函数：无匹配返回 null，禁止兜底（A-1） ───────────────

test('反推：未登记的前缀返回 null，而不是兜底到任一 Agent', () => {
  assert.equal(agentByFindingPrefix('NOPE'), null);
  assert.equal(agentByFindingId('NOPE-01'), null);
  assert.equal(agentById('nope'), null);
  assert.equal(isAgentId('nope'), false);
});

test('反推：已登记前缀逐项命中正确的 Agent', () => {
  for (const a of AGENTS) {
    assert.equal(agentByFindingId(`${a.findingPrefix}-01`)?.id, a.id);
    assert.equal(agentByFindingId(`${a.findingPrefix}-r2-03`)?.id, a.id);
    assert.equal(agentByFindingId(`${a.findingPrefix}-F1`)?.id, a.id);
  }
});

test('反推：畸形编号不抛异常，返回 null', () => {
  for (const bad of ['', '-', 'AGY', '-01', '01-AGY']) {
    assert.doesNotThrow(() => agentByFindingId(bad));
    assert.equal(agentByFindingId(bad), null, `「${bad}」不该被反推出 Agent`);
  }
});

// ─────────────────────── 4. grep 级对账 ───────────────────────

/**
 * 允许出现 Agent 字面量的文件。
 *
 * **加入本表前先想清楚**：注册表的价值在于「新增 Agent 只改注册项」，
 * 每加一个豁免就削弱一分。适配器与探针按定义就是 Agent 专属实现，它们
 * 的文件名本身即命名空间；除此之外的豁免应当极少，且要在此写明理由。
 */
/**
 * `src/trivium/` 之外也要过对账的模块（相对仓库根）。见 LITERAL_ALLOWLIST 里那段「注意」。
 * 报错里它们的路径显示为 `../<文件名>`（相对 src/trivium/）。
 */
const EXTRA_SCANNED: readonly string[] = ['src/entry-render.ts', 'src/install.ts'];

const LITERAL_ALLOWLIST: readonly { file: string; why: string }[] = [
  { file: 'agents/registry.ts', why: '唯一登记处，字面量的来源本身' },
  { file: 'adapters/index.ts', why: 'Agent id → 厂商适配器的唯一接线处；新增一家在此加一行（M7b 第 2 步把 review/run-protocol 两份字面表收敛到这里）' },
  { file: 'adapters/agy.ts', why: '厂商专属适配器：文件本身即该 Agent 的命名空间' },
  {
    file: 'adapters/claude.ts',
    why:
      '厂商专属适配器：claude 调用与参数构造，与 adapters/agy.ts 同规格。' +
      '同目录的 claude-trace.ts **不需要**本表条目——它只处理事件流，不写 Agent id 字面量（同 codex-trace.ts）',
  },
  { file: 'adapters/zcode.ts', why: '厂商专属适配器：ZCode 调用与参数构造' },
  {
    file: 'adapters/codex.ts',
    why:
      '厂商专属适配器：codex 调用、隔离副本准备与写判据接线，与 adapters/agy.ts 同规格。' +
      '同目录的 codex-trace.ts / codex-home.ts **不需要**豁免——它们只处理事件流与配置文件，' +
      '不写 Agent id 字面量，文件名带 codex 不进扫描面',
  },
  { file: 'config.ts', why: '内置默认配置里各 Agent 的厂商专属配置段（agents.gemini / agents.glm 的 vendor、agent、entry、max_turns）与 profiles 的逐 Agent 模型档位。M7b 第 4 步迁成 agents.* 后**仍需要**：内置默认值本身就得指名道姓地写出每一家配什么，那不是硬编码而是默认值的定义处；新增一家时这里加一段，与注册表加一行是同一件事的两面' },
  // 注意：扫描面是 src/trivium/ **加上** EXTRA_SCANNED 点名的 `src/` 顶层模块
  // （M10b 第 2 步代码双审 CODEX-04）。`src/` 顶层今天的两个模块都纳入，且都不需要豁免：
  // `install.ts` 里唯一的家根字面量 `.gemini/…` 带路径分隔符，属性形态扫描本就排除它。
  // 此前这里写的是「install.ts 不在扫描范围」，而本步新增的 `entry-render.ts` 恰恰也在论域外——
  // 它的取值清单一律读注册表，按 id 分叉正是本对账要治的形态。`src/` 顶层再加模块时，把它列进 EXTRA_SCANNED。
  //
  // `init.ts` 曾在此表中，2026-09-14 删除：它的 `.claude/...` 全部带路径分隔符、
  // 已被属性扫描排除，文件本身确无 Agent 字面量。此前判它「仍需要」是坏剥离器
  // 造出的假命中（见 stripComments 的注释）。
  {
    file: 'probes/codex.ts',
    why:
      '厂商专属探针：文件本身即该 CLI 的命名空间，与 adapters/agy.ts 同规格。' +
      '需要豁免而 probes/agy.ts、probes/zcode.ts 不需要，是因为一处**不对称**：' +
      '扫描器查的是 AgentId 全集（claude / codex / gemini / glm），而那两个文件里写的 ' +
      "'agy' / 'zcode' 是 cliName——对应的 AgentId 分别是 gemini 与 glm，扫不到；" +
      'codex 与 claude 的 cliName 恰好等于自己的 AgentId，于是同形的写法（which codex）会命中。' +
      '（M6 第 3 步接 claude 探针时果然遇到了同一件事，按本条同理加了下一条）',
  },
  {
    file: 'probes/claude.ts',
    why:
      '厂商专属探针，与 probes/codex.ts 同规格、同成因：claude 的 cliName 恰等于自己的 ' +
      'AgentId，于是 `which claude` 这类写法会被 AgentId 扫描命中，' +
      '而 probes/agy.ts、probes/zcode.ts 写的 cliName 不与任何 AgentId 相撞、扫不到。' +
      '上一条豁免的理由里预言过「接 claude 探针时会遇到同一件事」——本条就是它',
  },
  { file: 'doctor.ts', why: '逐侧探测的人读输出与厂商专属诊断话术' },
  /*
   * `preflight.ts` 的豁免于 2026-09-15（M8 第 3 步）删除——**它是被这条对账赶出去的**。
   *
   * 原理由是「逐侧预检的人读输出，以及两处按 Agent id 取厂商配置段的指纹计算」。
   * 本步把三处按厂商分派全部收敛掉：只读能力改为遍历适配器 `availability()`、
   * 探活改为遍历 `authProbe()`（指纹计算随之回到各适配器）、模型目录校验改为
   * 按 cliName 通用消费 `CommonProbe.models`。收敛完成后该文件里一个 Agent 字面量都没有，
   * 「不得留过期条目」这条当场把它标了出来——泛化是否真的做完，由机器说了算。
   */
  /*
   * 本条的理由**改写过两次**，两次都是「字面还在、但为什么在」变了：
   *   · 第一版：CriticId 的字面收窄 —— M7b 第 6 步放开成注册表全集后作废；
   *   · 第二版：Disposition.role 的字面 'claude'（「Driver 任意化排在 M10」）——
   *     EV-66 在 M9 第 6 步前就把 role 放开成 AgentId 了，那句预言本身失效，
   *     再留着就是一条**失实的留痕**（而上面那条守卫只查字面在不在，查不出理由过期）。
   * 现在的理由是探针键，与裁决件契约无关。下一个动这行的人请照样如实改写，别顺手删。
   *   · M10a 第 4 步（EV-07 结案时）：理由未变，改准了描述——原文把键说成 Agent id、
   *     行号 :778 已漂移。键其实按 cliName 索引（`ProbeByCli` 头注释原话），
   *     改用符号锚，不再写行号。
   */
  { file: 'types.ts', why: 'ProbeByCli 的具名可选键（claude?: ClaudeProbe、codex?: CodexProbe）：键按 cliName 索引，只因 claude / codex 的 cliName 恰与 AgentId 同形才被本扫描命中（成因同 probes/codex.ts 条）；探针形状逐家不同，泛化要等各家探针结构收敛' },
];

test('白名单纪律：每一项都要写明理由，且不得豁免不存在的文件', async () => {
  /*
   * 代码审查（run 20260913T121713Z）AGY-03/04 与 GLM-01/06 共同指出：
   * 白名单被用来**掩盖没改完的模块**——`topic-args.ts` 与 `report.ts` 根本
   * 不是 Agent 专属实现，加进来只是为了让对账变绿。grep 对账本是为补人工
   * 清单的漏而设，无理由的豁免把那处漏重新变回盲区。
   *
   * 所以白名单自己也得有守卫：理由必填，且豁免的文件必须真实存在
   * （文件被删或改名后，陈旧条目会悄悄扩大豁免面）。
   */
  const srcRoot = path.join(REPO_ROOT, 'src/trivium');
  for (const entry of LITERAL_ALLOWLIST) {
    assert.ok(
      entry.why.trim().length >= 6,
      `白名单条目 ${entry.file} 没有写明理由——每加一个豁免就削弱一分注册表的价值`,
    );
    await assert.doesNotReject(
      fs.access(path.join(srcRoot, entry.file)),
      `白名单条目 ${entry.file} 指向的文件不存在，应当删除该条目`,
    );
  }
});

/**
 * 白名单条目**仍然被需要**——移除它会让扫描变红。
 *
 * 上一个用例只守「文件还在」。但豁免过期的形态不是文件消失，而是
 * **文件里的字面量被清干净了、条目却留着**：豁免面悄悄扩大，
 * 日后有人往那个文件里写回硬编码，对账不会报。
 *
 * 本次实测查出 10 条这样的死条目（`hooks.ts`、`parse.ts`、`schemas.ts`、`brief.ts`、
 * `status.ts`、`init.ts`、两份轨迹解析与两份探针）——它们多半是随 M7a 的泛化
 * 一起被清空的，清的人没回头删条目。这很自然，所以要让机器守。
 *
 * **但本守卫只和剥离器一样可靠。** 第一版用坏正则跑，`config.ts` 的 8 处真硬编码
 * 被字符串里的 `/*` 吞掉，于是它被误判成过期、白名单条目被我删掉——
 * 一个本该受监控的文件就此脱离监控。这就是下方负例存在的理由。
 */
test('白名单纪律：不得留过期条目（豁免必须仍然被需要）', async () => {
  const srcRoot = path.join(REPO_ROOT, 'src/trivium');
  const idPattern = new RegExp(`['"\`](?:${ALL_AGENT_IDS.join('|')})['"\`]`);
  const prefixPattern = new RegExp(`['"\`](?:${ALL_FINDING_PREFIXES.join('|')})-`);
  const ids = ALL_AGENT_IDS.join('|');
  const propPattern = new RegExp(`\\.(?:${ids})(?![\\w/-])`);
  const keyPattern = new RegExp(`(?:^|[{,(]|\\s)(?:${ids})\\s*[:?]`);

  const stale: string[] = [];
  for (const entry of LITERAL_ALLOWLIST) {
    const src = await fs.readFile(path.join(srcRoot, entry.file), 'utf8');
    /*
     * 两个论域：带引号的字面量看**原文**（剥离器会把字符串内容空格化），
     * 属性/键看剥离后的代码。混用会同时造出误报与漏报。
     */
    const literalScope = stripCommentsKeepStrings(src).split('\n');
    const codeScope = stripComments(src).split('\n');
    const needed =
      literalScope.some((l) => idPattern.test(l) || prefixPattern.test(l)) ||
      codeScope.some((l) => propPattern.test(l) || keyPattern.test(l));
    if (!needed) stale.push(entry.file);
  }

  assert.deepEqual(
    stale,
    [],
    '这些文件已经没有 Agent 字面量了，白名单条目应当删除——' +
      '留着等于给它们开一张长期空白支票：\n' + stale.join('\n'),
  );
});

/**
 * 剥离注释，**保留字符串字面量的外壳与行号**。
 *
 * ## 为什么不能用正则
 *
 * 原先三处都写 `src.replace(/\/\*[\s\S]*?\*\//g, '')`。它不认引号上下文，于是
 * **字符串里的 `/*` 会被当成块注释开头**，一路吃到下一个 `*​/`。
 *
 * 这不是假想缺陷（2026-09-14 代码审查 AGY-01 顺出的真因）：`init.ts` 有一行
 * `'.claude/*'`（`.gitignore` 白名单写法），那个正则从它开始**吞掉 32 行真实代码**；
 * 全仓有 **7 个文件**的字符串含 `/*`，每一处都让后续一段代码对扫描器隐形。
 *
 * 后果有二，第二个更糟：
 *   ① 扫描器漏报——被吞掉的区段里若有硬编码，对账照常绿灯；
 *   ② 残片制造**假命中**——`'.claude` 断在这里，末尾没有路径分隔符，
 *      于是 `init.ts` 被判成「白名单仍需要」，掩盖了它其实已经干净；
 *      反过来 `config.ts` 的 8 处真硬编码被吞没，害我把它的白名单条目**误删**了。
 *
 * 一句话：**用没验证过的工具得出的结论，一律不可信。** 本函数因此配了负例
 * （见下方「剥离器不得吞掉字符串里的 /* 之后的代码」）——只把实现改对而不锁死，
 * 下次有人改回正则时测试依然全绿。
 *
 * ## 实现约定
 *
 * - 字符串/模板字面量：保留首尾引号，内容整体空格化。这样**带引号的扫描**
 *   （`'gemini'`）必须在**原文**上做，而属性/键扫描在本函数输出上做——
 *   两者论域不同，调用处已分开。
 * - 换行一律保留，行号与原文对齐，报错能直接定位。
 * - 不处理正则字面量（`/claude/i` 这类）：JS 里区分除法与正则需要完整的
 *   表达式上下文，为对账做到那一步不划算。该形态已在「不覆盖的形态」里如实登记。
 */
function stripComments(src: string, opts: { keepStrings?: boolean } = {}): string {
  const keepStrings = opts.keepStrings === true;
  const out: string[] = [];
  let i = 0;
  /** 上一个非空白的有效字符，用于区分「正则字面量」与「除号」 */
  let lastMeaningful: string | null = null;
  while (i < src.length) {
    const c = src[i]!;
    if (!/\s/.test(c) && c !== '/') lastMeaningful = c;
    else if (/\s/.test(c) && c !== ' ' && c !== '\t') lastMeaningful = '\n';

    // 字符串 / 模板：进去之后到闭合前，注释起始一律不算数
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out.push(c);
      i++;
      while (i < src.length) {
        const d = src[i]!;
        if (d === '\\') {
          // 转义对（如 \n \' ）整体抹平，长度守恒；保留模式下原样带过
          out.push(keepStrings ? src.slice(i, i + 2) : '  ');
          i += 2;
          continue;
        }
        if (d === quote) {
          out.push(quote);
          i++;
          break;
        }
        /*
         * **换行即认定失步，就地退出字符串模式。**
         *
         * `'` / `"` 字符串在合法 JS 里不能跨行（模板字面量可以，故排除它）。
         * 读到裸换行只有一种解释：我们压根没在字符串里——多半是**正则字面量
         * 里的引号**把机器带偏了，例如 `cell.replace(/[*\`_]/g, '')` 里那个反引号。
         *
         * 这个形态比它要修的原 bug 更毒：原 bug 只吞到下一个 `*​/`，
         * 而失步会让**其后整个文件**的注释与代码边界全错。按行收敛把损失
         * 锁死在一行内——要正确处理正则字面量得有完整表达式上下文，
         * 为一个对账工具做到那一步不划算，止损比求全更要紧。
         */
        if (d === '\n' && quote !== '`') {
          out.push('\n');
          i++;
          break;
        }
        out.push(keepStrings || d === '\n' ? d : ' ');
        i++;
      }
      continue;
    }

    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }

    /*
     * 正则字面量。**必须认它**，否则 `/[*\`_]/g` 里的反引号会被当成模板字面量开头，
     * 整台机器从那一行起失步——其后所有注释与代码的边界全错（实测 `disposition.ts`
     * 的块注释因此完全没被剥掉）。这比它要修的原 bug 毒得多：原 bug 只吞到下一个
     * 结束符，失步则污染整个文件。
     *
     * 判定用「前一个有效字符」的经典启发式：`/` 出现在 `( , = : [ ! & | ? { } ; return`
     * 之后才可能是正则，否则是除号。不完备，但足以覆盖本仓库的写法；
     * 且**正则内容整体跳过**——它里面的引号不该参与任何判定。
     *
     * 代价：正则字面量里的 Agent 名（如 `/claude/i` 这类写法）
     * 对账扫不到。这条已在「不覆盖的形态」里如实登记，不追全覆盖。
     */
    if (c === '/' && lastMeaningful !== null && /[(,=:[!&|?{};]/.test(lastMeaningful)) {
      i++; // 跳过开头的 /
      while (i < src.length && src[i] !== '\n') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') { // 字符类内的 / 不算结束
          while (i < src.length && src[i] !== ']' && src[i] !== '\n') {
            if (src[i] === '\\') i++;
            i++;
          }
        }
        if (src[i] === '/') { i++; break; }
        i++;
      }
      continue;
    }

    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i + 1 < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out.push('\n'); // 保行号
        i++;
      }
      i += 2;
      continue;
    }

    out.push(c);
    i++;
  }
  return out.join('');
}

/**
 * 带引号扫描专用：**剥掉注释、保留字符串原文**。
 *
 * 两个模式共用同一个状态机，差别只在字符串内容留不留：
 *   - `keepStrings: true` → 给带引号的字面量扫描（`'gemini'` 要看得见）；
 *   - 默认（不留）        → 给属性/键扫描（字符串里的 `.gemini` 是文案，不是属性访问）。
 *
 * **两个模式都必须剥块注释**。曾经这里只剥行注释，于是注释里那些
 * 「重构前写死 `['gemini','glm']`」之类的说明文字被当成硬编码报了出来——
 * 注释提到 Agent 名是说明性文字，不影响行为。
 */
function stripCommentsKeepStrings(src: string): string {
  return stripComments(src, { keepStrings: true });
}

/** 逐字符扫描，跳过注释与字符串之外的语法噪声由调用方以正则近似处理 */
async function collectSourceFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (e.name.endsWith('.ts')) out.push(abs);
    }
  };
  await walk(root);
  return out;
}

test('grep 对账：白名单外的模块不得出现 Agent id / 前缀字面量', async () => {
  // 扫的是**工作树源码**而非 dist 产物：对账要在人写的那一份上做
  const srcRoot = path.join(REPO_ROOT, 'src/trivium');
  const files = [...(await collectSourceFiles(srcRoot)), ...EXTRA_SCANNED.map((f) => path.join(REPO_ROOT, f))];
  assert.ok(files.length > 20, `源码扫描没找到足够文件（${files.length}），路径可能不对`);

  // 带引号的字面量才算——注释里提到 Agent 名是说明性文字，不影响行为
  const idPattern = new RegExp(`['"\`](?:${ALL_AGENT_IDS.join('|')})['"\`]`);
  const prefixPattern = new RegExp(`['"\`](?:${ALL_FINDING_PREFIXES.join('|')})-`);

  const offenders: string[] = [];
  for (const abs of files) {
    const rel = path.relative(srcRoot, abs);
    if (LITERAL_ALLOWLIST.some((w) => rel === w.file || rel.endsWith(`/${w.file}`))) continue;

    const src = await fs.readFile(abs, 'utf8');
    /*
     * 带引号的字面量必须在**保留字符串原文**的版本上扫：`stripComments` 会把
     * 字符串内容空格化，`'gemini'` 到那里就变成了 `'      '`，扫不出来。
     */
    const code = stripCommentsKeepStrings(src);

    for (const [lineNo, line] of code.split('\n').entries()) {
      if (idPattern.test(line) || prefixPattern.test(line)) {
        offenders.push(`${rel}:${lineNo + 1}  ${line.trim()}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    '这些位置写了具体 Agent 字面量，应改读注册表；确属 Agent 专属实现时，' +
      '把文件加进 LITERAL_ALLOWLIST 并在那里写明理由：\n' + offenders.join('\n'),
  );
});

/*
 * ── 属性访问形态的对账（M7b 第 2 步）──
 *
 * 上面那个扫描**只抓带引号的字面量**，于是 `reviews.gemini`、`{ gemini: agyAdapter }`、
 * `CRITIC_LABEL` 的对象键这类**不带引号**的形态全部漏网。
 *
 * 这不是假想：`report.ts` 的分歧度计算写着 `reviews.gemini && reviews.glm`，
 * 它**不在白名单里**（白名单自己就是按「带引号扫描」的结果建的），却实打实硬编码了两侧——
 * 三审时第三家的分歧度会被静默丢掉。`render.ts` 的两键标签表同理。
 *
 * ## 明确**不覆盖**的形态（别把这道对账读强了）
 *
 * 1. **散文/文案**：`divergence.ts` 曾有「仅 gemini … 仅 glm」的输出文案，
 *    空格前缀、后不接冒号，三个模式**都不匹配**。那处是重构成 `${d.a} × ${d.b}`
 *    顺手修掉的，**不是**对账守住的——早先这份注释把它列为覆盖对象，是高估（GLM-03）。
 * 2. **正则字面量**：`/claude/i` 这类写法若是行为逻辑，
 *    剥离器会整体跳过正则内容（否则里面的引号会让状态机失步）。
 * 3. **模板串里的旗标与枚举散文**：`cli.ts` 的 USAGE 里 `--model-gemini`、
 *    `--only gemini|glm` 之类，第三家启用后会静默过期。
 *
 * **刻意不追全覆盖**：给散文加窄模式会滑向误报海洋，而每个误报都要有人判断
 * 要不要加白名单——那反过来会稀释白名单的严肃性。
 *
 * 教训：**对账的覆盖面决定白名单的可信度**。扫不到的形态，白名单也不会有它的条目，
 * 于是「白名单外无字面量」这个结论看着成立、实际有洞。
 */
test('grep 对账（属性访问形态）：白名单外不得出现 .<id> / <id>: 的硬编码', async () => {
  const srcRoot = path.join(REPO_ROOT, 'src/trivium');
  const files = [...(await collectSourceFiles(srcRoot)), ...EXTRA_SCANNED.map((f) => path.join(REPO_ROOT, f))];

  const ids = ALL_AGENT_IDS.join('|');
  /*
   * 两种形态：
   *   `.gemini`  属性访问（`reviews.gemini`、`cfg.critics.glm`）
   *   `gemini:`  对象字面量的键 / 类型成员（`{ gemini: agyAdapter }`、`gemini: string`）
   * 后者要求前面是 `{`、`,`、行首或空白，避免误伤 `case 'gemini':` 之外的正常代码
   * （带引号的那种由上一个测试负责）。
   */
  /*
   * `(?![\\w/-])` 只排**路径分隔符**：`.claude/skills/...` 里的 `.claude` 是目录名，
   * 不是对 Agent 的属性访问。不排会把 USAGE 文案与资产路径全判成硬编码。
   *
   * **刻意不排 `.`**：第一版顺手把点也排掉，结果 `cfg.critics.gemini.effort` 这类
   * 真硬编码被一并吞掉——为治误报而开的口子造出了漏报，比误报更糟。
   * 对账器自己也遵守「宁可误报、不可漏报」：误报有零成本出口（加白名单并写明理由），
   * 漏报则是把盲区伪装成绿灯。
   */
  const propPattern = new RegExp(`\\.(?:${ids})(?![\\w/-])`);
  const keyPattern = new RegExp(`(?:^|[{,(]|\\s)(?:${ids})\\s*[:?]`);
  /*
   * 对象/解构**简写**：`{ gemini, glm }`、`const { gemini } = reviews`。
   * 既无前置点号也无后置冒号，上面两个模式全不匹配（审查意见 AGY-02）。
   */
  const shorthandPattern = new RegExp(`[{,]\\s*(?:${ids})\\s*(?=[,}])`);

  const offenders: string[] = [];
  for (const abs of files) {
    const rel = path.relative(srcRoot, abs);
    if (LITERAL_ALLOWLIST.some((w) => rel === w.file || rel.endsWith(`/${w.file}`))) continue;

    const src = await fs.readFile(abs, 'utf8');
    // 属性/键形态看剥离后的代码：字符串内容里的 `.gemini` 是文案，不是属性访问
    const code = stripComments(src);

    for (const [lineNo, line] of code.split('\n').entries()) {
      if (propPattern.test(line) || keyPattern.test(line) || shorthandPattern.test(line)) {
        offenders.push(`${rel}:${lineNo + 1}  ${line.trim()}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    '这些位置以**属性访问或对象键**的形态硬编码了 Agent（带引号的那种由上一个用例负责）。\n' +
      '改读注册表派生的集合/映射；确属 Agent 专属实现时加进 LITERAL_ALLOWLIST 并写明理由：\n' +
      offenders.join('\n'),
  );
});

/*
 * ── 剥离器自身的守卫（2026-09-14 代码审查 AGY-01）──
 *
 * 这一组存在的唯一理由：**用没验证过的工具得出的结论不可信。**
 *
 * 上面三个对账全都建立在 `stripComments` 之上。它的第一版是
 * `src.replace(/\/\*[\s\S]*?\*\//g, '')`——不认引号上下文，字符串里的 `/*`
 * 被当成块注释开头，一路吃到下一个结束符。实测后果：`init.ts` 被吞掉 32 行、
 * 全仓 7 个文件受影响，并直接导致 `config.ts` 的 8 处真硬编码隐形、
 * 它的白名单条目被误删。
 *
 * 只把实现改对是不够的——下次有人改回正则，上面三个用例依然全绿。
 */

test('剥离器：字符串里的 /* 不得被当成注释开头（否则后续代码对扫描器隐形）', () => {
  const src = [
    "const patterns = ['.claude/*', '!.claude/settings.json'];",
    'const table = { gemini: agyAdapter };', // ← 真硬编码，必须还看得见
    "const more = '*/';",
  ].join('\n');

  const code = stripComments(src);
  assert.match(code, /gemini:/, '字符串里的 /* 吞掉了后续真实代码——扫描器会漏报');
  assert.equal(code.split('\n').length, 3, '剥离后行号必须与原文对齐，否则报错定位会偏');
});

test('剥离器：真正的块注释与行注释要被剥掉，但保留行号', () => {
  const src = [
    '/* const a = { gemini: 1 }; */',
    'const b = 1;',
    '// const c = { glm: 2 };',
    'const d = 2;',
  ].join('\n');

  const code = stripComments(src);
  assert.doesNotMatch(code, /gemini:/, '块注释里的内容不该参与对账');
  assert.doesNotMatch(code, /glm:/, '行注释里的内容不该参与对账');
  assert.equal(code.split('\n').length, 4, '行号必须守恒');
});

test('剥离器：字符串内容被空格化，因此带引号的扫描必须走原文', () => {
  /*
   * 这条锁的是**论域分工**：`stripComments` 把 `'gemini'` 变成 `'      '`，
   * 所以带引号的字面量扫描只能在 `stripLineComments` 的输出上做。
   * 两者混用会同时造出误报（文案里的 .gemini 被当属性访问）与
   * 漏报（真的 'gemini' 字面量扫不出来）。
   */
  const src = "const x = 'gemini';";
  assert.doesNotMatch(stripComments(src), /'gemini'/, '剥离器会空格化字符串内容');
  assert.match(stripCommentsKeepStrings(src), /'gemini'/, '原文版本必须留住带引号的字面量');
});

test('剥离器：转义引号不得让字符串提前闭合', () => {
  const src = ["const s = 'it\\'s fine';", 'const t = { glm: 1 };'].join('\n');
  const code = stripComments(src);
  assert.match(code, /glm:/, '转义引号处理错会让后续代码落进「字符串内」而整段隐形');
});

test('剥离器：正则字面量里的引号不得让机器失步（比原 bug 更毒的形态）', () => {
  /*
   * `disposition.ts:76` 的 `cell.replace(/[*`_]/g, '')` 里有个反引号。
   * 不认正则字面量时，它被当成模板字面量开头——模板可以跨行，于是**其后整个文件**
   * 的注释与代码边界全错：实测该文件的块注释完全没被剥掉，注释里的说明文字
   * 被当成硬编码报了出来。
   *
   * 原 bug（字符串里的 /*）只吞到下一个结束符；失步则污染整个文件。
   */
  const src = [
    "const clean = cell.replace(/[*`_]/g, '');",
    '/** 这段块注释必须被剥掉：里面提到 gemini 只是说明文字 */',
    'const real = { glm: 1 };',
  ].join('\n');

  const kept = stripCommentsKeepStrings(src);
  assert.doesNotMatch(kept, /说明文字/, '正则里的反引号让机器失步，块注释没被剥掉');
  assert.match(stripComments(src), /glm:/, '失步会连带吞掉后续真实代码');
});

// ──────────── 4. JSON Schema 侧的对账（审查意见 GLM-02，M7b 第 3 步）────────────

/*
 * 上面三组只扫 `src/trivium/` 的**代码**字面量。schema 文件是另一个论域，
 * 此前没有任何机器检查看着它——而 `run.v2` 的设计恰恰把「不在 schema 里枚举
 * Agent id 与 vendor」当成一条硬约束（纪律 7：注册表是唯一来源）。
 *
 * 缺这组对账的后果不是理论风险：往 `critics_selected.items` 或 `critic.vendor`
 * 加回 `enum: ["gemini","glm"]`，全套测试**照样全绿**，直到 M8 接入第三家时
 * 才在 `writeRunMeta` 运行期抛「run.json 不符合 trivium.run.v2」——正是
 * `schemas.ts` 注释里自己描述的「改一漏二、跑到运行期才发现」那个症状。
 * v1 的 schema 就是这么写死两家的，那也正是本步必须升版而非原地扩展的原因。
 *
 * 我为这条约束留的保障原本只有 schema 里的一段注释。**注释守不住的东西要让机器守**
 * ——这是第 2 步刚学过的一课（白名单「过期条目」守卫），在新文件上又漏了一次。
 */
const SCHEMA_DIR = path.join(REPO_ROOT, 'skills/dual-critic/schema');

/** 取 JSON 里某条点路径的节点，缺失返回 undefined */
function nodeAt(root: unknown, dotted: string): unknown {
  let cur: unknown = root;
  for (const seg of dotted.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

test('run.v2 schema：身份字段一律不得枚举 Agent id 或 vendor', async () => {
  const schema = JSON.parse(await fs.readFile(path.join(SCHEMA_DIR, 'run.v2.json'), 'utf8'));

  /*
   * 这三处是 v1 写死两家的对应位置，逐一盯住。
   * 新增身份字段时**要往这张表里加**——漏加不会报错，正是本组对账要防的形态。
   */
  const identityPaths = [
    'properties.driver',
    'properties.critics_selected.items',
    '$defs.critic.properties.vendor',
  ];

  for (const p of identityPaths) {
    const node = nodeAt(schema, p);
    assert.ok(node, `run.v2.json 缺少 ${p}：本对账的盯防点失效了，先修路径再说`);
    assert.equal(
      (node as Record<string, unknown>)['enum'], undefined,
      `run.v2.json 的 ${p} 出现了 enum：Agent 身份的唯一来源是注册表（纪律 7），` +
        '在 schema 里抄第二份，新增一家时改一漏二不会报错。' +
        '身份校验请留在 schemas.ts 的 checkAgentIdentities()',
    );
  }
});

/*
 * `config.v2.json` 同属机读契约、同样有「不枚举 Agent 身份」的性质，
 * 上一条建立对账时却只盯了 `run.v2.json`——**同一个洞在新文件上重开**
 * （审查意见 AGY-05 ≡ GLM-02）。这已经是第三次同形：白名单过期条目、
 * run.v2 的枚举、现在是 config.v2。新增机读契约时，对账要跟着建。
 *
 * **两类 enum / const 必须分清**，否则这条对账一上来就会误伤：
 *   · **身份枚举**（`default_critics.items` 的取值）→ 禁止。那是注册表的职责。
 *   · **形状判别式**（`agents` 的 `oneOf` 分支里的 `vendor: {const: …}`）→ **必须允许**。
 *     可辨识联合正是靠它工作的；把它也禁掉，`agents` 就没法按厂商分形状了。
 *
 * 所以盯防点写成**显式路径清单**而不是全文搜 enum——全文搜必然扫到 vendor const。
 */
test('config.v2 schema：身份字段不得枚举 Agent id（但形状判别式的 vendor const 必须留着）', async () => {
  const schema = JSON.parse(await fs.readFile(path.join(SCHEMA_DIR, 'config.v2.json'), 'utf8'));

  for (const p of ['properties.review.properties.default_critics.items']) {
    const node = nodeAt(schema, p);
    assert.ok(node, `config.v2.json 缺少 ${p}：盯防点失效了，先修路径再说`);
    for (const forbidden of ['enum', 'const']) {
      assert.equal(
        (node as Record<string, unknown>)[forbidden], undefined,
        `config.v2.json 的 ${p} 出现了 ${forbidden}：可用审核者的唯一来源是注册表的 ` +
          'criticEnabled（纪律 7）。在 schema 里抄第二份，启用第三家时改一漏二不会报错，' +
          '症状要到运行期才现形。身份校验请留在 schemas.ts 的 checkConfigAgents()',
      );
    }
  }

  // `agents` 的键同样不该被枚举：它只要求「是已登记 Agent」，由代码层判定
  const agents = nodeAt(schema, 'properties.agents') as Record<string, unknown>;
  assert.ok(agents, 'config.v2.json 缺少 properties.agents');
  assert.equal(agents['propertyNames'], undefined, 'agents 的键不该用 propertyNames 枚举');
  assert.equal(agents['enum'], undefined);

  /*
   * 反向断言：`oneOf` 分支里的 vendor 判别式**还在**。
   * 少了它，`agents` 就退化成「任意对象」，两家的字段集合再也校验不出来——
   * 这条防的是「为了让上面的禁令过关而把判别式一起删掉」。
   */
  const branches = nodeAt(schema, 'properties.agents.additionalProperties.oneOf') as unknown[];
  assert.ok(Array.isArray(branches) && branches.length >= 2, 'agents 应按 vendor 分形状');
  for (const b of branches) {
    const v = nodeAt(b, 'properties.vendor') as Record<string, unknown> | undefined;
    assert.ok(
      v && typeof v['const'] === 'string',
      'oneOf 分支缺少 vendor 判别式：可辨识联合靠它工作，删掉它校验就形同虚设',
    );
  }
});

/*
 * 结构断言之外再加一条**行为**断言：拿一个当前未启用为审核者的已登记 Agent
 * （M7b 下是 codex / claude）去过校验器，形状必须被接受。
 *
 * 两条一起才完整：结构断言防「加回 enum」，行为断言防「换个写法把枚举塞回去」
 * （`const`、`pattern`、`oneOf` 都能达到同样效果而绕开对 `enum` 的检查）。
 */
/*
 * **M9 第 4 步：改为遍历全部已登记 id**（计划双审 GLM-01）。
 *
 * 上一版取「一个已登记但未启用为审核者的 id」当夹具，四家全启用后取不到值，
 * 而它只把这件事写进 assert 消息（「届时改用别的夹具」）——那是静默失效的形态。
 *
 * 换成遍历全集比原来**更强**，不只是「能跑了」：
 *   · 原来只验一家（而且是 `find()` 撞上的那一家），现在每一家都验；
 *   · 断言的主张本就与 `criticEnabled` 无关——run.v2 的形状论域是
 *     「已登记的 Agent」，而不是「当前启用的审核者」。拿启用状态当夹具来源，
 *     等于把一条恒真的形状约束绑在一个会变的运行期布尔上。
 *
 * 唯一要排除的是 `driver` 那一格：`critics_selected` 含当轮 Driver 会触发
 * 身份补校的互斥规则，那是**另一条**规则的正确行为，不该在这里被当成形状失败。
 */
test('run.v2 校验：每一个已登记 Agent 出现在入选集合里，形状上都必须被接受', () => {
  for (const spare of ALL_AGENT_IDS) {
    if (spare === DEFAULT_DRIVER) continue; // 见上：Driver 互斥是另一条规则

  const agent = agentById(spare)!;
  const meta = {
    schema: 'trivium.run.v2',
    run_id: 'R1', topic: 't', stage: 'plan', rerun_index: 1, command: 'x',
    prompt_hint: null, task_goal: null,
    driver: DEFAULT_DRIVER,
    critics_selected: [spare],
    snapshot: {
      git_head: null, tree_hash: 'h', dirty: false, subject_sha256: 's',
      drift: { changed: false, files: [], policy: 'warn' },
    },
    started_at: 'x', finished_at: null,
    review_mode: 'full', degraded_reason: null,
    critics: {
      [spare]: {
        vendor: agent.vendor, cli_version: null,
        model_requested: null, model_effective: null,
        status: 'ok', exit_code: 0, duration_s: 1,
        tool_calls: {}, evidence_ok: true, heterogeneous: true,
      },
    },
    deny_paths: [],
    guard: { readonly_breach: false, peer_artifact_read: false, peer_deny_applied: {}, forged_role_file: false },
    artifacts: [], gate: { adjudication_complete: false, state: 'running' }, status: 'running',
  };

  assert.deepEqual(
    validateRunMeta(meta), [],
    `${spare} 是已登记 Agent，run.v2 不该在形状上拒绝它——` +
      '拒绝即说明枚举被塞回了 schema（可能不是用 enum 写的）',
  );
  }
});

/*
 * ── 全目录兜底扫描（M7b 第 6 步，桩夹具实测查出）──
 *
 * 上面两条对账各自维护一份**显式路径清单**，并在注释里写着「新增机读契约时，
 * 对账要跟着建」。那句话没守住：`review.v1.json` 从来没被任何一条盯过，
 * 而它的 `findings.items.id.pattern` 写着 `^(AGY|GLM)-…`——第三家审核者的
 * 合法结论会被 ajv 拒掉，整份结论退化成 `parse_fallback`，
 * 意见编号变成 `STUB-F1` 这类兜底号，而**全套测试照常全绿**。
 *
 * 这已经是同一形状的第四次（白名单过期条目 → run.v2 → config.v2 → review.v1）。
 * 前三次的对策都是「记得把新文件加进清单」，而它每次都失效。所以这一次换成
 * **全目录兜底**：扫 `schema/` 下每一份契约的每一个校验关键字，
 * 新增 schema 文件自动进入论域，不需要谁记得。
 *
 * 论域刻意只盯 Agent **id** 与**意见编号前缀**，不盯 vendor——
 * `vendor: {const: …}` 是可辨识联合的形状判别式，必须留着（见上一条的反向断言）。
 */
test('全部机读 schema：任何校验关键字都不得枚举 Agent id 或意见编号前缀', async () => {
  const files = (await fs.readdir(SCHEMA_DIR)).filter((f) => f.endsWith('.json')).sort();
  assert.ok(files.length > 0, `${SCHEMA_DIR} 下一个 schema 都没有，扫描论域是空的`);

  /*
   * `run.v1` 是**历史契约**：既有归档是不可变工件，必须按写入时的规范解读（P6）。
   * 它写死两家正是 M7b 第 3 步必须升版而非原地扩展的原因，所以豁免它不是妥协。
   * 豁免面刻意只有这一条——多一条就要在这里写清为什么。
   */
  const HISTORICAL = new Set(['run.v1.json']);

  // 人读字段不参与：描述里举例写 `AGY-r2-01` 是应该的，那不是校验规则
  const PROSE_KEYS = new Set(['description', 'title', '$comment', '$id', '$schema']);

  /*
   * `const` 的豁免面：只豁免**形状判别式**所在的键。
   *
   * 可辨识联合靠 `{vendor: {const: …}}` 工作（上方另有反向断言盯着它还在）。
   * 把豁免写成「键名白名单」而不是「不扫 const」，是为了让豁免面**可见且可数**：
   * 想再加一个，就得在这里写下它叫什么、为什么。
   */
  const VENDOR_DISCRIMINANT_KEYS = new Set(['vendor']);

  /*
   * **具名豁免**：已知的、有理由的、且已登记为欠账的身份常量。
   *
   * 补上 const 分支之后第一次跑就扫出了它——那是真命中，不是误报。
   * 处置方式刻意选「按路径具名豁免」而不是「不扫 const」：
   * 前者豁免面是一条可数的路径且必须写下理由，后者是整片论域悄悄消失。
   * 这与白名单纪律同构（豁免要写理由、要被守着不能过期）。
   */
  /*
   * **本清单当前为空，这是正确状态，不是漏写。**
   *
   * 唯一的条目（`disposition.v1.json#properties.role.const`）随 EV-66 一起删除：
   * 那条豁免的理由是「Driver 任意化排在 M10，在那之前 role 事实上只有一个取值」，
   * 而 M9 第 5 步放开 `--driver` 之后它就不成立了——schema 里那份抄来的 id
   * 成了非缺省 Driver **写不出诚实裁决件**的唯一阻碍。放开 role 之后豁免无物可挡，
   * 下方「豁免仍然被需要」的守卫会把它当空头支票判红，**正确处置是删条目**，
   * 不是把 role 塞进别的豁免面把用例修绿。
   *
   * 再加条目前先想清楚：每一条都是在 schema 里给「抄第二份 id」开一次口子。
   */
  const NAMED_EXEMPTIONS: readonly { file: string; at: string; why: string }[] = [];
  /** 被豁免挡下的命中，用来守「豁免仍然被需要」——空头支票要当场现形 */
  const suppressed = new Set<string>();
  const exempt = (file: string, at: string): boolean => {
    const e = NAMED_EXEMPTIONS.find((x) => x.file === file && at.startsWith(x.at));
    if (!e) return false;
    suppressed.add(`${e.file}#${e.at}`);
    return true;
  };
  const ids = ALL_AGENT_IDS as readonly string[];
  const prefixes = ALL_FINDING_PREFIXES as readonly string[];

  const hits: string[] = [];

  const scan = (node: unknown, file: string, at: string): void => {
    if (Array.isArray(node)) {
      node.forEach((v, i) => scan(v, file, `${at}[${i}]`));
      return;
    }
    if (node === null || typeof node !== 'object') return;

    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const here = at ? `${at}.${k}` : k;
      if (PROSE_KEYS.has(k)) continue;

      // ① enum 直接列身份
      if (k === 'enum' && Array.isArray(v)) {
        const vals = v.filter((x): x is string => typeof x === 'string');
        const allIds = vals.length >= 2 && vals.every((x) => ids.includes(x));
        const allPrefixes = vals.length >= 2 && vals.every((x) => prefixes.includes(x));
        if (allIds || allPrefixes) {
          hits.push(`${file} 的 ${here} 用 enum 列出了 ${JSON.stringify(vals)}`);
        }
      }

      /*
       * ② const 钉死单个身份（审查意见 AGY-05 ≡ GLM-03）。
       *
       * 第一版这里只有 `enum` 一支，而上方注释写的是「enum / const 直接列身份」
       * ——**注释宣称了不存在的覆盖**，比单纯漏做更糟：下一个人会以为这块已经守住。
       *
       * `vendor` 键豁免：`{vendor: {const: 'antigravity'}}` 是可辨识联合的**形状判别式**，
       * 删掉它 `agents` 就退化成任意对象（上方另有一条反向断言盯着它还在）。
       * 但「豁免 vendor 键」与「完全不扫 const」之间差着整片论域，前者才是要的。
       */
      if (k === 'const' && typeof v === 'string' && !VENDOR_DISCRIMINANT_KEYS.has(at.split('.').pop() ?? '')) {
        if ((ids.includes(v) || prefixes.includes(v)) && !exempt(file, here)) {
          hits.push(`${file} 的 ${here} 用 const 钉死了身份「${v}」`);
        }
      }

      // ③ 正则等字符串里塞身份（`^(AGY|GLM)-…` 与 `^AGY-…` 都要抓）
      if (typeof v === 'string') {
        /*
         * 判据由「≥2 个 token 的交替式」放宽为「出现任一已登记 id 或前缀」。
         *
         * 原门槛 `alternation.length >= 2` 让**单前缀字面**（如 `^AGY-`）整类穿过
         * ——而把两家收窄成一家，和写死两家是同一种病，甚至更隐蔽。
         * 人读字段已在 PROSE_KEYS 排除，所以这里剩下的都是真正参与校验的关键字。
         */
        const hitTokens = [...ids, ...prefixes].filter((t) =>
          new RegExp(`(?:^|[^A-Za-z0-9])${t}(?:[^A-Za-z0-9]|$)`).test(v),
        );
        if (hitTokens.length > 0 && !exempt(file, here)) {
          hits.push(
            `${file} 的 ${here} 在校验关键字里写了身份 ${JSON.stringify(hitTokens)}：${JSON.stringify(v)}`,
          );
        }
      }

      scan(v, file, here);
    }
  };

  for (const f of files) {
    if (HISTORICAL.has(f)) continue;
    scan(JSON.parse(await fs.readFile(path.join(SCHEMA_DIR, f), 'utf8')), f, '');
  }

  assert.deepEqual(
    hits,
    [],
    'Agent 身份的唯一来源是 agents/registry.ts（纪律 7）。schema 只校**形状**，\n' +
      '  身份留给 schemas.ts / parse.ts 的注册表校验（两段式）。命中：\n' +
      hits.map((h) => `    ${h}`).join('\n'),
  );

  /*
   * 豁免也要被守着：**没被用到的豁免就是空头支票**。
   *
   * 与白名单的「不得留过期条目」同一条纪律。少了这一条，
   * NAMED_EXEMPTIONS 可以随便变长而无人察觉，扫描器的论域就会一点点漏空——
   * 而那正是这条扫描本身要治的病（前三次同形都是「论域悄悄缩小、测试照常全绿」）。
   */
  const unused = NAMED_EXEMPTIONS.filter((e) => !suppressed.has(`${e.file}#${e.at}`));
  assert.deepEqual(
    unused.map((e) => `${e.file}#${e.at}`),
    [],
    '这些具名豁免本轮一次都没挡下命中——对应的身份常量多半已经清掉了，条目应当删除',
  );

  for (const e of NAMED_EXEMPTIONS) {
    assert.ok(e.why.trim().length >= 20, `具名豁免 ${e.file}#${e.at} 的理由写得太短`);
  }
});

// ─────────────────── 4. 探针段按 cliName 索引（M6 第 1 步）───────────────────

/*
 * 这两条是 M6 计划双审 GLM-04 要求的配套对账。
 *
 * 背景：计划原拟新增一个 `probeKey` 字段专门做探针段的键，两侧独立判为过度登记——
 * 同一个事实立两个字段就是第二事实源。改为直接复用 `cliName` 之后，
 * **复用方案自己的前提**需要机器守住：cliName 必须全表唯一，
 * 且探针段的类型层具名键不得与它分叉。
 */

test('cliName 全表唯一', () => {
  const names = AGENTS.map((a) => a.cliName);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepEqual(
    dupes,
    [],
    'cliName 重复会让两件事同时坏掉：审查文档 front-matter 的 agent_cli 分不清是哪家，' +
      '且两家 Agent 会争抢同一个探针段键',
  );
});

test('ProbeByCli 的具名键 ⊆ 注册表 cliName 集', async () => {
  /*
   * 类型层为已实现专属形状的家给出精确类型（`agy?: AgyProbe`）。那些具名键
   * 一旦拼错或与注册表分叉，`defaultProbe()` 因为索引签名照样通过，
   * 症状要到消费方取特有字段时才现形——正是纪律 12 要防的「第二事实源」形态。
   *
   * 扫源码而不是扫运行期对象：运行期只看得见 `defaultProbe` 填了什么，
   * 看不见类型里声明了什么，而分叉恰恰发生在后者。
   */
  const src = await fs.readFile(
    path.join(REPO_ROOT, 'src/trivium/types.ts'),
    'utf8',
  );
  const block = /export type ProbeByCli = \{[^}]*\} & \{([^}]*)\}/.exec(src);
  assert.ok(block, '没能在 types.ts 里定位 ProbeByCli 的具名键块——正则或类型形状变了');

  const named = [...block[1]!.matchAll(/^\s*(\w+)\?:/gm)].map((m) => m[1]!);
  assert.ok(named.length > 0, '应当至少有一个具名键（agy / zcode）');

  const cliNames = new Set(AGENTS.map((a) => a.cliName));
  const strays = named.filter((n) => !cliNames.has(n));
  assert.deepEqual(
    strays,
    [],
    `ProbeByCli 出现了不在注册表 cliName 集里的具名键：${strays.join('、')}。` +
      '探针段键集的唯一来源是注册表，类型层只能给已登记的 CLI 加精确形状',
  );
});

// ───────────── 5. 适配层不得引用探针实现（M6 第 3 步 r4，审查意见 GLM-06）─────────────

test('架构契约：adapters/ 不得 import probes/', async () => {
  /*
   * 原则 P7：**适配层只读探针结论，不复用探针的实现**。
   *
   * 这条此前只活在 `probes/claude.ts` 的一句 JSDoc 里（「M9 不要 import 本函数」）。
   * 而 AGENTS.md 纪律 12 说得很清楚：**「靠记性的纪律要换成不依赖记性的机制」**——
   * 仓库无 eslint，本文件的既有扫描只查 Agent 字面量，
   * M9 落地时顺手 import 一下不会被打红。
   *
   * 为什么不能 import：探针的参数构造带着**探针尺度**的默认值
   * （成本闸门按单次 $0.008 留余量、模型挑最便宜的一档）。
   * M9 的审查任务要读整份 BRIEF 与 diff，逐字复用会被 CLI 当场掐断——
   * 而那是运行时才暴露的失败。适配层该读 `probe.readonly_flags` 自己构造，
   * `adapters/zcode.ts` 的 `readonlyArgsFromProbe` 就是现成先例。
   */
  const dir = path.join(REPO_ROOT, 'src/trivium/adapters');
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.ts'));
  assert.ok(files.length > 0, '适配层目录不该是空的——扫描范围写错了会让本条永绿');

  const offenders: string[] = [];
  for (const f of files) {
    const src = await fs.readFile(path.join(dir, f), 'utf8');
    for (const [i, line] of src.split('\n').entries()) {
      // 只看 import / require 形态，避免把注释里提到 probes 的句子算进来
      if (/^\s*(import|export)\b[^;]*from\s+['"][^'"]*probes\//.test(line)) {
        offenders.push(`adapters/${f}:${i + 1}  ${line.trim()}`);
      }
      if (/require\(\s*['"][^'"]*probes\//.test(line)) {
        offenders.push(`adapters/${f}:${i + 1}  ${line.trim()}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    '适配层引用了探针实现，违反 P7：\n' +
      offenders.join('\n') +
      '\n  适配层应当读 probe.<cli>.readonly_flags 自己构造命令行' +
      '（见 adapters/zcode.ts 的 readonlyArgsFromProbe）。' +
      '探针的参数构造带着探针尺度的默认值，逐字复用会在运行时被掐断。',
  );
});

test('架构契约：probes/ 的 import 面——允许清单而非黑名单（EV-74 计划 §5 用例 6）', async () => {
  /*
   * r2 稿只写「扫描 probes/ 的 import 行」，没定义「编排层」——按字面实现的黑名单
   * 形态会空转（新增编排模块不进清单即漏，AGENTS.md 纪律 12 要防的形状），
   * 且 `probes/env.ts:10` 今天就 import `../init.js`，按字面第一天就会误伤。
   * 允许清单把判据倒过来：只许落在这几类，新增一条编排层依赖会立刻被看见。
   *
   * **config/types/util/adapters/secrets 不算编排层**——这半句判据直接写进这里：
   * `secrets.ts` 是无状态脱敏叶子工具，与 util 同族，直接进允许清单本身，
   * 不像 `../init.js` 那样单独具名登记为例外（EV-74 计划 r5，CODEX-01≡AGY-01≡GLM-01）。
   */
  const ALLOWED_TARGETS: readonly RegExp[] = [
    /^node:/,
    /^\.\/[\w-]+\.js$/, // probes/ 同目录
    /^\.\.\/config\.js$/,
    /^\.\.\/types\.js$/,
    /^\.\.\/secrets\.js$/,
    /^\.\.\/util\//,
    /^\.\.\/adapters\//,
  ];
  /** 具名登记的已知例外：把 `stableNodePath` 搬出 `init.ts` 不在本主题论域（plan §0.2） */
  const NAMED_EXCEPTIONS: ReadonlyMap<string, readonly string[]> = new Map([
    ['env.ts', ['../init.js']],
  ]);

  const dir = path.join(REPO_ROOT, 'src/trivium/probes');
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.ts'));
  assert.ok(files.length > 0, '探针目录不该是空的——扫描范围写错了会让本条永绿');

  // 逐语句而非逐行匹配：多行 import 块的 `from '...'` 常单独占一行，逐行正则会漏检
  const IMPORT_RE = /^\s*import\s+(?:type\s+)?[\s\S]*?from\s+['"]([^'"]+)['"]/gm;
  const offenders: string[] = [];
  let exceptionHits = 0;

  for (const f of files) {
    const src = await fs.readFile(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const target = m[1]!;
      if (ALLOWED_TARGETS.some((re) => re.test(target))) continue;
      if ((NAMED_EXCEPTIONS.get(f) ?? []).includes(target)) {
        exceptionHits += 1;
        continue;
      }
      const line = src.slice(0, m.index).split('\n').length;
      offenders.push(`probes/${f}:${line}  import … from '${target}'`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    '探针文件出现了允许清单之外的 import，可能是把编排层依赖搬进了 probes/：\n' +
      offenders.join('\n') +
      "\n  若确属新的基础模块依赖，请在允许清单里登记并说明理由；" +
      '若只是个别文件的例外，按 probes/env.ts → ../init.js 的形态具名登记为例外。',
  );

  // 防空转腿（黑名单形态的教训，AGENTS.md 纪律 12）：例外登记必须真的命中过至少一次
  assert.ok(exceptionHits > 0, '具名例外一次都没命中——契约可能已经空转');

  // 防腐烂腿（EV-74 计划 r5，CODEX-01）：已登记例外指向的文件必须仍然存在，否则例外已过期
  for (const [file, targets] of NAMED_EXCEPTIONS) {
    for (const target of targets) {
      const resolved = path.resolve(dir, target.replace(/\.js$/, '.ts'));
      const stillExists = await fs.stat(resolved).then(() => true, () => false);
      assert.ok(
        stillExists,
        `具名例外 probes/${file} → ${target} 指向的文件已不存在（${resolved}），例外应当删除`,
      );
    }
  }
});


// ───────── 6. 适配层不得字面重建探针落盘的 argv 片段（M9 工前，BACKLOG EV-12）─────────

/**
 * 黑名单**按出处分两族**，因为两族的「防空转」判据根本不同（代码双审 r2 CODEX-05）。
 *
 * 初版把六个 token 摊成一个扁平数组，防空转一律判「该 token 还在 `probes/` 出现」。
 * 那对 `--allowed-tools` 是错的：它是为防「抄那份已作废的 §7.2 调用模板」而加的，
 * 而它在探针侧的地位是**刻意保留的负向候选**（M0 实测被 CLI 拒）。将来谁清理那条
 * 已知不成立的候选——完全合理的动作——第二腿当场红，而红之后最省事的修法就是
 * 往黑名单里删条目：被削掉的恰恰是「抄作废模板」那一半，且删除者会以为自己在修空转。
 */
/**
 * **token → 归属厂商**的映射（BACKLOG EV-39，M9 第 3 步落地）。
 *
 * ## 为什么值是 import 进来的常量本体，不是手抄一份
 *
 * 上一版是把六个 token 手抄成一个扁平数组。手抄的那份与探针那份是两处事实，
 * 改一处另一处还在，而「反向对账」腿正是为了盯这个——但对账本身也要有人写对。
 * 这里改成**直接引用常量本体**，于是漏同步在结构上不可能发生：
 * 探针加一项，这里自动跟着有。
 *
 * ## 归属怎么派生而不手工枚举
 *
 * 键取 **cliName**（= 探针文件的 basename，也是注册表里那一家的 CLI 名）。
 * 手工写的只剩「哪个常量属于哪个 cliName」这两行，而**漏写一行会被腿 5c 打红**
 * （它扫 `probes/` 下所有以 `READONLY_INVARIANTS` 结尾的导出常量，
 * 要求每个都在本表里登记）。这就是 EV-39 要的「由探针字段派生」的可落地版本。
 */
const PROBE_RECIPE_BY_CLI: ReadonlyMap<string, readonly string[]> = new Map([
  ['claude', READONLY_INVARIANTS],
  ['codex', CODEX_READONLY_INVARIANTS],
]);

/**
 * 刻意放过的 token：两字符旗标名，锁它必然误伤
 * （设计 §11.1 判据三的「不覆盖形态」表里具名登记过）。
 */
const IGNORED_TOKENS: ReadonlySet<string> = new Set(['-s']);

/** 展开成扁平集合供分词器比对用（归属判定另走 `ownersOf`） */
const PROBE_RECIPE_TOKENS: readonly string[] = [
  ...new Set(
    [...PROBE_RECIPE_BY_CLI.values()].flat().filter((t) => !IGNORED_TOKENS.has(t)),
  ),
];

/**
 * 一个 token 归属哪几家。**返回集合而不是单值**（计划双审 CODEX-06）。
 *
 * EV-39 的立条前提逐字写着「M10/M11 接入的家**若也用**这类通用名」——
 * 归属天然是多值的。上一版设计过一条「归属不得重叠」的断言，那与立条前提直接冲突：
 * 重叠发生的那天它当场红，而唯一出路是改断言或把 token 塞进 `IGNORED_TOKENS`，
 * **即 EV-39 明写要防的那种削弱**。
 */
function ownersOf(token: string): string[] {
  return [...PROBE_RECIPE_BY_CLI.entries()]
    .filter(([, tokens]) => tokens.includes(token))
    .map(([cli]) => cli);
}

/**
 * 某个适配器文件是不是这家自己的。
 *
 * 判据是**文件名前缀**：`<cli>.ts` 或 `<cli>-*.ts`。这条派生真的成立、不是巧合——
 * 现存 `agy.ts`/`agy-events.ts`、`zcode.ts`/`zcode-trace.ts`、
 * `codex.ts`/`codex-trace.ts`/`codex-home.ts`、`claude.ts`/`claude-trace.ts`
 * 四家的 cliName 与文件名前缀逐一对上，而 `base.ts`/`index.ts`/`stub.ts` 不归任何家。
 */
function ownsAdapterFile(cli: string, relFile: string): boolean {
  const b = path.basename(relFile, '.ts');
  return b === cli || b.startsWith(`${cli}-`);
}

/**
 * 分解形加强判据：把逗号连写的 token 拆开，**并按集合判子集**。
 *
 * 缺它会漏掉一种最自然的规避：黑名单里的是**逗号连写**的工具列表，
 * 而 `quotedTokens` 按空白切分——写成三个独立字面量时三段都不在黑名单里，**全绿**。
 * 那正是白名单派生被绕过后最省事的写法。
 *
 * ## 三处漏检，代码双审 r1 三侧各指出一个（CODEX-05 ≡ AGY-01 ≡ GLM-04）
 *
 * 上一版的门是 `cliOfFile && basename === cliOfFile`，即**只对归属家自己的
 * `<cli>.ts` 生效**，且分解形集合只取该家自己的。三个后果：
 *
 * 1. **跨厂商文件整段 no-op**（CODEX-05，证据最硬）：
 *    `CODEX_READONLY_INVARIANTS = ['-s','read-only']` **没有逗号项**，
 *    于是 `decomposedTokensOf('codex')` 是**空集**。把 claude 的三个裸工具名
 *    写进 `adapters/codex.ts`，全形黑名单（逗号连写）与分解形（空集）
 *    **两腿都不命中 ⇒ 全绿**。而③跨厂商错用腿立条的理由逐字是
 *    「别家文件里出现这个 token 几乎一定是抄错了配方」——同一个错误换个写法就漏了。
 * 2. **逗号子集 / 重排漏检**（AGY-01）：`'Read,Grep'` 既不等于完整配方串、
 *    也不匹配任何单项，**两头不沾**。
 * 3. **实现排除的比理由宽**（GLM-04）：理由只排除 trace/events 族，
 *    而实现把自家名下**全部非主文件**都排除了；未来重构出 `<cli>-args.ts`
 *    并在里面拆散工具列表，可同时逃过两腿——守卫随一次重构静默收窄。
 *
 * ## 现在的判据
 *
 * 论域 = **所有适配器文件 − 分类文件豁免表**（`<cli>-trace.ts` / `<cli>-events.ts`
 * 一族，它们按职责就要出现裸工具名做事件分类，`zcode-trace.ts` 的
 * `ZCODE_READ_TOOLS` 是现成先例）。token 取**全部家的并集**，不再按文件归属挑。
 */
const DECOMPOSED_EXEMPT_SUFFIXES: readonly string[] = ['-trace', '-events'];

/** 该文件是不是「按职责需要裸工具名」的分类文件 */
function isClassifierFile(relFile: string): boolean {
  const b = path.basename(relFile, '.ts');
  return DECOMPOSED_EXEMPT_SUFFIXES.some((suf) => b.endsWith(suf));
}

/**
 * 全部家的分解形 token 并集（去空白归一）。
 *
 * **归一要去空白**（CODEX-05 的第二半）：`'Read, Grep, Glob'` 按 `,` 切出来的是
 * `Read` / ` Grep` / ` Glob`，不 trim 就对不上。
 */
function allDecomposedTokens(): Set<string> {
  const out = new Set<string>();
  for (const tokens of PROBE_RECIPE_BY_CLI.values()) {
    for (const t of tokens) {
      if (!t.includes(',')) continue;
      for (const part of t.split(',')) {
        const v = part.trim();
        if (v && !IGNORED_TOKENS.has(v)) out.add(v);
      }
    }
  }
  return out;
}

/**
 * 一个带引号的字面量是不是「某家配方的逗号子集或重排」。
 *
 * 判据：按 `,` 切开、去空白、去空项之后，**元素数 ≥ 2 且全部属于同一家的分解形集合**。
 * 于是 `'Read,Grep'`（子集）、`'Glob,Read,Grep'`（重排）、`'Read, Grep, Glob'`（带空格）
 * 都会被认出来，而普通的逗号串（如 `'a,b'`）不会。
 */
function decomposedSubsetOwner(raw: string): string | null {
  if (!raw.includes(',')) return null;
  const parts = raw.split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  for (const [cli, tokens] of PROBE_RECIPE_BY_CLI.entries()) {
    const own = new Set<string>();
    for (const t of tokens) {
      if (!t.includes(',')) continue;
      for (const part of t.split(',')) {
        const v = part.trim();
        if (v) own.add(v);
      }
    }
    if (own.size > 0 && parts.every((x) => own.has(x))) return cli;
  }
  return null;
}

/** 已作废的演进设计 §7.2 模板所写的旗标名——不依赖探针，防空转判据另设（见第二腿） */
const DEPRECATED_TEMPLATE_TOKENS: readonly string[] = ['--allowed-tools'];

const BANNED_PROBE_TOKENS: readonly string[] = [
  ...PROBE_RECIPE_TOKENS,
  ...DEPRECATED_TEMPLATE_TOKENS,
];

/**
 * 取出源码里所有带引号字面量的内容，按空白切成 token，并**归一 token 边界**。
 *
 * 归一是双向的（代码双审 r2 GLM-02）：
 *   - 漏的方向：`'--tools=Read,Grep,Glob'` 值连写是不可再切的单 token，
 *     而本仓 `zcode.ts` 自己就写明「`=` 是标准长参数写法」；
 *   - 误伤的方向：中文报错文案里旗标名常黏着标点（`adapters/codex.ts` 的
 *     `（read-only 下文件仍被创建…`），只因全角括号才幸免。
 *
 * **在全文上跑、由偏移反算行号**，不逐行切：剥离器保证模板字面量可跨行，
 * 逐行切会让跨行串的中间行取不到成对引号而静默返回空集（r2 AGY-01 ≡ CODEX-04 ≡ GLM-05）。
 */
function quotedTokens(src: string): Array<{ token: string; line: number; whole: string }> {
  const out: Array<{ token: string; line: number; whole: string }> = [];
  const re = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    const line = src.slice(0, m.index).split('\n').length;
    // `whole` 是这条字面量的**完整内容**（不含引号）。④-a 判整体、④-b 判切片，
    // 两者判据不同却共用一次扫描——所以两样都要带出去（r3 CODEX-06）
    const whole = m[2] ?? '';
    for (const raw of whole.split(/\s+/)) {
      if (!raw) continue;
      // 两端剥非旗标字符（中英文标点、括号），再把 `--flag=value` 切成两半
      const trimmed = raw.replace(/^[^\w-]+/u, '').replace(/[^\w,./-]+$/u, '');
      if (!trimmed) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        out.push({ token: trimmed.slice(0, eq), line, whole });
        const val = trimmed.slice(eq + 1);
        if (val) out.push({ token: val, line, whole });
      } else {
        out.push({ token: trimmed, line, whole });
      }
    }
  }
  return out;
}

/**
 * **文案豁免**：按 `file → token → 理由` 具名登记，形态沿用本文件的 `LITERAL_ALLOWLIST`。
 *
 * 为什么要有这一层：边界归一（剥两端标点）把漏的方向收住了，代价是**误伤的方向张开了**
 * ——中文报错文案里旗标名常黏着全角标点，剥掉之后就是一个裸 token。
 * 代码双审 r2 GLM-02 预言了这一格，BACKLOG EV-39 更写明：
 * **「误伤时最可能的修法是往黑名单里删条目（削弱守卫），而不是加豁免」**。
 * 这里就是那个豁免口，加在这里比删 `BANNED_PROBE_TOKENS` 便宜得多、也安全得多。
 *
 * 准入很窄：**只收 `availability()` / 报错文案这类用户可见字符串**，
 * 即「该 token 出现在这里不是为了拼 argv」。凡是进 argv 的一律不豁免。
 */
/**
 * ④-a / ④-b 的判据本体，**主扫与反面夹具共用同一份**。
 *
 * 抽出来的理由是 CODEX-06 要的那条反面夹具：夹具若自己重写一遍判据，
 * 就成了「两份手写判据」，会随措辞漂移而无物报警——本仓对这个形状的定性
 * 一贯比缺陷本身更重（见准入脚本「判据一律 import 探针 judge*」那条）。
 *
 * 返回 offender 描述串，空数组即这份源码没有分解形规避。
 */
function decomposedOffendersIn(rel: string, raw: string): string[] {
  const out: string[] = [];
  const decomposed = allDecomposedTokens();
  for (const { token, line, whole } of quotedTokens(stripCommentsKeepStrings(raw))) {
    if (isProseException(rel, token)) continue;
    // ④-a 单项分解形：`'Read'` 这类**独占整条字面量**的裸工具名
    if (decomposed.has(token) && whole.replace(/\s+/g, '') === token) {
      out.push(`${rel}:${line}  ${token}  [分解形：把逗号连写的安全不变量拆开写，逃过了全形黑名单]`);
      continue;
    }
    // ④-b 逗号子集 / 重排 / 带空格：`'Read,Grep'`、`'Glob,Read,Grep'`、`'Read, Grep, Glob'`
    const owner = decomposedSubsetOwner(token);
    if (owner) {
      out.push(`${rel}:${line}  ${token}  [分解形子集/重排：${owner} 家配方的一个子集，两头不沾全形黑名单]`);
    }
  }
  return out;
}

const PROSE_EXCEPTIONS: ReadonlyArray<{ file: string; token: string; why: string }> = [
  {
    file: 'src/trivium/adapters/codex.ts',
    token: 'read-only',
    why: 'availability() 的不可用理由文案：「（read-only 下文件仍被创建时探针会把该字段清空）」。'
      + '这是讲给用户听的成因说明，不进 argv；只读旗标本身仍由 readonlyArgsFromProbe 透传。',
  },
];

function isProseException(relFile: string, token: string): boolean {
  return PROSE_EXCEPTIONS.some((e) => e.file === relFile && e.token === token);
}

test('文案豁免纪律：每条都要写明理由，且不得豁免已经不存在的命中', async () => {
  // 与 LITERAL_ALLOWLIST 的两条纪律同构：豁免必须有理由，且必须**仍然被需要**——
  // 否则它会沉淀成一张没人敢动的清单，下一次真误伤时反而被当成先例扩大。
  for (const e of PROSE_EXCEPTIONS) {
    assert.ok(e.why.trim().length > 20, `豁免 ${e.file}/${e.token} 没写明理由`);
  }
  const banned = new Set(BANNED_PROBE_TOKENS);
  for (const e of PROSE_EXCEPTIONS) {
    const raw = await fs.readFile(path.join(REPO_ROOT, e.file), 'utf8');
    const hit = quotedTokens(stripCommentsKeepStrings(raw))
      .some((t) => t.token === e.token && banned.has(t.token));
    assert.ok(hit, `豁免 ${e.file}/${e.token} 已经不被需要（该文件里不再有这个命中），请删掉它`);
  }

  /*
   * **排他：豁免只能开给 token 归属家自己的文件**（BACKLOG EV-39 的真正堵口）。
   *
   * 这才是「比现状更严」的那一半。现状是任一适配器出现任一 token 即红，
   * 而误伤时最省事的修法是**往黑名单里删条目**——EV-39 逐字写明要防这个。
   * 加了归属分治之后，误伤只能从**自家**豁免；跨家想豁免直接不允许，
   * 因为别家文件里出现这个 token 几乎一定是抄错了配方，那正是要盯的东西。
   *
   * 现存唯一一条豁免（read-only @ adapters/codex.ts）恰好合规：改动零行为、
   * 新增一条不可绕过的边界。
   */
  for (const e of PROSE_EXCEPTIONS) {
    const owners = ownersOf(e.token);
    if (owners.length === 0) continue; // 作废模板族不按厂商分，不受本条约束
    const rel = e.file.replace(/^src\/trivium\//, '');
    assert.ok(
      owners.some((c) => ownsAdapterFile(c, rel)),
      `豁免 ${e.file}/${e.token} 跨了厂商：该 token 归属 ${owners.join('、')}，` +
        '别家文件里出现它是跨厂商错用，不得用文案豁免放行',
    );
  }
});

test('架构契约：adapters/ 不得字面重建探针的安全不变量', async () => {
  /*
   * 设计 11.1「旗标归属判据」判据二：`readonly_flags` 装的若是**可直接使用的
   * argv 片段**（claude 的 `READONLY_INVARIANTS`、codex 的 `CODEX_READONLY_INVARIANTS`），
   * 适配层必须**原样透传**，不得自己拼字面量。
   *
   * 为什么：这些值是**负对照挣来的实测结论**——探针让模型真去写文件、文件没被创建
   * 才记下它们。适配层一旦字面重建，就把「本机实测证明它管用」偷换成
   * 「文档上写着它应该管用」；而 codex 侧空数组的正确含义是「本机沙箱不可信、
   * 该侧判不可用」，不是「回落到默认值」。claude 侧更硬：漏掉 `--strict-mcp-config`
   * 会让 MCP 的写工具进入审查会话工具面，那是能越出项目边界的失守面，且成本约 24 倍。
   *
   * **不扫 zcode 的 `--mode` / `--disallowed-tools`**：那家的 readonly_flags 装的是
   * **候选串的接受记录**而非可用 argv，旗标名出现在适配层是设计如此。
   *
   * ## 覆盖面：已知形态，不是完备（设计 11.1 判据三有同一张表）
   *
   * 守住的是「引号包裹的字面量内容、按空白切分并归一边界后命中黑名单」。
   * 覆盖复合串（`'--a --b'.split(' ')`）、跨行模板串、值连写（`--tools=X`）、
   * 标点黏连。**追不到**的形态见下方 `不覆盖形态` 夹具——每一类都有一条
   * 期望**不红**的用例锁着，而不是只在散文里声明（r2 CODEX-04）。
   */
  const adapterFiles = await collectSourceFiles(path.join(REPO_ROOT, 'src/trivium/adapters'));
  assert.ok(adapterFiles.length > 0, '适配层目录不该是空的——扫描范围写错了会让本条永绿');

  /*
   * **判定分三格，不是二格**（BACKLOG EV-39，M9 第 3 步）。
   *
   * 两份上游文字互为补充，**按任一字面单独实现都会让主守卫反向失效**：
   *   - BACKLOG EV-39 原句「只对该厂商自己的适配器判红」⇒ 跨厂商错用漏检；
   *   - 裁决件 §2.5 bullet 3「只允许出现在该厂商的适配器」若被**孤立**读成判绿规则
   *     ⇒ 自家字面重建漏检，直接违反判据二。
   * 而 §2.5 的 bullet 1 逐字是「按归属厂商判红」——①+③ 的合取才是完整语义，
   * 落地取那个合取：**两种情形都红，但归因分开、豁免面按归属收窄**。
   */
  const deprecated = new Set(DEPRECATED_TEMPLATE_TOKENS);
  const recipe = new Set(PROBE_RECIPE_TOKENS);
  const offenders: string[] = [];
  for (const abs of adapterFiles) {
    const raw = await fs.readFile(abs, 'utf8');
    const rel = path.relative(REPO_ROOT, abs);
    const cliOfFile = [...PROBE_RECIPE_BY_CLI.keys()].find((c) => ownsAdapterFile(c, rel)) ?? null;

    for (const { token, line } of quotedTokens(stripCommentsKeepStrings(raw))) {
      if (isProseException(rel, token)) continue;

      // ① 作废模板族：全局生效，不按厂商——该族的威胁模型与抄进哪家无关
      if (deprecated.has(token)) {
        offenders.push(`${rel}:${line}  ${token}  [抄了已作废的演进设计 §7.2 模板]`);
        continue;
      }
      if (!recipe.has(token)) continue;

      const owners = ownersOf(token);
      if (cliOfFile && owners.includes(cliOfFile)) {
        // ② 自家字面重建：违反判据二
        offenders.push(`${rel}:${line}  ${token}  [字面重建自家安全不变量 → 改用 readonlyArgsFromProbe 透传]`);
      } else {
        // ③ 跨厂商错用：该 token 不归这个文件的家（含 base/index/stub 这类不归任何家的文件）
        offenders.push(
          `${rel}:${line}  ${token}  [跨厂商错用：该 token 归属 ${owners.join('、') || '(无)'}]`,
        );
      }
    }

    /*
     * ④ **分解形加强判据**：论域是**所有适配器文件 − 分类文件**（trace/events 族）。
     *
     * 不再只对归属家的 `<cli>.ts` 生效——那样会让跨厂商文件整段 no-op
     * （codex 家配方无逗号项 ⇒ 集合为空），而③立条的理由正是要盯跨厂商错用
     * （代码双审 r1 CODEX-05 ≡ AGY-01 ≡ GLM-04）。
     */
    if (!isClassifierFile(rel)) {
      /*
       * ④-a 判**整条字面量**，不判切出来的片段（代码双审 r3 CODEX-06）。
       *
       * r2 §2.10 承诺过「去空白后**整体等于**某个分解形 token」，理由是扩域
       * （从「归属家的 <cli>.ts」扩到「所有非分类适配器文件」）会把散文也卷进来：
       * `'Read tool unavailable'` 这种字符串按空白切开后，片段 `Read` 当场命中，
       * 唯一出口是 `PROSE_EXCEPTIONS`——而它的粒度已自记为过粗（EV-45）。
       *
       * **那条承诺没落地**：实现与 r1 逐字相同，扩域做了、扩域的副作用收口没做。
       * 当前仓里恰好没有这样的字符串，所以它一直是绿的——
       * 典型的「先绿着、等下一次真实文案出现」。
       *
       * 现在按承诺实现：整条字面量去空白后整体等于某个 token 才算规避。
       * 逗号连写形态（`'Read,Grep'`）由 ④-b 覆盖，两者不重叠。
       */
      offenders.push(...decomposedOffendersIn(rel, raw));
    }
  }

  assert.deepEqual(
    offenders,
    [],
    '适配层出现了不该出现的 argv token（违反 11.1 旗标归属判据二 / EV-39 排他判据）：\n' +
      offenders.join('\n') +
      '\n  自家的：必须经 readonlyArgsFromProbe 从 probe.<cli>.readonly_flags 原样取用——' +
      '字面重建等于把「实测证明它管用」换成「文档上写着它应该管用」。' +
      '\n  别家的：几乎一定是抄错了配方，那正是跨厂商错用要盯的东西。',
  );
});

test('架构契约：黑名单两族各自的防空转判据', async () => {
  /*
   * 防空转分两条，因为两族 token 的「还算数吗」判据不同（r2 CODEX-05）。
   *
   * 另有**反向对账**（r2 CODEX-03）：初版只防「token 被从探针删掉」这一个方向，
   * 没有防「探针新增一条硬前置而黑名单不跟」——而 `--strict-mcp-config` 本身
   * 就是实测后才升为硬前置的，这条路走过一次。缺了反向对账，M9 适配器字面重建
   * 那条新旗标同样不红，而注释却写着「任一项即判红」。
   */
  /*
   * ── 腿 5：**派生关系没被绕过**（EV-39 换掉了已退化的反向对账）──
   *
   * 旧的反向对账断言「探针常量 ⊆ 黑名单」。那在手抄年代有意义，而 M9 第 3 步
   * 把 `PROBE_RECIPE_TOKENS` 改成**从常量本体派生**之后，它**恒真** ⇒ 就是空转。
   * 留着一条恒真的断言比没有更糟：它看起来在守，实际什么都不守。
   *
   * 换成四条真能红的：
   */
  // 5a：映射的键必须是注册表里真实存在的 cliName
  const knownClis = new Set(AGENTS.map((a) => a.cliName));
  for (const cli of PROBE_RECIPE_BY_CLI.keys()) {
    assert.ok(knownClis.has(cli), `PROBE_RECIPE_BY_CLI 的键「${cli}」不是注册表里的 cliName`);
  }

  /*
   * 5b：映射的值必须与 import 进来的常量**同一份**，不许就地抄一份。
   *
   * **判据是引用相等，不是 `deepEqual`**（代码双审 r1 GLM-03）：
   * `deepEqual` 只比内容，把 `['claude', READONLY_INVARIANTS]` 改成
   * `['claude', [...READONLY_INVARIANTS]]` 这类就地抄本**照样绿**。
   * 此后探针常量再新增硬前置项时不会流进映射，而现役各腿全都不响——
   * 5c 只按文件名查登记，正向防空转腿只抓「token 从探针消失」的**删除**方向，
   * 抓不到「新增项没进黑名单」的**添加**方向。
   *
   * 也就是说 EV-39 最重要的收益（派生关系结构性成立）有一半靠这条腿守着，
   * 而上一版的它**守不住自己声称守的编辑形态**——那正是本轮被三侧打中三次的
   * 「声称强于事实」。
   */
  assert.ok(
    PROBE_RECIPE_BY_CLI.get('claude') === READONLY_INVARIANTS,
    'claude 的映射值不是 READONLY_INVARIANTS 本身——就地抄一份会让新增项不流进黑名单',
  );
  assert.ok(
    PROBE_RECIPE_BY_CLI.get('codex') === CODEX_READONLY_INVARIANTS,
    'codex 的映射值不是 CODEX_READONLY_INVARIANTS 本身',
  );

  /*
   * 5c：**probes/ 下每个只读不变量常量都要在本表里登记**。
   *
   * 这是 EV-39 要的「归属由探针字段派生而不手工枚举」的可落地版本：
   * 手工写的那两行仍在，但**第五家探针加了常量而映射没跟上，这里当场红**。
   */
  const probeSrcFiles = await fs.readdir(path.join(REPO_ROOT, 'src/trivium/probes'));
  const unregistered: string[] = [];
  for (const f of probeSrcFiles.filter((x) => x.endsWith('.ts'))) {
    const raw = await fs.readFile(path.join(REPO_ROOT, 'src/trivium/probes', f), 'utf8');
    if (!/export const \w*READONLY_INVARIANTS\b/.test(raw)) continue;
    const cli = path.basename(f, '.ts');
    if (!PROBE_RECIPE_BY_CLI.has(cli)) unregistered.push(f);
  }
  assert.deepEqual(
    unregistered,
    [],
    'probes/ 下有只读不变量常量，但 PROBE_RECIPE_BY_CLI 没登记它的归属：\n  ' +
      unregistered.join('、') +
      '\n  不登记的话，那一家的 token 在任何适配器里都不会被判红。',
  );

  /*
   * 5d（原腿 4）：**某家有配方 token，却没有它的适配器文件 ⇒ 归属判据对它生效于空集**。
   *
   * 这条正是 EV-39 当初暂缓的那句话的机器化版本——「现在把 claude 的三个 token
   * 限定到该文件，等于让它们对空集生效」。文件一建就绿，**理由消失这件事因此
   * 变成可核的，而不是靠人记得**。
   */
  const adapterRels = (await collectSourceFiles(path.join(REPO_ROOT, 'src/trivium/adapters')))
    .map((abs) => path.relative(REPO_ROOT, abs));
  for (const cli of PROBE_RECIPE_BY_CLI.keys()) {
    assert.ok(
      adapterRels.some((rel) => ownsAdapterFile(cli, rel)),
      `${cli} 的配方 token 已登记，但 adapters/ 下没有它的文件——归属判据对它生效于空集`,
    );
  }

  // ── 正向防空转（配方族）：token 必须还是探针代码在用的字面量 ──
  const probeFiles = await collectSourceFiles(path.join(REPO_ROOT, 'src/trivium/probes'));
  assert.ok(probeFiles.length > 0, '探针目录不该是空的——扫描范围写错了会让本腿永绿');
  const seen = new Set<string>();
  for (const abs of probeFiles) {
    const raw = await fs.readFile(abs, 'utf8');
    for (const { token } of quotedTokens(stripCommentsKeepStrings(raw))) seen.add(token);
  }
  const stale = PROBE_RECIPE_TOKENS.filter((t) => !seen.has(t));
  assert.deepEqual(
    stale,
    [],
    '配方族 token 已不在 probes/ 出现，上半条对它已退化为空转：\n  ' +
      stale.join('、') +
      '\n  探针不再使用该旗标时，必须同步更新 PROBE_RECIPE_TOKENS 并复核 11.1 判据二。',
  );

  /*
   * ── 作废模板族：判据是「它仍被设计正文列为作废旗标」，**不依赖探针** ──
   *
   * 这一族的立条理由是「防抄 §7.2 那份已作废的模板」，与探针是否还在试它无关。
   * 把判据挂到探针上（初版的做法）会让「清理探针里的死候选」这个合理动作
   * 把守卫削掉一半。
   */
  const designPath = path.join(
    REPO_ROOT,
    'doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md',
  );
  const design = await fs.readFile(designPath, 'utf8');
  const unlisted = DEPRECATED_TEMPLATE_TOKENS.filter((t) => !design.includes(t));
  assert.deepEqual(
    unlisted,
    [],
    '作废模板族 token 已不在设计 3.7.1 的作废清单里，本族已退化为空转：\n  ' +
      unlisted.join('、') +
      '\n  该族不依赖探针，判据是设计正文仍把它列为作废旗标。',
  );
});

test('不覆盖形态：六类逐条锁住「确实扫不到」，不留散文断言', () => {
  /*
   * 设计 11.1 判据三登记了若干「追不到」的形态。此前它们只是散文，
   * 没有一条锁住「这些确实扫不到」——于是实现改动后，登记表可能悄悄变得比实现保守
   * 或比实现激进，两个方向都没人发现（r2 CODEX-04）。
   *
   * 下面每一条都**期望不命中**。哪天实现变强了，这里会红——那是好事，
   * 提示去把登记表那一行删掉，而不是反过来。
   */
  const banned = new Set(BANNED_PROBE_TOKENS);
  const hits = (src: string) => quotedTokens(src).filter((t) => banned.has(t.token)).map((t) => t.token);

  // ① 字符串拼接
  assert.deepEqual(hits(`const a = '--' + 'restricted';`), [], '拼接：登记为不覆盖');
  // ② 模板插值分段
  assert.deepEqual(hits('const a = `--restricted${x}`;'), [], '模板插值：登记为不覆盖');
  // ③ 数组拼装
  assert.deepEqual(hits(`const a = ['-','-restricted'].join('');`), [], '数组拼装：登记为不覆盖');
  // ④ 正则字面量内（剥离器整段跳过；probes/codex.ts 有现网实例）
  assert.deepEqual(
    quotedTokens(stripCommentsKeepStrings('const re = /read-only|sandbox/i;'))
      .filter((t) => banned.has(t.token)),
    [],
    '正则内：剥离器整段跳过，登记为不覆盖',
  );
  // ⑤ 短旗标名 -s（只锁值，不锁名）
  assert.deepEqual(hits(`const a = ['-s', probeValue];`), [], '短旗标名：刻意放过');
  // ⑥ 跨文件常量中转（此处只锁「本文件看不见」这一事实）
  assert.deepEqual(hits(`import { FLAGS } from './elsewhere.js'; const a = [...FLAGS];`), [], '跨文件中转：登记为不覆盖');

  // ── 反面：这些**必须**命中，否则上面六条的「不命中」没有意义 ──
  assert.deepEqual(hits(`const a = '--restricted';`), ['--restricted'], '裸字面量必须命中');
  assert.deepEqual(
    hits(`const a = '--restricted --strict-mcp-config'.split(' ');`),
    ['--restricted', '--strict-mcp-config'],
    '复合串必须命中',
  );
  assert.deepEqual(hits(`const a = '--tools=Read,Grep,Glob';`), ['--tools', 'Read,Grep,Glob'], '值连写必须命中');
  assert.deepEqual(hits('const a = `\n  --restricted\n`;'), ['--restricted'], '跨行模板串必须命中');
  assert.deepEqual(hits(`throw new Error('缺少 --restricted，请重跑 doctor');`), ['--restricted'], '标点黏连必须命中');
});

test('镜头键对账：lenses.yaml 顶层键必须是注册表里的 Agent id', async () => {
  /*
   * 「四键齐备」是设计 §9.3 写下的承诺，但缺键的失败模式是**静默降级**
   * （`brief.ts` 的 `lenses[critic]?.[stage] ?? 通用提示`）——键名写成 `claud:`
   * 或将来注册表改 id，那一侧就悄悄失去差异化视角，而这正是 §9.3 开头声明要防的
   * 「多审退化成同审」。`report` 的 Jaccard 提示按 lenses.yaml 自己的口径
   * 「长期 > 0.8」才触发，一两轮看不出来（r2 CODEX-08）。
   *
   * 纪律 10 把镜头键列为注册表派生项；同文件里对该纪律的其它派生项都有 grep 级用例，
   * 独缺这一条。
   */
  const raw = await fs.readFile(path.join(REPO_ROOT, 'skills/dual-critic/lenses.yaml'), 'utf8');
  const keys = [...raw.matchAll(/^([a-z][\w-]*):\s*$/gm)].map((m) => m[1] as string);
  assert.ok(keys.length > 0, '一个顶层键都没解析到——正则写错了会让本条永绿');

  const known = new Set<string>(AGENTS.map((a) => a.id));
  const unknown = keys.filter((k) => !known.has(k));
  assert.deepEqual(
    unknown,
    [],
    'lenses.yaml 有注册表里不存在的顶层键（拼写漂移会让那一侧静默降级为通用镜头）：\n  ' +
      unknown.join('、'),
  );

  const enabled = AGENTS.filter((a) => a.criticEnabled).map((a) => a.id);
  const missing = enabled.filter((id) => !keys.includes(id));
  assert.deepEqual(
    missing,
    [],
    '已启用为审核者的 Agent 缺镜头键，该侧会静默按通用标准审：\n  ' + missing.join('、'),
  );
});

test('④-a 反面夹具：散文里的工具名不得误伤，独占字面量必须抓住（r3 CODEX-06）', () => {
  /*
   * codex 要这条夹具的理由逐字是：「现在这条会红，夹具能让这个差异**无法靠措辞含混过去**」。
   *
   * 扩域（r1 CODEX-05）把论域从「归属家的 <cli>.ts」扩到「所有非分类适配器文件」，
   * 于是任何**带引号字符串**里出现独立的工具名词都会被判规避——包括讲给用户听的散文。
   * r2 §2.10 承诺连同扩域一起收口，**承诺没落地**（判据与 r1 逐字相同）。
   *
   * 两个方向都要锁：只锁「不误伤」会让判据退化成恒不报；
   * 只锁「抓得住」则回到 r1 那个误伤面。
   */
  const tool = [...allDecomposedTokens()][0];
  assert.ok(tool, '分解形 token 集合为空——判据指错了地方，下面两条都会恒真');

  const FAKE = 'src/trivium/adapters/__fixture__.ts';

  // 方向一：散文**不得**误伤。这正是扩域带来、而 r2 承诺收口却没收的那一面
  assert.deepEqual(
    decomposedOffendersIn(FAKE, `const msg = '${tool} tool unavailable';`),
    [],
    '散文里提到工具名不是「分解形规避」——把它判红只会逼出一条粒度过粗的豁免（EV-45）',
  );

  // 方向二：独占整条字面量的裸工具名**必须**抓住，这是 ④-a 存在的全部理由
  assert.equal(
    decomposedOffendersIn(FAKE, `const t = '${tool}';`).length,
    1,
    '裸工具名独占一条字面量，就是把逗号连写的安全不变量拆开写——必须报',
  );

  // 方向二之二：前后空白不算脱身（承诺原文是「**去空白后**整体等于」）
  assert.equal(
    decomposedOffendersIn(FAKE, `const t = '  ${tool}  ';`).length,
    1,
    '加几个空格不该让它逃掉——判据是去空白后整体相等',
  );
});
