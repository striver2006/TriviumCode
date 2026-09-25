# EV-123 零配额验收读数

- **日期**：2026-09-25
- **脚本**：本目录 `check.mjs`（只读判定，读数由脚本自己写进 `results.json`；会话里的命令不带重定向）
- **前置**：`npm run build`、`npm run install:local`（E1 / E3 走安装副本 `.trivium/bin/trivium`）；`dist/test/` 由此前的 `npm test` 产出（E2 从那里导入）
- **结果**：**E1、E2、E3 全部通过**，`failures` 为空；另 `npm test` 全绿、`trivium doctor --selftest` 14 / 14

全程带 `--skip-auth-check`：它只跳过 ⑧ 探活（预检里唯一真实消耗配额的一项），不影响 ④″ 的出项。
**没有在真实 HOME 上挪 `~/.zcode/cli/config.json`**：反向两项把 HOME 钉到 mkdtemp 的空目录，清理只认 `mkdtemp` 的返回值。

| # | 形态 | 判据 | 读数 |
| :-- | :--- | :--- | :--- |
| E1 | 正向：本机、真实 HOME（副本源在） | 退出码 0；`warnings` 键在；不含「模型覆盖副本源」条目，`checks[]` 里也没有该项；「探活已跳过」是 warn | ✓ `warnings` = [`探活`]；副本源项不在 |
| E2 | 反向·函数层：从构建产物导入，HOME 为空目录，真实适配器表 | 恰出一项（只有 zcode 实现了该成员），`ok: true`、`warn: true`、以 `⚠️` 开头、路径以 `~/` 展示、不带临时 HOME 绝对路径；渲染行首 `⚠`、末行「✓ 预检通过（含 1 条警告）」 | ✓ 全部满足 |
| E3 | 反向·CLI 层：安装副本，`HOME=<空目录>` 拉起 `preflight --stage plan --skip-auth-check --json` | 退出码 0；`warnings` 含副本源条目、路径以 `~/` 展示、不带临时 HOME；`checks[]` 里该项带 `warn` | ✓ `warnings` = [`ZCode 模型覆盖副本源`, `探活`]；首个失败项 null |

## 读数说明

- E1 只记检查项名与 warn 标记，不记 detail：detail 里有带用户名的绝对路径（如归档根）。
- E1 本机未出 C5（运行期选模）：本机 doctor 的 `zcode.runtime_selection` 读数不是 `reorder_ineffective`。
- E3 证实空 HOME 下预检 ①～⑦ 都不依赖 HOME（探针结论与归档根都在项目内），短路不会先于 ④″ 发生——审查侧 glm 在计划双审 r2 里做过同一判断，这里是实测。
- `review --start` 那一路**没有真实验收**：真跑一次就会拉起审查、消耗配额。它由 `test/integration/override-source-start.test.ts` 的全桩真实子进程用例覆盖到 CLI 层，只有真实 zcode 适配器的 `modelOverrideSource()` 返回值由单元用例（等于 `zcodeOverrideSourcePath()`）与本读数的 E2 / E3 覆盖。
