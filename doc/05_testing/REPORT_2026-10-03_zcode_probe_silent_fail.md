# zcode 探针静默失败收口 · 实施报告（EV-196 + EV-197）

> - **日期**：2026-10-03
> - **主题**：`zcode探针静默失败收口`（命令 A `/dual-run`，Driver claude）
> - **起点**：`ee4ac5b`（`main`，工作树干净）
> - **计划**：`.reviews/zcode探针静默失败收口/plan/` r2（计划双审第 1 轮 run `20261003T063541Z`：codex `approve-with-nits`（次要 4）、gemini `approve`（零意见）、glm `approve-with-nits`（次要 1、吹毛求疵 2），7 条全接受）
> - **证据目录**：`doc/05_testing/evidence/zcode-probe-silent-fail-20261003/`
> - **代码双审**：run `20261003T071007Z`，codex `approve-with-nits`（次要 1、吹毛求疵 2）、gemini `approve`（零意见）、glm `approve-with-nits`（次要 1、吹毛求疵 1），5 条全接受，按应答件改码见 §2 末；CODEX-01 按决策三不在本题改、另登 EV-198
> - **配额**：全程零配额（用户决策五）：探针与 doctor 层用拉起桩，认证探活用假入口，没有任何真实 ZCode 调用

## 1. 问题

- **EV-196**：doctor 的 zcode 探针进了真实调用段、却没刷新 `response_field` 时，doctor 不拦也不警告，只多一条 note。结论从既有值克隆，`response_field` 保留旧值（如 `'response'`），而「headless 未跑通」那条 blocker 只看 `response_field === null`，于是不触发——全量 doctor 退 0、blockers 与 warnings 都为空。EV-194 起 doctor 的 headless 与审查运行走同一条选模路径，这类失败的含义是「审查那条路径不通」。真实调用段里有三条这样的路径：副本源读取或解析失败、headless 失败（均当场返回），以及 headless 退 0 却抠不出 envelope（不返回、path_deny 照跑；未登记在 EV-196 里，本题一并覆盖）。
- **EV-197**：认证探活 `authProbe.probe()` 在 `finally` 里裸调 `fs.rm(runDir, { recursive: true, force: true })`，`force` 只吞 ENOENT；ENOTEMPTY / EBUSY / EACCES 从 finally 抛出、顶替探活结果，穿过无兜底的 `probeAuth` 把预检崩成内部错误，副本支下含真实凭据的 `cli/config.json` 副本留在系统临时目录。doctor 侧的同形删除已在 EV-194 改成重试三次、失败不抛、推 note。

## 2. 改了什么

- `probes/zcode.ts`：
  - 新增导出 `ZcodeHeadlessUnrefreshedBranch` / `ZcodeHeadlessUnrefreshed` 与表 `ZCODE_HEADLESS_UNREFRESHED`（三支的人读名 `what`、根因 note 的定位字面 `noteKey`、沿用旧值的几项 `carried`）；
  - `probeZcode` 返回加第五项 `headlessUnrefreshed`：副本源失败与 headless 失败两支当场返回时带出，无 envelope 一支记下、在函数末尾带出；入口缺失、跳过真实调用、有 envelope 时为 null。过程事实、不落盘；
  - 三条既有 note 改为引用表里的 `noteKey` 拼接，拼出来的文字逐字不变；
  - 临时目录删除改调共用的 `removeZcodeTempDir(runDir, '探针')`。
- `doctor.ts`：新增导出 `zcodeHeadlessUnrefreshedWarning(u)`；zcode 段在旗标 warning 之后、headless blocker 之前，`headlessUnrefreshed` 非空即推一条 warning（哪一支、哪几项沿用上一次的结论、审查运行大概率同样跑不通、根因见含 `noteKey` 的那条 `[zcode]` note）。blocker 判据与退出码不变。
- `adapters/zcode.ts`：
  - 新增导出 `zcodeTempDirResidueText(who, runDir, code, hasCopy)` 与 `removeZcodeTempDir(runDir, who)`（`maxRetries: 3`、失败不抛、返回提示或 null）。提示按残留目录里是否还有 `cli/config.json` 副本分两档（计划双审 GLM-02）：有副本时与 EV-194 的 doctor note 逐字相同；没有时说「其中没有 cli/config.json 副本，是本次探测的 CLI 产物，请手工删除」。「还有没有」由删除函数在失败后对 `prepareZcodeHome` 写副本的那个位置现场 `stat`：在 ⇒ 有，`ENOENT` ⇒ 没有，查不了 ⇒ 按有说；
  - `authProbe.probe()`：原 try 体与结果拼装收进内部函数 `attempt(entry, runDir)`，外层 `try { r = await attempt(...) } finally { residue = await removeZcodeTempDir(runDir, '探活') }`，删不掉时把提示用全角分号接在详情末尾，`ok` 不变；删除成功时输出与改动前逐字节相同。
- **代码双审后（应答件 5 条全接受）**：「还有没有副本」从「调用方按 `prepareZcodeHome` 是否成功返回推断」改为上面的删除失败后现场查（GLM-01 ≡ CODEX-03）——写盘之后还有 `chmod` 可抛、`writeFile` 可能半写（副本在而以为没有），递归删除又是删到一半才失败（副本已删而以为还在），两个方向都会说错；两侧的 `seen` 持有对象随之删去。认证探活「副本源读取或解析失败」那句旁加注释，说明它独立于 doctor 侧的表（CODEX-02：探活详情不被任何 warning 指向，且 `adapters/` 不引用 `probes/`）。补 D17 钉住 warning 与 headless blocker 不互斥（GLM-02）。旗标探针与两条模型覆盖臂的同族裸删按决策三不改，另登 EV-198（CODEX-01）。
- 不变：审查运行、旗标探针、三条模型覆盖探针臂、`probePathDeny` 本体、探针结论的 schema / 缓存 / TTL、`probeAuth` 的结构、headless blocker 判据、「拉起抛错原样上抛」。

## 3. 读数

| 项 | 结果 | 留痕 |
| :--- | :--- | :--- |
| 单测 | `zcode-doctor-probe-home.test.ts` 新增 D10b、D11～D16，代码双审后再加 D10c、D10d、D17，D10 改锁 `cli/` 并叠加逐字比对；`zcode-auth-probe.test.ts` 新增 A1～A4（A1 / A2 双审后改锁 `cli/`）。两份合跑：双审前 33/33，双审后 36/36 | — |
| 变异预跑（逐条带超时） | 第一批 18/18、代码双审后第二批 19/19 咬住，源码逐字节恢复 | `mutation-spec.r1.json` / `mutation-spec.json`、`mutation-names-log.r1.txt` / `mutation-names-log.txt` 及同名 `output` |
| 变异装置（`scripts/mutation-check.mjs`） | 第一批 18/18、第二批 19/19 咬住，基线全绿（2 个套件） | `mutation-output.r1.txt` / `mutation-output.txt` |
| 全量检查（串行） | 双审前两次均 tests 2621 / pass 2619 / fail 0 / skipped 2，退 0（比上一题双审后的 2610 多 11 条：D10b、D11～D16、A1～A4）；双审后一次 tests 2624 / pass 2622 / fail 0 / skipped 2，退 0（再多 3 条：D10c、D10d、D17） | `check-1.txt`、`check-2.txt`、`check-3.txt` |
| doctor 自检 | 双审前后各一次，均 14/14、退 0（仓库 bundle `skills/dual-critic/scripts/trivium.cjs`，不是 wrapper 指向的安装副本） | `doctor-selftest.r1.txt`、`doctor-selftest.txt` |

### 3.1 变异清单（第二批，代码双审后；第一批 18 条见 `*.r1.*`）

| 编号 | 变异 | 咬住它的用例（预跑实测） |
| :--- | :--- | :--- |
| M1 | 副本源失败支不带出未刷新 | D12、D16 |
| M2 | headless 失败支不带出 | D11、D15、D16、D17 |
| M3 | 无 envelope 支不带出 | D13、D16 |
| M4 | 有 envelope 那一支也置成 `no_envelope` | D14、D15 |
| M5 | 跳过真实调用那条 return 带上 `headless_failed` | D14 |
| M6 | 无 envelope 支 carried 取成四项 | D13 |
| M7 | doctor 不推 warning | D15、D16、D17 |
| M8 | doctor 把它推进 blockers | D15、D16、D17 |
| M9 | headless blocker 判据并上 `headlessUnrefreshed`（出路二的等价形态） | D15、D16 |
| M10 | 无 envelope 支的 note 不再引 noteKey | D13、D16 |
| M11 | 共用删除函数失败照抛 | A1、A2、A4 |
| M12 | 探活不把残留接进详情 | A1、A2、A4 |
| M13 | 探活删除失败时把 ok 置 false | A1、A4 |
| M14 | 探活退回旧写法（finally 里裸删） | A1、A2、A4 |
| M15 | 共用函数有副本那档的文案字面改写 | D10、D10d（字面断言） |
| M16 | 残留里有没有副本恒判「有」（不现场查） | D10b、D10c |
| M17 | 残留里有没有副本恒判「没有」 | A1、A2 |
| M18 | 查不了副本在不在时按「没有」说 | D10d |
| M19 | warning 判据加第二条件（existing 为 null 时不出，与 blocker 互斥） | D17 |

第一批与第二批的差别：M1～M15 同一组变异（第二批 M2、M7、M8 多咬住新增的 D17）；第一批的 M16～M18 针对「调用方传 `hasCopy`」的写法（探活恒传 true、doctor 侧恒传 true、探活把有副本判成恒真），代码双审后该写法取消，按「删除失败后现场查」重写为现在的 M16～M18，另补 M19。

`maxRetries: 3` 不做变异：重试只对 EBUSY / ENOTEMPTY / EPERM 等瞬时错误生效，用例摆的 EACCES 不重试，观测不到——未覆盖面。

另：变异与全量跑完后，系统临时目录下 `trivium-auth-priv-*` / `trivium-zcode-auth-*` 为 0（新用例把 `TMPDIR` 钉在私有根、结束整删）；见到的两个 `trivium-dprobe-*` 残留时间早于本题开工（本地 13:23 / 13:25），是上一题 EV-194 变异轮留下的 D10 夹具（只剩只读的 `home/locked`），未动。

## 4. 文档

- 主设计 v1.3.79：§11.3 第 7 条末尾补「静默失败收口」一句；变更记录加一行。
- RUNBOOK §五：加两行——doctor 的「headless 探针本轮进了真实调用，但没刷新 response_field」告警怎么读；「探针 / 探活临时目录删除失败」怎么认残留与处置。
- BACKLOG：EV-196、EV-197 结案；代码双审 CODEX-01 新登 EV-198。

## 5. 残余

- **当期可见**：EV-196 的 warning 只在跑 doctor 的当期出现，此后预检与审查运行照常消费落盘的旧 `response_field`——与 EV-86（旗标结论「冻结」不可见）同一形态，修法方向也相同（落一个「上一次判定完成的时刻」持久事实）。不新登。
- **缓存期只当次可见**（计划双审 CODEX-02）：探活正结论入缓存（条目不含 detail），TTL 期内的预检走缓存命中，删除失败的提示只在当次可见。不改 `probeAuth`（决策三）。
- **拉起抛错且删不掉时提示丢失**（计划双审 GLM-01）：`attempt` 抛错时异常照旧上抛、finally 算出的提示无人消费；doctor 侧同形（D5 那条路径上已推进 notes 的提示随异常一起丢）。拉起抛错本身已让预检崩成内部错误，修它要改异常形状或改 `probeAuth`，越出决策三。
- **`maxRetries` 未覆盖**：见 §3.1 末。
- **同族裸删三处未收**（代码双审 CODEX-01，另登 EV-198）：旗标探针与两条模型覆盖臂的 finally 仍是裸删，删除失败会抛穿 `probeZcode`、doctor 崩成内部错误；三处目录里都没有真实凭据。决策三定了本题不改这三条探针臂。
