# 计划：ZCode 0.16.9 provider 配置注入（EV-81）

- **主题**：`zcode-provider配置注入`
- **起点**：`f4f3970`（M9 第 7 步收口），`main` 干净，无未关闭闸门
- **触发**：M10 计划原稿 §0.3 **F-8** / §0.4 **P-4**；用户 2026-09-20 拍板取 ①「先另开小主题修，修完再以三侧跑 M10 计划审」
- **审查形态**：本主题**只走代码双审**，且只能 `--critics codex,gemini`——~~glm 正是坏着的那侧~~。
  **2026-09-21 更正**（r2 CODEX-05）：准确理由是 **glm 适配层正是本轮被审对象，不以待审代码审自己**。
  「坏着的那侧」在双审启动时刻已不准确（本机两份 provider 配置都在、全局副本已含新代码）。
  r3 起还多一条独立理由：EV-82 未结案前 glm 会静默跑在个人配置默认模型上，不构成独立一侧。
  修法在 F-8 已经实测验证（带两个变量复跑 `preflight --stage plan` 整份通过），本文件是**留痕**，不发起计划审。
- **产出**：本文件；代码与文档改动；随后由用户发起 `/dual-review-code`

---

## 一、目标与范围

### 目标

让 ZCode 0.16.9 在编排器下重新可用：`preflight` 的「ZCode 已认证」一格恢复 exit 0，含 glm 的双审能起来。

### 做（纪律 1：外部产品行为变化只改适配层）

1. `adapters/zcode.ts`：按入口派生内置 provider 配置路径、按真实用户目录取个人配置路径，**存在性门控**后注入
   `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` / `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`；`failureKind` 新增
   `provider_config_unresolved`，探活失败详情指向安装布局而非凭据。
2. `probes/zcode.ts`：`probeReadonlyFlags` 注入内置变量并增第三态 `indeterminate`；`probeZcode` 落盘
   `provider_config` 存在性事实格。
3. `doctor.ts`：blocker 文案补一句「内置文件未找到是布局问题，不是凭据问题」。
4. 用例 `test/unit/zcode-provider-env.test.ts`（假入口按 CLI 三种 stderr 形态应答，零配额）。
5. 文档回填：设计 §3.3 / §3.5 / §11.3 / §21（v1.3.31）；M0 报告 §7 P-28～P-30；BACKLOG EV-81；
   RUNBOOK §五、QUICKSTART 前置表、`.env.example`、LLD 模块表；实测原始输出进
   `doc/05_testing/evidence/zcode-provider-config-20260920/`。

### 不做（逐条附理由）

| 不做 | 理由 |
| :--- | :--- |
| 把两条路径写进 `config.yaml` 让用户配置 | 路径由 ZCode 安装布局与用户目录**决定**，不是用户的选择；配置项只会在布局变化时成为第二个要同步的事实源 |
| 适配层读 `probe.provider_config` 决定注入 | 文件在两次 doctor 之间出现或消失时，读探针格会漏注入或注入到不存在的路径；派生规则只有一处，拉起时按当下文件系统重算更稳。探针格是给人看的 |
| 修 `readonly_flags` 被污染的既有结论文件 | 那是 `.trivium/config.local.yaml`（不进 Git），修后重跑 `doctor --only zcode --no-model-calls` 即刷新，无需代码处理 |
| 探针中把 `--mode yolo` 等候选清单按 0.16.9 重排 | 候选清单的取舍是 M0 的决定，本主题只保证判定不被定位失败污染 |
| 处理 0.16.9 把 `Model config is missing` 改成 `Model creation failed` 的文案变化 | 未验证两者是否同一失败；`failureKind` 判 `model_config_missing` 的正则不改，落到 `other` 时 stderr 原文照样进详情 |
| M10 计划原稿的其余 F-x / P-x | 属 M10 主题，本主题只解 F-8 |

---

## 二、现状与实测（2026-09-20，原始输出见 evidence 目录）

| # | 命令形态 | 结果 |
| :--- | :--- | :--- |
| 1 | 不注入，任意 HOME，`--bogus-flag` | 「无法定位 CLI ZCode Built-in Provider Config：`<入口目录>/provider/…`, `/config/provider/…`」，**退 1、stdout 空**，`Unknown option` 未出现 → 定位**先于**参数解析（P-28 / P-29） |
| 2 | 注入两份，空 HOME，`--bogus-flag` | `Unknown option '--bogus-flag'` |
| 3 | 只注入内置，空 HOME，`--mode plan` | `Error: Model creation failed`，退 1，数秒内退出 |
| 4 | 只注入个人 | 同 1 |
| 5 | 注入两份、个人指向不存在的文件 | 同 3 |
| 6 | 注入两份，空 HOME，`--mode plan` | **起了一个 turn**（stderr `AI SDK Warning (anthropic.messages / qwen3.8-max)`，stdout 97 字节 envelope），3 分钟未退出，手工结束（P-30） |
| 7 | 只注入内置，空 HOME，`--bogus` | `Unknown option '--bogus'`，退 1 |

修前 `.trivium/config.local.yaml` 的 `readonly_flags`（probed_at 2026-09-19T22:54Z，0.16.9）把七个候选**全部**记成接受，
含 0.16.5 已证实被拒的四个（C-09）——就是形态 1 的后果。适配层 `readonlyArgsFromProbe` 只取两项，argv 未受污染，结论文件失真。

### 三条派生结论

- **内置那份是定位成败的关键**；个人那份缺失或指向不存在的文件不会更早失败（形态 4 / 5），只会以「Model creation failed」的面目出现
  → 适配层**文件不在就不给变量**，让 CLI 的原话进 `failureKind`，而不是伪装成模型问题。
- **旗标探针只能注入内置那份**（形态 3 vs 6）：个人配置自带默认模型，两份都给时空 HOME 挡不住真实调用，七个候选就是七次真实调用。
- **`failureKind` 按 stderr 形态判、~~不依赖退出码~~**：形态 1 退 1 会与 `other` 撞在一起，预检提示会把人引去查凭据。
  **2026-09-21 更正**（r2 AGY-01）：形态判定要收进**退出码非 0** 分支——裸正则会把 stderr 带同名诊断行的
  成功调用误判成布局失败。它要先于 `model_config_missing` 判，但不该先于退出码判。

---

## 三、方案（每步可单独验证）

### 3.1 `adapters/zcode.ts`

- `zcodeProviderConfigPaths(entry, userHome = os.homedir())` 纯函数：
  内置 `resolve(dirname(entry), '../config/provider/zcode-builtin.json')`，个人 `join(userHome, '.zcode/v2/provider_config.json')`。
- `zcodeProviderEnv(entry, userHome?)`：存在性门控，只判有无、不读内容（个人配置 0600 含凭据）。
- `invokeZcode`：`env = { ...(await zcodeProviderEnv(opts.entry)) }` 再叠 `HOME`。仍是唯一执行点。
- `ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE = /Built-in Provider Config/`——只认英文名词片段，中文前缀随 CLI 语言设置变。
- `failureKind` 先判该正则，再按退出码分档；`authProbe` 的 detail 对新档位给出「安装布局」方向的提示。

### 3.2 `probes/zcode.ts`

- `probeReadonlyFlags` 返回 `{ accepted, rejected, indeterminate }`；env 为 `{ ...只含内置变量, HOME: emptyHome }`；
  命中 `UNRESOLVED_RE` 的候选进 `indeterminate`，`continue`。
- `probeZcode`：`probe.provider_config = { builtin_file, personal_file }`（存在记绝对路径，不存在记 null）；
  `indeterminate` 非空时打 ⚠️ note，且**不写入** `readonly_flags`。
- `ZcodeProbe.provider_config?: {…} | null`，`defaultProbe()` 置 null（未探过 ≠ 未找到）。schema 的 `probe.cli.*` 为
  `additionalProperties: true`，无需改 `config.v2.json`。

### 3.3 用例（10 条）

路径派生 ×2、存在性门控 ×2、`invokeZcode` 真递到子进程（含 HOME 副本不影响）、`provider_config_unresolved` 分档、
正则边界、P-29 全 indeterminate、P-28/P-30 七次调用日志断言「个人变量一次都不给」、`defaultProbe` 空壳。

---

## 四、不可逆决策

无。`provider_config` 是可选字段，旧结论文件不受影响；`failureKind` 新增枚举值只在新形态出现时产生。

## 五、已知边界（如实登记）

- **「Model creation failed」与 0.16.5 的「Model config is missing」是否同一失败未验**，本主题不改那条正则。
- **`version` 子命令不受影响**（实测），`probeZcodeEntry` 不注入。
- **进程在 turn 里可长时间不退出**（形态 6）：由 `run` 的 `timeoutMs` + `killTree` 兜底，本主题不改超时策略。
- 派生规则假定 `Resources/glm/zcode.cjs` 与 `Resources/config/provider/` 是兄弟目录——这是 0.16.9 应用包的事实，
  布局再变时 `provider_config.builtin_file` 会记 null、探活进 `provider_config_unresolved`，**失败会说话**，但不会自愈。

## 六、验收

1. `npm run check` 全绿（修前 1495 → 修后 1505，+10）。
2. `npm run install:local` 后 `./.trivium/bin/trivium doctor --only zcode --no-model-calls`：notes 出现 `provider_config` 行，
   `readonly_flags` 恢复为 0.16.5 时期的接受集（`--mode plan` / `--mode yolo` / `--disallowed-tools …`），`indeterminate` 为空。
3. `./.trivium/bin/trivium preflight --stage plan` 整份 exit 0（「ZCode 已认证」一格通过）。
4. 代码双审 `--critics codex,gemini`，逐条裁决后由用户 `/dual-approve`，再提交。

## 七、执行顺序

1 适配层 → 2 探针 → 3 用例 → 4 `npm run check` → 5 文档回填 → 6 `install:local` + doctor + preflight → 7 提示用户发起代码双审。
