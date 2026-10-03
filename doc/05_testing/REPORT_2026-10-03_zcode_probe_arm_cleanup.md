# zcode 探针臂删除收尾 · 实施报告（EV-198）

> - **日期**：2026-10-03
> - **主题**：`zcode探针臂删除收尾`（命令 A `/dual-run`，Driver claude）
> - **起点**：`4a3d9f3`（`main`，工作树干净）
> - **计划**：`.reviews/zcode探针臂删除收尾/plan/` r2（计划双审第 1 轮 run `20261003T115927Z`：codex `approve-with-nits`（4 条，均因缺 `confidence` 逐条降级）、gemini `approve-with-nits`（次要 1、吹毛求疵 1）、glm `approve-with-nits`（次要 2、吹毛求疵 2），10 条全接受）
> - **证据目录**：`doc/05_testing/evidence/zcode-probe-arm-cleanup-20261003/`
> - **代码双审**：run `20261003T123538Z`，codex `approve-with-nits`（5 条，均因缺 `confidence` 逐条降级）、gemini `approve`（零意见）、glm `approve`（零意见）；接受 4、驳回 1（CODEX-04：前缀字面是有意的独立锚点、RUNBOOK 列前缀是用户决策四点名的），按应答件改码见 §2 末；CODEX-01 只改登记面、另登 EV-200
> - **配额**：全程零配额（用户决策五）：三条探针臂用假入口，doctor 层用桩，没有任何真实 ZCode 调用

## 1. 问题

EV-197 只收了认证探活与 doctor headless 段两处临时目录删除。doctor 的 zcode 探针里还有三处 finally 是裸 `fs.rm({ recursive: true, force: true })`：旗标探针 `probeReadonlyFlags`（前缀 `trivium-flagprobe-`）、白名单臂 `probeModelOverride`（`trivium-modeloverride-`）、同形臂 `probeModelOverrideFullCopy`（`trivium-fullcopyarm-`）。`force` 只吞 ENOENT，ENOTEMPTY / EBUSY / EACCES 从 finally 抛出、顶替原返回值，`probeZcode` 逐臂无兜底，异常穿过 `runDoctor`，doctor 崩成内部错误，本轮已探的结论在 checkpoint 前丢失。

开工时另核出两处：

- EV-198 登记里「三处目录里都没有真实凭据」说过头：同形臂写盘后才判残余，扫出残余时副本已在盘上；`apiKeyOnly` 收窄档下残余扫描为空也不保证没有凭据。
- `removeZcodeTempDir` 现场查副本的位置写死成 `prepareZcodeHome` 的布局（`<临时目录>/home/.zcode/cli/config.json`）；白名单臂的副本在 `<临时目录>/.zcode/cli/config.json`，直接套用会把有副本说成没有。

## 2. 改了什么

- `src/trivium/adapters/zcode.ts`：
  - `zcodeTempDirResidueText` 第四个参数由 `hasCopy: boolean` 改为 `ZcodeTempDirCopyKind | null`，加第三档「其中的 cli/config.json 是探针副本、凭据已换成哨兵，仍请手工删除」；`'credential'` 与 null 两档与原 true / false 逐字相同。
  - `removeZcodeTempDir(runDir, who, copy)`：副本位置与档位由调用方传入；`copy` 为 null（从不写副本）时删除失败不查、说没有；非 null 时删除失败后现场 stat，ENOENT 说没有，存在或查不了按 `copy.kind` 说。`copy.path` 只 stat 不删，删除面仍只有 `runDir`。
  - 新增导出 `zcodeCliCopyPath(homeDir)`，`prepareZcodeHome` 写副本改用它（只管副本的写入与现场查这一处，`.zcode/cli` 的其余回读点仍各写字面，代码双审 CODEX-02 后注释写明）；认证探活传 `{ path: zcodeCliCopyPath(zcodeHomeUnder(runDir)), kind: 'credential' }`，输出逐字不变。
- `src/trivium/probes/zcode.ts`：
  - 旗标探针：finally 改调 `removeZcodeTempDir(emptyHome, '探针', null)`，返回值加 `tempDirResidue: string | null`。
  - 白名单臂：try 体原样拆进内部 `attempt`，外层 finally 删除、传 `{ path: zcodeCliCopyPath(home), kind: 'sentinel' }`（写盘与查用同一个路径），删不掉时结果多一个 `tempDirResidue`。
  - 同形臂：同样拆 `attempt`；`residue` 声明挪到 try 外，finally 按删除那一刻的残余扫描结果与替换档取档（扫出残余或 `apiKeyOnly` 取 `credential`，否则 `sentinel`）；加测试注入口 `removeTempDir`（缺省即 `removeZcodeTempDir`），只为「扫出残余不拉起」那一支能在删除前一刻上锁。
  - `ModelOverrideProbe` 加可选 `tempDirResidue`；`probeZcode` 紧跟旗标结论 note、白名单臂 note、同形臂原样支 note 各推一次，置首支在其调用之后推（它没有自己的 note）。
  - doctor headless 段的调用改为显式传 `{ path: zcodeCliCopyPath(zcodeHomeUnder(runDir)), kind: 'credential' }`，输出逐字不变。
- 判据、拉起方式、三分判定、doctor 的 blocker / warning / 退出码、结论 schema 都不变。
- 代码双审后（应答件）：同形臂取档抽成导出函数 `fullCopyResidueKind(replace, residue)`、两支各写理由，docblock 写明 `residue` 是盘上副本形状的单一事实源（CODEX-05，行为不变）；`zcodeCliCopyPath` 注释收窄（CODEX-02）；`zcode-full-copy-arm.test.ts` 的 `tmp()` 记下所建目录、文件跑完由 `after` 钩子整删（CODEX-03）。

## 3. 读数

| 项 | 结果 | 留痕 |
| :--- | :--- | :--- |
| 单测 | 新增 9 格：`zcode-provider-env.test.ts` 的 R1、D19，`zcode-full-copy-arm.test.ts` 的 R2～R6，`zcode-auth-probe.test.ts` 的 R7，`zcode-doctor-probe-home.test.ts` 的 D18；A3 扩成三档、A1 / A2 / A4 / D10 的期望改用新档位（断言字面不改）。六个 zcode 相关文件合跑 190/190（代码双审前后各一次）。摆锁的格都带 root 跳过门，假入口摆锁失败退 3 | — |
| 变异预跑（逐条带超时） | 第一批 20/20、代码双审后第二批 20/20 咬住，源码逐字节恢复 | `mutation-spec.r1.json` / `mutation-spec.json`、`mutation-names-log.r1.txt` / `mutation-names-log.txt` 及同名 `output` |
| 变异装置（`scripts/mutation-check.mjs`） | 第一批、第二批均 20/20 咬住，基线全绿（4 个套件） | `mutation-output.r1.txt` / `mutation-output.txt` |
| 全量检查（串行） | 双审前两次均 tests 2633 / pass 2631 / fail 0 / skipped 2，退 0（比上一题双审后的 2624 多 9 条，即上面新增的 9 格）。双审后三次：第一次、第二次各红 1 条，均在 `test/integration/cancel-grace-unverifiable.test.ts`（K-K4「SIGKILL 之后应拦到（桩自证）」、K-K3「SIGTERM 之后没观测到 SIGKILL」，两次红的不是同一格），第三次 2633 / 2631 / 0 / 2、退 0。见下方说明 | `check-1.txt`～`check-5.txt` |
| doctor 自检 | 双审前后各一次，均 14/14、退 0（仓库 bundle `skills/dual-critic/scripts/trivium.cjs`） | `doctor-selftest.r1.txt`、`doctor-selftest.txt` |

**双审后两次全量的偶发红**：`cancel-grace-unverifiable` 是取消宽限期的信号时序用例（SIGTERM / SIGKILL 的观测顺序），与本题改动无交集——本题源码只动 `adapters/zcode.ts` 与 `probes/zcode.ts`，代码双审后的改动是取档函数抽取、一处注释与 `zcode-full-copy-arm.test.ts` 的收尾钩子。红的那一刻机器负载均值约 10（桌面应用占用），没有残留的测试进程；单跑该文件三次均 16/16 全绿，第三次全量全绿。它不在已知偶发清单里（已知的是 lock-cross-process 与 state.test「并发 setGate 不丢更新」），交付时经用户决定登记为 BACKLOG EV-201。

### 3.1 变异清单

| 编号 | 变异 | 咬住它的用例（预跑实测） |
| :--- | :--- | :--- |
| M1 | 旗标探针退回裸删 | R1、D19 |
| M2 | 白名单臂退回裸删 | R2 |
| M3 | 同形臂退回裸删 | R3、R4、R5、R6 |
| M4 | 白名单臂按 `prepareZcodeHome` 的布局查副本 | R2 |
| M5 | 白名单臂档位取成含真实凭据 | R2 |
| M6 | 同形臂丢掉残余条件 | R4、R6 |
| M7 | 同形臂丢掉 `apiKeyOnly` 条件 | R5 |
| M8 | 旗标探针传指向临时目录本身的哨兵档（「谎称有副本」，计划双审 CODEX-02 ≡ GLM-03 后的可判死写法） | R1、D19 |
| M9 | 副本已不在也按调用方档位说（不现场查） | R6 |
| M10～M13 | `probeZcode` 四处推 note 各删一处 | D18 |
| M14 | 旗标探针不带出提示 | R1、D19 |
| M15 | 白名单臂不带出提示 | R2 |
| M16 | 同形臂不带出提示 | R3、R4、R5、R6 |
| M17 | 第三档措辞改字 | R7 |
| M18 | `zcodeCliCopyPath` 多拼一层 `cli` | 12 格（`prepareZcodeHome` 与两臂的既有用例 9 格，另有 R2、R3、R5） |
| M19 | 认证探活的档位改成哨兵档 | A1、A2 |
| M20 | doctor headless 段的档位改成哨兵档 | D10、D10d |

M19、M20 是编码时补的：两处既有调用「输出逐字不变」的承诺要有变异咬住。`removeZcodeTempDir` 里 `copy === null` 的短路不单列变异：它从调用方一侧由 M8 咬住（计划 r2 §2.2）。

另：变异与全量跑完后，系统临时目录下 `trivium-flagprobe-` / `trivium-modeloverride-` / `trivium-fullcopyarm-` 前缀的目录为 0（新用例把 `TMPDIR` 钉在私有根、结束解锁并整删）。`zcode-full-copy-arm.test.ts` 的 `tmp()` 此前从不清理（代码双审 CODEX-03），本机系统临时目录里已积累 6383 个 `trivium-fullcopy-test-*`；补收尾后合跑六个 zcode 文件前后都是 6383，不再增加。已积累的历史目录不是本题建的，未在会话里删，交用户决定。

## 4. 文档

- 主设计 v1.3.80：§11.3 第 7 条末尾补「探针臂删除收尾」一句；变更记录加一行。
- RUNBOOK「临时目录删除失败」那一行：补 `trivium-flagprobe-`、`trivium-modeloverride-`、`trivium-fullcopyarm-` 三个前缀与第三档措辞的处置。
- BACKLOG：EV-198 结案，并把登记时「三处都没有真实凭据」改准；按计划双审 CODEX-04 ≡ AGY-02 ≡ GLM-02 新登 EV-199（探针夹具 cleanup 同族裸删，五处调用、四侧共用；代码双审 CODEX-01 补 codex 隔离探针一处，并写明清单按 grep 派生的口径）；按代码双审 CODEX-01 新登 EV-200（codex 认证探活删除失败崩预检、残留真实 `auth.json`）；按用户决定登记 EV-201（`cancel-grace-unverifiable` 全量偶发红）；EV-86 触发条件表写准为「改旗标判据」（只动删除收尾不算）。
- 本报告登记进 `doc/05_testing/README.md`「当前已归档文件」一节（计划双审 CODEX-03 ≡ AGY-01 ≡ GLM-01）。

## 5. 残余

- **拉起或副本准备本身抛错时提示丢失**：与 EV-197 残余 ① 同形。三臂里 `run()` 不抛（spawn 失败落成 `code: null`），可抛的是同形臂的 `prepareZcodeHome`（写盘 / `chmod` 失败）——那是副本准备失败，异常本身照旧崩掉 doctor，不在 EV-198 论域；本题让删除不再顶替原异常。
- **当期可见**：提示只在跑 doctor 的当期出现，同 EV-86 / EV-197 残余 ② 形态。
- **夹具 cleanup 与 codex 隔离探针裸删**：另登 EV-199，本题不改。
- **codex 认证探活裸删**（含真实 `auth.json`）：另登 EV-200，本题不改 codex 侧代码。
- **全量偶发红**：`cancel-grace-unverifiable` 的 K-K3 / K-K4 信号时序断言，用户定登记为 EV-201。
- **`maxRetries` 未覆盖**：用例摆的 EACCES 不在重试错误表里（EBUSY / EMFILE / ENFILE / ENOTEMPTY / EPERM），观测不到重试——同 EV-197。
