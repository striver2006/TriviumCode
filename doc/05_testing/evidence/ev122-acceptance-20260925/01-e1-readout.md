# EV-122 零配额验收 E1 读数

- **日期**：2026-09-25
- **计划**：`.reviews/EV-122-未受控模型播报/plan/2026-09-25-EV-122-未受控模型播报-r2-claude.md` §4.3
- **脚本**：同目录 `e1-check.mjs`（只读；从构建产物 `dist/test/src/…` 导模块，先跑 `npm run build`）；输出 `e1-output.json`
- **配额**：零。不拉起任何 CLI，不挪用户文件

## 取什么形态

EV-112 E2（run `20260924T172304Z`，单侧 glm）是这一格唯一的真实样本：副本源 `~/.zcode/cli/config.json` 暂时不在，审查运行走无副本一支，
归档 run.json 的 `critics.glm` 段为 `model_requested: GLM-5.3`、`model_effective: 84044858-…/qwen3.8-max`、`model_route: global`、`model_override_applied` 缺席，收尾 `message` 为空。

run.json 里**没有** `reason` 与 `cause`，脚本不按记忆抄：现跑 `prepareZcodeHome`，`srcConfig` 指向 mkdtemp 目录下一个不存在的文件，走第一个出口早退。
这样做的唯一差别是 `reason` 里的路径是临时路径而非 E2 当时的真实路径；判定只认 `cause`，不受影响。
没走默认路径的理由：真实副本源今天在，走默认路径会进副本支，把含凭据的副本写进临时目录。

## 判据与结果

| # | 判据 | 结果 |
| :-- | :--- | :--- |
| A1 | 读到的 E2 形态与读数一致（请求 `GLM-5.3`、`route: global`、`model_override_applied` 缺席、有生效模型） | ✅ |
| A2 | `prepareZcodeHome` 早退：`homeDir: null`、`route: global`、`cause: source_missing`，临时目录跑完仍为空 | ✅ |
| A3 | `decideModelOverride` 对这一格不产出（没尝试覆盖 ⇒ 缺席，与 EV-82 以来的契约一致） | ✅ |
| A4 | `decideModelUnenforced` 产出，`requested: GLM-5.3`、`effective` 为 E2 的回读值、`cause: source_missing` | ✅ |
| A5 | 守卫恰好播报一句，含请求值、生效值、FR-06 与 `source_missing` 的排查指向 | ✅ |
| A6 | 守卫不出「请求的模型没有生效」那句（两格互斥，不串） | ✅ |

守卫的那一句（`reason` 以占位代替）：

> glm 侧**本次没有做模型覆盖**：请求的是 `GLM-5.3`，实际跑的是 `84044858-4e28-432b-bbbd-7e2d624e39ff/qwen3.8-max`（&lt;reason&gt;）。该侧结论仍然有效，但模型路由（FR-06）与异构默认（NFR-06）在本侧不成立——若另一侧模型与它同家族，这一轮不构成真正的双审。先看副本源 `~/.zcode/cli/config.json` 在不在。

## 边界

- 这份验收锁的是**判定与播报**：E2 已在真实配额下证明「副本源缺失 → 跑在个人配置默认模型上」这条链路本身，这里不再重跑。
- `run()` 的接线（`requested` 取 `req.model`、结果写进 `CriticResult`）由 `zcode-carriers.test.ts` 的假入口用例端到端覆盖，`review.ts` 写进 run.json 由集成用例覆盖；变异 N4 / N6 / N7 证明这三处都咬得住。
- 限定失败（`qualify_failed`）这一支没有真实样本，只有假入口用例覆盖（`zcode-model-selection.test.ts`），与计划 §4.3 同一边界。
