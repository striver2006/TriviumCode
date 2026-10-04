---
schema: trivium.disposition.v1
topic: 单测临时目录收尾
stage: plan
role: claude
kind: revised
run_id: 20261004T133008Z
addresses:
  - 2026-10-04-单测临时目录收尾-codex.md
  - 2026-10-04-单测临时目录收尾-gemini.md
  - 2026-10-04-单测临时目录收尾-glm.md
---

# 裁决：单测临时目录收尾 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-04-单测临时目录收尾-claude.md`（r1，起点 `ae5dfbd`）
> ｜ 运行：`20261004T133008Z`（三侧到齐）
> ｜ 结论：codex `approve-with-nits`（次要 1）｜ gemini `request-changes`（重要 2、次要 1）｜ glm `approve-with-nits`（次要 1、吹毛求疵 2）
> ｜ 共 7 条：接受 7
> ｜ 修订后的计划：`plan/2026-10-04-单测临时目录收尾-r2-claude.md`；命令 A 不设人工闸门

三侧都独立复算了 r1 §1 的口径：剥离后 74 个文件、124 处，不动 21 个文件 36 处、改 53 个文件 88 处；codex 用仓内 `typescript` 复刻 `stripNonCode` 现跑一致，glm 逐文件核了处数与 `fakeCtx` 的 4 个文件 63 处。待改的 88 处父目录全是 `os.tmpdir()`、前缀除 `task-goal` 外全以 `trivium-` 开头，三侧均核实。

三侧同指一处：r1 §4 说 SC 组「本文件自己的私有根进豁免表」，§3 的豁免表公式却只写「21 项 + `scratch.ts` × 2」，照 §3 字面实施 G1 当天就红。属实，是我起草时两节没对齐。

AGY-02 回到本机核过：`os.tmpdir()` 会去掉 `TMPDIR` 的尾斜杠（codex 也实测了这一点），所以审查件里「尾斜杠导致防呆误判」那个具体场景不会发生；但同一处比对在 `TMPDIR` 是**相对路径**时确实会失效——`os.tmpdir()` 原样返回 `rel/x`，mkdtemp 的返回值也是相对的，退出时过不了绝对路径检查、只会打一行「不像」并留下目录（计划阶段 `node -e` 实测）。建议的修法（两侧解析后再比）正好覆盖这一情形，按订正后的形态接受。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | minor | 接受 | 属实：r1 §3 的豁免表公式漏了 `scratch-cleanup.test.ts` 自己私有根那一处，与 §4「进豁免表」自相矛盾，按 §3 实施 G1 必红。豁免表补这一项，口径只留一份：实施后共 23 个文件、39 处 | r2 §3 第 3 条；§0 第 3 条；§4 首段；§6 |
| AGY-01 | gemini | major | 接受 | 与 CODEX-01 同一处。另按建议把 §0、§6 的结案口径同步改成「改 53 / 不动 21，实施后豁免表 23 个文件 39 处」；不采用「换一种不被守卫计数的私有根写法」——那等于给守卫开一个绕过的样板 | r2 §0 第 3 条；§3 第 3 条；§6；§7 第 2 条 |
| AGY-02 | gemini | major | 接受 | 场景订正后接受：尾斜杠不会出现（`os.tmpdir()` 去尾斜杠，已实测），会出问题的是相对路径 `TMPDIR`。修法：调用时取 `parent = path.resolve(os.tmpdir())`，登记时存 `path.resolve(返回值)`，退出时两侧都是解析过的绝对路径再比；交给调用方的返回值不变。SC1 补「带尾斜杠的 `TMPDIR`」与「相对路径 `TMPDIR` 后再 `chdir`」两个目录，变异补 M15（登记时不解析） | r2 §2 第 3、4 条；§4 SC1；§5.2 M15 |
| AGY-03 | gemini | minor | 接受 | 下划线不引入分隔符、不造成穿越，放行无代价。正则改为 `^trivium-[A-Za-z0-9_-]*$`，SC6 补一个合法的下划线前缀照常建出、退出后删掉 | r2 §2 第 2 条；§4 SC6 |
| GLM-01 | glm | minor | 接受 | 与 CODEX-01 同一处；glm 提到的「守卫文件自身样例都在字符串与正则字面量里、剥离后恒计 0、不需要表项」一并写进 §3 第 2 条 | r2 §3 第 2、3 条 |
| GLM-02 | glm | nit | 接受 | 属实：r1 §1.1 的「不动前缀新建为 0」只举了一部分，`zcode-provider-env` 的 `trivium-r1-priv-` / `trivium-doctor-` / `trivium-d19-priv-` 与 `zcode-mcp-adapter` 的参数化前缀都没列。r2 把 21 个文件直接建在系统临时目录下的前缀全部列出（逐个为 0），并注明哪几处不建在系统临时目录下；报告照此写 | r2 §1.1 第三段；§6 报告一条 |
| GLM-03 | glm | nit | 接受 | 属实：`scratchDir` 是 async 函数，体内的 throw 表现为被拒的 Promise，不是同步异常。措辞分两版写清，SC6 对 `scratchDir` 用 `assert.rejects`、对 `scratchDirSync` 用 `assert.throws`，并保留「被拒之后 `tmp/` 下零条目」这条要紧的断言 | r2 §2 第 2 条；§4 SC6 |

## 2. 修改小结

- 守卫豁免表：21 + `scratch.ts` × 2 + `scratch-cleanup.test.ts` × 1，实施后 23 个文件、39 处（三侧同指）。
- helper 登记时解析路径，防呆按解析后的绝对路径比对；SC1 加两个目录、变异加 M15（AGY-02）。
- 前缀放行下划线（AGY-03）；拒绝形态按同步 / 异步两版分写（GLM-03）。
- §1.1 「不动」前缀列全（GLM-02）。

无驳回、无暂缓。本轮没有新发现需要另登 BACKLOG。
