# 多智能体协同开发落地方案：Claude Code + Antigravity + ZCode

> **适用环境**：Mac 开发主机（macOS） + VS Code  
> **协作模式**：方式二 · 文件工件中继架构（File Artifact Relay Protocol）  
> **核心优势**：去中心化、全程透明无黑盒、天然兼容 Git 版本回溯、杜绝单模型幻觉与盲区

---

## 一、方案设计思想与架构总览

本方案将当前三大主流异构编程智能体进行优势互补的协同分工：由 **Claude Code** 担任主控开发工程师（负责生成方案与编写代码），由 **Antigravity**（Google）与 **ZCode**（智谱）担任专家评审团（负责全工程方案推演与代码审计）。

### 为什么选择“文件工件中继模式”？
1. **完全透明，人工随时可查**：所有的审查意见、设计图纸全部落盘为标准的 Markdown 文档（统一存放于 `.reviews/` 目录），你在 VS Code 里双击即可使用 `Cmd + K V` 打开侧边预览。
2. **Git 追溯友好**：方案、代码改动补丁（`DIFF.patch`）以及两家 AI 的评审答卷均可沉淀为工程资产，留有完整的架构决策记录（ADR）。
3. **极高稳定性**：不需要维护复杂的进程间 RPC 隧道或 Webhook 服务，依靠本地磁盘工件与标准 POSIX 进程调用，极难出错且易于维护。

### 双阶段审查流转全景图

```text
                  【阶段一：方案审查与推演】                                     【阶段二：代码实现与安全审查】
        ┌──────────────────────────────────────────┐                   ┌──────────────────────────────────────────┐
        │  1. 用户在 VS Code 向 Claude Code 提需求  │                   │       4. 用户确认方案，Claude 编写代码     │
        └────────────────────┬─────────────────────┘                   └────────────────────┬─────────────────────┘
                             │                                                              │
                             ▼                                                              ▼
        ┌──────────────────────────────────────────┐                   ┌──────────────────────────────────────────┐
        │     Claude Code 生成 .reviews/PLAN.md     │                   │     Claude 生成变更 .reviews/DIFF.patch   │
        └────────────────────┬─────────────────────┘                   └────────────────────┬─────────────────────┘
                             │                                                              │
                             ▼ (并发启动 Review 脚本)                                        ▼ (并发启动 Review 脚本)
                ┌────────────┴────────────┐                                     ┌───────────┴────────────┐
                ▼                         ▼                                     ▼                        ▼
     ┌───────────────────────┐ ┌───────────────────────┐             ┌───────────────────────┐ ┌───────────────────────┐
     │  Antigravity (Gemini) │ │     ZCode (GLM)       │             │  Antigravity (Gemini) │ │     ZCode (GLM)       │
     │ 深度扫描工程依赖与调用│ │ 审查业务边界与异常防御│             │ 审查代码规范与上下游契│ │ 审查业务漏洞与异常分支│
     └──────────┬────────────┘ └──────────┬────────────┘             └──────────┬────────────┘ └──────────┬────────────┘
                │                         │                                     │                        │
                ▼ 产出                    ▼ 产出                                ▼ 产出                   ▼ 产出
        .reviews/PLAN_AGY.md      .reviews/PLAN_ZCODE.md                .reviews/CODE_AGY.md     .reviews/CODE_ZCODE.md
                │                         │                                     │                        │
                └────────────┬────────────┘                                     └───────────┬────────────┘
                             │                                                              │
                             ▼                                                              ▼
        ┌──────────────────────────────────────────┐                   ┌──────────────────────────────────────────┐
        │ 2. Claude 主动读取两份报告并优化方案工件 │                   │ 5. Claude 读取两份代码审查报告自我修复   │
        └────────────────────┬─────────────────────┘                   └────────────────────┬─────────────────────┘
                             │                                                              │
                             ▼                                                              ▼
        ┌──────────────────────────────────────────┐                   ┌──────────────────────────────────────────┐
        │ 3. 向用户汇报改进点，等待用户确认开工     │                   │ 6. 跑通单元测试，向用户交付高可靠成果    │
        └──────────────────────────────────────────┘                   └──────────────────────────────────────────┘
```

---

## 二、三方角色分工矩阵

| 角色 | 智能体 / 引擎 | 调用方式 | 核心职责与独特优势 |
| :--- | :--- | :--- | :--- |
| **主控工程师 (Driver)** | **Claude Code** (Sonnet 3.7 / 3.5) | VS Code 插件 / 终端命令 | 主导方案架构设计、编写主要代码、解决冲突、与用户实时对话。 |
| **架构评审专家 (Reviewer A)** | **Antigravity** (Gemini 2.5/3.1 Pro) | 终端命令 `agy -p ...` | 超长上下文与全知符号检索能力，擅长排查跨文件破坏性变更（Breaking Changes）、隐式调用链断裂。 |
| **工程审查专家 (Reviewer B)** | **ZCode** (GLM-5.3 / GLM-5) | 终端命令 `zcode -p ...` | 中文语义与本土化业务理解极佳，擅长审查边界异常分支、空指针防御、并发安全与测试完备性。 |

---

## 三、Mac 开发主机前置环境准备（只需配置一次）

### 1. 验证 Claude Code
在 Mac 终端中运行：
```bash
claude --version
```

### 2. 验证 Antigravity CLI (`agy`)
确保已安装并可在全局终端执行：
```bash
agy --help
```
> 若提示找不到命令，检查 `~/.gemini/antigravity/bin` 是否已添加至 `~/.zshrc` 的 `PATH` 环境变量中。

### 3. 激活 Mac 上的 ZCode CLI 引擎
ZCode 桌面应用（安装在 `/Applications/ZCode.app`）内部封装了版本为 0.16.x 的官方原生 CLI 驱动脚本 `zcode.cjs`。在终端中执行以下命令创建全局封装脚本：

```bash
# 1. 创建全局启动脚本
sudo tee /usr/local/bin/zcode > /dev/null << 'EOF'
#!/bin/bash
node "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs" "$@"
EOF

# 2. 赋予可执行权限
sudo chmod +x /usr/local/bin/zcode

# 3. 验证激活是否成功
zcode version
```
> **提示**：终端输出类似 `0.16.5` 即代表激活成功。ZCode 的登录态位于 `~/.zcode/v2/config.json`，CLI 会自动复用桌面端的登录凭证。

---

## 四、评审智能体模型选型与配置指南

为了让评审达到最佳效果，推荐采用**“分层模型策略”**：在方案推演阶段使用深度推理的大模型（高智商/深度思考），在代码检查阶段使用响应快速、语法敏锐的高速模型。

### 1. Antigravity (`agy`) 模型配置

#### 方式 A：在命令中按需显式指定（最推荐）
在脚本或终端中调用 `agy` 时，可通过 `--model` 与 `--effort` 参数精细控制：
```bash
# 方案推演：使用顶级推理模型 + 深度思考 (High Effort)
agy -p "审查方案..." --model gemini-3.1-pro-high --dangerously-skip-permissions

# 代码审查：使用高速模型，极速出具审计意见
agy -p "审查代码..." --model gemini-3.8-flash-high --dangerously-skip-permissions
```
* `--model <model-id>`：指定底层模型。
* `--effort <low|medium|high>`：控制思维链推理深度（`high` 会进行更深入的依赖反推与边界自查）。

#### 方式 B：修改全局配置文件（永久默认生效）
配置文件路径：
* **Mac**：`~/.gemini/antigravity-cli/settings.json`
* **Windows**：`C:\Users\<用户名>\.gemini\antigravity-cli\settings.json`

编辑 `"model"` 字段即可：
```json
{
  "model": "gemini-3.1-pro-high",
  "trustedWorkspaces": [
    "/Users/your_username"
  ]
}
```

#### 查询可用模型列表
在终端运行命令：
```bash
agy models
```
* **推荐选型**：
  - `gemini-3.1-pro-high`：最强架构推演模型，推演深度与 Corner Case 覆盖度顶级，推荐用于**方案评审**。
  - `gemini-3.8-flash-high` / `gemini-3.7-flash-high`：超快响应、超大上下文，推荐用于**日常代码 Diff 审查**。

---

### 2. ZCode (`zcode`) 模型配置

ZCode CLI 直接复用桌面客户端的运行时环境与配置中心。

#### 方式 A：在桌面客户端 UI 中直接选择（最直观）
由于 CLI 自动继承桌面端配置：
1. 打开 **ZCode 桌面应用**；
2. 在新建任务或对话界面的**模型选择下拉框**中，切换为你希望使用的模型（如 **`GLM-5.3`** 或 **`GLM-5`**）；
3. 切换后，后续在终端或脚本中执行 `zcode -p "..."` 时，就会**默认采用你在桌面端当前选中的模型**。

#### 方式 B：修改全局配置文件
配置文件路径：
* **Mac**：`~/.zcode/v2/setting.json`
* **Windows**：`C:\Users\<用户名>\.zcode\v2\setting.json`

该文件中记录了当前的默认模型提供商与配置：
```json
{
  "modelProviderFamilyModes": {
    "bigmodel": "oauth"
  },
  "modelProviderFamilySelectedKeys": {
    "bigmodel": "coding-plan:builtin:bigmodel-coding-plan"
  }
}
```

#### ZCode 核心模型推荐
* **`GLM-5.3` / `GLM-5.1`**：智谱旗舰大模型，逻辑严密、长文本理解好，推荐用于方案架构把关。
* **`GLM-5-Turbo` / `GLM-4.7-Flash`**：高吞吐量高速模型，适合代码小补丁的快速审计。
* **`codegeex-4`**：专为代码语法树分析与工程规范调优的模型。

---

## 五、工件目录规划（`.reviews/`）

在项目根目录下设置统一的工件目录：

```text
your-project/
├── .reviews/                    # 统一存放多智能体交互的工件文件
│   ├── PLAN.md                  # Claude 生成的初始/优化后方案
│   ├── PLAN_AGY.md              # Antigravity 针对方案的审查意见
│   ├── PLAN_ZCODE.md            # ZCode 针对方案的审查意见
│   ├── DIFF.patch               # 当前未提交的代码差异
│   ├── CODE_AGY.md              # Antigravity 针对代码的审查意见
│   └── CODE_ZCODE.md            # ZCode 针对代码的审查意见
├── scripts/
│   └── agent_review.sh          # 核心自动化并发审查脚本
├── .claude/
│   └── commands/                # VS Code 内快捷命令
│       ├── review-plan.md
│       └── review-code.md
├── CLAUDE.md                    # 约束 Claude 行为准则的核心配置文件
```

> **建议**：可将 `.reviews/*.patch` 加入 `.gitignore` 避免临时补丁污染代码库；`PLAN_*.md` 可选择性保留作为架构决策记录（ADR）。

---

## 六、核心驱动脚本：`scripts/agent_review.sh`

在项目根目录下新建 `scripts/agent_review.sh`。此脚本已预置**模型分层参数**（方案推演用 `gemini-3.1-pro-high`，代码审查用 `gemini-3.8-flash-high`），并利用 Mac 的 `&` 与 `wait` 实现并行开工：

```bash
#!/bin/bash
set -e

# 定位项目根路径与审查工件目录
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REVIEW_DIR="$PROJECT_DIR/.reviews"
mkdir -p "$REVIEW_DIR"

MODE="$1" # 模式: plan (方案审查) 或 code (代码审查)

if [ "$MODE" = "plan" ]; then
    echo "🔍 [1/3] 启动设计方案双重评审流程..."
    if [ ! -f "$REVIEW_DIR/PLAN.md" ]; then
        echo "❌ 错误: 未找到 $REVIEW_DIR/PLAN.md，请先由 Claude 生成方案工件。"
        exit 1
    fi

    echo "⚡ 正在并行调度 Antigravity (Gemini Pro) 与 ZCode (GLM) 进行方案推演..."
    
    # 1. 后台启动 Antigravity 进行架构依赖与可行性深度审查（高推理模型）
    agy -p "请深入探索当前工程，针对 .reviews/PLAN.md 进行严谨的可行性审查。重点查找：潜在破坏性变更（Breaking Changes）、遗漏的模块调用依赖、架构扩展性隐患。审查意见以 Markdown 格式输出。" \
        --model gemini-3.1-pro-high \
        --effort high \
        --dangerously-skip-permissions \
        --mode plan \
        --add-dir "$PROJECT_DIR" > "$REVIEW_DIR/PLAN_AGY.md" 2>&1 &
    PID_AGY=$!

    # 2. 后台启动 ZCode 进行业务边界与异常防御审查
    zcode -p "请阅读 .reviews/PLAN.md。从业务工程落地、边缘异常分支（边界值、空指针、并发安全）及测试完备性三个维度进行严格审查，指出隐患并给出具体改进建议。" \
        --mode plan \
        --cwd "$PROJECT_DIR" > "$REVIEW_DIR/PLAN_ZCODE.md" 2>&1 &
    PID_ZCODE=$!

    # 等待两者同时完成
    wait $PID_AGY
    wait $PID_ZCODE

    echo "✅ [完成] 方案审查工件已生成至 .reviews/ 目录："
    echo "   - $REVIEW_DIR/PLAN_AGY.md"
    echo "   - $REVIEW_DIR/PLAN_ZCODE.md"

elif [ "$MODE" = "code" ]; then
    echo "🔍 [1/3] 提取当前 Git Diff 变更..."
    git diff HEAD > "$REVIEW_DIR/DIFF.patch"

    if [ ! -s "$REVIEW_DIR/DIFF.patch" ]; then
        echo "⚠️ 当前无任何未提交代码改动，跳过代码审查。"
        exit 0
    fi

    echo "⚡ 正在并行调度 Antigravity (Flash 高速) 与 ZCode 审查代码改动..."

    # 1. 后台启动 Antigravity 审查代码规范与上下游一致性（高速大模型）
    agy -p "审查 .reviews/DIFF.patch 中的代码改动。结合全局源码，核验改动是否破坏既有契约、是否存在资源未关闭或潜在性能劣化。" \
        --model gemini-3.8-flash-high \
        --dangerously-skip-permissions \
        --add-dir "$PROJECT_DIR" > "$REVIEW_DIR/CODE_AGY.md" 2>&1 &
    PID_AGY=$!

    # 2. 后台启动 ZCode 审查逻辑漏洞与防御性编程
    zcode -p "审查 .reviews/DIFF.patch 中的具体实现代码。重点查找：业务逻辑漏洞、空指针/越界隐患、异常捕获缺陷。" \
        --mode plan \
        --cwd "$PROJECT_DIR" > "$REVIEW_DIR/CODE_ZCODE.md" 2>&1 &
    PID_ZCODE=$!

    wait $PID_AGY
    wait $PID_ZCODE

    echo "✅ [完成] 代码审查工件已生成至 .reviews/ 目录："
    echo "   - $REVIEW_DIR/CODE_AGY.md"
    echo "   - $REVIEW_DIR/CODE_ZCODE.md"
else
    echo "使用方式: ./scripts/agent_review.sh [plan|code]"
    exit 1
fi
```

给脚本添加执行权限：
```bash
chmod +x scripts/agent_review.sh
```

---

## 七、行为守则配置：`CLAUDE.md`

在项目根目录下创建或修改 `CLAUDE.md`，约束 Claude Code 在 VS Code 中使用时严格遵循自动化闭环：

```markdown
# 智能体协同开发规范 (Multi-Agent Collaboration Protocol)

本项目采用多智能体交叉评审机制：
- Antigravity 负责架构与跨模块调用链把关
- ZCode 负责业务逻辑与异常边界把关

## 一、方案制定阶段
当用户提出复杂功能需求、重构或架构调整时：
1. **生成方案工件**：梳理技术方案，将详细实施细节保存至 `.reviews/PLAN.md`。
2. **运行评审脚本**：使用 Bash 工具执行 `./scripts/agent_review.sh plan`。
3. **读取评审工件**：主动读取 `.reviews/PLAN_AGY.md` 与 `.reviews/PLAN_ZCODE.md`。
4. **汇报与迭代**：
   - 向用户汇报方案时，必须包含一段“💡 专家评审意见与改进要点”，列出采纳了哪些优化。
   - 将优化后的方案更新至 `.reviews/PLAN.md`。
   - 等待用户确认许可后，方可动笔写代码。

## 二、代码编写完成阶段
完成代码编写后，在交付用户前必须自闭环审查：
1. **触发代码评审**：使用 Bash 工具执行 `./scripts/agent_review.sh code`。
2. **读取代码审查工件**：主动读取 `.reviews/CODE_AGY.md` 与 `.reviews/CODE_ZCODE.md`。
3. **自我修复与验证**：
   - 针对审查报告中指出的逻辑漏洞、未捕获异常进行代码补强修复。
   - 运行项目现有单元测试，确保测试全部通过。
4. **成果交付**：向用户简要汇报改动概要及修复的审查项。
```

---

## 八、VS Code 效率增强：斜杠快捷命令

在项目根目录下创建 `.claude/commands/` 目录，方便在 VS Code 的 Claude 对话框中随时按需单步触发：

### 1. 方案评审命令：`.claude/commands/review-plan.md`
```markdown
---
description: 触发 Antigravity 与 ZCode 对当前方案进行联合评审
---
请按顺序执行以下步骤：
1. 运行 `./scripts/agent_review.sh plan`。
2. 读取 `.reviews/PLAN_AGY.md` 和 `.reviews/PLAN_ZCODE.md`。
3. 提炼两份文件中的有效改进建议，并更新现有方案。
```

### 2. 代码审查命令：`.claude/commands/review-code.md`
```markdown
---
description: 触发 Antigravity 与 ZCode 对当前未提交代码进行联合审查
---
请按顺序执行以下步骤：
1. 运行 `./scripts/agent_review.sh code`。
2. 读取 `.reviews/CODE_AGY.md` 和 `.reviews/CODE_ZCODE.md`。
3. 针对专家指出的合理代码缺陷进行修复，并运行测试验证。
```

---

## 九、全流程实战演练（你在 VS Code 中的实际体验）

### 场景模拟：重构订单超时自动取消与库存回滚系统

1. **第一步：向 Claude Code 提需求**  
   你在 VS Code 内置终端或 Claude 侧边栏输入：  
   > *“帮我把现有的轮询扫表订单取消机制，重构成基于分布式延时队列的架构，支持千万级订单高并发与幂等库存回滚。”*

2. **第二步：方案出炉与并发双审（完全自动化）**  
   - Claude Code 自动理清设计脉络，写入 `.reviews/PLAN.md`；
   - Claude 自动调用 Bash 工具执行 `./scripts/agent_review.sh plan`；
   - 终端后台并发唤起 Antigravity (Gemini Pro) 和 ZCode (GLM)，分别对全局调用依赖和业务细节进行推演；
   - 约 10~20 秒后，`.reviews/PLAN_AGY.md` 和 `PLAN_ZCODE.md` 写入完毕；
   - **在 VS Code 资源管理器中，你可以随时双击这两个文件，按 `Cmd + K V` 查看两家 AI 的评审报告。**

3. **第三步：Claude 自我吸收并在对话中回复**  
   Claude Code 读完两份工件后，直接输出：  
   > *“方案已初步拟定并完成双重评审：*  
   > *1. **Antigravity** 指出我们现有的库存扣减表缺少版本号乐观锁机制，高并发下存在超卖风险；*  
   > *2. **ZCode** 提醒需补充延时队列投递失败时的死信重试机制与告警接入。*  
   > *我已经针对这两点修正了方案，完整设计已更新至 `.reviews/PLAN.md`。请确认是否可以开工编码？”*

4. **第四步：编码实施与二次代码审查**  
   你回复：“*没问题，开始写代码*”。Claude Code 快速完成所有代码修改。编写完成后，它自觉调用 `./scripts/agent_review.sh code`，两家 AI 针对实际 `DIFF.patch` 审查通过，Claude 跑通现有测试用例，向你交付稳定可靠的代码。

---

## 十、最佳实践与避坑要点

1. **务必带上 `--dangerously-skip-permissions` 参数**：  
   在调用 `agy` 时必须加上此参数，防止脚本在后台因等待用户终端敲键盘确认权限而无限期挂起。
2. **防审查分歧（死循环防护）**：  
   在脚本的 Prompt 中明确要求评审专家“重点关注逻辑漏洞、并发安全与破坏性变更，避免纯主观代码风格挑刺”，保证评审意见具有高可操作性。
3. **工件版本管理建议**：  
   在 `.gitignore` 中加入 `.reviews/*.patch` 避免临时补丁污染代码库；`PLAN_*.md` 建议随功能分支提交，沉淀为团队的架构决策资产。
