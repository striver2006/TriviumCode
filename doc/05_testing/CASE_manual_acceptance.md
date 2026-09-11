# CASE：人工验收剧本（PRD 场景 S1～S5）

> 对应 [设计 §17.3](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计-claude.md)。
> 自动化测试（`npm run check`，458 例）与 `trivium doctor --selftest`（14 步）**覆盖不到**下面这些，
> 因为它们要么需要人在 Claude Code 窗口里操作，要么必须真实消耗两侧厂商配额。

## 先做这一步

```bash
cd /path/to/你的项目
.trivium/bin/trivium doctor --selftest     # 零配额，14 步。不通过就别往下走
.trivium/bin/trivium preflight --stage all # 会真实探活两侧，消耗少量配额
```

`preflight` 退 0 才继续。它退 69 时会指出是探针过期、CLI 不可调用还是未认证。

> 下文 `TV` 指 `.trivium/bin/trivium`。全部剧本都会**真实消耗两侧配额**，
> 单次双审墙钟通常 2～15 分钟。

---

## 剧本 1 · 全程只开 Claude Code（S1）

**验什么**：开发者不需要打开 Antigravity 或 ZCode 的任何窗口。

**怎么做**

1. 关掉 Antigravity 与 ZCode 的 GUI 窗口（保留登录态即可，不要退出登录）。
2. 只开 VS Code + Claude Code。
3. 在 Claude Code 里输入：

   ```text
   /dual-run 给 <某个真实小功能> 加上 <某个约束>
   ```

4. 全程不切窗口，直到命令走完 S0～S10。

**判据**

| # | 判据 | 不通过说明什么 |
| :--- | :--- | :--- |
| 1.1 | 全程无需切到另外两个产品的窗口 | 有交互弹窗或需要手工授权 → headless 授权链路没配好 |
| 1.2 | 产出 `plan/` 四件套与 `code/` 三件套 | 缺件 → 跑 `TV gate --stage <阶段> --topic <主题> --check-artifacts` 看缺哪一份 |
| 1.3 | S10 的 `verify/` 记录里是**真实执行**的命令与退出码 | 没有 `verify/` → `.trivium/config.yaml` 的 `verify.build`/`verify.test` 还是空的 |
| 1.4 | 失败时如实报 `failed`，工件全部保留 | 报了成功却没有 verify 记录 → 属严重缺陷，请提 issue |

**注意**：命令 A **不设人工闸门**（PRD 4.4），它会一路跑到编译测试。
两条护栏仍在：审查期禁写业务文件、裁决未齐备不得收工。

---

## 剧本 2 · 进程与隔离实证（S2）

**验什么**：两侧真的以独立进程跑在项目根上；两侧原始输出落在**项目树之外**。

> ⚠️ **先读这一段，否则你会验出错误结论。** 2026-09-11 一次真实运行实测到：
>
> - **agy 的 `-p` 进程只活约 10 秒**，随后把工作交给一个常驻 **hub 进程**
>   （`agy --hub --hub-port=<n> --app_data_dir=antigravity --add-dir=<项目根>`）。
>   该 hub **跨运行复用**，实测启动时间比本次运行早 8.5 小时。
>   所以「运行期间 ps 一直能看到 `agy -p`」**不成立**（坑 P-17）。
> - **ZCode 把进程名改成 `zcode-cli`**（另有 `zcode-node-repl-mcp` 辅助进程），
>   `pgrep -f 'zcode\.cjs'` **恒为空**（坑 P-18）。
>
> 按旧写法验，两侧都会得出「进程没起来」的错误结论。

**怎么做**（需要两个终端）

终端 A —— 起一次审查：

```bash
TV=.trivium/bin/trivium
$TV review --start --stage plan --topic <你的主题> --focus "看并发与回滚" --json
# 记下返回的 run_id 与 run_dir
```

终端 B —— **立刻**开始轮询（`agy -p` 只有约 10 秒窗口）：

```bash
for i in $(seq 1 30); do
  date +%H:%M:%S
  ps -eo pid,command | grep -E 'zcode-cli|agy ' | grep -v grep | cut -c1-140
  sleep 5
done
```

抓到 pid 后取 cwd：

```bash
for p in $(pgrep -x zcode-cli) $(pgrep -f 'agy --hub'); do
  echo "pid $p cwd: $(lsof -a -d cwd -p $p -Fn 2>/dev/null | tail -1 | cut -c2-)"
  ps -p $p -o lstart=
done

# 项目树内**没有**本次对方结论
ls .reviews/<主题>/plan/          # 此刻不应出现 -gemini.md / -glm.md

# 项目外的运行目录里有两侧原始输出
ls -R ~/.trivium/runs/*/<run_id>/
```

**判据**

| # | 判据 | 依据 |
| :--- | :--- | :--- |
| 2.1 | 能看到 `zcode-cli` 进程；agy 侧能看到 `agy --hub …`（`agy -p` 若没抓到属正常，它只活约 10s） | 真的拉起了厂商 Agent，不是 LLM 补全 |
| 2.2 | 这些进程的 cwd 都是项目根 | 就地审查（ADR-001），不是镜像树 |
| 2.3 | agy hub 的命令行里带 `--add-dir=<项目根>` | 工作区授权的实际落点 |
| 2.4 | 审查进行中，`.reviews/<主题>/plan/` 里**没有** `-gemini.md` / `-glm.md` | 延迟落盘：对方本次结论在树内物理不存在（§10.1 第 ② 道） |
| 2.5 | `~/.trivium/runs/<repo_id>/<run_id>/{gemini,glm}/` 下有原始 stdout 与轨迹 | 原始日志可能含仓库片段，故留在项目外 |
| 2.6 | 两侧结论**同时**出现（不是一先一后） | 齐备后统一落盘 |

**一并注意 agy hub 的隔离含义**：hub 跨运行复用，因此「为每次运行准备独立
`HOME`」这类手段对它**不生效**。隔离结论一律以 `probe.agy.isolation` 为准，
不要假设每次运行都有独立的 agy 进程空间（P-17）。

> `lsof` 在部分 macOS 安全设置下需要授权。取不到 cwd 时，退而求其次看
> agy hub 命令行里的 `--add-dir`。

**同时可验**：审查进行中，让 Claude Code 改一个业务文件，
应被 `hook-pre-write` 以 exit 2 拦下并提示「审查进行中」。

---

## 剧本 3 · 三条命令都停在人工闸门（S3）

**验什么**：命令 B/C/D 跑完都**停住**，不自动往下走。

**怎么做**：在 Claude Code 里依次跑（每条都用真实主题）

```text
/dual-review-plan 看不可逆决策与回滚路径
/dual-review-code 看并发与错误处理
/dual-review-bug  看证据链是否闭合
```

每条跑完后：

```bash
TV=.trivium/bin/trivium
$TV status --topic <主题>          # 闸门状态应为 awaiting_approval
$TV gate --stage <阶段> --topic <主题> --check   # 应退 0
```

然后尝试改一个业务文件（让 Claude Code 去 Edit），**应被拦下**。

**判据**

| # | 判据 | 退出码 |
| :--- | :--- | :--- |
| 3.1 | 三条命令跑完都停在 `awaiting_approval`，不自动继续 | — |
| 3.2 | 闸门期改业务文件被 `hook-pre-write` 拦下，提示里给出 `/dual-approve` 与 `/dual-abandon` | `2` |
| 3.3 | 归档内的裁决件写入**不**被拦 | `0` |
| 3.4 | `/dual-approve` 之后业务写入解锁 | `0` |
| 3.5 | 命令 D 的工件落在 `bug/`，**不串到** `plan/` | — |

**特别注意 FR-22**：命令 D 不得由 A 或 C 代替。若某次根因分析是在 `/dual-run`
里顺带做的，它**没有**经过根因双审——不要把它当成审过。

---

## 剧本 4 · 换模型组合并回读生效值（S4 / AC-13 / AC-18）

**验什么**：`--model-*` 真的改变了生效模型，且**回读**到的值与指定一致；
用户 ZCode 桌面端的默认模型**未被改动**。

**怎么做**

```bash
TV=.trivium/bin/trivium

# 先记下 ZCode 桌面端当前默认模型，跑完要回来对
cat ~/.zcode/cli/config.json | python3 -m json.tool | grep -i model

# 第一次：用 profile 默认
$TV review --start --stage plan --topic <主题> --focus "第一轮" --json

# 第二次（同主题重跑）：换另一组模型
$TV review --start --stage plan --topic <主题> --focus "第二轮，换模型" \
   --model-gemini gemini-3.8-flash-high \
   --model-glm    GLM-5.3-Flash --json
```

可用取值以 `.trivium/config.local.yaml` 的 `probe.agy.models` /
`probe.zcode.models` 为准；写错会在启动前退 `64` 并列出全部可用值。

跑完对比两次的 `run.json`：

```bash
python3 - <<'PY'
import json,glob
for f in sorted(glob.glob('.reviews/<主题>/plan/_meta/run-*.json')):
    d=json.load(open(f))
    print(d['run_id'], d['rerun_index'])
    for k,v in d['critics'].items():
        print('  ',k,'请求',v['model_requested'],'→ 生效',v['model_effective'],
              '(来源',v.get('model_effective_source'),')','异构' if v['heterogeneous'] else '同构')
PY
```

**判据**

| # | 判据 | 说明 |
| :--- | :--- | :--- |
| 4.1 | 两次的 `model_effective` 不同，且与各自 `model_requested` 一致 | ZCode 侧生效值带 `<providerId>/` 前缀属正常（坑 C-02），后半段应匹配 |
| 4.2 | `model_effective_source` 是 `envelope` 或 `trace`，**不是** `requested` / `unverified` | `requested` 表示没回读到，等于没验证（AC-13） |
| 4.3 | 两侧 `heterogeneous: true` | 默认 profile 两侧都不是 Claude 系（AC-18） |
| 4.4 | `~/.zcode/cli/config.json` 的默认模型**与跑前一致** | 模型覆盖走独立 `HOME` 下的配置副本，绝不改用户全局配置 |
| 4.5 | 第二轮产出 `-r2-` 文件，第一轮文件**字节不变** | `shasum` 比对（FR-25 / P6） |

> 若把某侧显式指定为 `claude-*` slug（`agy models` 里确实有），编排器**不阻止**，
> 但会打醒目告警、在 `run.json` 写 `heterogeneous: false`、并在该侧文档头标注。
> 这条也值得单独验一次。

---

## 剧本 5 · 留痕删不掉也改不掉（S5 / P5 / P6）

**验什么**：已落盘的审查工件被删或被改之后，`git commit` 必须被拦下。

**怎么做**

```bash
TV=.trivium/bin/trivium
# 前提：某主题的 plan 阶段已跑完双审、裁决已通过 gate --check（闸门回 idle）

# ① 基线：此刻提交应放行
echo '{"session_id":"manual","tool_name":"Bash","tool_input":{"command":"git commit -m x"}}' \
  | $TV gate hook-pre-commit; echo "exit=$?"          # 期望 0

# ② 删掉一份审查文档
rm .reviews/<主题>/plan/<日期>-<主题>-gemini.md
echo '{"session_id":"manual","tool_name":"Bash","tool_input":{"command":"git commit -m x"}}' \
  | $TV gate hook-pre-commit; echo "exit=$?"          # 期望 2，并指出「已丢失」

# ③ 恢复后再试
git restore .reviews/<主题>/plan/<日期>-<主题>-gemini.md
echo '{"session_id":"manual","tool_name":"Bash","tool_input":{"command":"git commit -m x"}}' \
  | $TV gate hook-pre-commit; echo "exit=$?"          # 期望 0

# ④ 改动内容（不删）
echo '<!-- 偷偷加一行 -->' >> .reviews/<主题>/plan/<日期>-<主题>-glm.md
echo '{"session_id":"manual","tool_name":"Bash","tool_input":{"command":"git commit -m x"}}' \
  | $TV gate hook-pre-commit; echo "exit=$?"          # 期望 2，并报出前后哈希
git restore .reviews/<主题>/plan/<日期>-<主题>-glm.md
```

**判据**

| # | 判据 | 退出码 |
| :--- | :--- | :--- |
| 5.1 | 完整时放行 | `0` |
| 5.2 | 删掉任一**记录在案**的工件即拦下，并点名路径与它的 `run_id` | `2` |
| 5.3 | 改动内容同样拦下，并报出「记录 xxx，现为 yyy」 | `2` |
| 5.4 | 恢复后立即放行 | `0` |
| 5.5 | 从未跑过审查的仓库**不**被误拦 | `0` |

> 这条已有自动化用例（`test/integration/gate-loop.test.ts`），人工复核只是为了
> 确认在**真实归档**上同样成立。
>
> 确实要作废某一轮时用 `/dual-abandon --topic <主题>`——它保留工件、只解闸门。
> 重跑会自动抬升 `-r<N>`，既有工件一律不覆盖，**不需要先删**。

---

## 验收记录模板

把结果记进 `doc/05_testing/REPORT_<日期>_manual_acceptance.md`：

```markdown
| 剧本 | 判据 | 结果 | 证据 | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 1.1 全程不切窗口 | ✅ / ❌ | 截图或命令输出 |  |
```

**不通过时不要就地改判据**。先按 §16.2 纪律 1 判断：是实现错了，还是设计记载
与厂商实际行为不符。后者要回补修订设计文档，并把实测记进
[M0 本机坑清单](./REPORT_2026-09-11_m0_probe.md) 的冲突表。
