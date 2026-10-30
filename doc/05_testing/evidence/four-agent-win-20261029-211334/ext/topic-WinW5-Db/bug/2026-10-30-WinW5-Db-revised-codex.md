---
schema: trivium.disposition.v1
topic: WinW5-Db
stage: bug
role: codex
kind: revised
run_id: 20261030T001216Z
addresses:
  - 2026-10-30-WinW5-Db-claude.md
---

# 裁决与修订后的根因结论：WinW5-Db（bug 阶段）

被审原稿：`.reviews/WinW5-Db/bug/2026-10-30-WinW5-Db-codex.md`
审查来源：claude 侧 `2026-10-30-WinW5-Db-claude.md`（verdict: pass，minor ×2，nit ×1）

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CLAUDE-01 | claude | minor | 接受 | 意见属实：1+NaN=NaN、1+Infinity=Infinity 均为 number 型传播，1+null=1、1+true=2 静默返回数值，原稿「返回非数值结果」的措辞与「影响范围照抄需求列举式清单」确实只覆盖字符串拼接通道，未统辖 b 位各取值类型。原稿系根因稿（只审根因、不改实现），采纳其表述修订建议。 | 本修订稿 §根因结论·失效机理与影响范围 |
| CLAUDE-02 | claude | minor | 接受 | 意见属实：test/sum.test.cjs 全部 15 行内无 NaN/Infinity/-Infinity 用例，「同理漏检」确为静态推断且无失败测试佐证；若修复只补 typeof 漏 Number.isFinite，现有测试仍全绿、缺陷换形态存活。采纳：标注推断性质并在修复方向中补回归覆盖要求。 | 本修订稿 §复现确认 与 §修复方向 |
| CLAUDE-03 | claude | nit | 接受 | 意见属实：原稿「实际返回 '1b'」以实测口径陈述但未附执行记录，推断与实测未区分。采纳：在复现确认处标注证据来源为静态推演并引用复现用例。 | 本修订稿 §复现确认 |

## 修订后的根因结论

### 缺陷现象

- 复现用例：`sum(1, "b")` 不抛 TypeError。按 JS 语义静态推演（原稿与本稿均无执行记录），`1 + 'b'` 触发字符串拼接，返回 `"1b"`。
- 失败测试：`test/sum.test.cjs` 中「b 位字符串拒绝（复现用例）」（:12-14）。

### 需求依据（requirements.md）

- :3 总规则：两个入参都必须是 number 且为有限值（Number.isFinite）。
- :4 列举式拒绝清单：字符串、NaN、Infinity、-Infinity，抛带说明的 TypeError。
- :6 校验失败不得返回数值结果。

### 根因分析

`src/sum.cjs:4-6` 的校验分支只对参数 a 生效，函数体内不存在对参数 b 的任何类型或有限性检查。当 a 为合法有限 number、b 为非法输入时，a 的校验通过，执行落入 `return a + b` 的正常路径，被 JS 隐式类型转换静默吸收，不抛错。

### 失效机理与影响范围（按 CLAUDE-01 修订）

b 位非法输入越过防线进入 `a + b` 正常路径后，失效形态由 b 的取值类型决定：

- string → 字符串拼接（`sum(1,'b')` 返回 `'1b'`）；
- NaN / Infinity / -Infinity → 数值型传播（`sum(1,NaN)` 返回 NaN，typeof 仍为 'number'，并非「返回非数值结果」）；
- null / boolean → 数值强转（`sum(1,null)` 返回 1、`sum(1,true)` 返回 2），静默返回数值结果，直接违反 requirements.md:6，比字符串分支更严重。

影响范围按 requirements.md:3 的总规则界定：**b 位为一切非有限 number 的输入均漏检**；:4 的列举式清单（string/NaN/Infinity/-Infinity）仅作示例，null/boolean 等强转取值同属该范围。

### 修复方向（本阶段只审根因，不改实现）

在 return 之前补充与 a 对称的 b 位校验（`typeof b !== 'number' || !Number.isFinite(b)`，二者缺一不可——只补 typeof 会漏 NaN/Infinity，现有复现测试仍会全绿、缺陷换形态存活），抛带说明的 TypeError。

**回归覆盖要求**（按 CLAUDE-02 增补，留待 code 阶段落实）：镜像覆盖 a/b 两位的 string/NaN/Infinity/-Infinity 四类拒绝用例，确保 b 位数值传播分支有可捕获它的回归兜底。

### 复现确认（按 CLAUDE-03 标注证据来源）

- `sum(1, "b")` → 期望抛 TypeError；实际行为由代码静态推演为返回 `"1b"`，佐证为 test/sum.test.cjs:12-14 复现用例的失败（assert.throws 未满足）。
- `sum(1, NaN)` / `sum(1, Infinity)` 同理漏检（**静态推断**，无执行记录；同根因，影响形态为数值传播，见上）。

