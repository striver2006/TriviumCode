# M11 第 5 步 · 档位命令行旗标全链 · 测试报告

> - **日期**：2026-10-08
> - **起点**：`c93887da`（`main`；主设计 v1.3.131、PRD v1.4.21）
> - **流程**：命令 A，主题 `M11-档位命令行旗标`。计划三审 run `20261007T162911Z`（codex `request-changes`、gemini / glm `approve-with-nits`），12 条全接受，r2 定稿；用户起草前定三件（三类旗标全上、留痕空窗接受、`--profile-〈id〉` 按钩子派生）。代码三审 run `20261007T172231Z`：gemini `approve`（零意见）、glm `approve-with-nits`（2 条接受：GLM-02 `--tier` 选到带思考等级的档同样被拦，补说明并按来源改过渡闸文案；GLM-01 删死导出 `hasTierFlags`）；**codex 解析回退、原文只有一句过程性陈述、没有结论**，`CODEX-F01` 驳回——本轮实际给出结论的是两侧
> - **证据目录**：[`evidence/m11-tier-flags-20261008/`](./evidence/m11-tier-flags-20261008/)
> - **配额**：运行期零配额（只用桩与夹具），只有三审本身花配额

## 1. 结论

`--tier-〈id〉` / `--effort-〈id〉` / `--profile-〈id〉` 三类旗标在 `review`、`preflight`、`topic resolve` 三个入口上线，命令 A 由 resolve 输出照抄进 S0.6 预检与 S2、S6 的 `--start`（设计 v1.3.132）。**本步未达成任何 AC**：思考等级与厂商 profile 尚未透传——`--effort-〈id〉` 与不同于 `agents.〈id〉.profile` 的 `--profile-〈id〉` 在第 6 步之前被预检过渡闸拦下退 64（gemini 的 slug 已编码档位时只告警）；`tier` / `tier_source` 第 6 步才入 run.json，用 `--tier-〈id〉` 发起时告警（用户接受的留痕空窗）。

## 2. 用例

| 编号 | 文件 · 用例（摘） | 断言要点 |
| :--- | :--- | :--- |
| K1～K7 | `tier-flags.test.ts`（新） | 收集面是全部已登记 Agent、写了空串与没写分开；三类旗标的键判定与 `--model-〈id〉` 同一份（能入选未入选列本轮入选与 `--critics` 出口、Driver 自己列当前可用）；`--model-〈id〉` 既有两条文案逐字不变；`--profile-〈id〉` 只对 codex 成立、给 gemini 退 64 并点明不是 `--profile`；`--tier` 只收三档、三类写了不给值都退 64；`mergeCliOverrides` 逐侧合并；三档清单取自 `base.ts` 导出的 `TIER_NAMES` |
| F1～F6 | `tier-resolve.test.ts`（扩） | 两格校验带第五参数：`--tier` 选到未定义档报档名与可用档、来源是命令行；选到只写 model 的档通过且带留痕空窗告警；过渡闸三格（档位带 effort——文案点明「经 `--tier-codex high` 选到的档位条目」、指引换一档（GLM-02）；`--effort` 单独给；`--profile-codex` 不同于 `agents.codex.profile`）退 64 且点名旗标，等于时不触发；永久判据（枚举外、名单外）先于过渡闸，名单为空跳过；gemini 后缀 slug + `--effort-gemini` 只告警；`--model` 覆盖档位模型的告警 |
| T1～T5 | `tier-flags-cli.test.ts`（新，经 bundle） | resolve 输出三字段只含入选侧、没写为 `{}`；写了不给值退 64；resolve 输出照抄进 `preflight` 通过并念出空窗告警；照抄进 `review --start` 能启动、请求模型取自所选的档、`warnings` 念出空窗；选出与当轮 Driver 同族的档位模型时 `override_reason` 认得 `--tier-gemini low`（worker 经交接文件拿到档位旗标） |
| 零工件 | `no-artifacts.test.ts`「档位旗标不合法」 | 未入选侧、档名不在三档、没有厂商 profile 概念的侧、过渡闸四格，`review --start` 各退 64 且归档与运行目录文件集不变 |
| 对账 | `skill-flag-parity.test.ts` | dual-run 的 S0.6 / S2 / S6 交接逐段点名 `--tier-` / `--effort-` / `--profile-`；`--profile` 改为不吞 `--profile-` 的精确形；B/C/D 正文交代 `tiers` / `efforts` / `vendor_profiles` 透传到第 2 步预检与第 3 步 `--start`（12 格） |
| 对账 | `entry-render-parity.test.ts`、`usage-registry-parity.test.ts` | 产物里没有空括号；`--help` 的 `--tier-*` / `--effort-*` 与已启用审核者全集对齐，`--profile-〈id〉` 只对带厂商 profile 概念的侧出现 |

旧形状交接文件（不带 `tierFlags`）由其余全部 worker 用例覆盖：没写档位旗标时交接文件不含这个键。

## 3. 变异验证

规格由 `gen-mutation-spec.mjs` 从源码截锚点并核唯一（源码 16 条 + 契约 2 条）。

| 编号 | 变异 | 套件 | fail | 红的是谁 |
| :--- | :--- | :--- | :--- | :--- |
| A1 | 收集面漏掉一家 | 旗标 | 1 | K1 |
| A2 | 键校验只查 profile 一类 | 旗标 | 1 | K2 |
| A3 | `--profile-〈id〉` 不查钩子 | 旗标 | 1 | K4 |
| A4 | `--tier` 取值不校验 | 旗标 | 1 | K5 |
| B1 | `checkTierCombos` 不收档位旗标 | 解析 | 4 | F3～F6 |
| B2 | 留痕空窗告警删去 | 解析 | 1 | F2 |
| B3 | 过渡闸文案不再点明经 `--tier` 选到的档（代码三审 GLM-02 补） | 解析 | 1 | F3 |
| C1 | 路由点不用合并结果 | CLI | 2 | T4、T5 |
| C2 | `--start` 告警复查不带档位旗标 | CLI | 1 | T4 |
| C3 | 交接文件不带档位旗标 | CLI | 1 | T5 |
| C4 | `override_reason` 不认 `--tier` | CLI | 1 | T5 |
| D1～D3 | resolve 输出分别漏 `tiers` / `efforts` / `vendor_profiles` | CLI | 3 / 3 / 3 | T1、T3、T4 |
| D4 | `topic resolve` 按真假过滤 | CLI | 1 | T2 |
| E1 | 入口渲染漏厂商 profile 提示 | 渲染 | 1 | 源 → 产物零 diff |
| M1 | 契约：dual-run 的 S2 交接删去三字段透传 | 旗标对账 | 4 | 四家载体的逐段锁 |
| M2 | 契约：dual-run 的 S0.6 交接删去 `--profile` 本身（只剩 `--profile-〈id〉`） | 旗标对账 | 4 | 四家载体的逐段锁 |

逐条预跑 **18/18 咬住**（B3 在代码三审之后补，单独一份：`mutation-names-log-b3.txt`、`mutation-names-output-b3.json`、规格 `mutation-spec-b3.json`；`mutation-names-log.txt`、`mutation-names-output.json`；M1 / M2 见 `mutation-names-log-m.txt`、`mutation-names-output-m.json`、规格 `mutation-spec-m.json`）。正式装置跑源码 16 条（代码三审修复之后重跑；其余 15 条的规格与修复前逐字节一致）：基线 4 个套件全绿，**16/16 咬住**（`mutation-output.txt`），工作树逐字节复原、哨兵已删；契约两条不是 `.ts` 目标，只走预跑。

**M1 / M2 首跑没咬住，原因是变异打错了文件**：第一版把它们打在渲染产物 `skills/dual-run/SKILL.md` 上，而 `skill-flag-parity` 取的是渲染器从 `skills-src/` 现渲染的内存产物、不读盘（盘上一致由 `entry-render-parity` 另守），于是两条都 fail=0（首跑记录仍在 `mutation-names-log.txt` 末两行）。改打源文件 `skills-src/commands/run.contract.md` 后重跑，两条各红四家载体的逐段锁。

## 4. 全量检查

- `npm run check` **两次串行：3016 / 3014 / 0 / 2**（总数 / 通过 / 失败 / 跳过），两次相同、退出码均为 0（`check-1.txt`、`check-2.txt`，代码三审修复之后的那两次）。第 4 步为 2983，本步净增 33 例，跳过数不变。
- **首轮两次全量各红 1 例**（同一格）：`driver-wiring.test.ts`「调用链：isHeterogeneous 与 overrideReasonFor 的厂商与 Driver 取值来自当轮留痕」——它要求 `overrideReasonFor` 的末参恒为 `meta.driver`，而我把新参数 `tierFlags` 加在了它后面。护栏是对的，改实现：`tierFlags` 挪到 `driver` 之前。改后重新生成变异规格与改前逐字节一致（锚点未动），正式装置重跑 15/15、两次全量全绿，上面的读数是改后的。
- 本段文字是全量跑完后填入的，索引条目与文件集未动。

## 5. 附带发现

1. `skill-flag-parity` 原先的 `/--profile\b/` 会被 `--profile-codex` 代绿（`\b` 在 `-` 前成立）：新旗标上线后，即使删掉 `--profile` 本身、只要还写着 `--profile-codex`，逐段锁照样绿。已改为精确形，变异 M2 钉住。
2. `topic resolve` 对取值旗标缺值记空串，既有 `--model-〈id〉` 按真假过滤会把它静默丢掉（`cli.ts` 侧却退 64）。三类新旗标按「键在不在」判；`--model-〈id〉` 的同一缺口登记 BACKLOG EV-228，本步不改既有旗标行为。
3. 交接文件读侧是断言不是校验：旧版本 worker 读新交接文件会静默忽略 `tierFlags`，跨版本回滚恢复会丢失命令行选档。不改 run.v2 无解，接受并写明（计划 r2 §5 第 4 条）。
