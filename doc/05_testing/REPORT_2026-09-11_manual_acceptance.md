# REPORT：人工验收执行结果（2026-09-11）

> 依据 [`CASE_manual_acceptance.md`](./CASE_manual_acceptance.md) 与设计 §17.3。
> 执行环境：macOS 25.6.0 ｜ node v25.2.1 ｜ `agy` **1.2.0** ｜ `zcode.cjs` **0.16.5**。
> 本次**真实消耗两侧厂商配额**：共 6 次双审（含 3 次失败/中止）+ 3 次认证探活。

---

## 总览

| 剧本 | 结论 | 说明 |
| :--- | :--- | :--- |
| 1 · 全程只开 Claude Code | ⚠️ **部分** | 编排器侧全链路已实测走通；`/dual-run` 这一层需由使用者在 Claude Code 窗口里跑（入口 skill 标了 `disable-model-invocation: true`，Driver 不自行调用） |
| 2 · 进程与隔离实证 | ✅ **通过（并推翻了原判据）** | 实测结果与剧本原文不符，已据实重写剧本并补 P-17 / P-18 |
| 3 · 三条命令停在人工闸门 | ⚠️ **部分** | AC-14 已有端到端自动化用例（bug 阶段闸门期改代码被 deny → approve 解锁）；三条 `/dual-*` 命令各跑一次真实审查未做，成本高 |
| 4 · 换模型并回读生效值 | ✅ **通过** | 5 条判据全中，见下 |
| 5 · 留痕删不掉也改不掉 | ✅ **通过** | 在**真实归档**上五步全对 |

**本次真实运行共逮到 6 个缺陷**（全部已修并提交），是本轮最主要的产出——
它们无一能被桩适配器或单元测试发现。清单见末节。

---

## 剧本 2 · 进程与隔离实证

**判据结果**

| # | 判据 | 结果 | 实测证据 |
| :--- | :--- | :--- | :--- |
| 2.1 | 两侧确有独立进程 | ✅ | `zcode-cli` pid 97109（启动 10:08:27，与 run 起始同秒）；agy 侧 `agy -p <BRIEF…>` pid 97108 |
| 2.2 | cwd 为项目根 | ✅ | 三个进程 `lsof -a -d cwd` 均为 `/Users/chenzhenbo/Work/TriviumCode` |
| 2.3 | agy hub 带 `--add-dir=<项目根>` | ✅ | `agy --hub --hub-port=59812 --app_data_dir=antigravity --add-dir=/Users/chenzhenbo/Work/TriviumCode` |
| 2.4 | 审查进行中树内无对方结论 | ✅ | 轮询期间 `.reviews/<主题>/code/` 下 `-gemini.md`/`-glm.md` 计数恒为 0 |
| 2.5 | 原始输出在项目外 | ✅ | `~/.trivium/runs/TriviumCode-2217d505/<run_id>/{gemini,glm}/` |
| 2.6 | 两侧结论同时出现 | ✅ | 两份 `.md` 在同一次落盘批次产生 |

**原剧本被实测推翻的两处**（已补为坑 P-17 / P-18 并重写剧本）：

1. **`agy -p` 只活约 10 秒**，随后工作转交常驻 **hub 进程**；该 hub 在本次运行之前
   就已存在（启动于前一天 23:34，早于本次运行 8.5 小时）。
   所以「运行期间 `ps` 一直能看到 agy」不成立。
   **更要紧的含义**：hub **跨运行复用**，因此「为每次运行准备独立 `HOME`」
   这类隔离手段对它**不生效**。
2. **ZCode 把进程名改成 `zcode-cli`**（另有 `zcode-node-repl-mcp` 辅助进程），
   `pgrep -f 'zcode\.cjs'` **恒为空**。按原判据验会误得「ZCode 没跑起来」。

---

## 剧本 4 · 换模型并回读生效值

在 `doctor --selftest --keep-fixture` 留下的小夹具仓库里跑（项目小、两侧快；
`config.local.yaml` 从主仓库复制，探针是本机级结论，不必重跑 doctor）。

| 轮 | 侧 | 请求 | **回读到的生效模型** | 来源 | 耗时 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| r2 | gemini | `gemini-3.1-pro-high` | `gemini-3.1-pro-high` | `envelope` | 61s |
| r2 | glm | `GLM-5.3` | `bigmodel-coding-plan/GLM-5.3` | `trace` | 331s |
| r3 | gemini | `gemini-3.8-flash-high` | `gemini-3.8-flash-high` | `envelope` | 130s |
| r3 | glm | `GLM-5.3-Flash` | `bigmodel-coding-plan/GLM-5.3-Flash` | `trace` | 360s |

| # | 判据 | 结果 |
| :--- | :--- | :--- |
| 4.1 | 两次生效模型不同且与各自请求一致 | ✅ ZCode 侧带 `bigmodel-coding-plan/` 前缀属正常（C-02），后半段匹配 |
| 4.2 | 来源是 `envelope` / `trace`，不是 `requested` / `unverified` | ✅ 四条全部有实证来源 |
| 4.3 | 两侧 `heterogeneous: true` | ✅ 四条全 true |
| 4.4 | ZCode 桌面端默认模型未被改动 | ✅ `~/.zcode/cli/config.json` sha256 跑前跑后均为 `2aea2d84aee8401e` |
| 4.5 | 第二轮抬 `-r<N>`，既有工件不覆盖 | ✅ 目录下并存 `-gemini.md` / `-r2-*` / `-r3-*` 共 5 份，互不相同 |

---

## 剧本 5 · 留痕删不掉也改不掉

在**真实归档**（`.reviews/M4-M5实现/code/`）上执行：

| 步骤 | 期望 | 实测 |
| :--- | :--- | :--- |
| ① 归档完整时提交 | `0` | ✅ `0` |
| ② 删掉 `…-r3-glm.md` | `2` + 点名路径与 run_id | ✅ `2`，报「已丢失：…（run 20260911T025329Z 记录过它，sha256 fe92c00a91ab）」 |
| ③ 恢复后 | `0` | ✅ `0` |
| ④ 追加一行改动内容 | `2` + 前后哈希 | ✅ `2`，报「记录 fe92c00a91ab，现为 d40525728d6d」 |
| ⑤ `git restore` 后 | `0` | ✅ `0` |

---

## 剧本 1 / 3 的未尽部分

| 缺什么 | 为什么本次没做 | 谁来做 |
| :--- | :--- | :--- |
| 在 Claude Code 里真打一次 `/dual-run` | 七个入口 skill 都标了 `disable-model-invocation: true`——Driver **不应**自行调用它们，这正是设计要的。编排器侧的 S0～S10 各步已逐个实测 | 使用者，按剧本 1 |
| `/dual-review-plan` `/dual-review-code` `/dual-review-bug` 各跑一次真实审查并停在闸门 | 三次真实双审约 40～60 分钟且消耗可观配额；闸门行为本身已有端到端自动化覆盖（`gate-loop.test.ts` 7 例、`bug-stage.test.ts` 7 例含 AC-14 全链路） | 使用者，按剧本 3 |

---

## 本次真实运行逮到的缺陷（均已修复并提交）

无一能被桩适配器或单元测试发现——它们要么依赖厂商真实行为，要么依赖多进程真实时序。

| # | 缺陷 | 后果 | 提交 |
| :--- | :--- | :--- | :--- |
| 1 | **agy 1.2.0 拒绝「自带档位的 slug + `--effort`」**（P-16） | gemini 侧 5.6s 非零退出、白烧一次调用，strict 下整次作废。plan 阶段恰好 slug 与 effort 都是 `high` 所以从未暴露 | `ef80ad8` |
| 2 | **`status.json` 逐侧状态硬编码 `'ok'`** | 一侧硬失败时 `--wait`/`--status` 仍显示「gemini: ok」，而 run.json 里是 failed | `ef80ad8` |
| 3 | **code 阶段摘要里 HEAD 恒显示 `—`** | 摘要信息缺失 | `ef80ad8` |
| 4 | **`--cancel` 只杀 worker，厂商进程被遗弃给 init** | 取消之后 `zcode-cli` 的 PPID 变成 1 且**仍在烧配额**。改为按进程组发信号 | `5476238` |
| 5 | **「修改计划」列名不被闸门识别** | 照着**随仓库分发的** `response.md.template` 写应答件，必然被自己的闸门判成「接受但没写落点」 | `c515275` |
| 6 | **agy 吐两个相接 JSON 对象 → 每次降级 `parse_fallback`** | 一份合格的 6 条意见结论**每次**失去阻断资格；本次就因此丢了 gemini 独有的 blocker（AGY-02） | `68a9c1f` |

另有一条运维事实值得记住：`.trivium/bin/trivium` 指向的是**已安装副本**，
改完代码只 `npm run build` 不 `node dist/install.cjs`，跑的还是旧产物——
本次因此白跑一次真实审查。已写进 [`GUIDE_env_setup.md`](../04_development/GUIDE_env_setup.md)。

---

## 顺带产出：一次真实的代码双审

对 M4+M5 全部变更（48 文件 / 277 KB 补丁）跑 `--stage code`，两侧在背靠背状态下
**独立收敛到同两处**：

- worker 异常退出不回收闸门，业务写锁挂到 24h TTL（GLM-r2-02 ≡ AGY-01）
- 留痕完整性核对的清单来自被核对对象自身，可整枝绕过（GLM-r2-03 ≡ AGY-04）

共 16 条意见（glm 10 + gemini 6），已逐条裁决：接受 14、驳回 1、暂缓 1。
驳回的那条附了实测反证。裁决件见
`.reviews/M4-M5实现/code/2026-09-11-M4-M5实现-r3-response-claude.md`，
`gate --stage code --check` 已通过。

**已接受但尚未实施的修改计划共 14 条**，落点逐条写在裁决件里——这是下一步的工作。
