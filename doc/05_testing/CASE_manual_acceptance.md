# CASE：人工验收剧本（PRD 场景 S1～S8）

> 对应 [设计 §17.3](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md) 与演进设计 §13.3（手工验收剧本增补）。
> 自动化测试（`npm run check`）与 `trivium doctor --selftest`（14 步）**覆盖不到**下面这些，
> 因为它们要么需要人在编程 Agent 的会话窗口里操作，要么必须真实消耗厂商配额。
>
> 剧本 8～11 是 M11 第 10 步写入的（演进设计 §13.3 第 1、3、4 条与 PRD S8 / AC-23），**写入时尚未执行**，
> 执行随 M11 第 12 步全量手工验收；判据按写入时的设计口径给出，跑出来与判据不符时照模板末尾的规矩处理，不就地改判据。

## 先做这一步

M11 第12步前置（2026-10-09）：先完成接入路线准入，再执行全量剧本。Claude/Qwen、Kimi、DeepSeek 三批各12次，Codex官方及三profile一批12次，合计最多48次真实CLI启动（含help/version、失败、重试）；到上限停并记未测，不降低判据。准入逐路线核对读能力、工具白名单/MCP隔离、写入负对照、禁读检测、结构化输出与轨迹；另核对请求/实际入口、profile/模型/effort组合、供应商声明与回读来源。原生Claude真实验收待订阅恢复。

2026-10-10补测：旧额度48/48已耗尽，新增证据在 `evidence/agent-access-20261010-admission/`。初始准入32/审查16，用户已明确授权按需扩容；每次扩容独立记账，达到现行上限先停再记账扩容，不重置或跨池挪用。统一入口为 `node scripts/agent-access-launch.mjs <admission|review> <唯一标签> tv|probe ...`。逐路线核对真实写尝试、配对拒绝、文件状态；无尝试仍记未测。单独注册Write的权限诊断保存工具面偏差、实际deny设置、配对拒绝和文件状态；它不替代生产同形准入，权限拒绝也不凭错误文案追认为明确deny规则命中。Qwen pro须验证qwen3.8-max模型回读及完整只读准入后切配置；默认三审恢复只要求Claude/Qwen flash完整准入，不等待Kimi/DeepSeek。2026-10-10用户授权暂用qwen/kimi/deepseek；配置切换与恢复后组合预检另存provider-routing证据，七条全准入条件不变。正式审查每主题最多四轮；本任务不执行M11第12步。

新增契约剧本：显式null继承与单次覆盖、同侧native/profile冲突64、名单外profile统一64；真实子进程证明到执行端的组合、换路线/包装器后缓存失效；超时/取消/失败保留请求；跨Agent同族、同provider不同族、别名与缺Driver声明unknown；v1/v2历史不重写、v3贯通worker/gate/夹具审批/report/提交Hook。所有同族/未知场景告警继续。最终串行两次check与14/14桩自检，未测项明确标未测。

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
| 4.3 | 两侧 `heterogeneous: true` | 默认 profile 下各侧生效模型都不落在当轮 Driver 厂商的名义模型族——本剧本以 Claude Code 为 Driver，即都不是 Claude 系（AC-18）。判定按模型名，属启发式；`true` 的准确读法是「未检出同族」 |
| 4.4 | `~/.zcode/cli/config.json` 的默认模型**与跑前一致** | 模型覆盖走独立 `HOME` 下的配置副本，绝不改用户全局配置 |
| 4.5 | 第二轮产出 `-r2-` 文件，第一轮文件**字节不变** | `shasum` 比对（FR-25 / P6） |

> 若把某侧显式指定为**与当轮 Driver 厂商名义族同族**的模型（本剧本 Driver 是 Claude Code，即 `claude-*` slug，`agy models` 里确实有），
> 编排器**不阻止**，但会打醒目告警、在 `run.json` 写 `heterogeneous: false` 与 `override_reason`（文案点名当轮 Driver），
> 并在该侧文档头标注（渲染为「疑似与主脑同源」）。换一家当 Driver 时「同族」跟着换：例如 codex 为 Driver 时，
> 同族的是 OpenAI 名义族（模型名含 `gpt`），`claude-*` 反而判异构。判定按模型名、属启发式，
> 模型名不含族名时会漏判（BACKLOG EV-107）。这条也值得单独验一次。

---

## 剧本 5 · 留痕删不掉也改不掉（S5 / P5 / P6）

**验什么**：已落盘的审查工件被删或被改之后，`git commit` 必须被拦下。

**怎么做**

```bash
TV=.trivium/bin/trivium
# 前提：某主题的 plan 阶段已跑完双审、裁决已通过 gate --check。
#      注意闸门此刻**未必回 idle**：若这一轮是 /dual-review-plan（entry B）发起的，
#      --check 通过后闸门会立起 awaiting_approval（那正是命令 B 的停点）。
#      本剧本验的是提交拦截，两种状态下都该按下面的期望值走；
#      若想先回到 idle，用 /dual-approve --topic <主题> --stage plan 放行。

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

## 剧本 6 · Bash 旁路挡得住（P5 / P6）

**验什么**：`hook-pre-write` 只覆盖 Edit / Write，而写文件的路不止那一条。
`cat > f`、`sed -i`、`tee`、`git checkout -- f` 都能绕过去，`hook-pre-bash` 是补这个缺口的。
这是本轮加固的重点，自动化层有单测，但**真实归档上的表现值得人工确认一次**。

**怎么做**

```bash
TV=.trivium/bin/trivium
probe () {   # $1 = 要试的命令字符串
  printf '{"session_id":"manual","tool_name":"Bash","tool_input":{"command":%s}}' \
    "$(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
    | $TV gate hook-pre-bash; echo "  exit=$?  ← $1"
}

# ── A 组：编排器独占对象，闸门是否开着都该拦 ──
probe "rm .reviews/<主题>/plan/<日期>-<主题>-gemini.md"      # 期望 2
probe "sed -i '' 's/blocker/minor/' .reviews/<主题>/plan/<日期>-<主题>-glm.md"  # 期望 2
probe "echo x > .reviews/<主题>/plan/_meta/task.json"        # 期望 2
probe "rm -rf .trivium/bin"                                  # 期望 2
probe "cat <<'EOF' > .reviews/<主题>/plan/_meta/run-x.json
{}
EOF"                                                          # 期望 2（heredoc 不能逃逸）

# ── B 组：普通业务文件，只在闸门期拦 ──
probe "cat > src/foo.ts"        # 闸门期 2 / 闸门空闲 0
probe "git checkout -- src/"    # 闸门期 2 / 闸门空闲 0

# ── C 组：只读命令，任何时候都放行 ──
probe "git log --oneline -5"    # 期望 0
probe "grep -rn foo src/"       # 期望 0
```

B 组要各跑两遍：一遍在 `awaiting_approval` 或 `running` 期间，一遍在闸门空闲时。
用 `$TV status --json` 确认当前状态。

**判据**

| # | 判据 | 退出码 |
| :--- | :--- | :--- |
| 6.1 | 改角色后缀文件（删 / `sed -i`）任何时候都被拦 | `2` |
| 6.2 | 改归档 `_meta/` 或 `task.json` 任何时候都被拦 | `2` |
| 6.3 | 删 wrapper 或 `.trivium/` 的状态与锁被拦 | `2` |
| 6.4 | heredoc 藏起来的写入同样被拦（判定在未剥 heredoc 的原文上做） | `2` |
| 6.5 | 普通业务文件的写命令：闸门期拦、空闲放行 | `2` / `0` |
| 6.6 | 只读命令任何时候不误伤 | `0` |
| 6.7 | 删掉 wrapper 后再调任意工具，四个拦截型 Hook 报「护栏失效」而**不是**静默放行 | `2` |

> 6.7 单独试：`chmod -x .trivium/bin/trivium` 后随便跑一个 Edit，应看到修复指引；
> `chmod +x` 恢复。**不要在这一步真的 `rm -rf` wrapper**，恢复要重跑 `trivium init`。
>
> 拦截是**启发式**的，不求完备——它挡住顺手的旁路。真绕过去了，改动仍会被跑后复算
> 判成漂移，整次审查可能作废（剧本 3 验的就是这件事）。

---

## 剧本 7 · 换一家 Agent 主攻（S6 / AC-21 / FR-28）

**验什么**：在另一家编程 Agent **自己的会话里**发起命令 B（或 C），由它起草与裁决、其余几家只读审查；
工件命名、闸门停点、逐条裁决与 Claude Code 主攻时一致；护栏等级如实分级，并在停点话术里明示。
M10b 第 4 步已按此验收过 ZCode（命令 B）与 Codex（命令 C）两家（[报告](./REPORT_2026-09-25_m10b_step4.md) §1.4、§1.5），这里是可复用的人工剧本。

**前提**：该家的入口已装（`node dist/install.cjs --targets <id>`）；项目已 `init`（ZCode 主攻还要有 `.zcode/config.json`）；
`TV preflight --stage plan --driver <id>` 退 0。

**怎么做（以 ZCode 主攻命令 B 为例）**

1. ZCode 桌面端打开项目，**先点信任、再新建会话**；第一句只发「本轮不要使用子代理（Agent 工具），所有操作由你直接执行。」
2. 让会话认领：`.trivium/bin/trivium topic claim --topic <主题> --stage plan --driver glm --json`，期望退 0；
3. 让会话用 Write 写原稿 `.reviews/<主题>/plan/<日期>-<主题>-glm.md`（先认领再写，否则会被 Hook 当成伪造件拦下）；
4. 发 `/dual-review-plan <提示语> --topic <主题>`，等它走完预检 → 解析 → `--start` → `--wait` → 读审查 → 写 `…-revised-glm.md` → `gate --check` → `--await-approval`；
5. （可选）让会话用 Write 新建一个 `…-codex.md`，应被 Hook 拒绝；
6. 会话结束后**立刻**把 `~/.zcode/cli/rollout/model-io-sess_<id>.jsonl` 拷走——那个目录只留最近 3 个会话，拷完之前别再开 ZCode；
7. 在终端里造缺件、造改工件各一次，`approve` 均应退 2；复原后由你决定是否审批。

**Codex 主攻（命令 C）的差别**：`codex -s danger-full-access -C <项目根>` 起会话；调用写 `$dual-review-code …`；
要先交代别的事就单独发一条，那一条里不要出现 `$名字`（一提到就会注入 skill 全文）；Codex 没有 Hook，第 5 步那类写入不会被拦——这是预期，不是缺陷。

**判据**

| # | 判据 | 怎么看 |
| :--- | :--- | :--- |
| 7.1 | 原稿、修订件（或应答件）的后缀 = 当轮 Driver，front-matter `role` 同 | 文件名与 front-matter |
| 7.2 | `run.json.driver` = 该家、`driver_enabled: true`、`driver_guard_level` 与 QUICKSTART §5.2 的表一致 | `_meta/run-<run_id>.json` |
| 7.3 | 审核者集合不含当轮 Driver（缺省即另外两家） | `critics_selected` |
| 7.4 | plan / bug 阶段 `task.json.drivers.<阶段>.driver` = 该家 | `task.json` |
| 7.5 | 停点话术的调用写法与末句按该家的等级措辞（ZCode「只作尽力拦截、不兜底」；Codex / Antigravity「没有 Hook 拦截」） | `--await-approval` 的 **CLI 原文**——会话转述时可能改措辞 |
| 7.6 | 造缺件、造改工件各一次，`approve` 均退 2 | 终端输出 |
| 7.7 | 提示语保真：会话留痕里你发出的原文，与 `run.json.topic`、BRIEF 第 2 段焦点逐字一致 | ZCode rollout；Codex 为 `~/.codex/sessions/**/rollout-*.jsonl` |
| 7.8 | ZCode：会话留痕里 `review --start` 出自该会话，且没有 `model-io-sess_subagent_*` | rollout |

> **已知边界**：闸门期改业务文件，审批前复核与跑后漂移复算两道机制都发现不了（BACKLOG EV-132），所以本剧本的判据里不设这一格——它会「通过」。
> 停点与 `approve` 会打印一段工作树改动摘要、列出这类改动（只告知、不拦），专门演示见剧本 9。
> Antigravity 目前只以名义 Driver 验收过，照本剧本在它自己的会话里跑属于首次，请照实记录。

---

## 剧本 8 · 三审 + 指定 Codex 厂商 profile + 换家族（S7 / AC-20 / FR-27，演进 §13.3 第 1 条）

**验什么**：三个审核者一起审，三家前缀的意见都被逐条裁决、过得了闸门；`--profile-codex` 真的决定了 codex 以哪个厂商 profile 发起；
换一个模型家族重跑，回读到的生效模型与 provider 随之变化。

**前提**：`$CODEX_HOME`（不设即 `~/.codex`）下有两个分属不同家族、都配了凭据的 profile，下文记作 `<A>`、`<B>`；
`TV doctor --only codex` 的 profile 名单里有这两个、且都显示「有可用凭据」；从 `.trivium/config.local.yaml` 的
`probe.cli.codex.models_by_profile` 里各挑一个模型，记作 `<模型A>`、`<模型B>`。

**怎么做**（Claude Code 主攻）

```bash
TV=.trivium/bin/trivium

# ① 预检（会真实探活，花少量配额）：两组都应退 0
$TV preflight --stage plan --critics gemini,glm,codex --profile-codex <A> --model-codex <模型A>
$TV preflight --stage plan --critics gemini,glm,codex --profile-codex <B> --model-codex <模型B>

# ② 负对照（可选）：只换 profile、不换模型，<模型A> 不在 <B> 的目录里时应退 64 并列出 <B> 目录的可用值
$TV preflight --stage plan --critics gemini,glm,codex --profile-codex <B> --model-codex <模型A>
```

1. 在 Claude Code 里发 `/dual-review-plan <提示语> --topic <主题> --critics gemini,glm,codex --profile-codex <A> --model-codex <模型A>`；
2. 审查进行中，在终端里看一眼 codex 子进程：`ps -ax -o pid,args | grep '[c]odex exec'`，把那一行记下来；
3. 让 Driver 读三份审查、写裁决件（三家前缀的每一条都要有一行），`gate --check` 通过后 `/dual-approve`；
4. 同一主题再发一次，换成 `--profile-codex <B> --model-codex <模型B>`，同样走到审批。

**判据**

| # | 判据 | 怎么看 |
| :--- | :--- | :--- |
| 8.1 | 两轮的 `critics_selected` 都是三家，三份审查文档（`-codex` / `-gemini` / `-glm` 后缀）齐备 | 运行记录与归档目录 |
| 8.2 | 裁决件覆盖三家前缀的全部编号，`gate --check` 退 0；任删一行再跑应退 2 并点名缺的编号（跑完复原） | 终端输出 |
| 8.3 | 第一轮 codex 侧 `profile_requested` = `<A>`，第 2 步记下的子进程参数里有 `-p <A>` 与 `-m <模型A>` | 运行记录与 `ps` 输出 |
| 8.4 | 第二轮 codex 侧 `profile_requested` = `<B>`；`model_effective` 与 `<模型B>` 一致、与第一轮不同；`model_effective_source` 不是 `requested` / `unverified` | 运行记录 |
| 8.5 | 两轮 codex 侧的 `model_provider` 不同；两个 profile 指向的 provider `base_url` 互异 | 运行记录；`base_url` 只 `grep` 这一个键，**不要整份打印配置文件**（里面有凭据） |
| 8.6 | 第二轮产出 `-r2-` 文件，第一轮文件字节不变 | `shasum` 比对 |

> 「生效模型不同」不足以说明换了家族：codex 不校验 `-m` 与 `-p` 的对应，同一个模型名可以挂在两个 provider 下（坑 P-24），所以 8.4 与 8.5 逐分量各核一次。

---

## 剧本 9 · Codex 主攻，闸门期改业务文件（S6 / AC-21，演进 §13.3 第 3 条）

**验什么**：Codex 主攻（护栏 L2、没有 Hook）时，闸门期改业务文件**事前没有任何拦截**、审批前复核照样通过，
而审批时打印的工作树改动摘要把这次改动列出来——护栏差异如实演示，不是缺陷。

**前提**：同剧本 7 的 Codex 部分（入口已装、项目已 `init`、`TV preflight --stage plan --driver codex` 退 0）；
选一个**已被 Git 跟踪**、在归档根与 `.trivium/` 之外的业务文件，下文记作 `<业务文件>`。

**怎么做**

1. `codex -s danger-full-access -C <项目根>` 起会话；让会话认领 `TV topic claim --topic <主题> --stage plan --driver codex --json`（退 0），再写原稿 `…-codex.md`；
2. 发 `$dual-review-plan <提示语> --topic <主题>`，等它走到停点（`--await-approval`），把停点输出原文留下；
3. **闸门期**：让会话（或你在终端里）给 `<业务文件>` 末尾加一行；
4. 在终端里 `TV approve --topic <主题> --stage plan`，把输出原文留下；
5. 对照（可选，会再花一轮配额）：同主题再发一轮，这次在 `--start` 之后、审查收尾之前改 `<业务文件>`，看该轮运行记录。

**判据**

| # | 判据 | 怎么看 |
| :--- | :--- | :--- |
| 9.1 | 第 3 步的修改没有被任何机制拦下 | 会话 / 终端。Codex 没有 Hook，这是预期（L2），记录即可 |
| 9.2 | 停点话术的末句按 Codex 的等级措辞（「没有 Hook 拦截」一类），与 QUICKSTART §5.2 的表一致 | 第 2 步的 CLI 原文 |
| 9.3 | 第 4 步 `approve` 退 0：审批前复核只核裁决齐备与本轮登记工件的 sha256，不看工作树 | 终端输出 |
| 9.4 | 第 4 步的输出里有「工作树改动摘要」，列出 `<业务文件>`；把第 3 步的改动先提交再审批，摘要照样列出 | 终端输出（摘要的基线是该轮运行记录的 `snapshot.after_tree_hash`） |
| 9.5 | 该轮运行记录的 `snapshot.drift.changed` 仍为 `false`：跑后漂移复算在审查收尾时做，闸门期的改动不进这一格，运行记录之后也不再回写 | 运行记录 |
| 9.6 | （对照）第 5 步那一轮 `snapshot.drift.changed` 为 `true`，`policy` 与 MANUAL §5.3「漂移」的默认组合一致（不在被审范围内的文件缺省只告警） | 运行记录与终端告警 |

> 演进设计 §13.3 第 3 条原写「跑后 drift 留痕可见」。按现行实现，闸门期的改动由审批时的工作树改动摘要露出，不进 `snapshot.drift`（跑后复算发生在闸门期之前）；
> 本剧本按现行实现给判据（9.4、9.5），审查进行中改动才会进 drift（9.6）。

---

## 剧本 10 · 同一主题先后换 Driver，复盘不串档（S6 / FR-28，演进 §13.3 第 4 条）

**验什么**：同一主题的两个阶段分别由 Claude Code 与 ZCode 主攻，`report` 按 Driver 分组时各计各的：
裁决件按该轮 Driver 的后缀定位，不把一家的裁决记到另一家名下。

**前提**：剧本 7 的 ZCode 部分已能走通；准备一处可审的业务代码改动（code 阶段的被审对象是 `git diff`）。

**怎么做**

1. Claude Code 里发 `/dual-review-plan <提示语> --topic <主题>`，裁决（`…-revised-claude.md`）、通过闸门、审批；
2. 负对照：终端里 `TV topic claim --topic <主题> --stage plan --driver glm --json`，应退 64——该阶段已有 claude 的运行留痕，同一阶段不能换 Driver（出口是换阶段或新开主题）；
3. ZCode 桌面端按剧本 7 的步骤开会话，改一处业务代码，发 `/dual-review-code <提示语> --topic <主题>`，写应答件（`…-response-glm.md`）、走到停点、审批；
4. 终端里 `TV report --topic <主题>` 与 `TV report --topic <主题> --json`。

**判据**

| # | 判据 | 怎么看 |
| :--- | :--- | :--- |
| 10.1 | 第 2 步退 64 | 终端输出 |
| 10.2 | plan 轮运行记录 `driver` = `claude`，code 轮 `driver` = `glm`；code 轮 `critics_selected` 不含 `glm` | 两轮运行记录 |
| 10.3 | 复盘第二节「按 Driver」表有 claude / plan 与 glm / code 两行（另各有合计行），**没有**「读不到 Driver」组 | `report` 人读输出 |
| 10.4 | 两行的已裁决与接受 / 驳回 / 暂缓分别等于 `…-revised-claude.md` 与 `…-response-glm.md` 裁决表的行数——各自按本轮 Driver 后缀定位，不串档 | 对照两份裁决件 |
| 10.5 | 各 Driver 组接受 / 驳回 / 暂缓之和 = 第二节全主题采纳率的分子与分母 | `report` 人读输出 |
| 10.6 | 「按审核者」表里 glm 的入选轮次只算 plan 轮（code 轮它是 Driver、不入选） | `report` 人读输出 |
| 10.7 | `--json` 的 `aggregates.byDriver` 恰有 claude 与 glm 两组，`aggregates.unknownDriver` 没有轮次 | `--json` 输出 |

---

## 剧本 11 · 按任务选思考深度并回读核对（S8 / AC-23 / FR-30）

**验什么**：逐审核者「选档」与「精确指定模型 + 思考等级」两种发起方式都能核对：档位名与来源、请求的思考等级、
生效模型与**回读到的**生效思考等级都入档，且彼此一致；写错的组合在发起前退 64、零工件。

**前提**：在 `.trivium/config.yaml` 给 codex 与 gemini 各配好至少两档（写法见 QUICKSTART §4「按档位选模型与思考深度」；gemini 的档用带 `-low` / `-medium` / `-high` 后缀的模型名，codex 的档写 `effort`）；
档位表 `profiles` 里两家本阶段的格子保持裸模型名（`init` 的缺省形态）；`TV doctor --only codex` 已刷新，`probe.cli.codex.reasoning_levels` 里有所选模型的可选值。
AC-23 的达成边界（PRD）：生效思考等级只有 gemini 回读得到，codex、claude 记 `null`、来源 `unverified`，ZCode 没有思考等级——本剧本照此给判据。

**怎么做**

```bash
TV=.trivium/bin/trivium

# ① 负对照（前三条应退 64、第四条退 69，见判据 11.1；.reviews/<主题>/ 下不出现新文件；预检在失败那一格就停，不探活）
$TV preflight --stage plan --critics codex,gemini --tier-codex <本侧没定义的那一档>
$TV preflight --stage plan --critics codex,gemini --effort-codex <不在该模型可选值里的值>
$TV preflight --stage plan --critics codex,glm --effort-glm high
$TV preflight --stage plan --critics codex,gemini --profile-codex <本机没有的名字>
```

1. **选档**：发 `/dual-review-plan <提示语> --topic <主题> --critics codex,gemini --tier-codex <档1> --tier-gemini <档2>`；审查进行中 `ps -ax -o pid,args | grep '[c]odex exec'` 记下 codex 的参数；走到停点；
2. **精确指定**：同主题再发一轮，`--critics codex,gemini --model-codex <模型> --effort-codex <值> --model-gemini <带后缀的模型名>`，另加一次 `--effort-gemini <与后缀不同的值>` 看告警；
3. （可选）把档位表里 codex 本阶段的格子改成 `{tier: <档3>}`，不带档位旗标再发一轮，跑完改回；
4. 每轮跑完 `TV report --topic <主题>`。

**判据**

| # | 判据 | 怎么看 |
| :--- | :--- | :--- |
| 11.1 | 四条参数负对照均退 64；明确不存在的 profile 在预检与准备阶段同样先退 64（EV-232），凭据、服务、入口或只读能力不可用另退 69。四条都列出可用值或点名原因，主题目录下没有新文件 | 终端输出、`ls` |
| 11.2 | 第 1 轮两侧 `tier` = 所选档、`tier_source` = `cli`；`model_requested` 与 `effort_requested` 等于该档里写的值；codex 侧 `profile_requested` 等于该档的 `profile`（档里没写则为 `agents.codex.profile`） | 运行记录 |
| 11.3 | 第 1 轮 codex 子进程参数含 `-c model_reasoning_effort=<该档的 effort>`，以及该档 profile 的 `-p` | 第 1 步记下的 `ps` 输出 |
| 11.4 | 第 2 轮两侧 `tier: null`、`tier_source: override`（基础组合是裸模型名，只提供模型，被精确值全部盖掉）；`effort_requested` 等于命令行的值 | 运行记录 |
| 11.5 | gemini 侧 `effort_effective` 等于实际模型名的档位后缀、来源 `envelope`；第 2 步另给的 `--effort-gemini` 只告警，`effort_requested` 照记、`effort_effective` 仍取后缀 | 运行记录与预检告警 |
| 11.6 | codex 侧 `effort_effective: null`、`effort_effective_source: unverified`（请求值照记，不拿请求值充数） | 运行记录 |
| 11.7 | （可选的第 3 步）该轮 codex 侧 `tier` = `<档3>`、`tier_source` = `profile` | 运行记录 |
| 11.8 | 各侧审查文档 front-matter 的 `tier` / `tier_source` / `effort_requested` / `effort_effective` / `effort_effective_source` 与运行记录同值；顶层 `profile` 是本轮的档位表名 | 审查文档头与运行记录 |
| 11.9 | `report` 第四节的「思考等级请求 / 生效」两列与运行记录一致，`null` 与字段缺席写法分开 | `report` 人读输出 |

> 本剧本只核「入档且一致」，不判生效值对不对：codex 侧的归并发生在厂商服务端、客户端看不到（PRD AC-23 达成边界）。
> 运行记录指归档阶段目录下的 `run-<run_id>.json`。

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
[本机坑清单](../04_development/GUIDE_local_pitfalls.md)（`P-xx`；[M0 探针报告](./REPORT_2026-09-11_m0_probe.md) §8 的冲突表是 M0 快照，不再追加）。

### Claude 三供应商补测记录口径（2026-10-10）

[本批结果](./REPORT_2026-10-10_claude_three_providers.md)按 profile × 实际请求模型拆分，DeepSeek V4 pro 不替代 flash，Kimi k3 不替代 coding。生产写负对照仍要求实际非法工具调用、配对错误、精确隔离目标前后未生成；注册 Write 的诊断及本地模拟供应商响应均单列，不自动替代真实模型尝试。能力臂传完整生产 Schema；禁读集合直接用生产 enumerateDenyPaths 并核对全部夹具工件，Read/Grep 逐目标取证，事后检测不删除。根目录 Grep 空结果、模型自述“通过”与文件不存在均不能单独判通过。超时保留原始拒绝事件但整个能力臂记未完成。

Codex默认官方路线配置验收：合并共享/本机配置后，default、flash、pro各plan/code/bug共九格均须解析profile=null，模型按档分别为gpt-6.1-sol、gpt-6-luna、gpt-6-astra；由doctor核对当前版本及读取/只读能力，再走编排器preflight。不得沿用0.160.1探针或保留Kimi模型配官方入口；全局配置与登录文件hash前后核对；漂移须记录且不得追认旧完整指纹结论，CLI启动另记持久预算。
