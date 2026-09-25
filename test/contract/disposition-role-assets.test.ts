import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../helpers/fixture.js';
import { ALL_AGENT_IDS } from '../../src/trivium/agents/registry.js';

/**
 * 资产契约：**指挥 Driver 产出工件的那些祈使句，不得把角色名写死。**
 *
 * ## 这条判据在防什么
 *
 * `skills/` 下的 SKILL.md、模板与 `protocol/*.snippet` 是**祈使句**——它们在指挥 Driver
 * 用什么文件名、往 `role` 里填什么。EV-66 放宽 schema 之后，非缺省 Driver 终于写得出
 * 合法裁决件了，但只要这些文本还写着 `-revised-claude.md` / `role: claude`，
 * 它就会**照着旧文本写**，产出一份闸门定位不到的件（`missing_disposition`）；
 * 原稿写错后缀更早——`locateSubject` 按当轮 Driver 过滤，`review --start` 当场退 65。
 *
 * 这个漏的症状是**无声的**：改漏一处，全量测试照样绿——因为没有任何机器判据在看资产面
 * （`registry-parity` 的论域只有 `src/trivium`，其注释也自认「散文/文案形态不覆盖」）。
 * 只有真换一个 Driver 跑一遍才会撞上，而那要到 M9 第 6 步。
 *
 * ## 这条判据自己会不会是假证明
 *
 * 会——**而且它的第一版就是半假的**，两轮双审各抓出一半：
 *
 *   · 计划双审（CODEX-F01 第 3/4 条、GLM-02、AGY-03）指出：照人工清单建论域必漏。
 *     计划原稿里那份「实测 6 处」的清单，实测是 9 文件 17 行。
 *   · 代码双审（CODEX-01 ≡ GLM-02、GLM-03、GLM-04、AGY-02）指出第一版仍有三处虚：
 *     ①论域宣称「自动扩展」，实际被两条手工挑的扩展名框住，
 *     **`protocol/*.snippet` 在域外**——而那是 `init` 幂等并入每个目标项目 CLAUDE.md 的
 *     文本，是 Driver 会话真正读到的项目记忆，写着「你的产出后缀是 `-claude`」；
 *     ②字面只从 `DEFAULT_DRIVER` 派生，一份指引若写死**别家** id 两个 pattern 都不命中；
 *     ③「变异自测」只对 `hardcodedRolePatterns()` 的返回值做字符串匹配，
 *     **不经扫描管线**——管线写坏（守卫写反、豁免错位、hits 永不入队）时它照绿。
 *
 * 本仓还有一条活着的同形先例可对照：`promise-landing.test.ts` 曾靠文件名字面
 * `-response-claude.md` 找裁决件且明写不断言命中数，论域清空、用例照常全绿。
 *
 * 所以现在按五个维度写，缺一条就会退化成假证明：
 *
 *   1. **论域自动扩展**：`skills/` 下全部 `.md` / `.template` / `.snippet` 递归收，
 *      不用文件清单。新加一份 SKILL.md 或 snippet 自动进论域。
 *   2. **字面从注册表派生**：扫的是 `ALL_AGENT_IDS`，不是硬编码的 `'claude'`，
 *      也不只是 `DEFAULT_DRIVER`——写死任何单个已登记 id 都会把别家 Driver 引向失败。
 *   3. **命中下限**：论域文件数有下限断言。发现式写错、目录改名、扩展名失配，
 *      都会让扫描零命中而用例照常绿（本仓记过四次这个形状）。
 *   4. **正向自动发现**：不只查「旧字面不复发」，还查「新指引确实在」，
 *      且**待查文件由内容特征发现**（含裁决件 front-matter 的模板、提及裁决件产出的
 *      SKILL.md），不硬编码文件名——否则新增资产时正向那半会静默失去覆盖。
 *   5. **变异自测走真实管线**：合成内容喂给 `scanContent`（第一条用例用的同一个函数），
 *      断言违例被抓住、豁免被放过。管线坏掉时这里当场红。
 *
 * ## 它证不到什么（如实标注，别当验收替代品）
 *
 * 只证「**角色名字面不复发**」。证不到「新指引语义正确」——
 * 把文本改成「填缺省 Driver 的角色名」这种语义错误，它一个字都抓不到，
 * 因为那里面没有任何角色名字面。那一格只能靠第 6 步真换 Driver 跑一遍。
 *
 * 论域也**不含** `skills/dual-critic/schema/*.json`（机读契约，由 `registry-parity`
 * 的 schema 全目录扫描守着）与仓库根 `CLAUDE.md` / `AGENTS.md`（项目自身的记忆，
 * 不随 `init` 分发；它们的对应模板 `protocol/*.snippet` 在论域内）。
 */

const SKILLS_ROOT = path.join(REPO_ROOT, 'skills');

/** 论域的扩展名集——三类文本资产，全部是「指挥 Driver 的祈使句」的载体 */
const ASSET_EXTENSIONS = ['.md', '.template', '.snippet'];

/**
 * 豁免：命中了但**确实不该改**的行。
 *
 * **清单当前为空，这是正确状态。**
 *
 * 第一版曾有 6 条覆盖原稿命名面（`plan`/`rca` 模板、`README` 两行、`dual-run:53`），
 * 当场被下方「豁免仍然被需要」的守卫判红——那时判据只匹配裁决件后缀，
 * 原稿面的裸 `-claude.md` 根本不在论域，豁免无物可挡，是彻头彻尾的空头支票。
 * 后来代码双审又证明那几处**根本不该豁免**：照抄会在 `review --start` 退 65
 * （`locateSubject` 按当轮 Driver 过滤），于是它们被直接改掉了。
 *
 * 再加条目前先确认两件事：那一行真的会被下面的 pattern 命中吗？它真的不该改吗？
 */
const EXEMPTIONS: readonly { file: string; line: number; why: string }[] = [];

/** 递归收论域文件，返回相对 `skills/` 的路径 */
async function collectAssets(dir: string, base = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...(await collectAssets(path.join(dir, e.name), rel)));
    } else if (ASSET_EXTENSIONS.some((ext) => e.name.endsWith(ext))) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * 角色名写死的形态。**字面由注册表全集派生**，不写任何 id 字面量。
 *
 * 三种形态分别对应三处会真的害到人的地方——**上一版注释写了三种、只实现了两种**
 * （代码双审 AGY-02），裸后缀那条是这次补上的：
 *   · 裁决件后缀 `-revised-<id>.md` / `-response-<id>.md` → 闸门定位不到；
 *   · front-matter 取值 `role: <id>`（含引号形态）        → 作者身份判红；
 *   · 裸后缀 `-<id>.md` / 「产出后缀是 -<id>」             → 原稿定位不到，退 65。
 *
 * 为什么是 `ALL_AGENT_IDS` 而不是 `DEFAULT_DRIVER`（代码双审 GLM-04）：
 * 判据的意图是「不得把角色名写死」，而不是「不得写死 claude」。
 * 一份指引写死 `-revised-codex.md`，同样会把非 codex 的 Driver 引向 missing_disposition。
 * 用全集仍是注册表单源，不违纪律 7。
 */
function hardcodedRolePatterns(): RegExp[] {
  const ids = ALL_AGENT_IDS.join('|');
  return [
    new RegExp(`-(?:revised|response)-(?:${ids})\\.md`),
    // 引号形态也要吃：`role: "claude"` 与 `role: claude` 是同一个错误
    new RegExp(`role:\\s*['"\`]?(?:${ids})['"\`]?(?![\\w-])`),
    /*
     * 裸后缀——**按已知形态抓，不是宽匹配**，这是实测逼出来的收窄。
     *
     * 第一版写成 `-(?:${ids})(?:\.md|\b)`，一跑就命中 18 行，**全是误报**：
     * 旗标名 `--model-gemini` / `--model-glm` / `--only gemini|glm`，
     * 以及散文里对审查文档后缀的**合法**提及（「不要手工创建 `-gemini.md`」）。
     * 审查员后缀被散文提到是正当的——它们确实叫这个名字；
     * 真正有害的只有「**指挥 Driver 产出**时把后缀写死」这一种语境。
     *
     * 所以只抓两种真实出现过的形态：
     *   · 落盘路径示例 `<主题>-<id>.md` / `{{TOPIC}}-<id>.md`（原稿与裁决件都走它）；
     *   · 「你的产出后缀是 `-<id>`」这一句式（snippet 与项目记忆里的那句）。
     *
     * **它不完备**，如实记在这里：换一种句式写死角色名它抓不到。
     * 宽匹配那一版倒是完备，代价是 18 条误报要配 18 条豁免——
     * 而豁免清单正是论域漏空的主要来源（本仓记过四次）。两害相权取这一边，
     * 并用下方变异自测把这两种形态钉死。
     */
    new RegExp(`(?:主题>|\\{\\{TOPIC\\}\\})-(?:${ids})\\.md`),
    new RegExp(`产出后缀是\\s*\`?-(?:${ids})\``),
  ];
}

const isExempt = (file: string, line: number): boolean =>
  EXEMPTIONS.some((e) => e.file === file && e.line === line);

/**
 * 逐行扫一份文本，返回命中行（`<rel>:<行号>  <行文本>`）。
 *
 * **抽成纯函数是为了让变异自测走真实管线**（代码双审 GLM-03）：
 * 上一版的变异用例只调 `patterns.test(str)`，压根不经过「逐行 → 豁免 → 入队」这几步，
 * 于是管线本身写坏时它照绿，而第一条用例在零命中上恒绿——判据整体失效而无红。
 * 现在第一条用例与变异用例共用本函数，管线坏掉两边一起红。
 */
function scanContent(rel: string, content: string, patterns: RegExp[]): string[] {
  const hits: string[] = [];
  content.split('\n').forEach((text, i) => {
    const lineNo = i + 1;
    if (!patterns.some((p) => p.test(text))) return;
    if (isExempt(rel, lineNo)) return;
    hits.push(`${rel}:${lineNo}  ${text.trim()}`);
  });
  return hits;
}

/** 扫一遍论域，同时记下哪些豁免真的挡下了命中 */
async function scanAssets(): Promise<{ files: string[]; hits: string[]; usedExemptions: Set<string> }> {
  const files = await collectAssets(SKILLS_ROOT);
  const patterns = hardcodedRolePatterns();
  const hits: string[] = [];
  const usedExemptions = new Set<string>();

  for (const rel of files) {
    const src = await fs.readFile(path.join(SKILLS_ROOT, rel), 'utf8');
    src.split('\n').forEach((text, i) => {
      const lineNo = i + 1;
      if (!patterns.some((p) => p.test(text))) return;
      if (isExempt(rel, lineNo)) {
        usedExemptions.add(`${rel}:${lineNo}`);
        return;
      }
      hits.push(`${rel}:${lineNo}  ${text.trim()}`);
    });
  }
  return { files, hits, usedExemptions };
}

test('资产契约：指挥产出工件的祈使句不得写死角色名', async () => {
  const { files, hits, usedExemptions } = await scanAssets();

  /*
   * 论域下限。数字取得比实际宽松——它防的是「递归失效、目录改名、扩展名失配」
   * 这种论域塌成空集的形态，不是用来精确记账的（那会让每加一份文档都要改这里）。
   */
  assert.ok(
    files.length >= 8,
    `skills/ 下只收到 ${files.length} 份资产，论域塌了——本条判据会在空论域上全绿`,
  );

  /*
   * `protocol/*.snippet` 必须在论域里，单独锁一条。
   *
   * 它是第一版**结构性漏掉**的那一面（扩展名集只有 .md / .template），
   * 而 `init` 会把协议片段（M10b 第 2 步起是 `driver.snippet` / `critic.snippet` 两段）幂等并入
   * 每个目标项目的 CLAUDE.md / AGENTS.md / GEMINI.md——
   * 那是 Driver 会话真正读到的项目记忆，最权威的一份指令却不在判据视野内。
   * 只把 `.snippet` 加进扩展名集是不够的：下次有人重构 `collectAssets` 时，
   * 没有这条断言就没人会发现它又掉出去了。
   */
  assert.ok(
    files.some((f) => f.endsWith('.snippet')),
    'protocol/*.snippet 不在论域里——init 分发给每个项目的那份 Driver 指令就没人看着了',
  );

  assert.deepEqual(
    hits, [],
    '下列资产面文本把角色名写死了。\n' +
      '  它们是**祈使句**——非缺省 Driver 会照着写，产出闸门定位不到的裁决件\n' +
      '  （missing_disposition），或写错原稿后缀而在 review --start 当场退 65，\n' +
      '  而全量测试照样绿，只有真换 Driver 跑一遍才撞得上。\n' +
      '  改法：后缀写 `<当轮 Driver>`，模板的 front-matter 与落盘示例用 {{ROLE}} 占位符。\n' +
      '  确实不该改的，加进 EXEMPTIONS 并写明理由。\n' +
      `  ${hits.join('\n  ')}`,
  );

  /*
   * 豁免也要被守着：没被用到的豁免就是空头支票。
   * 与 `registry-parity` 的「不得留过期条目」同一条纪律——少了它，
   * EXEMPTIONS 可以随便变长而无人察觉，论域就此一点点漏空。
   */
  const stale = EXEMPTIONS.filter((e) => !usedExemptions.has(`${e.file}:${e.line}`))
    .map((e) => `${e.file}:${e.line}`);
  assert.deepEqual(
    stale, [],
    '这些豁免条目一次都没挡下命中——多半是那一行已经改掉或移位了，条目应当删除或改准：\n  ' +
      stale.join('\n  '),
  );

  for (const e of EXEMPTIONS) {
    assert.ok(e.why.trim().length >= 6, `豁免 ${e.file}:${e.line} 没写明理由`);
  }
});

/*
 * 正向那一半：只查「旧字面不复发」是不够的（计划双审 AGY-03）。
 *
 * 占位符写错、或者有人把整句指引删掉，消极扫描照样全绿——因为它只会看到
 * 「没有角色名字面」。所以还要查**新指引确实在**。
 *
 * **待查文件由内容特征发现，不硬编码文件名**（代码双审 AGY-02）：
 * 上一版写死了 6 个路径，新增一份模板或 SKILL 时正向这半会静默失去覆盖——
 * 与消极扫描那半用人工清单是同一个病。
 */
test('资产契约：裁决件模板必须留出角色占位符，SKILL 必须指明当轮 Driver', async () => {
  const files = await collectAssets(SKILLS_ROOT);

  /* 凡是带裁决件 front-matter 的模板，role 必须是占位符 */
  const dispositionTemplates: string[] = [];
  for (const rel of files) {
    if (!rel.endsWith('.template')) continue;
    const src = await fs.readFile(path.join(SKILLS_ROOT, rel), 'utf8');
    if (!src.includes('schema: trivium.disposition.v1')) continue;
    dispositionTemplates.push(rel);
    assert.match(
      src, /^role:\s*\{\{ROLE\}\}\s*$/m,
      `${rel} 的 front-matter 没有 role 占位符——Driver 照抄时不知道该填什么，` +
        '而消极扫描看不出这件事（那里确实没有写死的角色名）',
    );
  }
  assert.ok(
    dispositionTemplates.length >= 2,
    `只发现 ${dispositionTemplates.length} 份裁决件模板（revised / response 至少两份）——发现式失效了`,
  );

  /* 凡是提及裁决件产出的 SKILL.md，必须告诉 Driver 后缀取自己的 id */
  const producingSkills: string[] = [];
  for (const rel of files) {
    if (!rel.endsWith('SKILL.md')) continue;
    const src = await fs.readFile(path.join(SKILLS_ROOT, rel), 'utf8');
    if (!/-(?:revised|response)-/.test(src)) continue;
    producingSkills.push(rel);
    assert.match(
      src, /-(?:revised|response)-<当轮 Driver>\.md/,
      `${rel} 没有告诉 Driver 裁决件的后缀取自己的 Agent id——` +
        '删掉写死的角色名只完成一半，指引缺位时 Driver 只能猜',
    );
  }
  assert.ok(
    producingSkills.length >= 4,
    `只发现 ${producingSkills.length} 份指挥产出裁决件的 SKILL（三条 dual-review + dual-run）——发现式失效了`,
  );
});

/*
 * 变异自测：判据自己得会报，**且必须经过真实扫描管线**。
 *
 * 上一版只对 `hardcodedRolePatterns()` 的返回值做字符串匹配（代码双审 GLM-03）：
 * 正则再正确，只要管线写坏——匹配守卫写反、豁免行号错位、hits 永不入队——
 * 它照绿，而第一条用例在零命中上恒绿。那样这一维就是纸面的。
 *
 * 现在喂合成内容给 `scanContent`（第一条用例用的同一个函数），
 * 不向 `skills/` 写任何文件。这条用例存在的理由与 `registry-parity` 那个坏正则的
 * 教训同源——那次剥离器把真硬编码吞了，一个本该受监控的文件脱离监控而用例全绿。
 */
test('资产契约：判据自测——注入写死的角色名，必须被真实扫描管线抓住', () => {
  const patterns = hardcodedRolePatterns();

  /* 每一条都是真实出现过（或会出现）的违例形态，逐条覆盖三种 pattern */
  const violations = [
    '依 `trivium.disposition.v1` 写出 `…-revised-claude.md`：',
    'role: claude',
    'role: "claude"',
    '| [`response.md.template`](./x) | `code/<日期>-<主题>-response-codex.md` 应答件 |',
    'role: gemini',
    '把方案写成 `.reviews/<主题>/plan/<日期>-<主题>-claude.md`。',
    '你的产出后缀是 `-claude`。',
  ];
  for (const v of violations) {
    assert.deepEqual(
      scanContent('fake.md', v, patterns),
      [`fake.md:1  ${v.trim()}`],
      `扫描管线漏掉了这条违例，判据已经不是有效判据了：${v}`,
    );
  }

  /* 反向：正确写法不得被误伤，否则判据会逼出一份膨胀的豁免清单 */
  const legit = [
    '依 `trivium.disposition.v1` 写出 `…-revised-<当轮 Driver>.md`：',
    'role: {{ROLE}}',
    '  .reviews/{{TOPIC}}/plan/{{DATE}}-{{TOPIC}}-{{ROLE}}.md',
    '本目录的模板只对应 **Driver 自己产出**的工件，不含审查文档。',
    '受保护的后缀是除当轮 Driver 之外的全部已登记角色。',
  ];
  for (const l of legit) {
    assert.deepEqual(
      scanContent('fake.md', l, patterns), [],
      `判据误伤了正确写法，会逼出多余的豁免：${l}`,
    );
  }

  /* 豁免这一支也要走一遍：命中但被豁免时，管线必须真的放过 */
  const probe = EXEMPTIONS.length === 0
    ? scanContent('fake.md', 'role: claude', patterns)
    : [];
  assert.equal(
    probe.length, 1,
    '空豁免清单下命中必须入队——若这里为空，说明 isExempt 或入队逻辑写反了',
  );
});
