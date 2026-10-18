---
schema: trivium.disposition.v1
topic: M12-共享根残留检测
stage: plan
role: claude
kind: revised
run_id: 20261018T023000Z
addresses:
  - 2026-10-18-M12-共享根残留检测-codex.md
  - 2026-10-18-M12-共享根残留检测-gemini.md
  - 2026-10-18-M12-共享根残留检测-glm.md
---

# 裁决：M12-共享根残留检测 · 计划三审第 1 轮

> 被审对象：`plan/2026-10-18-M12-共享根残留检测-claude.md`（r1，起点 `a0c3a609`）
> 三侧都是 `approve-with-nits`：codex 1 minor，glm 2 minor，gemini 1 minor、2 nit。6 条全部接受，合入后的计划见 `plan/2026-10-18-M12-共享根残留检测-r2-claude.md`。
> 裁决前回源码核了三处：`test/unit/entry-collisions.test.ts:49-52`、`:61-63` 手写的扫描目标确实没有新字段，`tsc --strict` 覆盖 `test/`（CODEX-01 / GLM-01 / AGY-01 成立）；`resolveAssetRoot` 只看覆盖参数与 `TRIVIUM_ASSET_ROOT`，不知道当前进程从哪份运行时跑起来（GLM-02 成立）；编排器已有用 `process.argv[1]` 定位自身产物的先例（`selftest.ts:216`、`run-protocol.ts:619`），安装器的 `realOrResolved`（`install.ts:105`）是安装器私有函数（AGY-03 的落点据此定）。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 成立：r1 把 `sharedResidueNames` 定为必填，既有用例里手写的两个扫描目标会过不了类型检查，与「既有用例一条不改」冲突；就算跳过类型检查，遍历缺失字段也会抛错 | r2 §2.1：`sharedResidueNames?: readonly string[]` 改为可选，扫描时按 `?? []` 处理（缺省即不查）；安装器与 `sharedReadRootTargets` 显式传名单；§4 U2 ⑥ 追加「缺省字段等价于空数组」断言；§3.1 写明既有用例连构造字段也不补 |
| GLM-01 | glm | minor | 接受 | 与 CODEX-01 同一处，取它建议的第一个方向（字段设为可选），这样「既有用例一条不改」按字面成立，不需要另立「补字段不算改用例」的口径 | 同 CODEX-01 |
| GLM-02 | glm | minor | 接受 | 成立：安装时设了 `TRIVIUM_ASSET_ROOT` 指到共享根，之后在不带这个变量的 shell 里跑 doctor / preflight，豁免会算成缺省位置，那份活运行时被报成残留。比登记边界更好的办法代价很小：doctor / preflight 本身就跑在那份运行时里，`process.argv[1]` 就是它的 `scripts/trivium.cjs`，把当前产物所在的运行时根也加进豁免即可 | r2 §0 D-6、§2.1：编排器侧豁免取两项——`resolveAssetRoot(undefined, se.env, se.home)` 与新函数 `selfRuntimeRoot()`（`process.argv[1]` 形如 `〈根〉/scripts/trivium.cjs` 时返回 `〈根〉`，否则 `null`；测试进程里恒为 `null`，可经参数注入）；§4 U3 追加「变量只在安装时设、扫描时不设，但自身产物在共享根」一格；§5 A-2 追加同形态读数；§7 判据边界登记剩下的情形：既不是当前进程所在、扫描时也没设变量的那份运行时，仍会被报 |
| AGY-01 | gemini | minor | 接受 | 与 CODEX-01 同一处 | 同 CODEX-01 |
| AGY-02 | gemini | nit | 接受 | 代价为零，单测样板少；调用方（扫描核心）照样显式传各家名单，安装器的判定输入不变 | r2 §2.1：`isResidueCopy(dir, entryNames = ENTRY_SKILL_NAMES)`；`scanEntryCollisions` 内传 `t.names` |
| AGY-03 | gemini | nit | 接受 | 成立：夹具在 `/var/folders/…`、`fs.realpath` 给的是 `/private/var/…`，只比字面会让豁免漏判。安装器的 `realOrResolved` 不挪（会牵动 `runtime-overlap` 判定）；共享模块自带一个更窄的版本即可：候选目录一定存在，可直接 `realpath`；豁免路径不存在时不可能与存在的候选同一处，退回 `path.resolve` 不影响结论 | r2 §2.1：候选与豁免两侧都先 `realpathOr(p)`（`fs.realpath` 失败退回 `path.resolve(p)`）再比；§4 U2 ④ 夹具放在 `scratchDir` 下（macOS 上即 `/var` 软链路径），豁免用另一种写法（软链 / 未规范化）给出 |

## 汇报要求（不是编号意见）

- GLM-02 的落点新增了一条「当前进程自身产物所在的运行时根」豁免，取自 `process.argv[1]`。它只放宽判定（少报），不会多报；代码双审时请审查判断这条豁免的形态判据（`basename === 'trivium.cjs'` 且父目录名为 `scripts`）是否够窄。
