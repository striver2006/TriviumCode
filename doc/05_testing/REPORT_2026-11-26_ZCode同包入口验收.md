# ZCode 主攻与审核者同包入口验收

2026-11-26，macOS 27.2.1 arm64，VS Code 1.147.0。驾驶舱和后台各用隔离工作区，后台通过项目 wrapper 运行工作树构建的核心。

## 实际安装与入口

| 场景 | 发行包 / Agent | 实际入口 | 内置 provider |
| --- | --- | --- | --- |
| 驾驶舱默认主攻 | 独立 zcode-runtime 4.0.0 / 0.18.0 | `~/.local/bin/zcode` 直接执行，其包装目标为 `~/.zcode/runtime/current/bin/zcode.mjs`，`current` 指向 `releases/4.0.0` | 由原生交互启动器装载 |
| 两份安装并存时默认审核 | 同一独立发行包 4.0.0 / 0.18.0 | `~/.zcode/runtime/releases/4.0.0/agent/zcode.cjs` 经 Node 执行 | 该包的 `agent/provider/zcode-builtin.json` |
| 仅能发现桌面版时审核 | ZCode.app 4.0.0 / 0.18.0 | `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs` 经 Node 执行 | `Resources/config/provider/zcode-builtin.json` |

### 驾驶舱首条任务与续话

隔离工作区未设置 `trivium.launch.glmInteractivePath`。VS Code 的 ptyhost 日志记录了实际启动器 `~/.local/bin/zcode`。打包扩展内的生产 JS 与从当前源重新生成的生产 JS 的 SHA-256 均为 `1bd368cd05a78f5495356a8bd3d62ae386401ed7c762dcf00045f09d97ba685b`。

原生会话 `sess_8da359d6-7d09-4cf5-9ab6-cadbe5c17f70` 的模型记录和轮次完成事件均可对上。驾驶舱首条任务含主题「独立终端首轮验收」，要求计算 37 × 13。续话从驾驶舱中继输入框发送，原生用户消息与输入逐字相同。

| 消息 | 原生轮次 | 模型回读 | 原生回答 |
| --- | --- | --- | --- |
| 首条任务 | `turn_865e0556-ee06-4141-97bc-b249a2545a9e` | GLM-5.3 | `ZCFIRST481` |
| 原会话续话 | `turn_3c1e16d4-d66b-4475-8689-45b82738bac6` | GLM-5.3 | `ZCNEXT731` |

### 同版本切换与桌面兼容

先用隔离 HOME 和不含独立启动器的 PATH 跑桌面版完整 doctor，再在同一工作区恢复独立安装的发现条件，最后重跑独立版完整 doctor。两个完整探测都读到了文件哨兵。桌面限定环境和独立环境的 GLM 预检均通过，真实认证探活都回读 `bigmodel-coding-plan/GLM-5.3`。

| 连续执行的 doctor | Agent | 响应字段 | 真实响应读回的模型标识 `model_id_form` | 路径级禁止读取 |
| --- | --- | --- | --- | --- |
| 桌面版完整探测 | 0.18.0 | `response` | `bigmodel-coding-plan/GLM-5.3` | `false` |
| 切换后仅执行 `--no-model-calls` | 0.18.0 | `null` | `null` | `null` |
| 独立版完整探测 | 0.18.0 | `response` | `bigmodel-coding-plan/GLM-5.3` | `false` |

静态探测重新验证了独立版接受的参数。只有 `--mode plan` 的安装不能满足后台只读要求。路径级禁止读取在两份安装的完整探测中都未能阻止读取哨兵；编排器继续核对实际读取轨迹。

### 执行层写入拒绝

独立版的真实 CLI 通过核心 doctor 启动。单独的本地测试 provider 给出带唯一调用号 `toolu_trivium_zcode_write_negative` 的 `Write` 工具调用，目标是夹具内的临时文件。请求工具表含 `Read`、不含 `Write`。CLI 返回与调用号对应的 `tool_result`，其中 `is_error=true`，并给出 `No such tool available: Write`；目标文件前后内容均为 `original`。本项只验证独立 CLI 执行层的拒绝行为。

### Codex 主攻、独立 ZCode 单侧审核

隔离仓按入口 C 发起「ZCode独立安装验收」第 1/1 轮，运行号 `20261126T075619Z`。冻结请求为 `GLM-5.3`，原生主轮日志回读 provider `bigmodel-coding-plan` 和模型 `GLM-5.3`。运行中的审核子进程使用独立包的内置 provider。另一次真实预检在 Node 入口采集到后台脚本路径和参数，工具禁用表包含 `Write,Edit,MultiEdit,ApplyPatch,NotebookEdit,Bash,WebFetch,WebSearch`。[本机观测字段](evidence/zcode-installation-20261126/macos.json)

该次送审补丁含 19 个文件。审核者用完 1200 秒预算，编排器退出 75。失败正本中 `model_effective=null`，有效票 0，未生成审核意见或裁决件。隔离主题回到 `idle`，未进入人工审批。成功审核归档仍待复测。[运行元数据](evidence/zcode-installation-20261126/run-20261126T075619Z.json) · [超时记录](evidence/zcode-installation-20261126/review-glm-20261126T075619Z.failed.json)

## 自动化与未测项

| 检查 | 本机结果 |
| --- | --- |
| 核心 `npm run check` | 退出 0。4080 项中 4064 通过，16 跳过，0 失败 |
| 扩展 `npm --prefix extension run check` | 使用本机 VS Code 1.147.0，191 项单元测试、86 项集成测试通过 |
| 安装选择回归 | 覆盖独立版与桌面版并存、仅独立版、仅桌面版、显式脚本或启动器、入口缺失或核验失败，以及同 Agent 版本换装 |

Windows 真机未测。桌面版测至完整 doctor 与真实预检，未另启动桌面版正式审核。上面的角色验收使用隔离工作区。

## 正式发布与日常环境部署

2026-11-26，核心 1.3.8 与驾驶舱 0.3.3 的发布源码为 `adeaa72c569b3af41b5299916c7af5ae5a70f80a`。合入上一版发布记录并更新正式版本号后，重新运行了核心与扩展的完整检查，结果与上表一致。

| 交付物 | 回读结果 |
| --- | --- |
| GitCode 核心 `v1.3.8` | macOS 包的 `release_state=stable`、`source_dirty=false`。解压后 264 个文件逐项通过校验。公开下载的安装包、校验文件和 52 页 PDF 与本地归档字节一致。 |
| macOS 安装包 | SHA-256 为 `4fda36791ed8ec61b10ddea65ad3045798de16caf4451c462bc3242f5bf97366`。从解压目录执行安装前检查与安装，项目 wrapper 回报 `1.3.8`，已安装核心与包内 CLI 散列一致。 |
| Marketplace 驾驶舱 `0.3.3` | 公开下载 VSIX 的 SHA-256 为 `27380c624f27fab0d5ec19bbe5407860dadee59752ffd255bf944c02323b8694`，与上传件一致。VS Code 本机安装目录的七个载荷文件均与 VSIX 相符，比较 manifest 时剔除了安装器加入的 `__metadata`。 |
| 项目 wrapper 装后验证 | `doctor --selftest` 14/14。完整 ZCode doctor 选中独立版 `releases/4.0.0/agent/zcode.cjs`；Codex 主攻、GLM 审核的代码预检加 `--refresh-auth` 退出 0，5 秒真实探活回读 `bigmodel-coding-plan/GLM-5.3`。 |

[GitCode macOS 安装包](https://gitcode.com/czb99/TriviumCode/releases/download/v1.3.8/TriviumCode-1.3.8-macos.tar.gz) · [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=triviumcode.trivium-cockpit)
