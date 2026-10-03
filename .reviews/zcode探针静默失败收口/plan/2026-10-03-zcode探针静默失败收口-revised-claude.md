---
schema: trivium.disposition.v1
topic: zcode探针静默失败收口
stage: plan
role: claude
kind: revised
run_id: 20261003T063541Z
addresses:
  - 2026-10-03-zcode探针静默失败收口-codex.md
  - 2026-10-03-zcode探针静默失败收口-gemini.md
  - 2026-10-03-zcode探针静默失败收口-glm.md
---

# 裁决：zcode探针静默失败收口 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-03-zcode探针静默失败收口-claude.md`（r1，起点 `ee4ac5b`）
> ｜ 运行：`20261003T063541Z`（约 8 分 59 秒）
> ｜ 结论：codex `approve-with-nits`（次要 4）｜ gemini `approve`（零意见）｜ glm `approve-with-nits`（次要 1、吹毛求疵 2）
> ｜ 共 7 条：接受 7、驳回 0、暂缓 0
> ｜ 修订后的计划：`plan/2026-10-03-zcode探针静默失败收口-r2-claude.md`；命令 A 不设人工闸门

每条都回源码核过，核对结果写在「理由」列。三侧对主方向（EV-196 出 warning 不拦、判据单一；R1 warning 与既有 blocker 不互斥；EV-197 共用删除函数、探活结论不变）均表认可，定案。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | minor | 接受 | 属实：r1 §1.2「existing 里是 'response' 时 A / B / C 三支都不可达」说反了。三支本身恒可达、不以 `response_field` 为入口条件；不可达的是 :604 那条 blocker——旧值 'response' 顶替了本轮结论，blocker 判据不成立，这正是 EV-196 的静默形态 | r2 §1.2 该句改写 |
| CODEX-02 | codex | minor | 接受 | 属实：`probeAuth` 对 `ok: true` 写缓存（`preflight.ts:736-738`，条目不含 detail），TTL 期内的预检走缓存命中、详情是 `authCacheValid` 的 reason，残留提示只在删除失败的那一次预检可见。取建议 ②：不改 `probeAuth`（决策三），作为已知残余写明，与 §2.3 的 EV-86 同族残余并列；残留目录在系统临时目录、前缀 `trivium-zcode-auth-` 固定，RUNBOOK 那行顺带说明怎么认 | r2 §3.4（新增，残余）、§5 BACKLOG EV-197 结案说明、RUNBOOK 行 |
| CODEX-03 | codex | minor | 接受 | 属实：只用生成函数的输出比对会自我循环，文案被改 D10 / A1 / A2 照绿。现 D10 的三段字面断言（`startsWith('⚠️ 探针临时目录删除失败')`、`/（EACCES）/`、`/含真实凭据，请手工删除/`）保留不删，「与函数输出相等」作为新增断言叠加；A1 / A2 同样各带字面断言；变异表补 M15「改写共用函数里的文案字面」，由 D10 与 A1 的字面断言咬住 | r2 §4.1 D10 / A1 / A2 断言、§4.2 M15 |
| CODEX-04 | codex | minor | 接受 | 建议照收、前提有一处更正：认证探活的退路支**也**设落点根（`adapters/zcode.ts:1125` `storageRedirectRoot: zcodeHomeUnder(runDir)` 不分支，EV-136 r1 CODEX-02 ≡ GLM-02 定的「两支都设」），所以退路支同样能摆出删不掉。仍把 A1 / A2 的摆法前提写明为副本支（档位有模型 + 副本源可读），另加 A4 摆退路支（档位无模型）验 GLM-02 的措辞分支；假入口的锁开关在拿不到 `ZCODE_STORAGE_DIR` 时退非 0 并写明原因，摆不出就红，不静默通过 | r2 §4.1 认证探活表前提、A4、假入口开关说明 |
| GLM-01 | glm | minor | 接受 | 属实：`attempt` 抛错时 finally 里算出的残留提示无人消费，含凭据副本留在临时目录而无提示。doctor 侧同形（D5 抛错路径下推进 notes 的残留 note 随异常一起丢），是 EV-194 起就有的同族缺口。按建议显式裁决为**已知残余、不修**：拉起抛错本身已让预检崩成内部错误（`probeAuth` 无兜底，决策三不改），这条路径上用户面对的是一次崩溃，修它要么改写上抛异常的 message（改变异常形状，内部错误的呈现路径要连带核），要么改 `probeAuth`——都越出决策三划的范围。写进 r2 §3.3、§6 R6，BACKLOG EV-197 结案说明并列为残余（两侧同形），不新登条目 | r2 §3.3 改写、§6 R6（新增）、BACKLOG EV-197 结案说明 |
| GLM-02 | glm | nit | 接受 | 属实：`prepareZcodeHome` 在 `source_missing` / `no_model` 两档直接返回、不建副本（`adapters/zcode.ts:964-974`）；解析失败时 `ensureDir`（:978）已建目录、`writeFile`（:993）未到，同样没有副本。这三种情形下「其中的 cli/config.json 副本含真实凭据」不属实。不软化成「可能含」（那会把副本支也说虚），改为按事实分支：共用函数多收一个 `hasCopy`（调用方以「`prepareZcodeHome` 成功返回且 `homeDir !== null`」判定）——有副本时原句逐字不变（D10 照绿），没有时说「其中没有 cli/config.json 副本，是本次探测的 CLI 产物，请手工删除」，不断言产物里不含敏感内容 | r2 §3.1 函数签名与两档措辞、§3.2 / doctor 侧的 `hasCopy` 取法、§4.1 A4 与 A3 |
| GLM-03 | glm | nit | 接受 | 属实：现 `zcode-auth-probe.test.ts` 直接用真实 `os.tmpdir()`（:20），A1 / A2 摆只读残留若清理链失手会永久留在系统临时目录。照 doctor 侧 D10 同法：这几条用例把 `TMPDIR` 钉到用例私有根，结束时恢复权限后整删私有根；观测文件只用来断言「残留确在」，不承担清理 | r2 §4.1 认证探活装置说明、§6 R5 改写 |

## 2. 说明

- gemini 零意见，其「未覆盖范围」三项（未跑测试、`maxRetries` 重试的 OS 行为、真实 stderr 与脱敏的交互）中，第二项与计划 §4.2「`maxRetries: 3` 不做变异、记为未覆盖面」一致；另两项属只读审查与零配额的固有边界，不另处理。
- R1（warning 与既有 blocker 是否互斥）三侧意见一致：不互斥，判据保持单一。r2 §6 R1 记下这一定案。
- 本轮没有新增登记条目：CODEX-02 与 GLM-01 两条残余都写进 EV-197 的结案说明（决策四「不新登，除非双审核出新缺口」——这两条是本题修法的边界说明，不是新缺口）。
