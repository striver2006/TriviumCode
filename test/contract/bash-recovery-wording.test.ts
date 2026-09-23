import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../helpers/fixture.js';
import { GIT_OPT_PREFIX } from '../../src/trivium/hooks.js';

/**
 * §3.2.2 扫描判据的机械核对（M10a 第 2 步 EV-55）。
 *
 * 计划把「清单的得出方式」从人工数处数改成一条可执行判据：扫 `src/trivium/` 下
 * 所有提到 git 恢复类子命令的文案源串，要求每一处都提示「这一步请在终端里手动执行」——
 * 因为恢复命令本身会提到受保护路径，常规写法在会话里会被 Bash 守卫的同一条判据再拦一次。
 *
 * ## 论域：语句组 + 具名豁免，不再用字符窗口（代码双审 r2 CODEX-02 ≡ GLM-01 ≡ AGY-03）
 *
 * 上一版的论域是「命中点 ±400 字符内出现保护字面（`_meta` / `task.json` / 角色后缀）」。
 * 实测在真实仓库上**论域为空**：真实文案的对象写的是 `<路径>` 占位符或「上面列出的
 * 受保护路径」，最近的保护字面在 705 字符之外，六处命中全被 `continue` 掉——把全部
 * 「终端」提示删光测试照样绿。「对象带不带保护字面」从源码字面上判不出来。
 *
 * 所以改成显式判定：
 *   · **每一处**命中都要在它所在的**语句组**（由 `+` 拼接的同一条文案）内含「终端」；
 *   · 对象确实不是受保护路径的，进下方 `EXEMPTIONS` 具名豁免，写明理由；
 *     豁免表本身也被扫描——豁免不到任何命中就判过期；
 *   · 已知站点下限：`KNOWN_SITES` 必须真的进论域，论域被清空时这里先红；
 *   · 变异腿：从 hooks.ts 源文本删去「终端」，判据必须报出这两处。
 *
 * 保护字面那张手抄的角色后缀表随之删除（GLM-05 (a)：它是注册表之外的第二份登记事实）。
 */

const RECOVERY_SUBCOMMANDS = ['checkout', 'restore', 'switch', 'stash', 'reset', 'clean', 'revert'];
/**
 * 与 `hooks.ts` 的写命令判据共用同一段 git 选项前缀（代码双审 r2 CODEX-07）：
 * `git -c core.quotePath=false restore …` 恰是本仓纪律要求的 git 写法，
 * 上一版的 `git\s+(checkout|…)` 认不出它。
 */
const GIT_RECOVERY_RE = new RegExp(`\\bgit\\s+${GIT_OPT_PREFIX}(?:${RECOVERY_SUBCOMMANDS.join('|')})\\b`, 'g');
const TERMINAL_HINT_RE = /终端/;

interface Marked {
  /** 相对仓库根 */
  file: string;
  /** 语句组内必须出现的一段原文，用来认出是哪一条文案 */
  marker: string;
}

/** 对象不是受保护路径的恢复类文案：不要求「终端」提示 */
const EXEMPTIONS: ReadonlyArray<Marked & { reason: string }> = [
  {
    file: 'src/trivium/guard.ts',
    marker: '只读失守',
    reason: '只读失守的恢复对象是审查期间被写的工作树业务文件，会话内可执行（计划 §3.2.2 表第 3 行，记巡检清单不改）',
  },
  {
    file: 'src/trivium/hooks.ts',
    marker: '这是按写命令形态的启发式判定',
    reason: '闸门写锁的 deny 文案在列举写命令形态，不是恢复建议',
  },
];

/** 必须进论域的已知站点：论域被清空（窗口、正则或剥注释出错）时这里先红 */
const KNOWN_SITES: readonly Marked[] = [
  { file: 'src/trivium/hooks.ts', marker: '禁止用 Bash 改动编排器独占的文件' },
  { file: 'src/trivium/hooks.ts', marker: '归档留痕不完整' },
  { file: 'src/trivium/gate.ts', marker: '结论文件是裁决校验的唯一事实来源' },
];

// ───────────────────────── 剥注释（字符串感知，保留换行） ─────────────────────────

/**
 * 剥掉注释，**保留字符串、模板串与正则字面量**，并把被剥内容换成等量空白、保留换行——
 * 于是剥后文本的行号就是原文行号（代码双审 r2 CODEX-05：上一版把整块注释压成一个空格，
 * 报错行号整体前移数百行）。
 *
 * 上一版是两条正则，不感知字符串：字符串里的 `//`（URL）会把行尾剥掉、`'src/*'`
 * 会与后面的 `*∕` 配对吞掉中间源码（代码双审 r2 CODEX-07 / GLM-05 (b)；
 * registry-parity 记过同一个坑）。正则字面量也要认：`/['"]x/` 里的引号
 * 若被当成字符串起点，后面整段代码都会错位。
 *
 * 模板串 `${…}` 内的表达式原样保留、不剥注释——那里的注释极罕见，保留只会让
 * 待判文本变多（多报），不会漏报。
 */
function stripComments(src: string): string {
  return scanSource(src).text;
}

/**
 * 剥注释的同时记下两类「跨度」，供语句组划分用（代码双审 r3 CODEX-02 ≡ AGY-01 ≡ GLM-03）：
 * 顶层模板串 `` `…` ``、代码态下的数组字面量 `[…]`。偏移与原文一致（剥注释保持等长）。
 */
function scanSource(src: string): { text: string; spans: Array<[number, number]> } {
  const spans: Array<[number, number]> = [];
  const brackets: number[] = [];
  const n = src.length;
  const blank = (s: string): string => s.replace(/[^\n]/g, ' ');

  const scanQuoted = (i: number, q: string): number => {
    let j = i + 1;
    while (j < n) {
      const c = src[j]!;
      if (c === '\\') { j += 2; continue; }
      if (c === q || c === '\n') return j + 1;
      j++;
    }
    return n;
  };
  const scanExpr = (i: number): number => {
    let j = i;
    let depth = 0;
    while (j < n) {
      const c = src[j]!;
      if (c === '\'' || c === '"') { j = scanQuoted(j, c); continue; }
      if (c === '`') { j = scanTemplate(j); continue; }
      if (c === '{') depth++;
      else if (c === '}') {
        if (depth === 0) return j + 1;
        depth--;
      }
      j++;
    }
    return n;
  };
  const scanTemplate = (i: number): number => {
    let j = i + 1;
    while (j < n) {
      const c = src[j]!;
      if (c === '\\') { j += 2; continue; }
      if (c === '`') return j + 1;
      if (c === '$' && src[j + 1] === '{') { j = scanExpr(j + 2); continue; }
      j++;
    }
    return n;
  };
  /** 返回正则字面量的结束位置；不是合法正则（遇换行）时返回 -1 */
  const scanRegex = (i: number): number => {
    let j = i + 1;
    let inClass = false;
    while (j < n) {
      const c = src[j]!;
      if (c === '\n') return -1;
      if (c === '\\') { j += 2; continue; }
      if (inClass) { if (c === ']') inClass = false; }
      else if (c === '[') inClass = true;
      else if (c === '/') {
        j++;
        while (j < n && /[a-z]/i.test(src[j]!)) j++;
        return j;
      }
      j++;
    }
    return -1;
  };
  /** `/` 处于「期待表达式」的位置才是正则起点 */
  const regexAllowed = (out: string): boolean =>
    /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\breturn|\btypeof|\bcase)\s*$/.test(out.slice(-40));

  let out = '';
  let i = 0;
  while (i < n) {
    const c = src[i]!;
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const nl = src.indexOf('\n', i);
      const end = nl === -1 ? n : nl;
      out += blank(src.slice(i, end));
      i = end;
      continue;
    }
    if (c === '/' && d === '*') {
      const close = src.indexOf('*/', i + 2);
      const end = close === -1 ? n : close + 2;
      out += blank(src.slice(i, end));
      i = end;
      continue;
    }
    if (c === '\'' || c === '"') {
      const end = scanQuoted(i, c);
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (c === '`') {
      const end = scanTemplate(i);
      spans.push([i, end]);
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (c === '[') brackets.push(i);
    else if (c === ']') {
      const open = brackets.pop();
      if (open !== undefined) spans.push([open, i + 1]);
    }
    if (c === '/' && regexAllowed(out)) {
      const end = scanRegex(i);
      if (end !== -1) {
        out += src.slice(i, end);
        i = end;
        continue;
      }
    }
    out += c;
    i++;
  }
  return { text: out, spans };
}

// ───────────────────────── 语句组与判据 ─────────────────────────

/**
 * 命中所在的「语句组」：由行尾 `+` 串起来的同一条文案。
 * 向上吞并行尾为 `+` 的前行，向下沿行尾 `+` 延伸；空行（剥掉的注释）跳过。
 *
 * 另两种组形态由 `collectHits` 先行放大（第 2 轮裁决件承诺的三种形态，r3 三侧独立指出
 * 上一版只实现了 `+` 这一种）：命中落在**跨行模板串**或**跨行数组字面量**（`[…].join`）内时，
 * 整个模板串 / 数组先算作一组，再从它的首尾行按 `+` 规则继续延伸。
 *
 * 已知不覆盖的形态：把恢复子命令拆进两个字面量（`'git ' + 'restore'`、`['git', 'restore']`）
 * 时正则整条不命中，文案静默落在论域外——由 `KNOWN_SITES` 下限兜已知站点，新文案别这么拆。
 * 另外，数组整体算一组是宽松方向：同一数组里别的元素的「终端」也会被算上。
 */
function groupAround(lines: string[], idx: number): { start: number; end: number } {
  const t = (k: number): string => lines[k]!.trim();
  let start = idx;
  for (let k = idx - 1; k >= 0; k--) {
    if (t(k) === '') continue;
    if (!t(k).endsWith('+')) break;
    start = k;
  }
  let end = idx;
  let cur = idx;
  while (t(cur).endsWith('+')) {
    let m = cur + 1;
    while (m < lines.length && t(m) === '') m++;
    if (m >= lines.length) break;
    end = m;
    cur = m;
  }
  return { start, end };
}

interface Hit {
  file: string;
  /** 原文行号（剥注释保留了换行，两者一致） */
  line: number;
  group: string;
}

function collectHits(file: string, raw: string): Hit[] {
  const { text: src, spans } = scanSource(raw);
  const lines = src.split('\n');
  const lineOf = (offset: number): number => src.slice(0, offset).split('\n').length - 1;
  const hits: Hit[] = [];
  for (const m of src.matchAll(GIT_RECOVERY_RE)) {
    const at = m.index;
    const line = lineOf(at);
    // 最内层的跨行模板串 / 数组：先把它整体算作一组
    let first = line;
    let last = line;
    let best: [number, number] | null = null;
    for (const sp of spans) {
      if (sp[0] > at || sp[1] <= at) continue;
      if (!src.slice(sp[0], sp[1]).includes('\n')) continue;
      if (best === null || sp[1] - sp[0] < best[1] - best[0]) best = sp;
    }
    if (best !== null) {
      first = lineOf(best[0]);
      last = lineOf(best[1] - 1);
    }
    const start = groupAround(lines, first).start;
    const end = groupAround(lines, last).end;
    hits.push({ file, line: line + 1, group: lines.slice(start, end + 1).join('\n') });
  }
  return hits;
}

function judge(sources: ReadonlyArray<{ file: string; raw: string }>): {
  hits: Hit[];
  offenders: string[];
} {
  const hits = sources.flatMap((s) => collectHits(s.file, s.raw));
  const offenders = hits
    .filter((h) => !EXEMPTIONS.some((e) => e.file === h.file && h.group.includes(e.marker)))
    .filter((h) => !TERMINAL_HINT_RE.test(h.group))
    .map((h) => `${h.file}:${h.line}`);
  return { hits, offenders };
}

async function collectSourceFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs);
      else if (e.name.endsWith('.ts')) out.push(abs);
    }
  };
  await walk(root);
  return out;
}

async function loadSources(): Promise<Array<{ file: string; raw: string }>> {
  const files = await collectSourceFiles(path.join(REPO_ROOT, 'src/trivium'));
  return Promise.all(
    files.map(async (f) => ({ file: path.relative(REPO_ROOT, f).split(path.sep).join('/'), raw: await fs.readFile(f, 'utf8') })),
  );
}

// ───────────────────────── 用例 ─────────────────────────

test('§3.2.2 扫描判据：每一处 git 恢复类文案都要在同一语句组内提示「终端」（豁免须具名）', async () => {
  const { hits, offenders } = judge(await loadSources());

  // 下限：已知站点必须真的进论域——论域被清空时判据本身就失效了
  for (const s of KNOWN_SITES) {
    assert.ok(
      hits.some((h) => h.file === s.file && h.group.includes(s.marker)),
      `已知站点没进论域（判据空转）：${s.file}「${s.marker}」\n实际命中：\n` +
        hits.map((h) => `  ${h.file}:${h.line}`).join('\n'),
    );
  }
  // 豁免表防过期：每条豁免都必须豁免到至少一处真实命中
  for (const e of EXEMPTIONS) {
    assert.ok(
      hits.some((h) => h.file === e.file && h.group.includes(e.marker)),
      `豁免已过期（没有命中可豁免），请删除：${e.file}「${e.marker}」`,
    );
  }

  assert.deepEqual(
    offenders,
    [],
    '以下位置提到 git 恢复类子命令，但同一条文案里没有「请在终端执行」的提示——' +
      '恢复命令本身会提到受保护路径，常规写法会被 Bash 守卫再拦一次。' +
      '对象确实不是受保护路径的，进 EXEMPTIONS 并写明理由：\n' +
      offenders.join('\n'),
  );
});

test('变异腿：从 hooks.ts 删去「终端」提示，判据必须报出两处已知站点', async () => {
  const sources = await loadSources();
  const mutated = sources.map((s) => (s.file === 'src/trivium/hooks.ts' ? { ...s, raw: s.raw.replaceAll('终端', '别处') } : s));
  const { hits, offenders } = judge(mutated);
  for (const marker of ['禁止用 Bash 改动编排器独占的文件', '归档留痕不完整']) {
    const site = hits.find((h) => h.file === 'src/trivium/hooks.ts' && h.group.includes(marker));
    assert.ok(site, `变异后仍应命中「${marker}」`);
    assert.ok(
      offenders.includes(`${site.file}:${site.line}`),
      `删掉「终端」后「${marker}」必须成为 offender，实际：${offenders.join(', ')}`,
    );
  }
});

test('报错行号是原文行号：剥注释保留换行（代码双审 r2 CODEX-05）', () => {
  const raw =
    '/*\n * 很长的块注释\n * 第三行\n */\n' +
    'const a = 1; // 行注释\n' +
    "const msg = '请 `git restore <路径>`' +\n" +
    "  '  恢复。';\n";
  const hits = collectHits('x.ts', raw);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.line, 6, '命中在原文第 6 行');
  assert.equal(stripComments(raw).split('\n').length, raw.split('\n').length, '剥注释不能改变行数');
});

test('判据认得带取值型选项的 git 写法与全部恢复类子命令（代码双审 r2 CODEX-07）', () => {
  for (const s of [
    'git -c core.quotePath=false restore -- x',
    'git -C /proj checkout -- x',
    'git --git-dir .git reset --hard',
    'git switch main',
    'git clean -fd',
    'git revert HEAD',
    'git stash pop',
  ]) {
    GIT_RECOVERY_RE.lastIndex = 0;
    assert.ok(GIT_RECOVERY_RE.test(s), `应命中：${s}`);
  }
  for (const s of ['git -c core.quotePath=false log', 'git diff HEAD', 'git status']) {
    GIT_RECOVERY_RE.lastIndex = 0;
    assert.equal(GIT_RECOVERY_RE.test(s), false, `不应命中：${s}`);
  }
  GIT_RECOVERY_RE.lastIndex = 0;
});

test('语句组：跨行 + 拼接的文案作为一组判定，「终端」出现在组外不算数（代码双审 r2 GLM-01 宽松方向）', () => {
  const inGroup =
    "const a = '请用 `git checkout -- <路径>` 恢复。\\n' +\n" +
    "  '  这一步请在终端里手动执行。';\n";
  assert.deepEqual(judge([{ file: 'a.ts', raw: inGroup }]).offenders, []);

  const outOfGroup =
    "const a = '请用 `git checkout -- <路径>` 恢复。';\n" +
    "const b = '无关文案：请在终端里看日志。';\n";
  assert.deepEqual(judge([{ file: 'b.ts', raw: outOfGroup }]).offenders, ['b.ts:1'], '相邻无关文案里的「终端」不能替它作证');
});

test('语句组：跨行模板串与数组 join 各自整体成组（代码双审 r3 CODEX-02 ≡ AGY-01 ≡ GLM-03）', () => {
  const tplOk =
    'const m = `请用 \\`git restore <路径>\\` 恢复。\n' +
    '  这一步请在终端里手动执行。`;\n';
  assert.deepEqual(judge([{ file: 't.ts', raw: tplOk }]).offenders, [], '提示在同一模板串的下一行，应判合规');

  const tplBad =
    'const m = `请用 \\`git restore <路径>\\` 恢复。\n' +
    '  没有提示。`;\n' +
    "const other = '无关：终端';\n";
  assert.deepEqual(judge([{ file: 't2.ts', raw: tplBad }]).offenders, ['t2.ts:1'], '模板串外的「终端」不能替它作证');

  const arrOk =
    'const m = [\n' +
    "  '请用 `git restore <路径>` 恢复。',\n" +
    "  '这一步请在终端里手动执行。',\n" +
    "].join('\\n');\n";
  assert.deepEqual(judge([{ file: 'a.ts', raw: arrOk }]).offenders, [], '提示在同一数组的另一元素，应判合规');

  const arrBad =
    'const m = [\n' +
    "  '请用 `git restore <路径>` 恢复。',\n" +
    "  '没有提示。',\n" +
    "].join('\\n');\n" +
    "const other = '无关：终端';\n";
  assert.deepEqual(judge([{ file: 'a2.ts', raw: arrBad }]).offenders, ['a2.ts:2'], '数组外的「终端」不能替它作证');
});

test('防空转腿：剥注释真的剥掉了注释，且不误伤字符串 / 正则字面量', () => {
  // 注释里的恢复命令只是在讲机制，必须剥掉
  const sample = '/** git checkout 只是在讲机制 */\nconst x = 1; // git restore 同上\n';
  const stripped = stripComments(sample);
  assert.doesNotMatch(stripped, /git checkout|git restore/);
  assert.match(stripped, /const x = 1;/);

  // 字符串里的 `//`：上一版正则会把同一行后面的代码剥掉
  const url = "const u = 'https://example.com'; const s = 'git restore x';\n";
  assert.match(stripComments(url), /const s = 'git restore x';/, '字符串里的 // 不是注释');

  // 字符串里的 `/*`：上一版会与后面的 `*/` 配对吞掉中间源码
  const glob = "const g = 'src/*'; const s = 'git restore x'; /* 真注释 */\n";
  const g2 = stripComments(glob);
  assert.match(g2, /const s = 'git restore x';/, "字符串里的 /* 不是注释起点");
  assert.doesNotMatch(g2, /真注释/);

  // 正则字面量里的引号：当成字符串起点会让后面整段错位
  const re = "const r = /['\"]x/; const s = 'git restore x'; // 注释\n";
  const r2 = stripComments(re);
  assert.match(r2, /const s = 'git restore x';/);
  assert.doesNotMatch(r2, /注释/);

  // 模板串里的 `${}` 与 `//`
  const tpl = "const t = `a ${b ? '//' : 'x'} git restore y`; // 注释\n";
  const t2 = stripComments(tpl);
  assert.match(t2, /git restore y`;/);
  assert.doesNotMatch(t2, /注释/);
});
