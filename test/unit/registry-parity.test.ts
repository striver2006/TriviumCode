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
  DEFAULT_DRIVER,
  agentByFindingId,
  agentByFindingPrefix,
  agentById,
  findingPrefixAlternation,
  isAgentId,
  suffixAlternation,
} from '../../src/trivium/agents/registry.js';
import { CRITICS, CRITIC_PREFIX, CRITIC_VENDOR } from '../../src/trivium/types.js';
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
const LITERAL_ALLOWLIST: readonly { file: string; why: string }[] = [
  { file: 'agents/registry.ts', why: '唯一登记处，字面量的来源本身' },
  { file: 'adapters/index.ts', why: 'Agent id → 厂商适配器的唯一接线处；新增一家在此加一行（M7b 第 2 步把 review/run-protocol 两份字面表收敛到这里）' },
  { file: 'adapters/agy.ts', why: '厂商专属适配器：文件本身即该 Agent 的命名空间' },
  { file: 'adapters/zcode.ts', why: '厂商专属适配器：ZCode 调用与参数构造' },
  { file: 'config.ts', why: '内置默认配置里各 Agent 的厂商专属配置段（agents.gemini / agents.glm 的 vendor、agent、entry、max_turns）与 profiles 的逐 Agent 模型档位。M7b 第 4 步迁成 agents.* 后**仍需要**：内置默认值本身就得指名道姓地写出每一家配什么，那不是硬编码而是默认值的定义处；新增一家时这里加一段，与注册表加一行是同一件事的两面' },
  // 注意：`src/install.ts` 不在本对账的扫描范围（只扫 src/trivium/），
  // 因此不需要、也不应该为它留白名单条目——留着只会误导读者以为它被扫过。
  //
  // `init.ts` 曾在此表中，2026-09-14 删除：它的 `.claude/...` 全部带路径分隔符、
  // 已被属性扫描排除，文件本身确无 Agent 字面量。此前判它「仍需要」是坏剥离器
  // 造出的假命中（见 stripComments 的注释）。
  { file: 'doctor.ts', why: '逐侧探测的人读输出与厂商专属诊断话术' },
  { file: 'preflight.ts', why: '逐侧预检的人读输出，以及 checkModelSlugs 的厂商专属 slug 校验分支（agy 目录硬校验 vs zcode 短名补全，无法登记为统一数据）' },
  { file: 'review.ts', why: 'effortFor 的厂商专属分支：effort 只存在于 antigravity 形状的配置段，ZCode 0.16.5 实测没有等价旗标（M0 坑清单 C-07）。**M7b 第 4 步后仍需要**——config v2 只把 critics.* 改名为 agents.*，并未把 effort 统一成逐 Agent 字段；设计 13.1.1 把 tiers / models / default_tier 排在 M11，在那之前这里的编译期穷尽（switch + never）是能拿到的最强保证' },
  { file: 'selftest.ts', why: '自检场景里两侧桩的固定编排；M7b 增 N 侧场景' },
  { file: 'types.ts', why: 'CriticId 的字面收窄（Extract<AgentId, …>）；M7b 随注册表放开' },
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
     * 代价：正则字面量里的 Agent 名（如 `adapters/base.ts` 的 `!/claude/i.test(model)`）
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
  const files = await collectSourceFiles(srcRoot);
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
 * 2. **正则字面量**：`adapters/base.ts` 的 `!/claude/i.test(model)` 是行为逻辑，
 *    而剥离器会整体跳过正则内容（否则里面的引号会让状态机失步）。
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
  const files = await collectSourceFiles(srcRoot);

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
test('run.v2 校验：未启用但已登记的 Agent 出现在入选集合里，形状上必须被接受', () => {
  const spare = ALL_AGENT_IDS.find((id) => !CRITIC_AGENT_IDS.includes(id));
  assert.ok(spare, '四家全部启用为审核者时本用例失去意义，届时改用别的夹具');

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
});
