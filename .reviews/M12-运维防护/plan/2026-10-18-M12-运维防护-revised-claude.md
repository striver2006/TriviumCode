---
schema: trivium.disposition.v1
topic: M12-运维防护
stage: plan
role: claude
kind: revised
run_id: 20261018T002634Z
addresses:
  - 2026-10-18-M12-运维防护-codex.md
  - 2026-10-18-M12-运维防护-gemini.md
  - 2026-10-18-M12-运维防护-glm.md
---

# 裁决：M12-运维防护 · 计划三审第 1 轮

> 被审对象：`plan/2026-10-18-M12-运维防护-claude.md`（r1，起点 `8c4d359f`）
> 三侧：codex `request-changes`（1 major、1 minor），glm `approve-with-nits`（1 minor），gemini `approve-with-nits`（2 minor、2 nit）。7 条全部接受，合入后的计划见 `plan/2026-10-18-M12-运维防护-r2-claude.md`。
> 裁决前回源码核了四处：`brief.ts:840` `excerptSubject` 缺省 400 行内返回全文（CODEX-02 成立）；`zcode-provider-env.test.ts:639-645` 对 `warnings.length === 1` 精确断言、装置不钉 HOME（GLM-01 成立）；`preflight.ts` `displayHomePath` 只认 `os.homedir()`（AGY-01 成立）；直调 `runDoctor` / `runPreflight` 的测试文件共 6 个（`preflight.test.ts` 32 处、`zcode-doctor-probe-home` 3、`zcode-provider-env` 2、`claude-structured-probe` 2、`fixture-repo-init` 1、`codex-wiring`），经 CLI 子进程跑 `preflight` / `doctor` 的集成文件 9 个（CODEX-01 的论域成立）。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 成立且比 GLM-01 更宽：doctor 的扫描放在 `--only` 门控之前，凡经 `runDoctor` / `runPreflight` 或 CLI 子进程跑到这两条命令的旧用例都会读真实 `~/.agents/skills`，哪怕断言不飘也违背「不碰真实家目录」。r1 只点了 `preflight.test.ts` 的精确断言用例，论域塌小了。逐个给 40 余处调用补参数既易漏、又证明不了「不读」，改为单一来源加护栏 | r2 §2.5（扫描家目录的唯一来源 `entryScanHome()`：注入口 → 环境变量 `TRIVIUM_ENTRY_SCAN_HOME` → `os.homedir()`）、§4.1（测试侧统一隔离：`cli()` 缺省设该变量指向空夹具；直调的 6 个文件经 `test/helpers` 的隔离助手设进程级变量）、§4 U8（对账用例：凡直调或经 CLI 跑到 doctor / preflight 的测试文件必须走隔离，未走即红）、U9（证明读的是指定的家目录） |
| CODEX-02 | codex | minor | 接受 | 成立：小 diff 在 400 行内时任务书节选就是全文，`requests[*].brief_text` 里本来就各有一份，去重只动 `snapshots`，整份文件里的哨兵计数与「约 1/3」都不是正确判据 | r2 §4 I1 改为只数 `snapshots` 与 `frozen_diff` 结构里的补丁正文份数、另比各侧 `brief_text` 字节不变；§5 A-3 体积对照改用明显超过节选上限的夹具（> 400 行），预期缩减量按「去掉的 N−1 份快照正文」计算 |
| GLM-01 | glm | minor | 接受 | 成立，与 CODEX-01 同源：`zcode-provider-env.test.ts` 的 D19 精确断言 `warnings.length === 1`，共享根一有同名入口就会红。按 CODEX-01 的统一隔离一并覆盖；glm 核销的四处（`fixture-repo-init`、`zcode-doctor-probe-home`、`preflight.test.ts` 的 `doctorEnvOnly`、`codex-wiring`）断言形态不受影响，照样纳入隔离（目的是「不读」，不只是「不飘」） | r2 §4.1 隔离面清单逐文件列出，含 `zcode-provider-env.test.ts`；U8 对账 |
| AGY-01 | gemini | minor | 接受 | 成立：隔离夹具下 `displayHomePath` 折叠不了夹具路径，告警会露出临时目录绝对路径、断言随机器漂 | r2 §2.2 / §2.3：`displayHomePath(p, home = os.homedir())` 加可选第二参（既有调用点不传、行为不变），共享读取面告警用扫描所用的同一个家目录折叠 |
| AGY-02 | gemini | minor | 接受 | 成立：`frozen_diff` 形态坏了（缺失、非对象、`text` / `sha256` 非字符串）或出现在非 code 阶段，应当是受控的 `envError`，不该是原生 `TypeError` | r2 §3.2：`unpackSnapshots` 先做形态校验——任一侧 `diffText === null` 而 `frozen_diff` 缺失或形态不合 ⇒ envError；`frozen_diff` 存在而 `stage !== 'code'` ⇒ envError；U7 加这三种篡改格 |
| AGY-03 | gemini | nit | 接受 | 防御性补强，代价为零：快照为空对象时 `every` 恒真 | r2 §3.1：`packSnapshots` 要求侧数 ≥ 1 且首侧 `diffText` 为字符串，才提取；U7 加空快照格 |
| AGY-04 | gemini | nit | 接受 | r1 写「返回值形状即 `InstallProblem` 子集」容易被读成从 `install.ts` 引类型；`src/trivium/` 不得反向依赖安装器 | r2 §2.1：共享模块自己声明 `EntryCollisionKind` 与 `EntryCollisionProblem`；`install.ts` 的 `InstallProblem['kind']` 改写为 `EntryCollisionKind` 并上其余三类（取值集合不变）；U4 加一条源码扫描：`src/trivium/` 下无 `from '../install` 一类引用 |

## 汇报要求（不是编号意见）

- CODEX-01 的落点引入了一个只为隔离而存在的环境变量 `TRIVIUM_ENTRY_SCAN_HOME`。它只改变共享读取面扫描读哪个家目录，只读、不写；会写进主设计与 RUNBOOK，代码双审时请审查判断这个口子是否合适。
