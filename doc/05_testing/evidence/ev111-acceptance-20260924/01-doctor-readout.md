# EV-111 零配额验收 · doctor 构建标识读数

- **依据**：计划 `.reviews/EV-111-构建标识HEAD误报/plan/` r2 §5.3（代码双审 r1 已审批「修改后通过」）
- **命令**：`trivium doctor --only env --no-model-calls`。零配额：`--no-model-calls` 跳过全部真实模型调用；
  构建标识那一行在环境段，`env` 档就能读到（r2 §5.3，计划双审 CODEX-02）
- **构建**：实施提交 `1b7cfed` 推送后，在干净工作树上 `npm run build`、`npm run install:local` 各一条，
  安装副本的构建标识 = `1b7cfed`、`inputs 3f1e3439824d`、构建时干净

## 读数 A：HEAD = 构建提交（对照格）

- 时点：安装后、任何新提交之前；`git status --short` 为空；HEAD `1b7cfed`
- 读数（doctor 第 7 行，原样）：

```text
编排器构建标识：1b7cfed，inputs 3f1e3439824d，构建于 2026-09-24T14:49:24.293Z；本仓模式（按根提交判定）：安装副本与当前工作树一致
```

- 判定：零告警；HEAD 未前进，**不出**出处句（r2 §4.2「HEAD 相同时不补」）✅

## 读数 B：HEAD 前进一次纯文档提交（EV-111 本体）

本文件连同读数 A 作为那次纯文档提交落盘（提交 `53d12e0`）；提交后再读一次 doctor，读数 B 追加在下面，随收尾提交一并入库。

- 时点：`53d12e0` 提交后；`git status --short` 为空；`git diff --name-only 1b7cfed 53d12e0` 只有本文件（作用面外）；安装副本未重装
- 读数（doctor 第 7 行，原样）：

```text
编排器构建标识：1b7cfed，inputs 3f1e3439824d，构建于 2026-09-24T14:49:24.293Z；本仓模式（按根提交判定）：安装副本与当前工作树一致（构建于 1b7cfed，仓库 HEAD 已到 53d12e0，作用面与构建时一致）
```

- 判定：HEAD 与构建提交不同、作用面指纹一致 ⇒ **零告警**，不再报「安装副本与仓库 HEAD 不同版」；出处句如实给出两端提交 ✅
- 这一行由 `describeBuildStamp` 产出，其内部调的 `checkBuildStamp` 与收尾写 `gate.warnings` 的 `collectBuildStampNotices` 是同一个函数，
  所以「零告警」对收尾路径同样成立。下一次真实双审的 run.json 不再出「不同版」，作为附带观察，不专门花配额（r2 §5.3）

## 结论

两格读数都满足 r2 §4.2 / §5.3：HEAD 相同不补出处句；HEAD 前进一次纯文档提交后零告警、补出处句。EV-111 验收通过。
