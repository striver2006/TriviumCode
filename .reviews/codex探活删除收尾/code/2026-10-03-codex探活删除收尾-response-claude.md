---
schema: trivium.disposition.v1
topic: codex探活删除收尾
stage: code
role: claude
kind: response
run_id: 20261003T150101Z
addresses:
  - 2026-10-03-codex探活删除收尾-codex.md
  - 2026-10-03-codex探活删除收尾-gemini.md
  - 2026-10-03-codex探活删除收尾-glm.md
---

# 应答：codex探活删除收尾 · 代码双审第 1 轮

> 被审对象：相对 `9ce191f` 的工作树补丁（21 个文件，`_meta/changes-20261003T150101Z.diff`）
> ｜ 运行：`20261003T150101Z`（约 9 分 14 秒）
> ｜ 结论：codex `approve-with-nits`（次要 1、吹毛求疵 2）｜ gemini `approve`（零意见）｜ glm `approve-with-nits`（吹毛求疵 1）
> ｜ 共 4 条：接受 4、驳回 0、暂缓 0

每条都回源码核过。CODEX-02 与 GLM-01 同指「没有凭据副本」档的后半句「是本次探活的 CLI 产物」说过头，合并处置。gemini 零意见，其「未覆盖范围」（未实跑、真实 CLI 行为）属只读审查与零配额的固有边界，不另处置。

## 1. 应答表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | minor | 接受 | 属实：凭据载体名口径在 `isCredentialCarrier`、`codexCredentialCopies` 的枚举、C7 手写谓词、假入口脚本四处各有字面，C7 拿测试自己的手抄谓词过滤写入面，钉住强度靠两处手抄同步。取建议的单源部分：导出 `isCredentialCarrier`，C7 改用它过滤写入面，并另断言 `codexCredentialCopies` 给出的每个名字都被它认作载体——生产谓词与清单任一侧漂移都会红。假入口是独立子进程里的脚本，那份字面保留（它只用于摆现场与「三份齐全」的自检，摆不出即退 3、用例红），在脚本注释里写明 | `src/trivium/adapters/codex-home.ts`（`isCredentialCarrier` 导出）；`test/unit/codex-auth-probe.test.ts` 的 C7 与假入口注释 |
| CODEX-02 | codex | nit | 接受 | 属实（与 GLM-01 同指）：「是本次探活的 CLI 产物」有两条可达路径不成立——副本准备失败（CLI 从未拉起）且删不掉；`rewriteHomePaths` 按幸存键拷进来的用户文件（如模型目录）在三份载体之后仍在。取建议一：后半句不再断言内容全貌，改为「其中没有凭据副本，剩下的是本次探活的临时文件，请手工删除」。不取建议二（把 `prep.copiedFiles` 纳入现场查）：那些文件不是凭据载体，查到了也不能说「含真实凭据」，只会让「有」档说过头。**这一句是用户决策二给的原话**，改动在收尾时向用户单独说明。zcode 侧同句式的「是本次探测的 CLI 产物」按决策二「zcode 侧全部输出逐字不变」不动，同一关切在报告残余里记一笔 | `src/trivium/adapters/codex.ts` 的 `codexTempDirResidueText`；C3、C8 的字面断言；RUNBOOK 那一行；报告 §2 / §6 |
| CODEX-03 | codex | nit | 接受 | 属实：`tryRemoveTempDir` 的 `code` 回退项 `(e as Error).message` 不经家目录归一，而它从此三处共用。fs 的系统错误恒带 `code`，回退支近于不可达；在共用函数处给回退值过一次 `tildeHome` 即可，`code` 存在时输出不变（zcode 可达路径逐字不变） | `src/trivium/util/fsx.ts` 的 `tryRemoveTempDir` 与其文档块 |
| GLM-01 | glm | nit | 接受 | 同 CODEX-02，处置合并。「补一格准备失败 + 删不掉」不补：准备失败时 CLI 不拉起，现有装置没有在「准备失败之后、删除之前」上锁的时机，要为它给 `probe()` 加测试注入口，不值；措辞改后两条路径都由 C8 的字面断言与 C3 覆盖到同一句 | 同 CODEX-02 |

## 2. 改动后的验证

按接受项改码后：新用例与相关回归单跑；变异第二批（规格重新生成，锚点随措辞更新，`.r1` 留档第一批）先逐条预跑、再跑装置；全量两次（串行）；doctor 自检；最后 `verify`。读数写进报告 §4、§5。
