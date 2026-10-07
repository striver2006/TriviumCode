---
schema: trivium.disposition.v1
topic: M11-档位命令行旗标
stage: plan
role: claude
kind: revised
run_id: 20261007T162911Z
addresses:
  - 2026-10-08-M11-档位命令行旗标-codex.md
  - 2026-10-08-M11-档位命令行旗标-gemini.md
  - 2026-10-08-M11-档位命令行旗标-glm.md
---

# 裁决：M11-档位命令行旗标 · 计划三审第 1 轮

> 被审对象：`plan/2026-10-08-M11-档位命令行旗标-claude.md`（原稿，起点 `c93887da`）
> ｜ 运行：`20261007T162911Z`（14 分 23 秒）
> ｜ 结论：codex `request-changes`（重要 1、次要 2、吹毛求疵 1）｜ gemini `approve-with-nits`（次要 2、吹毛求疵 3）｜ glm `approve-with-nits`（次要 1、吹毛求疵 2）
> ｜ 共 12 条：接受 12、驳回 0、暂缓 0
> ｜ 修订后的计划：`plan/2026-10-08-M11-档位命令行旗标-r2-claude.md`

每条都回源码核过。重合两组：CODEX-01 ≡ AGY-01 ≡ GLM-01（`skill-flag-parity` 的逐段锁与正文断言是硬编码清单，不随新旗标自动扩展——三侧独立指到同一处 :182-203）；CODEX-02 ≡ AGY-04（`mergeCliOverrides` 没有生产调用点）。三侧都没有对已定三件提出异议；§6 第 3 条（`override_reason` 措辞与交接文件加可选字段）三侧均未判越界，CODEX-03 补了回滚方向的降级面。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | major | 接受 | 属实：`skill-flag-parity.test.ts:193-197` 的 `sections` 对 S0.6 / S2 / S6 各配一组硬编码正则（`--critics` / `--profile` / `--model-` 等），:102 一带的 B/C/D 正文断言只认 `models`；新旗标不会自动进这两处。实施时六处交接散文漏改一处，套件照样全绿——该测试注释自述的 EV-125 那次正是这个形态。另核出：既有 `/--profile\b/` 会被 `--profile-codex` 误配（`\b` 在 `-` 前成立），新断言要用精确形 | r2 §3.1 对账一节单列一项：S0.6 / S2 / S6 三段各加三类旗标的点名（`--tier-`、`--effort-`、`--profile-` 后接提示变量展开名），`--profile` 那一条改为不吞 `--profile-` 的精确形（如 `/--profile(?!-)/`）；B/C/D 加 `tiers` / `efforts` / `vendor_profiles` 三字段的透传正文断言 |
| CODEX-02 | codex | minor | 接受 | 属实：原稿 §2.1 声明了 `mergeCliOverrides`，§2.3 四处调用点却各自展开 `{ model, ...tierFlags[c] }`，函数只剩单测在用；§0.2 写「四处」与 §2.3 的清单（含路由点共五处）口径不一 | r2 §2.3：合并只此一份——`checkModelSlugs` / `checkTierCombos` 内部调 `mergeCliOverrides`，`review.ts` 准备阶段算一次合并结果供路由点（:1145）用；§0.2 改为五处并逐一列出 |
| CODEX-03 | codex | minor | 接受 | 属实：`run-protocol.ts:186-211` `readHandoff` 是 `JSON.parse` 断言、不校验；旧版本读新交接文件会静默忽略 `tierFlags`，用 `--tier-〈id〉` 起跑的运行若被旧版 worker 恢复，选档无声丢失、路由回落配置档位、`override_reason` 回到失实归因。在不改 run.v2 的前提下无解，与既有 `handoffDriver` 的跨版本回落同形 | r2 §5 新增一条遗留：跨版本回滚恢复会静默丢失命令行选档，接受并写明；不为它改 run.v2 |
| CODEX-04 | codex | nit | 接受 | 属实：三字段同形同险 | r2 §3.2 变异 ⑨ 改为三格并列（`tiers` / `efforts` / `vendor_profiles` 各删一个） |
| AGY-01 | gemini | minor | 接受 | 同 CODEX-01 | 同 CODEX-01 |
| AGY-02 | gemini | minor | 接受 | 属实：`topic-args.ts:146-152` 取值旗标后缺值或紧跟已知旗标时记 `named[name] = ''`；`:617` 的 `--model-〈id〉` 按真假过滤，空串被静默丢掉。新旗标照抄就会把「写了但没给值」变成「没写」 | r2 §2.2：`topic-args` 按 `named[name] !== undefined` 判「写了」，空串照传给 `assertTierFlags` 退 64；`cli.ts` 侧 `flagString` 对缺值已退 64（既有），口径一致。`--model-〈id〉` 的同一缺口登记 BACKLOG 新条目（不在本步顺手改，§5） |
| AGY-03 | gemini | nit | 接受 | 属实：`test/integration/usage-registry-parity.test.ts` 对 `--help` 的 `--model-*` 与注册表对齐有回归锁，原稿 §1.3 / §3.1 漏列 | r2 §3.1 扩该文件：`--tier-〈id〉` / `--effort-〈id〉` 对已启用审核者全集逐个在场，`--profile-〈id〉` 只对实现钩子的侧在场、其余不在 |
| AGY-04 | gemini | nit | 接受 | 同 CODEX-02 | 同 CODEX-02 |
| AGY-05 | gemini | nit | 接受 | 属实：codex 载体的审核者里没有实现 `vendorProfilesFor` 的侧，`VENDOR_PROFILE_FLAGS` 渲染为空，「厂商 profile 覆盖（{{…}}）」会留空括号 | r2 §2.5：厂商 profile 那半句整体做成一个派生变量 `VENDOR_PROFILE_CLAUSE`（含标点的完整分句，或空串），模板只放这个变量，不在模板里写括号；`entry-render-parity` 补断言「产物里不出现 `（）` / `()`」 |
| GLM-01 | glm | minor | 接受 | 同 CODEX-01 | 同 CODEX-01 |
| GLM-02 | glm | nit | 接受 | 属实：过渡闸 effort 分支排除 `suffixEncoded`（`preflight.ts:483`），gemini slug 已带档位后缀时 `--effort-gemini` 只告警不生效、不退 64；设计 7.1 :1385 也写了这一格。原稿 §2.2 / §5 第 3 条「恒退 64」是绝对化表述，与 §3.1 自己的用例格不一致 | r2 §2.2 help、§4 文档、§5 第 3 条统一措辞：「被过渡闸拦下退 64（gemini 的 slug 已编码档位时思考等级本就不生效，只告警）」 |
| GLM-03 | glm | nit | 接受 | 属实：三档清单在 `adapters/base.ts` 是未导出的 `TIER_NAMES` | r2 §2.1：从 `base.ts` 导出 `TIER_NAMES`，`tier-flags.ts` 复用，不再自持字面量 |

## 2. 不涉及驳回与暂缓

12 条全部接受。CODEX-03 的处置是「接受降级、写明」，不是改 run.v2——与已定 ②「不改 run.v2」一致；若用户认为该降级不可接受，唯一替代会触及 run.v2，届时停下问用户。

## 3. 本轮附带记录

- 核 CODEX-01 时发现既有 `/--profile\b/` 会误配 `--profile-codex`：新旗标上线后，S0.6 / S2 / S6 里只要写了 `--profile-codex`，`--profile` 那一条就会被它「代绿」——即使 `--profile` 本身被删。r2 一并改为精确形。
- AGY-02 指出的空串静默丢失在既有 `--model-〈id〉` 上同样存在，本步不顺手改（改既有旗标的行为属另一题），登记 BACKLOG。
