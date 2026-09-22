// EV-79 · 重定向运算符对账表：判据的分类结果 vs 外壳实测语义
// （形态数不写死在抬头——本主题刚把承诺面从「共 N 种拼写」改成「按文法覆盖」，
//   理由正是枚举数目不可证；实际条数见末行合计，由 CASES.length 派生）
//
// 为什么要有这份（代码双审 CODEX-06 ≡ GLM-02）：计划 §3.1 声称「55 个形态逐格对照、
// 0 处不符」，而那张表此前只活在计划稿里，没有可复跑的留痕。
//
// ─────────────────────────────────────────────────────────────────────
// **r3 重写：把「实测」从期望值里拆出来**（代码双审 r3 CODEX-r3-03 ≡ AGY-03 ≡ GLM-04）
//
// 上一版的致命构造：`got === 'X'` 时直接按 `want` 反填档位（`want === 'X:miss' ? … : 'X:fd'`），
// 于是**凡期望为 X 的行，构造上永远「相符」**。我上一轮加 X:fd / X:miss 分档是为了防
// 「给漏检盖相符章」，但**分了档没分来源**：两档的判据侧观测完全相同（都是「不取目标」），
// 差别只在实测侧，而实测侧当时没有任何程序化输入。这与本主题 r2 那条「空枪用例」
// （断言在两种实现下同形）是同一族错误，只是换了个载体。
//
// 现在改成**两条独立的轴**：
//   · 轴一 判据行为：`got` vs `want`，want 只取 'F:…' 或 'X'（不再含 miss/fd 这类成因）。
//   · 轴二 实测真值：每行的 `w` 字段（是否真建出文件），**具名抄自** probe-redirect-operators.out.txt
//     的行号，由 `judgeDrift` 式的交叉核对而非反填得出。
// 漏检 = 轴一为 X（判据不取目标）**且** 轴二为 true（实测真写入）。两轴独立 ⇒ 不再循环。
//
// **这套办法的限度，写明不遮**：两份留痕不可能在一次执行里联动——探针要真建文件，
// 本脚本跑在项目里不能建。所以轴二是**抄录 + 具名**，失真面从「永远相符」降到「抄录出错」，
// 抄录出错只能靠 `src` 行号被人复核时发现。这不是端到端，不要当成端到端用。
// ─────────────────────────────────────────────────────────────────────
//
// 对账口径：
//   · 判据侧 —— 直调 `writeSinksOfSegment` 的实际消费方 `classifyWriteCommands`，
//     用**项目内/项目外**的落档差异反推它取到了哪个目标（writes 只给命令原文，
//     取不到目标本身，这正是「目标钉死」那组用例用的同一招）。
//   · 实测侧 —— 见同目录 probe-redirect-operators.out.txt（跑完看建出什么文件）。
//
// 用法：node redirect-operator-matrix.mjs   （先 node scripts/build.mjs --tests-only）
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// 仓库根由 git 推导，不写死绝对路径（代码双审 r2 CODEX-05 的落点论域，r3 CODEX-r3-05
// ≡ AGY-01 ≡ GLM-02 指出上一轮只改了姊妹脚本、漏了本件）。
const REPO_ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const m = await import(pathToFileURL(`${REPO_ROOT}/dist/test/src/trivium/adapters/base.js`).href);

const head = execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
// 戳带**工作树指纹**：本轮被审代码在未提交的工作树上，只落 HEAD 会让「不含修复的 HEAD」
// 与「标着它的结案证据」共用同一个短哈希——按戳 checkout 复跑会大面积不符，而戳上看不出
// 这个差别（r3 GLM-02；与 verify-claude-findings-on-head.mjs 同款处理）。
const dirty =
  execSync('git status --porcelain -uall', { cwd: REPO_ROOT, encoding: 'utf8' }).trim().length > 0;

const ROOT = '/proj';

/**
 * 期望值（轴一，只说**判据行为**）：
 *   'F:<目标>'  该 token 取到的写目标就是 <目标>（用项目外路径时落疑似档反推）
 *   'F:in'      取到的目标归一后落在项目内
 *   'X'         判据**不取任何目标**
 *
 * 实测值（轴二，**抄自** probe-redirect-operators.out.txt）：
 *   w   true = 该形态真建出文件 ｜ false = 不建 ｜ null = 本探针未覆盖
 *   src 抄录来源行号；`~` 后缀表示**同运算符、不同目标形**的旁证，不是该拼写直测
 *   mech 判据不取目标时的**机制标注**，仅供阅读，不参与对账（见页脚）
 *
 * `w` 为 null 的行不参与漏检判定，单独计数披露——「没测过」与「测了不写」必须分开，
 * 这正是本轮要修的那类混同。
 */
const CASES = [
  // ── 规则 4：非 fd 族，无条件取文件目标 ──
  ['>out.txt', 'echo x >/tmp/o.txt', 'F:/tmp/o.txt', true, 'L8~'],
  ['> out.txt', 'echo x > /tmp/o.txt', 'F:/tmp/o.txt', true, 'L8~'],
  ['>>out.txt', 'echo x >>/tmp/o.txt', 'F:/tmp/o.txt', true, 'L9~'],
  ['>> out.txt', 'echo x >> /tmp/o.txt', 'F:/tmp/o.txt', true, 'L9~'],
  ['&>out.txt', 'echo x &>/tmp/o.txt', 'F:/tmp/o.txt', true, 'L10~'],
  ['&> out.txt', 'echo x &> /tmp/o.txt', 'F:/tmp/o.txt', true, 'L10~'],
  ['&>>out.txt', 'echo x &>>/tmp/o.txt', 'F:/tmp/o.txt', true, 'L11~'],
  ['&>> out.txt', 'echo x &>> /tmp/o.txt', 'F:/tmp/o.txt', true, 'L11~'],
  ['>>&out.txt', 'echo x >>&/tmp/o.txt', 'F:/tmp/o.txt', true, 'L18'],
  ['>>& out.txt', 'echo x >>& /tmp/o.txt', 'F:/tmp/o.txt', true, 'L17'],
  ['2>>&1', 'echo x 2>>&1', 'F:in', true, 'L19'],
  ['>>&-', 'echo x >>&-', 'F:in', true, 'L20'],
  // 纯数字 / 减号作目标位（r4 的漏检面）
  ['> 2', 'echo x > 2', 'F:in', true, 'L8'],
  ['>> 2', 'echo x >> 2', 'F:in', true, 'L9'],
  ['&> 2', 'echo x &> 2', 'F:in', true, 'L10'],
  ['&>> 2', 'echo x &>> 2', 'F:in', true, 'L11'],
  ['>>& 2', 'echo x >>& 2', 'F:in', true, 'L12'],
  ['>>&2', 'echo x >>&2', 'F:in', true, 'L13'],
  ['> -', 'echo x > -', 'F:in', true, 'L51'],
  // 强制覆盖后缀 × 文件目标
  ['>&| f', 'echo x >&| /tmp/o.txt', 'F:/tmp/o.txt', true, 'L23'],
  ['>&! f', 'echo x >&! /tmp/o.txt', 'F:/tmp/o.txt', true, 'L24'],
  ['&>| f', 'echo x &>| /tmp/o.txt', 'F:/tmp/o.txt', true, 'L25'],
  ['&>! f', 'echo x &>! /tmp/o.txt', 'F:/tmp/o.txt', true, 'L26'],
  ['2>&| f', 'echo x 2>&| /tmp/o.txt', 'F:/tmp/o.txt', true, 'L27'],
  ['2>&! f', 'echo x 2>&! /tmp/o.txt', 'F:/tmp/o.txt', true, 'L28'],
  ['>&|f（紧贴）', 'echo x >&|/tmp/o.txt', 'F:/tmp/o.txt', true, 'L23~'],
  // 强制覆盖后缀 × 数字/减号目标（r5 的漏检面）
  ['>&| 2', 'echo x >&| 2', 'F:in', true, 'L30'],
  ['>&|2（紧贴）', 'echo x >&|2', 'F:in', true, 'L31~'],
  ['>&!2（紧贴）', 'echo x >&!2', 'F:in', true, 'L31'],
  ['>&| -', 'echo x >&| -', 'F:in', true, 'L32'],
  ['2>&! 1', 'echo x 2>&! 1', 'F:in', true, 'L33'],
  ['2>&|1（紧贴）', 'echo x 2>&|1', 'F:in', true, 'L33~'],
  // 普通覆盖后缀
  ['>| f', 'echo x >| /tmp/o.txt', 'F:/tmp/o.txt', true, 'L36'],
  ['>|f（紧贴）', 'echo x >|/tmp/o.txt', 'F:/tmp/o.txt', true, 'L36~'],
  ['>! f', 'echo x >! /tmp/o.txt', 'F:/tmp/o.txt', true, 'L37'],
  ['>>| f', 'echo x >>| /tmp/o.txt', 'F:/tmp/o.txt', true, 'L38'],
  ['>>! f', 'echo x >>! /tmp/o.txt', 'F:/tmp/o.txt', true, 'L39'],

  // ── 规则 3：fd 族 + 非数字非减号目标 ⇒ 文件 ──
  ['>&f（紧贴）', 'echo x >&/tmp/o.txt', 'F:/tmp/o.txt', true, 'L16~'],
  ['>& f（分离）', 'echo x >& /tmp/o.txt', 'F:/tmp/o.txt', true, 'L15~'],
  ['2>&f（紧贴）', 'echo x 2>&/tmp/o.txt', 'F:/tmp/o.txt', true, 'L16'],
  ['2>& f（分离）', 'echo x 2>& /tmp/o.txt', 'F:/tmp/o.txt', true, 'L15'],
  ['>&2foo（等值防线）', 'echo Y >&2foo', 'F:in', true, 'L14'],

  // ── 规则 1 / 2：fd 族 + 恰为数字或减号 ⇒ 排除 ──
  ['>&2', 'echo x >&2', 'X', false, 'L44', 'fd'],
  ['>&1', 'echo x >&1', 'X', false, 'L44~', 'fd'],
  ['2>&1', 'echo x 2>&1', 'X', false, 'L45', 'fd'],
  ['1>&2', 'echo x 1>&2', 'X', false, 'L46', 'fd'],
  ['>&-', 'echo x >&-', 'X', false, 'L47', 'fd'],
  ['2>&-', 'echo x 2>&-', 'X', false, 'L48', 'fd'],
  ['>& 2（分离）', 'echo x >& 2', 'X', false, 'L42', 'fd'],
  ['>& -（分离）', 'echo x >& -', 'X', false, 'L43', 'fd'],
  ['2>& 1（分离）', 'echo x 2>& 1', 'X', false, 'L42~', 'fd'],

  // ── 与写动词交互：被排除的 fd 目标不得顶替真实写入点 ──
  // （w 说的是**重定向部分**建不建文件；写入点来自 cp 这个写动词，不来自重定向）
  ['cp … >& 2', 'cp src/a.ts /tmp/out.ts >& 2', 'F:/tmp/out.ts', false, 'L42'],
  ['cp … >& -', 'cp src/a.ts /tmp/out.ts >& -', 'F:/tmp/out.ts', false, 'L43'],
  ['cp … 2>&1', 'cp src/a.ts /tmp/out.ts 2>&1', 'F:/tmp/out.ts', false, 'L45'],

  // ── 文法之外与语法错（已知残余 / 不可达）──
  // 判据不取目标而实测**真建出文件** ⇒ 由轴二派生为漏检，不靠期望值声明（EV-99 兜底）
  ['{fd}> f（文法外）', 'echo x {fd}> /tmp/o.txt', 'X', true, 'L54', 'miss'],
  // 这一行的排除机制**不是** fd 语义、也不是「引号免疫」：是 base.ts 去引号规则把
  // 引号段内含 & 的整段丢弃（`[\s;&|()]` 命中即替换为空格）。那条丢弃规则正是
  // **EV-102 登记的残余机制本身**——上一版给它盖「正确排除」章，盖错了对象（r3 AGY-03）。
  ["引号内的 &> 字面量", "grep -n '&>' src/a.ts", 'X', false, '—', 'drop'],
];

/** 机制标注的中文名，仅供阅读；不参与对账（见页脚第 2 条） */
const MECH_LABEL = { fd: 'fd 语义排除', drop: '去引号丢弃 ⇒ EV-102', miss: '文法外 ⇒ EV-99' };

let bad = 0;
let missCount = 0;
let untested = 0;
const rows = [];
for (const [label, cmd, want, w, src, mech] of CASES) {
  const r = m.classifyWriteCommands([cmd], ROOT);
  let got;
  if (r.writes.length > 0) {
    got = 'F:in'; // 目标落在项目内
  } else {
    const outside = r.suspected.find((s) => s.why.startsWith('写入目标在项目外'));
    if (outside) {
      got = `F:${outside.why.replace('写入目标在项目外：', '')}`;
    } else if (r.suspected.length > 0) {
      /*
       * 落进疑似档但**不是**「项目外」那个原因（幂等 / 掩码 / 提不出目标）。
       * 上一版把这一族一并吞进 X，于是某个 X 期望格若因回归改落到别的疑似原因，
       * 表照样打「相符」（r3 GLM-04）。现在单列成 S:，与 X 区分开、照常计不符。
       */
      got = `S:${r.suspected[0].why.split('：')[0]}`;
    } else {
      got = 'X'; // 判据完全不取目标
    }
  }
  const ok = got === want;
  if (!ok) bad++;
  // 漏检由**两轴交叉**派生，不由期望值声明：判据不取目标，而实测真写入。
  const miss = got === 'X' && w === true;
  if (miss) missCount++;
  if (w === null) untested++;
  rows.push([ok ? '  ' : '!!', label, cmd, got, want, w, src, mech, miss]);
}

const fmtW = (w) => (w === true ? '真写入' : w === false ? '不建文件' : '未实测');

console.log(
  `# EV-79 · 重定向运算符对账表 ｜ 基线 HEAD=${head}${dirty ? ' + 未提交改动（工作树脏）' : ''} ｜ 生成于 ${new Date().toISOString()}`,
);
console.log(`# 轴一 判据侧：classifyWriteCommands 的落档（F:in = 项目内、F:<路径> = 项目外、`);
console.log(`#              S:<原因> = 落进非「项目外」的疑似档、X = 不取任何目标）`);
console.log(`# 轴二 实测侧：抄自同目录 probe-redirect-operators.out.txt，src 为抄录行号（~ = 同运算符旁证）`);
console.log(`# 漏检 = 轴一为 X 且轴二为真写入，**派生得出**，不由期望值声明\n`);
for (const [mark, label, cmd, got, want, w, src, mech, miss] of rows) {
  const tail = mech ? `  [${MECH_LABEL[mech] ?? mech}]` : '';
  console.log(
    `${mark}${miss ? '※' : ' '}${label.padEnd(22)} ${cmd.padEnd(38)} 判据=${got.padEnd(12)} 期望=${want.padEnd(14)} 实测=${fmtW(w).padEnd(8)}(${src})${tail}`,
  );
}

console.log(`\n共 ${CASES.length} 形态，轴一不符期望：${bad}`);
console.log(`※ 漏检（判据不取目标而实测真写入）：${missCount} 格 —— 属已知残余，靠 BACKLOG 兜底`);
console.log(`未实测（本探针未覆盖该拼写，不参与漏检判定）：${untested} 格`);
console.log(`\n口径声明（三条，都是这张表**不能**证明的事）：`);
console.log(`  1. 「不符期望：0」只说明判据行为与登记一致，**不等于无漏检**——漏检看 ※ 那行。`);
console.log(`  2. 方括号里的机制标注（fd 语义 / 去引号丢弃 / 文法外）是**登记侧给定的说明**，`);
console.log(`     对账不校验它；标错了这张表不会红，只能靠人读 src 行号复核。`);
console.log(`  3. 轴二是从另一份留痕**抄录**来的，不是本次执行实测。两份留痕不可能在一次`);
console.log(`     执行里联动（探针要真建文件，本脚本不能建），失真面是「抄录出错」。`);
