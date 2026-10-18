/**
 * 配置项与消费方的对账（2026-09-16，BACKLOG EV-26 那一批）。
 *
 * ## 这条测试为什么存在
 *
 * `review.block_severities` 曾经有完整的类型定义、默认值、schema 校验与三处文档，
 * **全仓零消费方**——它进了每个项目 `init` 出来的配置文件，用户改它不会有任何效果。
 * 这不是孤例：`instructionFiles`（EV-06）与 `readonly_commands`（EV-15）同形，
 * 后者还顶着设计两处「把不存在的机制当前提」的论证。
 * （后续：EV-06 走了「接上」；`readonly_commands` 与 `max_check_retries` 于 2026-10-01 删除，
 * schema 仍按已废弃接受，见下方「两个空配置项收口」一组用例。EV-30 余下各条 2026-10-06、10-08 同一做法删完，
 * `KNOWN_DEAD` 自此为空。）
 *
 * 存量逐条裁另立主题。本条只做**防新增**：新加的配置项若没有任何代码读它，
 * 必须显式进 `KNOWN_DEAD` 并写明理由与去向，否则当场红。
 *
 * ## 判据的边界（如实写明，不当成完备）
 *
 * 判据是**属性访问形态**：`src/` 下除定义处以外出现过 `.<键名>`。
 * 取这个形态而不是裸键名，是因为裸键名会把**注释**算成消费方——
 * 当年三处注释提到 `readonly_commands`（都在说它没有消费方），裸匹配会让它被判成「活的」。
 *
 * 已知边界，两个方向都有：
 *   - **漏报**（判成活的、其实是死的）：注释里若写 `cfg.某键` 会命中。
 *     风险低——新增配置项时没人会先在注释里写属性访问。
 *   - **误报**（判成死的、其实是活的）：解构赋值 `const { parallel } = cfg.review`
 *     不带点，会被判成无消费方。目前全仓没有这种写法；真出现时把它加进
 *     `KNOWN_DEAD` 是错的，正确做法是改判据——所以这条边界写在这里而不是留给发现者猜。
 *
 * 更强的判据需要统一的配置访问器（现在全是 `cfg.review.xxx` 直接取值），
 * 那是一次跨模块重构，不在本批范围内，已登记待议。
 * **这条测试的目标是「防新增」，不是「完备地找出所有死配置」**——
 * 而它第一次运行就抓出了**七个**此前无人登记的存量（BACKLOG EV-30；原先逐条登记在 `KNOWN_DEAD` 里），
 * 是原先已知的两个（`block_severities`、`readonly_commands`）的三倍多。
 * （其中 `max_check_retries` 与 `readonly_commands` 于 2026-10-01 删除，EV-30 ① / EV-15；
 * 余下六条 2026-10-06 删两条、2026-10-08 删四条，EV-30 ②～⑦ 全部收口。）
 * 这个强度对目标绰绰有余，也说明这一类缺陷的真实规模比任何人估计的都大。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  defaultConfig,
  deprecatedConfigKeysIn,
  deprecatedConfigNotice,
} from '../../src/trivium/config.js';
import type { Config } from '../../src/trivium/types.js';
import { REPO_ROOT } from '../helpers/fixture.js';

/**
 * 已知无消费方、且**有意暂留**的配置项。
 *
 * **这份清单只许缩短，不许变长**——变长就是又放进来一个假承诺。
 * 新增配置项时若想加进来，先回答：为什么现在不接线、什么时候接、不接的话为什么不删。
 */
const KNOWN_DEAD: { key: string; why: string }[] = [
  /*
   * **现为空：本条测试第一次运行时抓出来的七条已全部收口**，没有一条走「接线」，全部删除——
   * 不再是「死配置」而是「已废弃键」（schema 仍接受、doctor / preflight 提示一条），
   * 由文件末尾的回归锁守着不许加回默认值：
   *   - 2026-10-01：`max_check_retries`（EV-30 ①），连同此前登记的 `readonly_commands`（EV-15）；
   *   - 2026-10-06：`parallel`（EV-30 ②）、`deny_via_cli`（EV-30 ③）；
   *   - 2026-10-08（M11 第 8 步）：`forbid_chars`（④）、`require_adjudication`（⑤）、`max_turns`（⑥）、
   *     `unsupported_override`（⑦）。删的理由逐条见 `config.ts` 的 `DEPRECATED_CONFIG_KEYS` 与 BACKLOG EV-30。
   *
   * 清单为空之后，上面那句「只许缩短、不许变长」就是「不许再有」：新增配置项要么有消费方，
   * 要么连同理由与去向写进来并经用户拍板——别为了让下一条对账变绿顺手加。
   */
];

/** 定义处：这些文件里出现键名是「声明」而不是「消费」，不计入 */
const DEFINITION_FILES = ['types.ts', 'config.ts'];

/**
 * 键名由用户/运行期决定的容器——它们**下一层**的键不是「配置项」。
 *
 * 例如 `profiles` 下是用户自定义的档位名、`agents` 下是 Agent id。
 * 把它们当配置项会造出永远消不掉的假阳性（档位叫什么名字，代码当然不会写死）。
 */
const DYNAMIC_CONTAINERS = new Set(['profiles', 'agents', 'auth', 'cli', 'effort']);

/**
 * 阶段名：`timeout_s.plan` 这类确实是配置项，但访问形态是 `cfg.review.timeout_s[stage]`，
 * 属性形态判据看不到它。它们由**容器键**（`timeout_s` / `min_tool_calls` …）的消费方代表——
 * 容器有人读，就说明这一族在生效。
 */
const STAGE_KEYS = new Set(['plan', 'code', 'bug']);

/** 递归收集 `src/` 下的 .ts 文件 */
async function collectSources(dir: string, out: string[] = []): Promise<string[]> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await collectSources(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * 该键是否以**属性访问形态**出现过——即有代码真的读它。
 *
 * 用 `.<键>` 而不是裸键名：裸匹配会把注释算成消费方。
 * 也接受方括号取值（`cfg.review['parallel']`），那同样是读。
 */
function hasPropertyAccess(src: string, key: string): boolean {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\.${k}\\b|\\[['"\`]${k}['"\`]\\]`).test(src);
}

/**
 * 递归取出配置对象里的**配置项**键名。
 *
 * 跳过两类不是配置项的键：动态容器下一层（档位名、Agent id …）与阶段名，
 * 理由见上面两个常量的说明。
 */
function configKeys(o: unknown, acc = new Set<string>(), inDynamic = false): Set<string> {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return acc;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (!inDynamic && !STAGE_KEYS.has(k)) acc.add(k);
    configKeys(v, acc, DYNAMIC_CONTAINERS.has(k));
  }
  return acc;
}

test('配置项对账：每个配置键都要有消费方，否则必须具名登记为已知死配置', async () => {
  const srcRoot = path.join(REPO_ROOT, 'src');
  const files = await collectSources(srcRoot);

  // 逐文件读一次，避免每个键都重扫全仓
  const consumers = new Map<string, string>();
  for (const f of files) {
    if (DEFINITION_FILES.includes(path.basename(f))) continue;
    consumers.set(path.relative(srcRoot, f), await fs.readFile(f, 'utf8'));
  }

  const cfg = defaultConfig() as unknown;
  const dead: string[] = [];
  for (const key of configKeys(cfg)) {
    // schema 标识不是「配置项」，跳过
    if (key === 'schema') continue;
    const used = [...consumers.values()].some((src) => hasPropertyAccess(src, key));
    if (!used) dead.push(key);
  }

  const registered = new Set(KNOWN_DEAD.map((d) => d.key));
  const unregistered = dead.filter((k) => !registered.has(k)).sort();

  assert.deepEqual(
    unregistered,
    [],
    '下列配置项在 src/ 下没有任何消费方——要么接线，要么删掉，要么进 KNOWN_DEAD 并写明理由：\n  ' +
      unregistered.join('\n  '),
  );
});

test('已知死配置清单不得留过期条目：登记了但其实有消费方，说明清单该缩短了', async () => {
  const srcRoot = path.join(REPO_ROOT, 'src');
  const files = await collectSources(srcRoot);

  const stale: string[] = [];
  for (const { key } of KNOWN_DEAD) {
    let used = false;
    for (const f of files) {
      if (DEFINITION_FILES.includes(path.basename(f))) continue;
      if (hasPropertyAccess(await fs.readFile(f, 'utf8'), key)) {
        used = true;
        break;
      }
    }
    if (used) stale.push(key);
  }

  assert.deepEqual(
    stale,
    [],
    '下列项已登记为「无消费方」，但 src/ 下确实有代码读它——请把它从 KNOWN_DEAD 里删掉：\n  ' +
      stale.join('\n  '),
  );
});

test('回归锁：被删掉的那个死配置不得再出现在默认配置或 schema 里', async () => {
  /*
   * `block_severities` 是本批删掉的那一个。它曾经三处齐全（类型、默认值、schema）
   * 而零消费方，且删除对测试套件**不可见**——新 init 的夹具用新代码生成、
   * 天然不含该键，全绿通过，破坏只发生在真实存量项目上。
   * 这条锁住「别再加回来」，而上面两条锁住「别再新增同形态的」。
   */
  const cfg = defaultConfig() as unknown;
  assert.ok(
    !configKeys(cfg).has('block_severities'),
    '默认配置里又出现了 block_severities——它已于 2026-09-16 删除（零消费方），不要加回来',
  );

  const schema = JSON.parse(
    await fs.readFile(
      path.join(REPO_ROOT, 'skills/dual-critic/schema/config.v2.json'),
      'utf8',
    ),
  ) as { properties: { review: { properties: Record<string, unknown>; required: string[] } } };
  const review = schema.properties.review;
  assert.ok(!('block_severities' in review.properties), 'config.v2 的 properties 里不该再有它');
  assert.ok(!review.required.includes('block_severities'), 'config.v2 的 required 里不该再有它');
});

// ── 两个空配置项收口（2026-10-01，EV-30 ① / EV-15；计划 r2 §3.4 / §3.6） ──

const DELETED_KEYS = [
  'max_check_retries', 'readonly_commands', 'parallel', 'deny_via_cli',
  // EV-30 ④～⑦（2026-10-08，M11 第 8 步）
  'forbid_chars', 'require_adjudication', 'max_turns', 'unsupported_override',
] as const;

test('回归锁：已删除的配置键（EV-15、EV-30 ①～⑦）不得再出现在默认配置或 schema 的 required 里', async () => {
  const keys = configKeys(defaultConfig() as unknown);
  for (const k of DELETED_KEYS) {
    assert.ok(!keys.has(k), `默认配置里又出现了 ${k}——它已删除（零消费方，见 DEPRECATED_CONFIG_KEYS），不要加回来`);
  }
  const schemaText = await fs.readFile(
    path.join(REPO_ROOT, 'skills/dual-critic/schema/config.v2.json'),
    'utf8',
  );
  const requiredLists: string[][] = [];
  const collect = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(collect);
    if (n === null || typeof n !== 'object') return;
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (k === 'required' && Array.isArray(v)) requiredLists.push(v as string[]);
      else collect(v);
    }
  };
  collect(JSON.parse(schemaText));
  for (const k of DELETED_KEYS) {
    assert.ok(
      requiredLists.every((r) => !r.includes(k)),
      `config.v2 的某个 required 里又出现了 ${k}——不带它的配置会因此校验失败`,
    );
  }
});

/** 默认配置叠上给定的已废弃键；`agyIds` 里的每个 id 都放一个 antigravity 条目并带 readonly_commands */
function cfgWith(opts: { gate?: boolean; agyIds?: string[] }): Config {
  const cfg = structuredClone(defaultConfig()) as unknown as {
    gate: Record<string, unknown>;
    agents: Record<string, Record<string, unknown>>;
  };
  if (opts.gate) cfg.gate['max_check_retries'] = 3;
  for (const id of opts.agyIds ?? []) {
    cfg.agents[id] = { ...(cfg.agents['gemini'] ?? {}), readonly_commands: ['git log'] };
  }
  return cfg as unknown as Config;
}

test('U4 已废弃键判定：五格各自只报实际出现的键；正文只列这些键、不带 ⚠️、无键时为 null', () => {
  const cases: { name: string; cfg: Config; want: string[] }[] = [
    { name: '都不带', cfg: cfgWith({}), want: [] },
    { name: '只带 gate', cfg: cfgWith({ gate: true }), want: ['gate.max_check_retries'] },
    { name: '只带 agents', cfg: cfgWith({ agyIds: ['gemini'] }), want: ['agents.gemini.readonly_commands'] },
    {
      name: '两个都带',
      cfg: cfgWith({ gate: true, agyIds: ['gemini'] }),
      want: ['gate.max_check_retries', 'agents.gemini.readonly_commands'],
    },
    {
      // 第二个键名排在 gemini 前面，验证 '*' 展开按键名排序、各列一条
      name: '两家 antigravity 条目',
      cfg: cfgWith({ agyIds: ['gemini', 'aaa-agy'] }),
      want: ['agents.aaa-agy.readonly_commands', 'agents.gemini.readonly_commands'],
    },
  ];
  for (const c of cases) {
    assert.deepEqual(deprecatedConfigKeysIn(c.cfg), c.want, c.name);
    const notice = deprecatedConfigNotice(c.cfg);
    if (c.want.length === 0) {
      assert.equal(notice, null, `${c.name}：无已废弃键时不出正文`);
      continue;
    }
    assert.ok(notice !== null, c.name);
    assert.ok(!notice.includes('⚠'), `${c.name}：正文不带 ⚠️（doctor 的 warn() 自带）`);
    assert.ok(notice.includes(`已废弃的键：${c.want.join('、')}。`), `${c.name}：正文应恰好列出 ${c.want.join('、')}——${notice}`);
    for (const k of ['gate.max_check_retries', 'readonly_commands']) {
      if (!c.want.some((w) => w.endsWith(k))) {
        assert.ok(!notice.includes(k), `${c.name}：没写的键 ${k} 不得出现在正文里——${notice}`);
      }
    }
    assert.match(notice, /从未生效/);
    assert.match(notice, /config\.yaml/);
  }
});

test('U8 流程文档回归锁：skills-src/ 全部文件与 skills/ 下全部 SKILL.md 不得再提已删除的配置键（EV-30 ①～⑦、EV-15）', async () => {
  /*
   * 防有人把「按配置重试 N 次」这类承诺写回流程文档——那正是 EV-30 ① 的起因。
   * 源目录里没有叫 SKILL.md 的文件（契约是 *.contract.md、片段是 *.md、载体是 *.yaml），
   * 所以对 skills-src/ 扫全部文件，对 skills/ 只扫渲染产物 SKILL.md（含 entry/ 副本）——
   * skills/ 下的 schema 刻意保留着两键（标 deprecated），不在扫描面里（计划 r2 §3.4，AGY-01）。
   */
  const walk = async (dir: string, keep: (name: string) => boolean, out: string[] = []): Promise<string[]> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p, keep, out);
      else if (keep(e.name)) out.push(p);
    }
    return out;
  };
  const files = [
    ...(await walk(path.join(REPO_ROOT, 'skills-src'), () => true)),
    ...(await walk(path.join(REPO_ROOT, 'skills'), (n) => n === 'SKILL.md')),
  ];
  assert.ok(files.length > 20, `扫描面太小，路径可能写错了：${files.length}`);
  const hits: string[] = [];
  for (const f of files) {
    const text = await fs.readFile(f, 'utf8');
    for (const k of DELETED_KEYS) if (text.includes(k)) hits.push(`${path.relative(REPO_ROOT, f)}：${k}`);
  }
  assert.deepEqual(hits, [], '流程文档里又出现了已删除的配置键：\n  ' + hits.join('\n  '));
});

test('U9「gate --check 重跑几次」的流程约定在各处源文件里是同一句、处数不缺（代码双审 r1 CODEX-02）', async () => {
  /*
   * `max_check_retries` 删掉后，这个数从配置降为散文，落在下表这些源文件里。
   * 本条守的是「同一句、一处不少」：将来改数字时改一处漏一处，这里会红——
   * `/dual-run` 的 S8 原本就漏写过上限，正是同族的形状。
   * 渲染产物（`skills/**\/SKILL.md`）不在这里：它们由 `entry-render-parity` 守住与源一致。
   * 主设计只数 §21 变更记录之前的正文（变更记录会引用这句，且只追加）。
   */
  const PHRASE = '重跑最多 3 次（首次校验不计';
  const DESIGN = 'doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md';
  const expected: { file: string; count: number; where: string; cut?: string }[] = [
    { file: 'skills-src/partials/review/body.md', count: 1, where: '第 6 步「校验裁决完整性」' },
    { file: 'skills-src/commands/run.contract.md', count: 2, where: 'S4 与 S8' },
    { file: DESIGN, count: 2, where: '7.4 步骤 6 与 8.6 步骤 6', cut: '\n## 21. 变更记录' },
    { file: 'doc/07_manuals/MANUAL_user.md', count: 1, where: '「已废弃的键」表' },
  ];
  const wrong: string[] = [];
  for (const e of expected) {
    let text = await fs.readFile(path.join(REPO_ROOT, e.file), 'utf8');
    if (e.cut !== undefined) {
      const i = text.indexOf(e.cut);
      assert.ok(i > 0, `${e.file} 里找不到切分锚点「${e.cut.trim()}」`);
      text = text.slice(0, i);
    }
    const n = text.split(PHRASE).length - 1;
    if (n !== e.count) wrong.push(`${e.file}（${e.where}）：期望 ${e.count} 处，实有 ${n} 处`);
  }
  assert.deepEqual(wrong, [], `「${PHRASE}…」这句不一致：\n  ` + wrong.join('\n  '));
});

test('U10 EV-30 ②③：review.parallel、isolation.deny_via_cli 出现时与旧两键一样只报实际出现的那几个；正文列出它们', () => {
  const base = () => structuredClone(defaultConfig()) as unknown as {
    review: Record<string, unknown>;
    isolation: Record<string, unknown>;
    gate: Record<string, unknown>;
  };
  const onlyParallel = base();
  onlyParallel.review['parallel'] = true;
  assert.deepEqual(deprecatedConfigKeysIn(onlyParallel as unknown as Config), ['review.parallel']);
  const onlyDeny = base();
  onlyDeny.isolation['deny_via_cli'] = 'auto';
  assert.deepEqual(deprecatedConfigKeysIn(onlyDeny as unknown as Config), ['isolation.deny_via_cli']);
  const all = base();
  all.gate['max_check_retries'] = 3;
  all.review['parallel'] = false;
  all.isolation['deny_via_cli'] = 'off';
  const want = ['gate.max_check_retries', 'review.parallel', 'isolation.deny_via_cli'];
  assert.deepEqual(deprecatedConfigKeysIn(all as unknown as Config), want, '按表序列出');
  const notice = deprecatedConfigNotice(all as unknown as Config);
  assert.ok(notice !== null && notice.includes(`已废弃的键：${want.join('、')}。`), String(notice));
  assert.equal(deprecatedConfigNotice(defaultConfig()), null, '默认配置不带任何已废弃键');
});

/*
 * **U11 M11 第 4 步：agents.codex.effort 按精确路径报废弃，同名的 agents.gemini.effort 不报**（设计 11.5 / 13.1.1，
 * 上位计划 r3 AGY-01）。gemini 那份有真实消费方（裸 slug 格子的思考等级回落）——废弃键表若用 `'*'` 通配，
 * 内置默认配置本身就会被报废弃。
 */
test('U11 agents.codex.effort 出现即报；agents.gemini.effort 不报；两者同在只报 codex 那条', () => {
  const base = () => structuredClone(defaultConfig()) as unknown as { agents: Record<string, Record<string, unknown>> };
  assert.ok('effort' in base().agents['gemini']!, '前提：默认配置带着 agents.gemini.effort');
  assert.deepEqual(deprecatedConfigKeysIn(base() as unknown as Config), [], 'gemini 的同名键不报');
  const withCodex = base();
  withCodex.agents['codex']!['effort'] = { plan: 'high', code: 'high', bug: 'high' };
  assert.deepEqual(deprecatedConfigKeysIn(withCodex as unknown as Config), ['agents.codex.effort']);
  const notice = deprecatedConfigNotice(withCodex as unknown as Config);
  assert.ok(notice !== null && notice.includes('已废弃的键：agents.codex.effort。'), String(notice));
  assert.ok(!notice.includes('gemini'), notice);
  assert.ok(!configKeys(defaultConfig().agents.codex as unknown).has('effort'), 'codex 默认值里不该再有 effort');
});

/*
 * **U12 schema 声明的可选键也要有消费方**（M11 第 4 步，计划 r2 §5.1）。
 *
 * 主对账只扫**默认配置**里出现的键；`tiers` / `default_tier` / `tier` 是可选键、默认值里没有（init 模板不写 tiers），
 * 主对账看不见它们。这里改从 schema 取：`agents` 四支与 `$defs` 里档位相关定义的全部**非 deprecated** 属性名。
 *
 * **判活局限如实写在这里**：判据仍是「定义文件之外有 `.键` 属性访问」。`tiers` / `default_tier` / `tier`
 * 名字独特，命中即有意义；`model` / `effort` / `profile` 这类通用名在 `src/` 里必然命中（别处的同名字段），
 * **本条对它们不构成覆盖**——它们是否真被读，由 `tier-resolve.test.ts` 的行为用例守。
 */
test('U12 schema 里 agents 四支与档位定义的非废弃属性都有消费方，否则进 KNOWN_DEAD', async () => {
  const schema = JSON.parse(
    await fs.readFile(path.join(REPO_ROOT, 'skills/dual-critic/schema/config.v2.json'), 'utf8'),
  ) as {
    properties: { agents: { additionalProperties: { oneOf: unknown[] } } };
    $defs: Record<string, unknown>;
  };
  const keys = new Set<string>();
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n === null || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    if (o['properties'] && typeof o['properties'] === 'object') {
      for (const [k, v] of Object.entries(o['properties'] as Record<string, { deprecated?: boolean }>)) {
        if (v?.deprecated !== true && !STAGE_KEYS.has(k)) keys.add(k);
      }
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(schema.properties.agents.additionalProperties.oneOf);
  for (const name of ['tierEntry', 'tierEntryOpenai', 'tierEntryModelOnly', 'stageModel']) walk(schema.$defs[name]);
  for (const k of ['tiers', 'default_tier', 'tier']) assert.ok(keys.has(k), `论域应含 ${k}，否则本条空转`);

  const files = await collectSources(path.join(REPO_ROOT, 'src'));
  const consumers: string[] = [];
  for (const f of files) {
    if (DEFINITION_FILES.includes(path.basename(f))) continue;
    consumers.push(await fs.readFile(f, 'utf8'));
  }
  const registered = new Set(KNOWN_DEAD.map((d) => d.key));
  const dead = [...keys].filter((k) => !registered.has(k) && !consumers.some((src) => hasPropertyAccess(src, k)));
  assert.deepEqual(dead, [], `下列 schema 属性在 src/ 下没有消费方：${dead.join('、')}`);
});

/*
 * **U13 EV-30 ④～⑦（M11 第 8 步）：四个键按精确路径报废弃，默认值里不再有**（上位计划 r3 §4.8，D-7）。
 *
 * 精确路径的理由同 U11：两个 agents 键只属于 zcode 分支（vendor 由注册表钉死，只有 glm），
 * 通配会把将来别家接上线的同名键误报成废弃——所以「放在别家段里的同名键不报」也是本条要守的。
 * 「只报实际出现的键、正文不带 ⚠️、提到 config.yaml」由 U4 守，这里不重复。
 */
test('U13 EV-30 ④～⑦：topic.forbid_chars / gate.require_adjudication / agents.glm.max_turns / agents.glm.unsupported_override 出现即报、只按精确路径报', () => {
  assert.equal(KNOWN_DEAD.length, 0, 'EV-30 七条已全部收口，KNOWN_DEAD 应为空——加回去要先回答它为什么不删');

  type Loose = {
    topic: Record<string, unknown>;
    gate: Record<string, unknown>;
    review: Record<string, unknown>;
    isolation: Record<string, unknown>;
    agents: Record<string, Record<string, unknown>>;
  };
  const base = () => structuredClone(defaultConfig()) as unknown as Loose;
  const asCfg = (c: Loose) => c as unknown as Config;

  const d = base();
  assert.ok(!('forbid_chars' in d.topic), '默认值里不该再有 topic.forbid_chars');
  assert.ok(!('require_adjudication' in d.gate), '默认值里不该再有 gate.require_adjudication');
  assert.ok(d.agents['glm'] !== undefined, '前提：默认配置带 agents.glm 段');
  assert.ok(!('max_turns' in d.agents['glm']!), '默认值里不该再有 agents.glm.max_turns');
  assert.ok(!('unsupported_override' in d.agents['glm']!), '默认值里不该再有 agents.glm.unsupported_override');
  assert.deepEqual(deprecatedConfigKeysIn(asCfg(d)), []);

  const singles: { name: string; set: (c: Loose) => void; want: string }[] = [
    { name: 'forbid_chars', set: (c) => { c.topic['forbid_chars'] = ['/', '\\', '..', ' ']; }, want: 'topic.forbid_chars' },
    { name: 'require_adjudication', set: (c) => { c.gate['require_adjudication'] = true; }, want: 'gate.require_adjudication' },
    { name: 'max_turns', set: (c) => { c.agents['glm']!['max_turns'] = 40; }, want: 'agents.glm.max_turns' },
    { name: 'unsupported_override', set: (c) => { c.agents['glm']!['unsupported_override'] = 'reject'; }, want: 'agents.glm.unsupported_override' },
  ];
  for (const s of singles) {
    const c = base();
    s.set(c);
    assert.deepEqual(deprecatedConfigKeysIn(asCfg(c)), [s.want], `只写 ${s.name}`);
  }

  // 别家段里的同名键不报（精确路径；改成 '*' 这里会红）
  const elsewhere = base();
  elsewhere.agents['codex']!['max_turns'] = 40;
  elsewhere.agents['codex']!['unsupported_override'] = 'reject';
  elsewhere.agents['gemini']!['max_turns'] = 40;
  assert.deepEqual(deprecatedConfigKeysIn(asCfg(elsewhere)), [], '只认 agents.glm 下的这两个键');

  // 与既有废弃键同在：按表序列出，正文逐个点名
  const all = base();
  all.gate['max_check_retries'] = 3;
  all.review['parallel'] = true;
  for (const s of singles) s.set(all);
  const want = [
    'gate.max_check_retries', 'review.parallel',
    'topic.forbid_chars', 'gate.require_adjudication', 'agents.glm.max_turns', 'agents.glm.unsupported_override',
  ];
  assert.deepEqual(deprecatedConfigKeysIn(asCfg(all)), want, '按表序列出');
  const notice = deprecatedConfigNotice(asCfg(all));
  assert.ok(notice !== null && notice.includes(`已废弃的键：${want.join('、')}。`), String(notice));
});

/*
 * **U14 EV-227（M12 批次 4）：档位表 Agent 级 effort 出现即报，阶段格子里的同名 effort 不报**（设计 13.1.1「已废弃键」）。
 *
 * 路径 `['profiles', '*', '*', 'effort']` 两层通配依次匹配表名与 Agent id；阶段格子 `{model, effort}` 的 effort 在下一层、
 * 有真实消费方（思考等级下传）——路径多一层 `'*'` 会把它误报，少一层会漏报 Agent 级，这里两头都钉住。
 */
test('U14 profiles.〈表〉.〈id〉.effort 出现即报、按表名再按 Agent id 排序；阶段格子 {model, effort} 不报', () => {
  type Loose = { gate: Record<string, unknown>; review: Record<string, unknown>; profiles: Record<string, Record<string, Record<string, unknown>>> };
  const base = () => structuredClone(defaultConfig()) as unknown as Loose;
  const asCfg = (c: Loose) => c as unknown as Config;

  const d = base();
  for (const [t, tbl] of Object.entries(d.profiles)) {
    for (const [id, entry] of Object.entries(tbl)) assert.ok(!('effort' in entry), `默认值里不该有 profiles.${t}.${id}.effort`);
  }
  assert.deepEqual(deprecatedConfigKeysIn(asCfg(d)), []);

  const one = base();
  one.profiles['default']!['gemini']!['effort'] = 'high';
  assert.deepEqual(deprecatedConfigKeysIn(asCfg(one)), ['profiles.default.gemini.effort']);
  const notice = deprecatedConfigNotice(asCfg(one));
  assert.ok(notice !== null && notice.includes('已废弃的键：profiles.default.gemini.effort。'), String(notice));

  // 阶段格子里的思考等级不报（多一层 '*' 这里会红）
  const cell = base();
  cell.profiles['default']!['codex'] = { plan: { model: 'qwen3.8-flash', effort: 'high' }, code: { tier: 'high' }, bug: 'qwen3.8-flash' };
  assert.deepEqual(deprecatedConfigKeysIn(asCfg(cell)), [], '阶段格子的 effort 有真实消费方');

  // 两张表 × 两侧：按表名排序、表内按 Agent id 排序；与阶段格子同在时只报 Agent 级
  const many = base();
  many.profiles['zeta'] = { glm: { plan: 'GLM-5.3', effort: 'low' }, gemini: { plan: 'g', effort: 'medium' } };
  many.profiles['default']!['glm']!['effort'] = 'low';
  many.profiles['default']!['codex'] = { plan: { model: 'qwen3.8-flash', effort: 'high' }, effort: 'high' };
  assert.deepEqual(deprecatedConfigKeysIn(asCfg(many)), [
    'profiles.default.codex.effort', 'profiles.default.glm.effort', 'profiles.zeta.gemini.effort', 'profiles.zeta.glm.effort',
  ]);

  // 与既有废弃键同在：按表序排在最后，正文逐个点名
  const all = base();
  all.gate['max_check_retries'] = 3;
  all.review['parallel'] = true;
  all.profiles['default']!['gemini']!['effort'] = 'high';
  const want = ['gate.max_check_retries', 'review.parallel', 'profiles.default.gemini.effort'];
  assert.deepEqual(deprecatedConfigKeysIn(asCfg(all)), want, '按表序列出');
  const n = deprecatedConfigNotice(asCfg(all));
  assert.ok(n !== null && n.includes(`已废弃的键：${want.join('、')}。`), String(n));
});
