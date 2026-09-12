# 快速上手：Driver-DualCritic 双审流水线

> 目标：**15 分钟内**装好并跑通一条真实任务。
> 依据 [设计 v1.2.1](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计-claude.md) 与 [PRD v1.3.0](../01_requirements/PRD_driver_dual_critic.md)。

这条流水线让 Claude Code 主攻写代码，**Google Antigravity** 与**智谱 ZCode** 两个
独立审查员背靠背复审，结论逐条落盘留痕。你的角色是 Driver 的使用者——按 `/dual-*`
命令走，编排器负责并行、超时、隔离、防覆盖与闸门。

---

## 0. 前置条件

| 项 | 要求 | 怎么确认 |
| :--- | :--- | :--- |
| 操作系统 | **macOS**（一级平台）。Linux / Windows 未验证 | — |
| Node.js | ≥ 18 | `node --version` |
| git | 任意近期版本 | `git --version` |
| Claude Code | 已安装并能用 | — |
| Antigravity CLI | `agy` 可调用且**已登录** | `agy --version` |
| 智谱 ZCode | 桌面应用已安装，CLI 凭据已配置 | `ls ~/.zcode/cli/config.json` |

**关于凭据**：两侧的登录由你自己完成（`agy` 的交互登录、ZCode 的 `zcode login` 或
provider 配置）。编排器只读取已有登录态，从不代你写凭据，也不会把凭据写进任何工件——
落盘前有密钥扫描，命中即拒绝落盘（NFR-04）。

---

## 1. 安装（约 2 分钟）

```bash
git clone <本仓库> TriviumCode && cd TriviumCode
npm install
npm run build          # esbuild 打出单文件零依赖产物
node dist/install.cjs  # 装到用户级目录
```

安装器做三件事，全部幂等：

| 装到哪 | 内容 |
| :--- | :--- |
| `~/.claude/skills/dual-critic/` | 核心 skill + 编排器 `scripts/trivium.cjs` + schema / 镜头 / 阶段要点 / 模板 / 协议片段 |
| `~/.claude/skills/dual-*/` | 7 个入口 skill（`/dual-run`、`/dual-review-plan` …） |
| `~/.gemini/config/agents/trivium-critic/` | Antigravity 的只读审查 Agent 定义 |

> `trivium` **不在 PATH 上**，这是有意的。项目内一律用 `.trivium/bin/trivium`
> （下一步由 `init` 生成，内含 node 绝对路径——GUI 启动的进程不读你的 `~/.zshrc`）。

### 先自检一次

```bash
node ~/.claude/skills/dual-critic/scripts/trivium.cjs doctor --selftest
```

它在临时夹具仓库里**真跑**一遍整条流水线（双审 → 闸门拦截 → 补裁决 → 闸门放行 →
编译测试 → 复盘 → 重跑不覆盖），14 步逐一核对退出码。两侧走桩适配器，**不消耗厂商配额**。

它**证明不了**两家 CLI 可用——那是下一步 `doctor` 的事。输出里会写明这条边界。

---

## 2. 探针实测（约 3 分钟，会消耗少量厂商配额）

```bash
cd <你的项目>
node ~/.claude/skills/dual-critic/scripts/trivium.cjs doctor
```

两家 CLI 的参数与行为随版本漂移，所以实现代码**只读探针结论，绝不硬编码命令行**
（设计原则 P7）。`doctor` 逐项实测设计 §3.5 的探针清单，把结论写进 `.trivium/config.local.yaml`
的 `probe:` 段（不进 Git，因为它随机器而异）。

想先不烧配额，可以 `doctor --no-model-calls` 只做静态探测；但模型调用相关的结论
会留空，`preflight` 随后会报环境不可用。

---

## 3. 在项目里启用（约 1 分钟）

```bash
node ~/.claude/skills/dual-critic/scripts/trivium.cjs init
```

生成 / 合并（全部幂等，不覆盖你已有的内容）：

```
.trivium/
├── bin/trivium          # wrapper，项目内统一入口（内含 node 稳定路径）
├── config.yaml          # 团队共享策略，进 Git
└── config.local.yaml    # 探针结论，由上一步 doctor 写入，不进 Git
.claude/settings.json    # 五个 Hook 的注册（随仓库分发）
.gitignore               # 追加 .trivium 的本机状态项
CLAUDE.md / AGENTS.md    # 追加协议片段，标记括起，可重复运行
```

### 必须补一步：配置编译测试命令

`init` 会提示 `verify.build` / `verify.test` 留空。编排器**只执行**你显式写进
`.trivium/config.yaml` 的命令，**绝不猜测执行**——`scripts.test` 完全可能耗时极长、
依赖外部服务或有副作用（§14.1）。

```yaml
verify:
  build: ['npm run typecheck', 'npm run build']
  test:  ['npm test']
```

两者皆空时 `/dual-run`（命令 A）会拒绝启动：跑完全流程却无法收口没有意义。

### 确认 Hook 能随仓库走

```bash
git check-ignore -v .claude/settings.json   # 应命中 !.claude/settings.json 这条否定规则
```

### 升级与卸载

```bash
# 升级：重新构建并安装。安装器会裁剪 ~/.claude/skills/dual-*/ 里源码已不存在的旧文件，
# 各项目内重跑 init 刷新 wrapper（旧版 Hook 条目会被替换，不会叠加）
npm run build && node dist/install.cjs
node ~/.claude/skills/dual-critic/scripts/trivium.cjs init

# 卸载：只删用户级的 skill 目录与只读 Agent 定义；项目内的 .trivium/ 与 Hook 不动
node dist/install.cjs --uninstall
```

`brew upgrade node` 之后 wrapper 若失效，`trivium doctor` 会点名「wrapper 写死的 node 已不存在」，重跑 `init` 即可。

---

## 4. 跑通第一条任务（约 5 分钟）

在 Claude Code 里，先做最小的一条——**只审计划**：

```
/dual-review-plan 重点看并发与回滚路径
```

会发生什么：

1. Driver 把方案写成 `.reviews/<主题>/plan/<日期>-<主题>-claude.md`；
2. 编排器冻结送审包（记 `subject_sha256` 与工作树 `tree_hash`），渲染两份 BRIEF；
3. **两侧并行**独立审查，各自只读、背靠背——看不到对方的结论；
4. 两份结论齐备后**同时**落盘为 `…-gemini.md` 与 `…-glm.md`；
5. Driver 读两份全文，写 `…-revised-claude.md` **逐条裁决**（接受 / 驳回 / 暂缓 + 理由）；
6. `gate --check` 硬校验裁决完整性：少一条、理由空洞、编号不存在，都退 2 并点名缺口。

一次审查的墙钟通常 10～40 分钟（取决于模型与仓库大小；本仓库实测 GLM 侧审一份大补丁要 15～20 分钟）。命令内部用
`--start` / `--wait` 分段协议，所以不会撞上 Claude Code Bash 工具的超时上限。

### 七条命令

| 命令 | 做什么 |
| :--- | :--- |
| `/dual-run <任务目标>` | 全流程：出方案 → 双审 → 修订 → 编码 → 双审 → 应答 → 改码 → 编译测试 |
| `/dual-review-plan <提示语>` | 只审计划 |
| `/dual-review-code <提示语>` | 只审代码变更（被审对象是 `git diff`） |
| `/dual-review-bug <提示语>` | 只审根因分析（**不得**由前两者代替） |
| `/dual-approve` | 通过人工闸门 |
| `/dual-abandon` | 放弃闸门（工件保留） |
| `/dual-status` | 看闸门、运行、降级与争议 |

`<提示语>` 是必填的（FR-20）：它会**逐字**嵌进两侧 BRIEF 的第 2 段。换提示语必定重审。

---

## 5. 会挡你的四道护栏

它们由 Claude Code Hook 强制，**不靠模型自觉**。

| 什么时候 | 挡什么 | 怎么过 |
| :--- | :--- | :--- |
| 审查进行中 | 改业务文件 | 等审查跑完。审查员正在读真实工作树，你的改动会造成快照漂移，可能让整次运行作废 |
| 审查完成、裁决未齐备 | `git commit`、结束对话 | 补齐裁决件，跑 `gate --stage <阶段> --check` 通过 |
| 任何时候 | 主脑写 `*-gemini.md` / `*-glm.md` | 这两类文件只能由编排器渲染落盘（AC-07），你的产出后缀是 `-claude` |
| 闸门期 / 任何时候 | 用 **Bash** 绕过前三道：`cat > f`、`sed -i`、`tee`、`git checkout -- f` | Edit / Write 只是写文件的一条路，这些是旁路。命中编排器独占对象（角色后缀文件、`.trivium/` 的状态与锁、归档内 `_meta/` 与 `task.json`）**任何时候**都挡；其余写命令只在闸门期挡 |

第四道是**启发式**的，不求完备——它挡住顺手的旁路，但不要指望绕过去就没事：
绕过去的改动同样会被跑后复算判成漂移，整次审查可能作废。

被挡住时 Hook 会打印具体主题、阶段与解法。**不要靠改配置绕开**——那会让整条流水线
退化成「两个模型随口说了点什么」。

### 第四道有一种已知的误拦

判定在**未剥离 heredoc 的原文**上做，所以一条 Bash 命令只要正文里出现
`-gemini.md`、`_meta`、`task.json`、`state.json`、`.trivium` 这些字样，就会被当成
指向独占对象——哪怕它实际要写的是别的文件。

**任何把这些名字写进 Bash 命令文本的场合都会撞上**，不限于写文件。

**出口：改用 Write / Edit 工具落文件**，它们是精确判定的，不看字面。
提交说明也一样 —— 写进文件再 `git commit -F <文件>`，不要用 `-m` 内联。

**没有例外，包括 `git commit`。** 2026-09-12 给它开过一次豁免（BACKLOG 的 RV-B1），
双审打穿后撤回了。当时设了三个前置条件，仍有至少五条路能夹带进来，其中三条实测放行：

| 夹带形态 | 会发生什么 |
| :--- | :--- |
| `git commit -m x` 换行 `rm 某文件` | 分段判定不认换行，但 shell 把第二行当独立命令执行 |
| `git commit -m x > 审查文档` | 重定向符不是分段字符，目标文件被截断 |
| `echo 记得 git commit > _meta/某文件` | 根本不是提交命令，只因文本里有「git commit」就获豁免 |

根因是方向错了：原判定是 fail-closed（看见字面就拦，代价是误拦），豁免把它变成
需要穷举危险形态的 fail-open —— 而 shell 的攻击面穷举不完。误拦换个工具就绕开了，
漏拦却会让审查文档在闸门外被悄悄改掉，而且没有任何事后兜底。

这五类形态现在都锁成了测试负例。

这个代价是刻意接受的：正文里写保护路径恰恰是要防的攻击形态
（`python3 - <<'PY' … PY` 里藏一条改 `_meta/` 的写入），正则无法区分「讨论它」与「攻击它」。
漏拦的后果是裁决期归档被篡改且无跑后兜底，误拦的后果是你换个工具——代价不对称，所以选了误拦。

---

## 5.1 有一道关不是机械保证的

上面四道由 Hook 强制。**人工审批这道关不是。**

`trivium approve` 是普通 CLI 子命令，不校验调用来源，而 review 命令的 `allowed-tools`
预批准了 `Bash(.trivium/bin/trivium:*)`。也就是说 **Driver 自己敲一条命令就能关掉等你审批的闸门**，
不需要你确认。CLAUDE.md 里「审批的发起权在用户手里」是提示词约束，不是机械保证。

曾经加过一次性确认码，后来移除了——码的明文经 stdout 由 Driver 转述给你，它读得到，
构不成边界，只会让人误以为这道关是铁的。**虚假的安全感比没有护栏更糟。**

所以你的实际保障是**留痕**（那部分有机械边界）和**事后对账**：每次审批的时间、阶段、
`run_id` 与会话来源都写在 `task.json` 的 `approvals[]` 里，可查。
详见 [RUNBOOK 的信任边界段](../06_deployment/RUNBOOK_pipeline_ops.md)。

---

## 6. 产出在哪

```
.reviews/<主题>/
├── task.json                      # 主题级元数据：各轮指针、闸门、审批、争议
├── plan/  code/  bug/  verify/
│   ├── <日期>-<主题>-claude.md          # 原稿（plan / bug）
│   ├── <日期>-<主题>-gemini.md          # Antigravity 审查
│   ├── <日期>-<主题>-glm.md             # ZCode 审查
│   ├── <日期>-<主题>-revised-claude.md  # 修订件（含逐条裁决）
│   └── _meta/                            # 送审包、结构化结论、运行元数据、code 阶段的补丁
```

**只追加不覆盖**：既有工件一律不覆盖，重跑自动抬升 `-r<N>`（FR-25）。
详见 [`.reviews/README.md`](../../.reviews/README.md)。

看复盘：

```bash
.trivium/bin/trivium report --topic <主题>
```

给出时间线、每轮意见数与严重度分布、采纳率、被驳回项与理由、生效模型核对、
降级与告警清单、双审退化指标、耗时汇总。

---

## 7. 出问题时

| 现象 | 先看这个 |
| :--- | :--- |
| 命令没反应 / 提示未初始化 | `.trivium/config.yaml` 在不在？Hook wrapper 检测不到它一律放行（不会误伤其它仓库） |
| 某侧报不可用 | `trivium preflight --stage plan`，它会指出是探针过期、CLI 不可调用还是未认证 |
| 某侧审查被判「证据不足」 | 该侧读的项目文件数或工具调用数没达下限。看 `_meta/run-*.json` 的 `tool_calls` |
| 一侧超时 | 默认 strict 策略会中止整次运行。可调 `.trivium/config.yaml` 的 `review.timeout_s`，或临时用 `--allow-single` 降级（会被标记为降级，不是双审） |
| 跑起来之后卡住（锁、闸门、跑挂、留痕） | [`RUNBOOK_pipeline_ops.md`](../06_deployment/RUNBOOK_pipeline_ops.md) 按出口码查 |
| 装完想确认一切正常 | `doctor --selftest`；加 `--keep-fixture` 保留夹具，去掉 `TRIVIUM_STUB_CRITIC` 在其中重跑可检验两侧真实审查 |

退出码约定：`0` 成功 ｜ `1` 一般失败 ｜ `2` 闸门阻断 ｜ `64` 参数错误 ｜
`65` 前置产物缺失 ｜ `69` 环境或预检失败 ｜ `70` 主题被锁 ｜ `73` 运行仍在进行（**不是失败**）｜
`75` 严格模式中止。

---

## 8. 往下读

- [`.reviews/README.md`](../../.reviews/README.md)：留痕目录与命名规范
- [`doc/03_api/PROTOCOL_dual_critic_relay.md`](../03_api/PROTOCOL_dual_critic_relay.md)：工件中继与协议契约
- [`doc/04_development/GUIDE_env_setup.md`](../04_development/GUIDE_env_setup.md)：本地开发与调试
- [`doc/06_deployment/RUNBOOK_pipeline_ops.md`](../06_deployment/RUNBOOK_pipeline_ops.md)：运行期故障处置（锁、闸门、跑挂、留痕）
- [设计文档](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计-claude.md)：唯一实现依据
- [M0 本机坑清单](../05_testing/REPORT_2026-09-11_m0_probe.md)：两家 CLI 的实测行为与 12 条与文档记载不符之处
