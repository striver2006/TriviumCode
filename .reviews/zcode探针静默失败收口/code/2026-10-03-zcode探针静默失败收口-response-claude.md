---
schema: trivium.disposition.v1
topic: zcode探针静默失败收口
stage: code
role: claude
kind: response
run_id: 20261003T071007Z
addresses:
  - 2026-10-03-zcode探针静默失败收口-codex.md
  - 2026-10-03-zcode探针静默失败收口-gemini.md
  - 2026-10-03-zcode探针静默失败收口-glm.md
---

# 应答：zcode探针静默失败收口 · 代码双审第 1 轮

> 被审对象：相对 `ee4ac5b` 的工作树补丁（19 个文件，`_meta/changes-20261003T071007Z.diff`）
> ｜ 运行：`20261003T071007Z`（约 7 分 26 秒）
> ｜ 结论：codex `approve-with-nits`（次要 1、吹毛求疵 2）｜ gemini `approve`（零意见）｜ glm `approve-with-nits`（次要 1、吹毛求疵 1）
> ｜ 共 5 条：接受 5、驳回 0、暂缓 0（CODEX-01 按决策三不在本题改，作为双审核出的新缺口登记 EV-198）

每条都回源码核过。gemini 零意见，其「未覆盖范围」三条（未实跑、`maxRetries` 的 OS 行为、真实 CLI 故障注入）属只读审查与零配额的固有边界，不另处置。

## 1. 应答表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | minor | 接受 | 属实：`probes/zcode.ts` 旗标探针（:253）、白名单臂（:621）、同形臂（:1002）三处 finally 仍是裸 `fs.rm`，删除失败会抛穿 `probeZcode`（:1338 / :1382 起无逐臂兜底），doctor 崩成内部错误、本轮已探结论在 checkpoint 前丢失——与修前的认证探活同形。取建议 ②：决策三明定「不改旗标探针与模型覆盖探针臂」，本题不动；作为双审核出的新缺口登记（决策四允许）。顺手核了残留内容：三处目录里都没有真实凭据（旗标探针是空 HOME；白名单臂按 `buildProbeCliConfig` 白名单重建、`apiKey` 是哨兵；同形臂写盘前把凭据换成哨兵并做残余扫描），所以残留提示若补，应取「没有副本」那档而非「含真实凭据」 | BACKLOG 新登 EV-198（含触发条件与残留内容核实）；报告 §5 残余加一条 |
| CODEX-02 | codex | nit | 接受 | 「两份事实源」这一层：认证探活的「副本源 … 读取或解析失败」不被任何 warning 指向——表存在的目的是让 doctor 的 warning 与它点名的 note 不各改各的，探活详情不在这条链上；而且 `adapters/` 不引用 `probes/`（表在探针模块），引表要么搬表、要么反向依赖。取建议的第二项：在探活那句旁写注释，声明它独立于表及理由。「noteKey 偏泛」这一层：核过同一轮里含「读取或解析失败」的 `[zcode]` note 只有副本源那一条（`grep` 两个源文件：这串字面只出现在表定义、引用它拼出的那条 note、认证探活详情三处，进 doctor notes 的只有中间那条；该支当场返回、其后不再推 note），唯一性成立；它嵌在路径之后是因为 note 以「副本源 〈路径〉」起头，路径随机器变，取不出更长的连续定位串 | `adapters/zcode.ts` 探活副本源失败 detail 旁加注释 |
| CODEX-03 | codex | nit | 接受 | 与 GLM-01 同一缺口（见下格），一并改：判据从「`prepareZcodeHome` 成功返回」改为删除失败后按现场事实判定 | 同 GLM-01 |
| GLM-01 | glm | minor | 接受 | 属实：`prepareZcodeHome` 在 `writeFile`（:1022）之后、`return` 之前还有 `chmod`（:1024），`writeFile` 自身也可能半写——两种情形下副本已在盘上而 `hasCopy` 仍为 false。核对时另发现同族的反方向：递归删除是部分完成后才失败的（A1 / D10 摆的只读子目录与 `cli/` 是兄弟目录），副本很可能已被删掉，而 `hasCopy: true` 档仍说「其中的副本含真实凭据」。两个方向都源于「用写入时的推断代替删除失败那一刻的事实」。改为：`removeZcodeTempDir` 删除失败后自己查 `zcodeHomeUnder(runDir)` 下的 `.zcode/cli/config.json` 是否还在——在就用有副本那档；`ENOENT` 才用没有副本那档；查不了（权限等其他错误）按有副本说，宁可多提醒。调用方不再传 `hasCopy`，两处 `seen` 持有对象删去 | `adapters/zcode.ts` `removeZcodeTempDir` 签名与判据、`authProbe` 去掉 `seen`；`probes/zcode.ts` 去掉 `seen`；用例：D10 / A1 改为锁住 `cli/` 目录（副本删不掉）、新增 D10c（副本支锁兄弟目录：副本已删、说没有副本）与 D10d（`.zcode` 整个不可读：查不了按有副本说）；变异 M16～M18 按新判据重写；设计 / RUNBOOK / BACKLOG / 报告里「按副本是否写下」改为「按残留目录里是否还有副本」 |
| GLM-02 | glm | nit | 接受 | 属实：「warning 与 headless blocker 不互斥」是计划三侧定案，D15 / D16 的既有结论都摆 `'response'`，给 warning 的 if 加一条 `response_field !== null` 的变异今天无一用例咬住 | 新增 D17（既有结论 `response_field: null` + headless 失败：同一轮 blockers 有 `ZCODE_HEADLESS_NOT_OK_HINT`、warnings 有本题 warning）；变异补 M19（warning 判据加第二条件） |

## 2. 修改计划

1. `adapters/zcode.ts`：`removeZcodeTempDir(runDir, who)` 去掉 `hasCopy` 参数，删除失败后按现场判定（见 GLM-01 格）；`zcodeTempDirResidueText` 签名不变（纯函数，`hasCopy` 由上面算出）；`authProbe` 去掉 `seen`；副本源失败 detail 旁加注释（CODEX-02）。
2. `probes/zcode.ts`：去掉 `seen`，finally 改调两参数形态。
3. 用例：`stubInvoke` 的 `lockRunDir` 扩成三种锁法（兄弟目录 / `cli` 目录 / `.zcode` 不可读）；D10 改锁 `cli`，新增 D10c、D10d、D17；认证探活假入口的锁开关同样可选锁 `cli`，A1 / A2 改锁 `cli`，A4 保持锁兄弟目录（退路支本就没有副本）。
4. 变异：M16～M18 按新判据重写（判定恒真、恒假、把查不了当成没有），补 M19；先逐条预跑、再跑装置。
5. 文档按实改措辞；BACKLOG 新登 EV-198；报告 §2、§3、§5 与代码双审行补齐。全量串行再跑一次、自检再跑一次。
