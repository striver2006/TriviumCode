/**
 * 契约：措施 b 的**已知形态清单**与**用例**不得分叉。
 *
 * ## 为什么需要这条
 *
 * r1 双审 GLM-05：`adapters/base.ts` 的文档块里写着
 *
 * > 改清单必须同时改用例，否则 `known-forms` 那条守卫会红
 *
 * 而那条 `known-forms` 用例只是把**测试文件内的本地字面量**再断言一遍，
 * 既不读 `base.ts` 也不读设计文档——**清单在文档里长出 F-6 时它什么都不会红**。
 * 它防的是「实现退化」，不防「清单漂移」，而注释宣称的是后者。
 *
 * **注释宣称了不存在的保障**——这与设计 v1.3.6 记过的那条同形
 * （「注释宣称扫 `enum / const`、实现只有 `enum`」，当时的定性是
 * 「比单纯漏做更糟」）。本文件就是把那句话变成真的。
 *
 * 手法沿用 `registry-parity`：**grep 级对账**，不靠记性（AGENTS.md 纪律 12）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// 用既有的 REPO_ROOT，不自己从 import.meta.url 再算一遍——
// 打包后测试跑在 dist/test/ 下，相对层数与源码树不同，自算必错（起草时就错了一次）
import { REPO_ROOT } from '../helpers/fixture.js';

const BASE_TS = path.join(REPO_ROOT, 'src/trivium/adapters/base.ts');
const CASES_TS = path.join(REPO_ROOT, 'test/unit/peer-leak-command.test.ts');
const DESIGN_MD = path.join(
  REPO_ROOT, 'doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md',
);

/** 从 markdown 表格行里抠出形态编号：`| F-3 | …` / `| B-2 **…** | …` */
function idsInTable(text: string, kind: 'F' | 'B'): string[] {
  const re = new RegExp(String.raw`^\s*(?:\*\s*)?\|\s*(${kind}-\d+)\b`, 'gm');
  return [...new Set([...text.matchAll(re)].map((m) => m[1]!))].sort();
}

/** 从用例名里抠出形态编号：`test('[F-3] …'` / `test('【已知盲区 B-1】…'` */
function idsInCaseNames(text: string, kind: 'F' | 'B'): string[] {
  const re = new RegExp(String.raw`test\(\s*['"\`][^'"\`]*?\b(${kind}-\d+)\b`, 'g');
  return [...new Set([...text.matchAll(re)].map((m) => m[1]!))].sort();
}

const baseSrc = readFileSync(BASE_TS, 'utf8');
const caseSrc = readFileSync(CASES_TS, 'utf8');

/**
 * 只取设计里**措施 b 那一节**的文本，不扫全文（审查意见 AGY-05）。
 *
 * 设计文档两千多行，全文正则会把后续章节里任何形如 `| F-1 |` 的表格行也扫进来。
 * 区间取「措施 b 条目起」到「下一个 `- **威胁模型定调**` 项止」——
 * 两个锚都在 §10.1 内，锚失配时下面的「非空下限」会红，不会静默退化成空集。
 */
function measureBSection(md: string): string {
  const start = md.indexOf('- **措施 b**');
  const end = md.indexOf('- **威胁模型定调**', start);
  if (start < 0 || end < 0) return ''; // 让非空下限那条红出来，而不是在这里吞掉
  return md.slice(start, end);
}

const designSrc = measureBSection(readFileSync(DESIGN_MD, 'utf8'));

test('清单非空——正则失配时要红在这里，而不是让两个空集相等', () => {
  /*
   * 这条先于下面三条：两个空集恒相等，正则一旦写坏（或文档块被重排），
   * 对账会**按构造恒真**地通过。本项目在「用例数 === 5」那种恒真断言上
   * 已经栽过一次，不再犯。
   */
  assert.ok(idsInTable(baseSrc, 'F').length >= 5, 'base.ts 的 F 表不该是空的');
  assert.ok(idsInTable(baseSrc, 'B').length >= 4, 'base.ts 的 B 表不该是空的');
  assert.ok(idsInCaseNames(caseSrc, 'F').length >= 5, '用例里的 F 编号不该是空的');
  assert.ok(
    idsInTable(designSrc, 'F').length >= 5,
    '设计侧区间截取失败（措施 b 那一节的锚变了？）——不能让空集悄悄通过对账',
  );
  assert.ok(idsInTable(designSrc, 'B').length >= 4, '设计侧 B 表不该是空的');
});

test('已知形态 F：base.ts 的清单 ↔ 用例名，双向相等', () => {
  const inDoc = idsInTable(baseSrc, 'F');
  const inCases = idsInCaseNames(caseSrc, 'F');
  assert.deepEqual(
    inCases, inDoc,
    '清单与用例分叉了。\n' +
      `  base.ts 文档块：${inDoc.join(', ')}\n` +
      `  用例名：        ${inCases.join(', ')}\n` +
      '  加了形态就补用例；删了用例就删清单行——承诺面必须可审计。',
  );
});

test('盲区 B：base.ts 的清单 ↔ 用例名，双向相等', () => {
  const inDoc = idsInTable(baseSrc, 'B');
  const inCases = idsInCaseNames(caseSrc, 'B');
  assert.deepEqual(
    inCases, inDoc,
    '盲区清单与用例分叉了。\n' +
      `  base.ts 文档块：${inDoc.join(', ')}\n` +
      `  用例名：        ${inCases.join(', ')}\n` +
      '  盲区必须各有一条**会红的负断言**：哪天有人顺手扩了匹配面，' +
      '那条会红，届时要回 §10.1 重新掂量承诺面，而不是默默扩大它。',
  );
});

/**
 * **区间字面量的上界对账**（r4 双审 GLM-01）。
 *
 * 前面几条守的是「清单**行**不分叉」，守不住散落在正文里的**区间写法**：
 * `B-1～B-4`、`F-1～F-5`。r4 一次就逮到 8 处过期——
 * 而 EV-14 已经是第七次复发了。
 *
 * > 初版这段注释还把「四条」「四类」算进本条的守备范围，**而本条只对账区间**
 * > （r5 GLM-04：注释宣称了它守不住的东西，与本文件为之而生的那句话同形）。
 * > 散文计数由下面单独一条 `blindSpotCounts` 守，两者论域相同、判据不同。
 *
 * glm 给的判据是本主题以来第一条**可落地**的：
 * 区间的上界是 grep 得到的**字面量**，机械可判，成本远低于语义对账。
 *
 * 论域按其提醒扩到设计全文、README、BACKLOG、schema、源码——
 * 不只是措施 b 那一节（漏掉的恰恰都在节外）。
 */
const RANGE_SCAN: { label: string; path: string }[] = [
  { label: '设计（全文）', path: DESIGN_MD },
  { label: 'base.ts', path: BASE_TS },
  { label: 'BACKLOG', path: path.join(REPO_ROOT, 'doc/08_project/BACKLOG.md') },
  { label: 'run.v2.json', path: path.join(REPO_ROOT, 'skills/dual-critic/schema/run.v2.json') },
  { label: 'doc/02_design/README.md', path: path.join(REPO_ROOT, 'doc/02_design/README.md') },
  { label: 'PROTOCOL', path: path.join(REPO_ROOT, 'doc/03_api/PROTOCOL_dual_critic_relay.md') },
  // r5 GLM-04 实测：演进设计也提措施 b，不在论域里就是又一处「宣称覆盖而实际不覆盖」
  { label: '演进设计', path: path.join(REPO_ROOT, 'doc/02_design/2026-09-13-通用Agent编排与动态多审设计.md') },
  { label: 'ADR_002', path: path.join(REPO_ROOT, 'doc/02_design/ADR_002_multicritic_isolation.md') },
  { label: '用例文件', path: CASES_TS },
];

/**
 * 匹配**声称覆盖全集**的区间写法，取其上界。认这些写法：
 *
 * - 连接符：`～`、`~`、`-`、`至`、`到`（r5 AGY-04 ≡ GLM-04：只认前两个时，
 *   `B-1 至 B-5` 这种常见中文写法直接不匹配，而它一样会过期）
 * - 右侧省前缀的简写：`F-1～9`（同上，作者不会每次都写全）
 *
 * **只认起点为 1 的区间**。起草时我没加这个限定，于是它把
 * 「`F-6～F-8` 是 r1 双审补的」这句**准确的历史陈述**也判成过期——
 * 那是子区间，不声称覆盖全集。
 *
 * 这一条值得记：**判据过严会逼人把正确的话改错才能变绿**。
 * 守卫的价值在于「红得对」，不在于「红得多」。
 */
function rangeUpperBounds(text: string, kind: 'F' | 'B'): number[] {
  const re = new RegExp(String.raw`${kind}-1\s*(?:[～~\-]|至|到)\s*(?:${kind}-)?(\d+)`, 'g');
  return [...text.matchAll(re)].map((m) => Number(m[1]));
}

/**
 * **计数词对账**（r5 AGY-04 ≡ GLM-04）：`N 条盲区` / `N 类不可检` 里的 N。
 *
 * ## 为什么补这半
 *
 * 上面那条只守区间字面量，而本文件自己的动机注释写着它要守
 * 「`B-1～B-4`、`F-1～F-5`、**『四条』『四类』**」——**注释宣称了它守不住的东西**，
 * 和它当初为之而生的那句话同形。r5 有活例：B-6 撤销后设计正文仍写「四条盲区」，
 * 而区间字面量全都对齐，机器一声不吭。
 *
 * ## 为什么只对 B，不对 F
 *
 * 实测：仓里「N 种/类形态」几乎全是**别的东西**的计数（RV-B1 的五类 Bash 形态、
 * `~` 的三种写法、模型 slug 的两种形态）。拿 `形态` 当 F 的量词名词会造一片误报，
 * 而误报正是上一轮刚学的那个教训。F 侧目前只靠区间字面量守。
 *
 * ## 两条刻意的限制
 *
 * - **跳过「每一条盲区」**：那是「逐条」不是计数，`每` 前缀一律放行；
 * - **不认倒装**（`盲区有两条`）：倒装几乎都用来说**子集**
 *   （「非蓄意也会撞上的盲区有两条」），认它就会逼人把正确的话改错。
 *
 * 相应地，正装计数被判为**全集声明**：要说子集就**点名**（`B-2 与 B-5`），
 * 别用数字——点了名，上面几条对账才咬得住它。
 */
function blindSpotCounts(text: string): { n: number; raw: string }[] {
  const CN: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const re = /(每)?([一二两三四五六七八九十]|\d+)\s*[条类种个]\s*(?:盲区|不可检)/g;
  const out: { n: number; raw: string }[] = [];
  for (const m of text.matchAll(re)) {
    if (m[1]) continue; // 「每一条盲区」是逐条，不是计数
    const n = /^\d+$/.test(m[2]!) ? Number(m[2]) : CN[m[2]!];
    if (n !== undefined) out.push({ n, raw: m[0] });
  }
  return out;
}

test('区间字面量的上界 === 清单最大编号 —— 把「数一遍」从人工变成机器', () => {
  const maxOf = (ids: string[]): number => Math.max(...ids.map((x) => Number(x.split('-')[1])));
  const maxF = maxOf(idsInTable(baseSrc, 'F'));
  const maxB = maxOf(idsInTable(baseSrc, 'B'));

  const stale: string[] = [];
  for (const { label, path: p } of RANGE_SCAN) {
    const text = readFileSync(p, 'utf8');
    for (const [kind, want] of [['F', maxF], ['B', maxB]] as const) {
      for (const got of rangeUpperBounds(text, kind)) {
        if (got !== want) stale.push(`${label}：写着 ${kind}-1～${kind}-${got}，清单最大是 ${kind}-${want}`);
      }
    }
  }
  assert.deepEqual(
    stale, [],
    '区间字面量过期了（EV-14 第七次复发就是这一族）：\n  ' + stale.join('\n  '),
  );
});

test('散文里的计数词 === 盲区表条目数 —— 区间守住的那半之外的另一半', () => {
  const maxB = Math.max(...idsInTable(baseSrc, 'B').map((x) => Number(x.split('-')[1])));

  const stale: string[] = [];
  for (const { label, path: p } of RANGE_SCAN) {
    for (const { n, raw } of blindSpotCounts(readFileSync(p, 'utf8'))) {
      if (n !== maxB) stale.push(`${label}：写着「${raw}」，B 表实有 ${maxB} 条`);
    }
  }
  assert.deepEqual(
    stale, [],
    '散文计数过期了：\n  ' + stale.join('\n  ') +
      '\n  要说**全集**就让数字跟着 B 表走；要说**子集**就点名（如「B-2 与 B-5」）而不要写数字——' +
      '\n  点了名，上面几条 ID 对账才咬得住它。',
  );
});

test('设计 §10.1 的 B 清单与 base.ts 一致 —— 盲区表才是最会动的那半', () => {
  /*
   * r2 双审 AGY-03 ≡ GLM-05：初版只对账了 F，B 表可以单侧漂移而不红。
   *
   * glm 点出为什么这半更要紧：**B 行恰恰是最会动的部分**——
   * r1 刚重划过 B-2 的范围，R25 的措辞又随 EV-16（拍板不收窄）改了一次。
   * 而 `run.v2.json` 的字段描述当时已经宣称「两处由本测试对账」，
   * 对 B 而言那句话只覆盖 base ↔ 用例一侧——**又一处「宣称了不存在的覆盖」**。
   */
  const inDesign = idsInTable(designSrc, 'B');
  const inDoc = idsInTable(baseSrc, 'B');
  assert.deepEqual(
    inDesign, inDoc,
    '设计 §10.1 措施 b 的盲区表与 base.ts 文档块分叉了。\n' +
      `  设计：   ${inDesign.join(', ')}\n` +
      `  base.ts：${inDoc.join(', ')}`,
  );
});

test('设计 §10.1 的 F 清单与 base.ts 一致——承诺面不能只活在代码里', () => {
  /*
   * 设计文档是对外的承诺面，代码注释是对内的。两者分叉时，
   * 读设计的人会照着一个不存在的保证做判断——这正是本主题反复栽的那个形状。
   */
  const inDesign = idsInTable(designSrc, 'F');
  const inDoc = idsInTable(baseSrc, 'F');
  assert.deepEqual(
    inDesign, inDoc,
    '设计 §10.1 措施 b 的形态表与 base.ts 文档块分叉了。\n' +
      `  设计：   ${inDesign.join(', ')}\n` +
      `  base.ts：${inDoc.join(', ')}`,
  );
});

test('run.v2.json 逐侧段的 deny_* 字段都必须有产出点（r3 AGY-03 ≡ GLM-03）', () => {
  /*
   * **schema 宣告了一个永不出现的字段**，是本仓 EV-06 / guard.ts 反复登记的形态，
   * 而 r3 在同一处又犯了一次：`run.v2.json` 的逐侧段声明了 `deny_skipped` /
   * `deny_rule_count`，`review.ts` 组装 `meta.critics[c]` 时**一个都没写**。
   *
   * 它不会报错——逐侧段的 `required` 不含这两个键、`additionalProperties` 为 true，
   * 缺写完全静默。于是读 schema 的后来者会到 `run.json` 的逐侧记录里找一个
   * 永远不存在的字段，而它与 `guard` 段**同名不同形**（integer vs object），
   * 混淆面比单纯缺字段更大。
   *
   * 判据取「声明面 ⊆ 产出面」而非相等：产出点多写一个字段只是 schema 没跟上
   * （下次校验会点出来），而声明了没人写是**对外撒谎**，两者不对称。
   */
  const schemaSrc = readFileSync(
    path.join(REPO_ROOT, 'skills/dual-critic/schema/run.v2.json'),
    'utf8',
  );
  const schema = JSON.parse(schemaSrc) as Record<string, unknown>;
  const critic = ((schema.$defs ?? {}) as Record<string, { properties?: Record<string, unknown> }>)
    .critic;
  const declared = Object.keys(critic?.properties ?? {})
    .filter((k) => k.startsWith('deny_'))
    .sort();
  assert.ok(
    declared.length > 0,
    '逐侧段一个 deny_* 都没声明——扫不到就不是「都有产出点」，是判据指错了地方',
  );

  const reviewSrc = readFileSync(path.join(REPO_ROOT, 'src/trivium/review.ts'), 'utf8');
  /*
   * 只认**值表达式在场**的写法（`deny_bytes: r.deny_bytes`），不认裸键名：
   * 后者对 `deny_bytes: undefined` 照样绿，而那正是它要守的那一格
   * （与 deny-matrix 那条 `topic: ref.topic` 的判据同一条口径，r2 CODEX-09）。
   */
  const missing = declared.filter(
    (k) => !new RegExp(`\\b${k}:\\s*r\\.${k}\\b`).test(reviewSrc),
  );
  assert.deepEqual(
    missing,
    [],
    'run.v2.json 逐侧段声明了这些字段，但 review.ts 的逐侧记录没有对应的产出点——\n' +
      '  机读契约宣告了不存在的落点。要么补写产出点，要么从 schema 删掉声明。',
  );
});
