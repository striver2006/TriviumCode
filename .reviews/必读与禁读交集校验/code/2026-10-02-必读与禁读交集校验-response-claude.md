---
schema: trivium.disposition.v1
topic: 必读与禁读交集校验
stage: code
role: claude
kind: response
run_id: 20261001T163431Z
addresses:
  - 2026-10-02-必读与禁读交集校验-codex.md
  - 2026-10-02-必读与禁读交集校验-gemini.md
  - 2026-10-02-必读与禁读交集校验-glm.md
---

# 应答：必读与禁读交集校验 · 代码双审第 1 轮

> 被审对象：相对 `a9e7cdc` 的工作树改动（25 个文件，补丁 727.7 KB）
> ｜ 运行：`20261001T163431Z`（约 12 分 48 秒）
> ｜ 结论：codex `approve-with-nits`（重要 1、次要 4、吹毛求疵 2）｜ gemini `approve`（零意见）｜ glm `approve-with-nits`（吹毛求疵 1）
> ｜ 共 8 条：接受 8、驳回 0、暂缓 0（CODEX-04 按审查员给的第二种处置接受：不动次序、设计写明代价）

每条都回源码核过，「理由」列写核对结果，「修改计划」列写落点。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | major | 接受 | 属实：`skills-src/partials/review/body.md:30` 要求 Driver 在用户没给 `--context` 时自动补一份路径清单，本版起这份清单撞上禁读集会整轮退 64，而契约没有任何处置话术；设计 7.4（`:1459`）有同一句的拷贝。AGENTS.md 改动同步清单要求「相关命令契约」随退出码变化同步 | `body.md` 那一条后补：自动补清单时不要写进禁读范围（对端审查件及其目录、运行目录、`.trivium/`、凭据类文件、罩住它们的目录）；`--start` 因 `--context` 退 64 时，区分来源处置（见 CODEX-07）。`npm run render` 同批更新渲染产物；设计 7.4 那句同步 |
| CODEX-02 | codex | minor | 接受 | 属实：`brief.ts` 用 `util/fsx.ts` 的 `expandHome`（只认 `~` / `~/`），而 `adapters/base.ts` 私有的那份认 `~`、`$HOME`、`${HOME}`，与命令通道 `spellingsOf` 同口径；注释与设计都承诺「与机器判定同一套」，这一格不成立 | 导出 `base.ts` 那份（改名 `expandHomeSpellings`，避免与 `fsx.expandHome` 同名混用），`findDenyConflicts` 改用它；单测补 `$HOME/…`、`${HOME}/…` 指到对端子树判命中、指到己方子树放过；设计末节「另展开 `~`」改为三种写法；EV-185 的登记补上这两种写法（必读清单那一侧同样丢） |
| CODEX-03 | codex | minor | 接受 | 属实：落盘段对 `pendingBriefs` 无条件写（跳过判定只影响置闸门与派生），跳过轮的 `_meta/brief-*.md` 是剔除后的版本却无记录；「没有审查员会被拉起」只解释了不播报，解释不了不留痕，与同一节写下的 CODEX-01（计划双审）理由互相顶 | 跳过轮同样把剔除写进 run.json `gate.warnings`（去掉 `else`，与 `skipped` 并列写）；`--start` 的 `finished_inline` 与同步路径跳过分支仍不播报（没有审查员被拉起、也没有 `--wait`）。设计末节、LLD、报告的「三处都不记」改为「只留 run.json 一笔」；用例见 GLM-01 |
| CODEX-04 | codex | minor | 接受 | 属实：`--context` 校验排在逐侧 `freeze()` 之后，`workTreeHash` 的 `git add -A` 已把 blob / tree 写进对象库，一次注定退 64 的拒跑白付这部分成本。不动次序的理由：提前校验要么每次运行多扫一遍禁读集（`enumerateDenyPaths` 含深度 6 的凭据扫描，代价落在所有运行上，换的是罕见的拒跑），要么给 `freeze()` 加「传入预算好的禁读集」入口——那正是 `freeze.ts` 注释里记过两次的「唯一调用入口漏传参数」一类改动，风险与收益不相称。这些对象与一次正常运行写出的同形，按 git 缺省清理回收；`routeModel` 的 69 排到全部侧冻结之后同属此列 | 按审查员给的第二种处置：设计末节与 LLD 如实写明「拒跑发生在逐侧冻结之后：零工件指审查工件与留痕，`git add -A` 写进对象库的松散对象与正常运行同形，按 git 缺省清理回收」 |
| CODEX-05 | codex | nit | 接受 | 属实：`config.ts:837` 的 `runRoot(cfg)` 与三处手写的 `expandHome(cfg.runtime.run_root)` 语义相同（`config.ts` 自己也是 `fsx.expandHome`）；`config.ts` 不导入 `freeze` / `guard`，改用 helper 不成环 | `brief.ts` 的 `denyContextFor`、`freeze.ts` 的 `enumerateDenyPaths`、`guard.ts:694` 三处改用 `runRoot(cfg)`，纯重构、值不变（全量回归守） |
| CODEX-06 | codex | nit | 接受 | 属实：拒跑文案有 10 行封顶，剔除告警按条目一条、没有封顶；EV-186 那一格（非 claude Driver、多轮）会整批命中，开场播报要逐条念 | 播报通道（`--start` 的 `warnings` 与同步路径）封顶 5 条：超过时前 4 条照旧、其余并成一条「另有 N 条…已按侧剔除：「a」「b」…（逐条见 run.json 的 gate.warnings）」；run.json 的 `gate.warnings` 保留全量供对账。单测补封顶格。`listOwnHistory` 的条数上限并进 EV-186 的登记（属该条的修法面） |
| CODEX-07 | codex | minor | 接受 | 属实：用户写的 `--context` 被拿掉不留痕，而自动补清单的是 Driver，撞上 64 后「去掉再重跑」会被静默执行；plan / bug 阶段被去掉的路径随之退出漂移相关集。取审查员给的第二种处置（契约），不加 run.json 字段：被拿掉的条目全在禁读集里（对端审查件、运行目录、`.trivium/`、凭据），其中归档与 `.trivium/` 本就被漂移判定整体排除，剩下的凭据文件被改动从「相关」降成「无关」是可接受的边角；加 run.json 字段是 schema 加法，超出本主题 | 契约（同 CODEX-01 的落点）：`--context` 是**用户写的** ⇒ 原样转述 64 并停止，由用户改；是**你自动补的** ⇒ 按报错去掉点名的条目后重跑，并在开场播报里写明去掉了哪几条。设计末节同步写明这一分工 |
| GLM-01 | glm | nit | 接受 | 属实：跳过轮的口径没有任何用例锁定，变异 `else if`→`if` 或 `[]`→`rc.mustReadPruned` 都不会红 | 集成补一格：`skip_doc_only_review` 开、归档根 `doc/reviews`、纯文档变更正文提到对端审查件 ⇒ `finished_inline`、`warnings` 为 `[]`、run.json `gate.warnings` 含剔除条目（CODEX-03 改后的口径）；变异补两条（跳过轮不写 `gate.warnings`、`finished_inline` 分支返回剔除告警） |

## 2. 实施注记（按接受项修改之后补记）

- **CODEX-05 只落了一处**：`brief.ts` 的 `denyContextFor` 改用 `runRoot(cfg)`；`freeze.ts` 与 `guard.ts` 两处照原计划换掉之后，修订后的第一次全量检查红了一条——`config-consumers` 对账把 `run_root` 判成「`src/` 下没有消费方」。它的判据是「定义处 `config.ts` 之外的属性访问」，`runRoot(cfg)` 这个 helper 就在定义处、不算消费方；三处全换等于让一个活配置在对账里变成死配置。两处退回原样（零改动），统一配置访问器在该测试头注释里已登记待议，不在本主题。那次全量的输出留在证据目录 `check-1.fail-c05.txt`。
- **变异装置的一次中断**：M20 的替换串写了 `$'`，`String.replace` 把它当特殊替换模式，变异后的源码语法坏了、构建失败；三份目标文件按哨兵哈希核对一致后删哨兵，改写法后整批重跑。不涉及任何一条裁决。

## 3. 修改后的验证计划

按坑清单：改完先重跑新增单测与集成；变异规格追加 CODEX-02 / CODEX-03 / CODEX-06 / GLM-01 对应的条目后整批重跑（预跑 + 正式装置）；改前 / 改后验收重跑（场景不变）；全量两次、doctor 自检；之后 verify。读数写进报告 §6、§7，旧读数加 `.r1` 后缀保留。
