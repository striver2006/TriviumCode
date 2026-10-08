# M11 第 6 步跟进修复 · claude 思考等级续行解析（计划原稿）

> - **执笔**：claude（当轮 Driver）
> - **日期**：2026-10-08
> - **起点**：`1e1f07dc`（主设计 v1.3.133、PRD v1.4.23、LLD v1.1.53）
> - **审查档**：A（`/dual-run`）。
> - **范围边界**：只改 `src/trivium/probes/claude.ts` 的 `parseEffortLevels` 一个纯函数；探针调用面（`probeClaudeEffortLevels`、`probeClaude` 的落盘位置与 notes 文案）、`ClaudeProbe.effort_levels` 的三态语义、claude 适配器的 `claudeReasoningLevels` / `reasoningLevelsFor`、预检判据**全部不动**。零配额：只用纯函数、假 claude 与夹具，不拉起任何真实审查员、不发起真实 claude 的模型调用（起草时跑过一次本机 `claude --help`，不调模型）。
> - **已定**（用户发起时给定，本稿照此执行）：①续行定义 =「以空白开头、去掉空白后不以 `-` 开头的行」，遇下一个选项行或空行即止；②解析规则不变——取拼接后文本里第一对圆括号，列表项逐项形状校验，不合形状落 `null`，没有 `--effort` 行仍落 `[]`；③BACKLOG 不新登，本修复即处置；④提交后由用户重装并再跑一次零配额 doctor，核 `effort_levels` 落为五个取值。
> - **引用约定**：「主设计」= `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`；「报告」= `doc/05_testing/REPORT_2026-10-08_m11_effort_wiring.md`；行号取自 `1e1f07dc`。

---

## 0. 结论速览

1. **根因**：`parseEffortLevels`（`probes/claude.ts:667`）只取含 `--effort` 的**那一行**找括号；本机 `claude 2.1.291` 的帮助文本把取值列表折在下一行的 40 格空格缩进续行上，锚点行没有括号 ⇒ 按设计落 `null`。
2. **用例为何没抓到**：K1 / K3 的样本常量 `F6`（`test/unit/effort-wiring.test.ts:276`）抄自第 1 步报告 F6 的引用，报告把第 84、85 行拼成了一行；单测、变异（M14 / M17）、验收全建立在这份转述上，全绿。提交重装后真机 doctor 才暴露。
3. **修法**：锚点行之后，把**紧随其后的连续续行**拼上（单个空格连接），再按原规则解析。续行判据、终止条件照用户给定，不另加。
4. **样本**：本机 `claude --help` 的**整份原始输出**（311 行，逐字节，sha256 `550db4f8…6c35f09`）存为夹具 `test/fixtures/claude-help-2.1.291.txt`；K1 新格与 K3 的假 claude 都读这份夹具，**不再手抄**。夹具已扫过：无 tab、无凭据形态字面（只有 `ANTHROPIC_API_KEY` / `apiKeyHelper` 等键名与说明文字）。
5. **三格新用例 + 变异一条**（§3）；**文档**按实际达成改准（§4），新增主设计 v1.3.134 行。
6. **没有待拍板项**；§5 列三条残余风险请审查员核取舍。

---

## 1. 现状核实（`1e1f07dc`）

### 1.1 本机原始帮助文本（起草时零配额实跑，`/Users/chenzhenbo/.local/bin/claude`，`2.1.291 (Claude Code)`，退 0）

第 81～89 行，`cat -vet` 核过（行尾 `$` 前无尾随空格，无 `^I`）：

```
  --disallowedTools, --disallowed-tools <tools...>
      Comma or space-separated list of tool names to deny (e.g. "Bash(git *)
      Edit")
  --effort <level>                      Effort level for the current session
                                        (low, medium, high, xhigh, max)
  --environment <environment_id>        Create a new cloud session that runs on
                                        the given self-hosted environment
                                        (ccpool_...).
  --exclude-dynamic-system-prompt-sections
```

要点：

- 第 84 行（锚点）没有括号；第 85 行是 40 格空格 + `(low, medium, high, xhigh, max)`；第 86 行以两格空格 + `--environment` 起头，是下一个选项。
- 同一份帮助文本里还有**第二种排版**：选项名独占一行、描述在下一行 6 格缩进（第 82～83 行的 `--disallowedTools`）。用户给定的续行判据对两种排版都成立。
- 帮助文本里有**跨行的括号**（第 28～29 行 `--autocompact`：`(auto, or` / `100k–1M tokens)`）与**下一个选项续行里的括号**（第 88 行 `(ccpool_...).`）——正是焦点里「别的选项的括号」的真实形态，夹具里都有。
- 全文只有第 84 行含 `--effort` 词（`grep -n -e '--effort'` 仅一处命中）。空行在第 2、5、8、264 行（第 264 行是 Options 段与 Commands 段的分界）。

### 1.2 现行函数（`probes/claude.ts:667-675`）

```ts
const line = help.split(/\r?\n/).find((l) => /(^|\s)--effort(\s|=|$)/.test(l));
if (line === undefined) return [];
const open = line.indexOf('(');
const close = open >= 0 ? line.indexOf(')', open + 1) : -1;
if (open < 0 || close < 0) return null;
const items = line.slice(open + 1, close).split(',').map((x) => x.trim());
if (items.length === 0 || items.some((x) => !/^[a-z][a-z0-9_-]*$/.test(x))) return null;
return items;
```

文档块（`:655-666`）里「本机 2.1.291 实测原文（M11 第 1 步 F6）：`--effort <level>  Effort level … (low, …)`」就是那份拼过的转述，同样失实。

### 1.3 现行用例与变异

- K1（`:278-291`）八格，第一格用 `F6` 单行常量；K3（`:305-320`）假 claude 的 `--help` 吐 `F6` 一行。
- 第 6 步变异 M14（`if (open < 0 || close < 0) return null;` ⇒ `return [];`）、M17（`indexOf('(')` ⇒ `lastIndexOf('(')`）锚在现行源码行上，本次改动后锚点要随新源码重截（§3.3）。

---

## 2. 修法

### 2.1 拼接规则

```ts
const lines = help.split(/\r?\n/);
const at = lines.findIndex((l) => /(^|\s)--effort(\s|=|$)/.test(l));
if (at < 0) return [];
let text = lines[at]!;
for (let i = at + 1; i < lines.length; i++) {
  const l = lines[i]!;
  if (!/^\s/.test(l)) break;                 // 不以空白开头：段标题、顶格文本
  const t = l.trim();
  if (t === '' || t.startsWith('-')) break;  // 空行（含纯空白行）或下一个选项行
  text += ' ' + t;
}
// 以下与现行逐字相同，只把 line 换成 text
```

判据逐条落到用户给定的定义上：

| 行的形态 | 处置 | 依据 |
| :--- | :--- | :--- |
| 以空白开头、去空白后非空且不以 `-` 起头 | 拼入，继续看下一行 | 续行定义 |
| 去空白后以 `-` 起头（`  --environment …`、`  -p, --print`） | 停 | 「下一个选项行」 |
| 空行或纯空白行 | 停 | 「空行即止」；纯空白行按空行算——它去空白后为空，不是续行 |
| 不以空白开头（`Commands:`、顶格正文） | 停 | 不满足「以空白开头」 |
| 文本结束 | 停 | — |

- **只向后、只连续**：拼接从锚点下一行起，遇第一个非续行即止，不跳过、不回看锚点之前的行；
- **锚点行不变**：仍是「第一个含 `--effort` 词的行」，正则不改（`--effort-budget` 之类不算的那一格照旧成立）；
- **解析规则不变**：括号、形状校验、`[]` / `null` 三态逐字沿用；单个空格连接不影响逐项 `trim()`，跨行的列表（`(low, medium,` / `high)`）也能取全；
- **只换局部变量名 `line` ⇒ `text`**，return 路径与类型不变。

### 2.2 文档块改准

- 删去「本机 2.1.291 实测原文（M11 第 1 步 F6）」那句单行转述，改为：本机 2.1.291 的取值列表折在锚点下一行的缩进续行上（夹具 `test/fixtures/claude-help-2.1.291.txt` 第 84～85 行），并写明续行判据与终止条件；
- 「格式一漂移就落 `null`」那段保留，补一句：续行只拼紧随其后、连续的缩进非选项行，遇选项行或空行即止，**不会越过下一个选项去拿它的括号**——越不过去时结果是「锚点 + 本选项续行里没有括号 ⇒ `null`」。

### 2.3 不改的面

`probeClaudeEffortLevels`（拼 `stdout + '\n' + stderr` 后整体送解析）不动——stderr 在本机为空；即便有内容，它在 stdout 之后，只可能出现在锚点之后**更远**的位置，中间隔着 stdout 自身的段落与空行。`types.ts` 的 `effort_levels` 字段注释（`:822` 写「解析 `--effort` 行第一对圆括号里的列表」）只改一处措辞为「解析 `--effort` 行及其续行里第一对圆括号」，否则注释又成了失实断言；字段类型与三态语义不动。

---

## 3. 用例与变异

### 3.1 夹具

`test/fixtures/claude-help-2.1.291.txt`：起草时 `claude --help > scratchpad/claude-help.txt` 的**整份**输出，编码时逐字节拷入（不经编辑器、不手抄），用例里核 sha256 与本稿 §0 第 4 条一致，防止事后被「整理」成转述形态。文件头不加注释（加了就不是原文）；出处写在用例注释与报告里：claude 2.1.291，2026-10-08 本机零配额实跑，`--help` 不调模型。

先跑全量看 `contract/fixture-credentials` 与 `doc-archive-index` 一类扫描对 `test/fixtures/` 新文件的反应；若某扫描把帮助文本里的键名说明当凭据形态，按该测试已有的豁免登记口径处理并在报告里写明，不改夹具内容。

### 3.2 K 组改动（`test/unit/effort-wiring.test.ts`）

- **K1 原八格保留**（它们是格式漂移的合成样本，本来就不冒充原文）；`F6` 常量**删除**，第一格改名为「单行形态（合成）」并直接写出单行串——不再挂 F6 的名，免得再被当成原文。
- **K1 新增三格**：
  1. **本机原文两行**：从夹具读入**整份**帮助文本 ⇒ `['low','medium','high','xhigh','max']`；同格再断言夹具第 84、85 行逐字等于 §1.1 所列（含 40 格缩进），证明样本形态就是「列表在续行」——若哪天夹具被拼成一行，这格先红；
  2. **续行后紧跟下一个选项不被拼进来**：锚点行无括号、续行无括号，紧跟 `  --foo <x>   Foo (a, b)`（括号内容**合形状**，若越界拼入会得到错枚举 `['a','b']`）⇒ `null`；再加一个变体：下一个选项用短旗标形态 `  -f, --foo …`；
  3. **续行里没有括号仍落 `null`**：锚点 + 两行续行都无括号，之后空行，空行后再一段缩进行带 `(a, b)` ⇒ `null`（同时咬住「空行即止」）；变体：空行换成只含空格的行、换成顶格的 `Commands:` 段标题。
- **K1 再补一格（续行判据的另一半）**：6 格缩进的第二种排版——`  --effort <level>` 独占一行、下一行 `      Effort level (low, high)` ⇒ `['low','high']`；以及跨行列表 `(low, medium,` / `high)` ⇒ 三项。这两格是对「拼接」本身的正向覆盖，不是用户点名的三格，单列说明。
- **K3** 假 claude 的 `--help` 改为 `cat` 夹具文件（路径经环境变量或绝对路径写进 sh），断言 `effort_levels` 为五项、notes 含五个取值——让「探针整条链」也吃原文。

### 3.3 变异（照既有装置与逐条预跑脚本）

证据目录 `doc/05_testing/evidence/m11-effort-continuation-20261008/`：

- `gen-mutation-spec.mjs`：照搬第 6 步同名脚本的 `blockOf` / `sub` / 特殊替换串扫描，**只含 `probes/claude.ts` 一个目标、`effort-wiring` 单测一个套件**；
- 新增 **N1「不拼续行」**：把拼接循环的 `for` 头改成立即退出（`i < lines.length` ⇒ `i < at + 1`，或等价的锚点替换，以生成脚本核唯一为准），期望 K1「本机原文两行」与 K3 红；
- 新增 **N2「拼接不止于选项行」**：删去 `|| t.startsWith('-')`，期望 K1 新格 2 红；
- 新增 **N3「拼接不止于空行」**：删去 `t === '' ||`，期望 K1 新格 3 红（纯空白行变体）；
- 第 6 步的 **M14 / M17** 锚点随新源码重截后**重跑**（`line.indexOf` ⇒ `text.indexOf`），证明改动没让它们失咬；
- 先用逐条预跑脚本（照搬第 6 步 `mutation-names.mjs`，带 `--test-timeout`）过一遍，再跑正式装置 `scripts/mutation-check.mjs`；输出存证据目录。

N2 / N3 是焦点「边界是否严格」的直接证据：没有它们，两条终止条件被删也不会有用例红。

### 3.4 全量

`npm run check` 一次只发一条、输出重定向到证据目录的文件、`echo exit=$?` 取真实退出码，串行两次；跑前 `pgrep -fl 'node --test'` 确认无残留；跑着时不改 `doc/`。新增临时目录只走 `scratchDir`（K3 已在用）。单跑前 `node scripts/build.mjs --with-tests`，核用例总数含新增格。

---

## 4. 文档

- **报告**（`REPORT_2026-10-08_m11_effort_wiring.md`）：
  - 第 88 行风险 7「重装后跑一次 `doctor --no-model-calls` 即落盘」改准：重装后跑过，**真机落 `null`**（取值列表在续行上，解析器只看锚点行），预检对 claude 思考等级跳过校验并点名，不误拦、不放错值；本跟进修复后重装再跑才落五项；
  - 第 25 行 K 组说明里「F6 原文」改为「单行形态（合成）」，并注明原「F6 原文」是报告转述、非原始输出；
  - 末尾新增「跟进修复（2026-10-08）」一节：现象、根因（报告引用把两行拼成一行、样本未对原文核对）、修法、新增用例与变异读数、全量两次读数、待用户重装后核 doctor 一项（未核前不写「已落盘」）。
- **主设计**：
  - §3.7 第 459 行「零配额、`doctor --no-model-calls` 即落」后补：v1.3.133 首版只解析锚点行、本机列表在续行上，真机落 `null`，v1.3.134 起拼续行；
  - §11.5 第 2965 行「解析取该行第一对圆括号」改为「取该行及紧随的缩进续行拼接后的第一对圆括号（续行判据……，v1.3.134）」；
  - v1.3.133 变更记录行**不改写历史正文**（它记的是当时提交的内容，「探针零配额解析 `--help` 落 `ClaudeProbe.effort_levels`」作为实现描述并不失实），只在该行「二、claude 原生枚举」项末尾补一个括注「（真机未落成：取值列表在续行上，见 v1.3.134）」；
  - **新增 v1.3.134 行**：现象、根因两条（解析器只看锚点行；样本取自报告转述、未对原文核对）、修法、用例与变异、读数、「状态：待用户重装后跑零配额 doctor 核五项」；文档头当前版本与第 41 行 M11 进度段的第 6 步括号里补一句「claude 原生枚举 v1.3.134 修续行解析后落盘」；
  - 用户原话「主设计 v1.3.133 变更记录里『零配额 doctor 即落盘』那句」：核过，v1.3.133 行里没有这句字面；同义断言在 §3.7 第 459 行（「零配额、`doctor --no-model-calls` 即落」）与报告第 88 行，本稿按这两处改。请审查员核我是否漏了别处。
- **PRD**：核过，PRD 的 FR-30 / FR-27 / AC-23 进度句（v1.4.23）没有断言 claude 原生枚举已落盘或已校验，**不改、不升版本**；若审查员找到需改的句子再改。
- **LLD**：v1.1.53 变更说明写「`probes/claude.ts` 补 `effort_levels`（零配额解析 `--help`）」，仍属实，不改。
- **测试目录 README**：第 127 行报告索引描述若提到 K 组或 F6 则同步，否则不改；新证据目录若 `doc-archive-index` 要求登记则登记。
- **BACKLOG**：不新登（用户已定）。
- **types.ts** 字段注释一处措辞（§2.3）。

---

## 5. 残余风险（请审查员核取舍，本稿均不处理）

1. **锚点行仍是「第一个含 `--effort` 词的行」**：若厂商在别的选项的续行里用散文提到 `--effort`（如「overrides --effort」）且它排在 `--effort` 选项之前，锚点会落到那行，拼的是别人的续行。本机原文只有一处命中，用户给定「解析规则不变」，本稿不收紧锚点。收紧（例如要求锚点去空白后以 `-` 起头）的代价：若某版只在散文里提到它，会从「错枚举 / null」变成 `[]`（「无此概念」，配了即退 64）。
2. **第一对括号若是单个合形状的词**（如 `(experimental)` 出现在列表之前）会落一项错枚举。这在拼接前就存在于单行形态，拼接把窗口扩到了续行。不加「至少两项」之类的新规则——那是改解析规则，超出用户给定。
3. **续行判据不看缩进深度**：一行以空白开头、非 `-` 起头即算续行，不核它是否与描述列对齐。帮助文本里不存在「缩进的非选项行却属于别的段落」而中间没有空行或选项行的形态（Options 段内每个条目都以选项行起头，段间有空行），故不加。

---

## 6. 实施顺序

1. 夹具入库（逐字节拷贝，核 sha256）；
2. 改 `parseEffortLevels` 与文档块、`types.ts` 注释；
3. 改 K1 / K3；`node scripts/build.mjs --with-tests` 后单跑 `effort-wiring` 单测，核新增格在数；
4. 生成变异规格 → 逐条预跑 → 正式装置；
5. 全量两次（串行，各一条）；
6. 改报告、主设计、README（若需）；改完文档后再全量两次（测试读 `doc/`）。

步骤 5 与 6 的次序：若先改文档再一次性全量两次，可省一轮；实施时取「代码与用例、文档全部改完 → 全量两次」，变异在文档改动前跑完（变异不读 `doc/`）。
