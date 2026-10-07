# M11 第 4 步 · 配置契约与档位解析 · 测试报告

> - **日期**：2026-10-07
> - **起点**：`951dc8d7`（`main`；主设计 v1.3.130、PRD v1.4.20）
> - **流程**：命令 A，主题 `M11-配置契约与档位解析`。计划三审 run `20261007T130746Z`（codex / glm `approve-with-nits`、gemini `request-changes`），14 条全接受，r2 定稿；用户 2026-10-07 对六个待拍板项（P-1～P-6）答「按建议」。代码三审 run `20261007T152248Z`（codex / gemini `approve` 零意见、glm `approve-with-nits`），1 条接受（GLM-01：空串格子不回落 `default_tier`）
> - **证据目录**：[`evidence/m11-tier-config-20261007/`](./evidence/m11-tier-config-20261007/)
> - **配额**：运行期零配额（只用桩与夹具，未拉起任何真实审查员与真实 codex），只有双审本身花配额

## 1. 结论

配置契约（`config.v2` 原地扩 `tiers` / `default_tier` 与 `profiles` 三形态）、`agents.codex.effort` 废弃、档位解析 `resolveTier`（取代 `routeModel`）、codex 原生思考等级枚举落盘、预检与 `review` 准备阶段的档位组合校验与过渡闸**均已实现**（设计 v1.3.131）。**本步未达成任何 AC**：命令行旗标随第 5 步，思考等级与厂商 profile 透传、`tier` / `tier_source` 写入 run.json 随第 6 步，PRD FR-30 不翻达成。

用户拍板的六项按建议落地：P-1 过渡闸（档位里的 effort、与 `agents.codex.profile` 不同的厂商 profile 在第 6 步之前退 64；gemini 档位没写 effort 而运行期仍下传阶段级 effort 只告警）、P-2 claude 原生枚举随第 6 步、P-3 删本仓 `agents.codex.effort` 三行而不改写 `profiles`、P-4 「解析不出模型」维持退 64（规范改准）、P-5 本机层 `tiers` 整段替换与格子整格替换、P-6 `tier_source` 全覆盖规则统一。

## 2. 用例

| 编号 | 文件 · 用例（摘） | 断言要点 |
| :--- | :--- | :--- |
| T1～T3 | `config-schema.test.ts` | 三形态各一格合法；四支各带 `tiers` / `default_tier`（openai 支档位带 `profile`、zcode 支只有 `model`）合法；13 种非法组合各自被 schema 拒（含 `{tier}` 与 model 混写、`{model}` 缺 effort、格子带 profile、非 openai 支带 profile、zcode 支带 effort、空 `tiers`、空串 model / effort） |
| T4 | 同上 | 旧配置零改动可载：本仓 `config.yaml` 原样、含 `agents.codex.effort` 的旧配置（废弃键原样留在合并结果）、空串裸 slug（保持无 `minLength`，计划三审 CODEX-03） |
| T5 | 同上 | `agents.codex.effort` 默认值已删、schema 标 deprecated 且不在 required、原枚举外的值照旧被拒；`agents.gemini.effort` 不受影响 |
| T6 | 同上 | 本机层覆盖：`tiers` 整段替换（不继承共享层的 effort、不保留另两档）、格子整格替换（不混成 `{tier, model, effort}`）、原子节点之外照常逐键合并 |
| R1～R11 | `tier-resolve.test.ts` | 第一段次序（命令行档位 > 格子 > `default_tier`）、格子三形态、未定义档记 `missingTier` 且不落到下一级、无命中与只有命令行模型、空串格子按无模型且有 `default_tier` 时也不回落（代码三审 GLM-01）；第二段按字段叠加与告警；取值四格（档位部分覆盖、档位全覆盖按「实际写了的键」计、格子部分 / 全覆盖、裸 slug 被覆盖记 `override`）；厂商 profile 三层次序与非 openai 恒 null；gemini 阶段级 effort 只回落裸 slug、废弃的 codex effort 不回落；**裸 slug 等价性**：内置默认与本仓配置逐格解析结果等于格子原值、来源 `legacy`（60 格，实测） |
| H1～H3 | 同上 | 适配器钩子：codex 按厂商 profile 取逐模型枚举、无 profile 取基底、旧探针 / 查无 / 空枚举为 `unknown`；agy 带后缀即 `suffixEncoded`、不带后缀由目录变体派生；zcode `none`、claude `unknown` |
| S1～S3、S2b | 同上 | 档名写错时 slug 检查直接报档名与可用档（有命令行模型覆盖时也报，计划三审 GLM-04）；第一段无命中退 64；空串格子 + `default_tier` 退 64 并点明是空串（S2b，GLM-01）；档位换家族时 slug 按档位的厂商 profile 取目录，裸 slug 仍按 `agents.codex.profile`（旧行为不变） |
| C1～C7 | 同上 | 内置默认配置通过且**零告警**；永久判据（枚举外 effort、名单外 profile、glm 给 effort）退 64 并列可用值且排在过渡闸之前；过渡闸两格；两键同改换家族不被拦；取不到枚举 / 名单为空时跳过并点名；gemini 两种告警（过渡残余、slug 已编码档位）；档名缺失不在本检查重复报 |
| U11、U12 | `config-consumers.test.ts` | 废弃键精确路径（codex 报、gemini 不报）；schema 里 agents 四支与档位定义的非废弃属性都有消费方（`tiers` / `default_tier` / `tier` 判活有意义；`model` / `effort` / `profile` 按键名必然命中，用例注释写明不构成覆盖） |
| RL1 | `probe-fixture-cleanup.test.ts` | 扩写假 codex 的 `debug models`（逐模型 `supported_reasoning_levels` + 一条隐藏项 + 一个采集失败的 profile）；`skipModelCalls` 下 `reasoning_levels` 只收可见项、失败 profile 无条目 |
| 零工件 | `no-artifacts.test.ts`「档位组合不合法 → review --start 退 64 且零工件」 | glm 格子写 effort（永久判据）与 gemini 格子写 effort（过渡闸）各一格，经 bundle 跨进程跑，归档与运行目录文件集不变 |
| 迁移 | `adapter-base.test.ts`、`profile-override.test.ts`、`zcode-auth-probe.test.ts` | 改调 `resolveTier`；原「四级优先级」的 `topic: 'Y'` 两格删去，改为「命令行优先于格子」的等价断言 |

新增 35 例（`tier-resolve` 25、`config-schema` 6、`config-consumers` 2、`probe-fixture-cleanup` 1、`no-artifacts` 1）。

## 3. 变异验证

规格由 `gen-mutation-spec.mjs` 从源码截锚点并核唯一（源码 28 条 + schema 4 条，替换串扫过特殊替换模式）。先用逐条预跑脚本（`mutation-names.mjs`，带 `--test-timeout`）跑全部条目记下失败用例名，再用正式装置（`scripts/mutation-check.mjs`）跑全部源码变异——装置只认 `.ts` 目标，schema 四条只走预跑。

| 编号 | 变异 | 套件 | fail | 红的是谁 |
| :--- | :--- | :--- | :--- | :--- |
| R1 | `{tier}` 格子当作未命中 | 解析 | 11 | R1～R3、R6、R9、S1、S3、C2、C3、C5、C6 |
| R2 | 全覆盖判定恒假 | 解析 | 3 | R6～R8 |
| R3 | 裸 slug 被覆盖仍记 `legacy`（P-6 回退） | 解析 | 1 | R8 |
| R4 | `default_tier` 先于格子 | 解析 | 2 | R1、R3 |
| R5 | `agents.codex.profile` 先于档位条目 | 解析 | 7 | R1、R5、R9、S3、C2、C3、C5 |
| R6 | gemini 阶段级 effort 回落不限裸 slug | 解析 | 2 | R10、C6 |
| E1 | 空串格子改回「未命中」、回落 `default_tier`（代码三审 GLM-01 补） | 解析 | 2 | R4、S2b |
| V1 | 枚举非空时不校验 | 解析 | 1 | C2 |
| V2 | 枚举取不到时硬拒 | 解析 | 1 | C5 |
| V3 / V3b | 「无思考等级概念」一格删去 | 解析 / 零工件 | 1 / 1 | C2；零工件用例 |
| V4 | 厂商 profile 名单校验删去 | 解析 | 1 | C2 |
| V5 | slug 校验不传档位的厂商 profile | 解析 | 1 | S3 |
| V6 | 档名缺失分支删去 | 解析 | 1 | S1 |
| G1 / G1b | 过渡闸 effort 格删去 | 解析 / 零工件 | 2 / 1 | C3、C5；零工件用例 |
| G2 | 过渡闸 profile 格删去 | 解析 | 1 | C3 |
| G3 | 过渡闸不再豁免 slug 已编码档位 | 解析 | 1 | C6 |
| G4 | 过渡告警删去 | 解析 | 1 | C6 |
| D1 | 废弃键路径改回通配 | 对账 | 3 | U4、U10、U11（内置默认配置的 `agents.gemini.effort` 被误报） |
| M1 / M2 | 原子节点 `tiers` / 格子改回逐键合并 | schema | 1 / 1 | T6 |
| P1～P3 | 探针不落逐 profile / 基底枚举、枚举收进隐藏项 | 探针 | 1 / 1 / 1 | RL1 |
| Q1 | `review` 准备阶段不调档位组合校验 | 零工件 | 1 | 零工件用例 |
| H1 | codex 钩子不分 profile | 解析 | 2 | H1、C2 |
| H2 | agy 钩子不比对基名 | 解析 | 1 | H2 |
| S1 | schema：裸 slug 加 `minLength` | schema | 1 | T4（空串 slug 改为加载期被拒） |
| S2 | schema：`{tier}` 形态放开 `additionalProperties` | schema | 1 | T3 |
| S3 | schema：zcode 支档位放行 effort | schema | 1 | T3 |
| S4 | schema：openai 支 `effort` 回到 required | schema | 14 | 内置默认配置本身合法、T1、T2、T4～T6 等 |

逐条预跑 **32/32 咬住**：原 31 条在代码三审前跑（`mutation-names-log.txt`、`mutation-names-output.json`），GLM-01 修复后补的 E1 单独一份（`mutation-names-log-e1.txt`、`mutation-names-output-e1.json`、规格 `mutation-spec-e1.json`）；其余 31 条的锚点在修复前后逐字未变。正式装置在 GLM-01 修复后重跑全部源码变异：基线 5 个套件全绿，**28/28 咬住**（`mutation-output.txt`，各条失败数与预跑一致），工作树逐字节复原、哨兵已删。

## 4. 全量检查

- `npm run check` **两次串行：2983 / 2981 / 0 / 2**（总数 / 通过 / 失败 / 跳过），两次相同、退出码均为 0（`check-1.txt`、`check-2.txt`，代码三审 GLM-01 修复后的那两次）。M11 第 3 步为 2948，本步净增 35 例，跳过数不变。修复前的两次读数为 2982 / 2980 / 0 / 2（差的一例即 S2b）。
- 本段文字是全量跑完后填入的，索引条目与文件集未动。

## 5. 附带发现

1. **「解析不出模型」实为退 64**：`checkModelSlugs` 在预检与 `review` 准备阶段都先于路由执行，缺模型即以 64 拦下；`review.ts` 路由处的 69 分支对同一输入不可达。设计 12.1 / 13.1.1 / 5.1.1 第 ⑥ 件与 schema 描述此前写 69，本步改准（P-4）。
2. **`deepMerge` 逐键合并会混出跨家族组合与非法格子**：本机层 `tiers.high = {model, profile}` 会继承共享层同一档的 `effort`；格子 `{tier}` 叠在 `{model, effort}` 上会混成三键而被 schema 拒。改为两个原子节点整段 / 整格替换（P-5）。
3. **PROTOCOL 的废弃键段在 EV-30 ②③（设计 v1.3.122）时就漏登两条**，本步补齐五条（计划三审 CODEX-01）。
4. `profiles` 格子下的 Agent 级 `effort` 键无读取点、与新形态 `{model, effort}` 同名不同层，登记 BACKLOG EV-227。
