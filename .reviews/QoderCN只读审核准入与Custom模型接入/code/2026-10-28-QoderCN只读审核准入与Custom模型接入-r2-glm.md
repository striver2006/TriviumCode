---
schema: trivium.review.v2
topic: QoderCN只读审核准入与Custom模型接入
stage: code
role: glm
vendor: zcode
agent_cli: zcode/0.17.0
model_requested: GLM-5.3
model_effective: bigmodel-coding-plan/GLM-5.3
model_effective_source: trace
effort_requested: null
effort_effective: null
effort_effective_source: null
tier: null
tier_source: legacy
model_route: config_copy
run_id: 20261028T041304Z
rerun_index: 2
snapshot_hash: sha256:4d1bd92e14db876d86c6b6ac001286e57744a56e9695f7c7091874ccdb60f526
blind: true
started_at: 2026-10-28T04:13:12.999Z
finished_at: 2026-10-28T04:25:23.997Z
duration_s: 731
tool_calls:
  read: 15
  grep: 7
  glob: 0
  run_command: 0
  project_reads: 17
evidence_ok: true
verdict: reject
findings_count:
  blocker: 1
  major: 0
  minor: 3
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: unknown
access:
  requested_mode: standard
  profile: null
  launcher_requested: /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
  launcher_effective: /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
  wrapper_sha256: null
  configuration_sha256: null
  provider_declared: null
  provider_declared_source: null
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: codex
    right: glm
    status: unknown
    left_model: null
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: null
    right_source: trace
    reason: 左侧模型信息缺失
  - left: gemini
    right: glm
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / glm
  - left: glm
    right: claude
    status: different-family
    left_model: bigmodel-coding-plan/GLM-5.3
    right_model: claude-opus-5-5
    left_source: trace
    right_source: envelope
    reason: 模型族不同：glm / claude
override_reason: 左侧模型信息缺失
session_id: sess_8f539bab-c395-4612-9249-4a69c9e6ac73
---

# 代码审查：QoderCN只读审核准入与Custom模型接入

> Critic-B · 智谱 ZCode ｜ 回读模型 `bigmodel-coding-plan/GLM-5.3` ｜ 请求模型 `GLM-5.3`
> ｜ 运行 `20261028T041304Z` ｜ 第 2 轮
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

本轮产品面唯一源码改动 qoderChildEnv 环境白名单在真实派生处不生效：util/exec.ts 的 run() 对 opts.env 是「整份 process.env 之上叠加、仅显式 undefined 才删除」的语义（exec.ts:527-531 及 RunOptions 注释），而 qoderChildEnv 只构造白名单键、不含任何 undefined 条目，因此厂商子进程实际继承全部父环境变量（含 AWS_*、QODER_*、ANTHROPIC_*、NODE_OPTIONS 与任意 canary），仅 HOME/USERPROFILE/TMP 族/QODERCN_CONFIG_DIR 被覆盖；相对 HEAD 还是回退——旧实现把 NODE_OPTIONS 与 QODER_/ANTHROPIC_/OPENAI_/CODEX_/TRIVIUM_ 前缀显式置 undefined 经 run() 删除，新实现不再删任何键（全仓 grep 已无 NODE_OPTIONS 剥除点）。全部生产调用点（invokeQoderModel、探针三处 run、verifyQoderBinding）与两个取证脚本都经同一 run() 派生，故 PROTOCOL/设计新增节/报告「未知父环境与运行注入变量不继承、NODE_OPTIONS 不传」的断言与真实子进程行为不符，新增单测只测纯函数形状所以全绿；这正是上轮要求的「真实子进程侧 canary 反测」未做才会漏掉的缺陷，判 blocker、改后需重审，故 reject。取证与修正面质量好：共用逐值护栏绑定 secret_guard_sha256、泄漏置退出 1、custom 采集器收集全部解密 parameters 值且只重加密选中条目、报告已按原件更正第二批「未调用」误述、registry 两个开关保持 false、admission 恒 false，与证据抽查一致。

**结论**：不通过（`reject`）

## 审查意见（共 5 条：阻断 1 ｜ 次要 3 ｜ 吹毛求疵 1）

### GLM-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn-native.ts:53-68、87-89；src/trivium/util/exec.ts:527-531；调用点 src/trivium/adapters/qoder-cn.ts:39-41、src/trivium/probes/qoder-cn.ts:17-26、src/trivium/adapters/qoder-cn-native.ts:104` |
| 类别 | security ｜ 层次 code |
| 置信度 | high |

**问题**：环境白名单在 spawn 时不生效。run() 的实现是先复制整份 process.env 再叠加 opts.env，键值为 undefined 时才删除（exec.ts:527-531，RunOptions 注释明写「追加/覆盖到 process.env 之上」）；qoderChildEnv 返回的记录只含白名单键、不含 undefined 条目，于是厂商 CLI 子进程实际继承父环境全部未知变量（凭据类如 AWS_SECRET_ACCESS_KEY/QODER_API_KEY、注入类如 NODE_OPTIONS/BUN_OPTIONS 均在），只有 HOME/USERPROFILE/TMPDIR/TMP/TEMP/QODERCN_CONFIG_DIR 真正被覆盖。相对基线还是安全回退：被替换掉的旧代码把 NODE_OPTIONS 与 QODER_/QODERCN_/ANTHROPIC_/OPENAI_/CODEX_/TRIVIUM_ 前缀显式置 undefined、经 run() 删除，新实现不再删除任何键（src/trivium 全目录 grep NODE_OPTIONS 已无命中）。后果有三：其一，PROTOCOL 新增段、设计 §11.5 新增节、报告「生产代码与未实施项」都断言「未知父环境与运行注入变量不继承／NODE_OPTIONS 不传」，与真实行为不符，是写进对外契约的失实属性；其二，test/unit/qoder-cn-model.test.ts 三个新用例只断言 qoderChildEnv 纯函数的键集，未覆盖经 run() 合并后的最终子进程环境，所以全绿却测不住本缺陷；其三，两个取证脚本经同一 bundled run() 派生，报告所谓「使用生产新环境策略的复跑」同样继承整份父环境，环境隔离证据的 framing 建立在无效机制上。

**依据**：src/trivium/util/exec.ts 第 527-531 行合并语义与第 16-19 行 RunOptions 注释；src/trivium/adapters/qoder-cn-native.ts 第 53-68 行（qoderChildEnv 无 undefined 输出）与旧实现对照（被审 diff 第 147-188 行删除的置 undefined 循环）；src/trivium/adapters/qoder-cn.ts 第 39-41 行、src/trivium/probes/qoder-cn.ts 第 17/19/25 行、qoder-cn-native.ts 第 104 行三处调用均以 {env} 走 run()；test/unit/qoder-cn-model.test.ts 第 24-42 行仅构造级断言；doc/03_api/PROTOCOL_dual_critic_relay.md 与设计新增节、REPORT「生产代码与未实施项」节的继承断言（被审 diff 第 58-66、147-188、228 段）。

**建议**：让 qoderChildEnv 对父环境中全部非白名单键输出 undefined 值（run() 会据此删除），或给 run() 增加替换式 env 入口并让 withQoderHome 一侧使用；单测改为断言「经 run() 合并语义后的最终 env 不含 canary 键」或直接断言输出含 undefined 标记；同步修正 PROTOCOL/设计/报告中关于不继承的表述；把真实厂商子进程侧 canary 反测（父环境注入 canary 后确认子进程不可见）作为本次修复的验收项——上轮 GLM-05 要求的反测若已做即可当场暴露此缺陷。

### GLM-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs:18、65-67；scripts/acceptance/kimi-qoder-cn/qoder-custom.mjs:86-89` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：取证脚本的失败路径可能不落任何证据。readonly 把用户全局 settings.json 的基线 hash 读取放在 try 之外（第 18 行），该文件缺失或不可读时顶层抛未捕获 rejection，finally 不执行、证据不落盘，与 README「失败原件保留」的口径不一致（custom 把同类读取放在 try 内并容忍失败，两脚本口径不一）。两脚本 finally 里的不变量复算同样脆弱：readonly 第 65-67 行重读 settings.json 与两个 auth 文件、custom 第 86 行重读全部快照文件，任一 readFile 在运行中途被删除或不可读即抛错中断 finally，其后的证据写入（readonly 70-72、custom 90-93）不执行——恰好在最需要留痕的异常场景丢掉整份证据。

**依据**：scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs 第 18 行在 try 块之外 readFile、第 63 行 catch、第 64-74 行 finally 内先复算后写证据的顺序；scripts/acceptance/kimi-qoder-cn/qoder-custom.mjs 第 27-28 行（try 内读取）与第 86-93 行（finally 复算在写证据之前）；scripts/acceptance/kimi-qoder-cn/README.md「失败原件保留」句。

**建议**：把基线读取挪进 try 并容忍 ENOENT（记 null 并在证据中标注基线缺失）；finally 内的不变量复算逐文件 try/catch，把每项记为 per-file 布尔或错误摘要，不让首个异常中断证据落盘。

### GLM-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/qoder-secrets.mjs、qoder-secrets.test.mjs；scripts/acceptance/kimi-qoder-cn/README.md「不在默认npm test收录内」句` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：逐值护栏是证据归档前防凭据泄漏的唯一精确防线，本轮把它升为 custom/readonly 共用组件并以 secret_guard_sha256 绑定进证据，但实现与测试都留在 scripts/ 下且 README 明确声明不在默认 npm test 收录；护栏自身的回归（JSON 转义变体漏检、exitCode 语义变化、collectCredentialValues 行为改变）对 CI 完全不可见，要到下一次真机采集才可能暴露，而那时的代价是证据泄漏或误报阻塞。

**依据**：scripts/acceptance/kimi-qoder-cn/qoder-secrets.mjs 全文与 qoder-secrets.test.mjs 仅两条用例、均位于 scripts/acceptance 目录；README.md「此独立脚本测试不在默认npm test收录内，运行结果单列」；qoder-custom.mjs 第 20 行与 qoder-readonly.mjs 第 21 行以 secret_guard_sha256 绑定该文件。

**建议**：把 collectCredentialValues/secretGuard 移入 src/trivium（如 secrets.ts 旁）并在 test/unit 建对应用例随 npm test 跑，scripts 侧仅再导出；或由 test/unit 直接 import scripts 路径纳入默认套件。现有两条用例可顺带补嵌套对象与非字符串 JSON 值跳过的断言。

### GLM-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/qoder-secrets.mjs:2-6、11-18` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | medium |

**问题**：泄漏命中不可诊断且存在误报面。known_secret_found 置位时不保留任何不回显原值的指印（命中值索引或加盐 hash），证据里只有布尔，排查只能人工比对采集器内存；同时 collectCredentialValues 把 .auth/user 可解析 JSON 的全部字符串值无差别当秘密（含 plan/区域/账号展示类非敏感字段的假说风险，未读凭据原文无法证实具体形态），一旦短值在 stdout 合法出现即 sticky 置位并退出 1，整份证据被判泄漏失败且无法区分真假命中——方向 fail-closed 可接受，但会以不可定位的方式阻塞准入取证。

**依据**：scripts/acceptance/kimi-qoder-cn/qoder-secrets.mjs 第 2-6 行 collectCredentialValues 收集全部 JSON 字符串值、第 11-18 行 scrub 仅置 leaked 与替换不记录命中来源；qoder-secrets.test.mjs 断言只覆盖布尔语义。

**建议**：命中时在证据里记 matched 值的数组索引或短加盐 hash（不回显值本身）；可对明显非凭据字段按键名白名单或最小长度降权并单列为「低置信命中」，保持 fail-closed 但可定位。

### GLM-05 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/qoder-index.mjs:25-27` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：索引作为报告与后续消费的机读汇总，逐文件收录了 sources_unchanged/temporary_roots_removed/known_secret_found，但漏掉 readonly 原件里的 credentials_unchanged（认证未被篡改的不变量，595da8.json 第 49 行有、索引各文件条目无），只读索引的消费方看不到该项；且任一原件 JSON 损坏时 parse 抛错使整个索引无任何输出，与「只汇总」的容错定位不符。

**依据**：qoder-index.mjs 第 25-27 行文件级字段清单不含 credentials_unchanged；doc/05_testing/evidence/qoder-cn-admission-20261028/readonly-2026-10-28T04-12-18-095Z-595da8.json 第 49 行 credentials_unchanged true；index-2026-10-28T04-12-55-606Z-2b294a.json 逐文件条目仅有 sources_unchanged（grep 核对）。

**建议**：索引逐文件条目补录 credentials_unchanged；对单个原件解析失败记 per-file 错误条目后继续汇总，不让一份坏件拖垮整个索引。

## 认为正确的部分

- 共用逐值护栏的方向与实现正确：collectCredentialValues 收集复制认证原文与可解析 JSON 字符串，secretGuard 对原值与 JSON 转义变体逐值替换、命中 sticky、exitCode 泄漏优先；custom 采集器还收集全部解密 records 的 parameters 值（qoder-custom.mjs:52），任何一条模型密钥意外回显都会被拦，qoder-secrets.test.mjs 的转义变体与退出码语义有真实失败模式。
- 上轮意见的落实到位：readonly/custom 均绑定 secret_guard_sha256 且泄漏置退出 1（GLM-03 修复）；报告按原件更正第二批「未调用」误述并把「工具裁剪拒绝不进 permission_denials、两通道需独立处理」写进报告与设计新增节（GLM-01 修复）；白名单补入 SSL_CERT_FILE/SSL_CERT_DIR/NODE_EXTRA_CA_CERTS 并新增合法代理/NO_PROXY 正例测试（GLM-04/05 的测试与键集半边修复）；「真实厂商子进程侧 canary 矩阵未测」如实列入报告剩余工作表。
- qoder-custom.mjs 取证纪律好：marker 与 WASM 候选唯一性校验失败即停（fail-closed）、只重加密选中条目不复制其它五个模型凭据、invalid-key 臂用合成假 key、全部源文件前后 hash 对账、错误消息在 prepare/source 阶段整体替换避免凭据回显、临时根删除回读。
- registry 中 qoder-cn 的 criticEnabled/defaultSelected/driverEnabled 保持 false（registry.ts:429-431），报告「两个开关继续为 false」属实；Windows 在复制认证前继续拒绝（qoder-cn-native.ts:77）。
- 报告对整体未完成、Custom 必要回读缺失、native_routes/语义绑定 v2/准入台账/真实三审未实施、Windows 未测的定性诚实，未把诊断取证冒充生产接入；证据抽查（known_secret_found 全 false、新件含 secret_guard_sha256、旧件保持 null 不回填）与报告表述一致。

## 未覆盖范围（本侧盲区）

- 只读审查：未运行 typecheck/build/测试或任何脚本，报告宣称的 typecheck/build 退出 0、单元/集成 53/53、护栏 2/2 均未独立验证。
- GLM-01 的最终子进程环境是代码级推理（run() 合并语义 + 各调用点），未用真实子进程实测复现父环境 canary 可见性——若 Driver 认为判断有误，请以 canary 反测原件反驳。
- 凭据文件 .auth/user 与 .models customs 原文未读（凭据保护考虑），GLM-04 中非敏感字符串值误报的具体形态是假说。
- 证据 JSON 仅抽查 known_secret_found/secret_guard_sha256/credentials_unchanged/sources_unchanged 字段与两份 index 结构，未整读 stdout 全文、未复算 index 的调用/拒绝配对逻辑。
- 必读清单中 CLAUDE.md、README.md、doc/README.md、doc/01_requirements/README.md、doc/02_design/README.md、src/trivium/review.ts、run-protocol.ts、preflight.ts、qoder-cn-model.ts 全文、test/integration/qoder-cn-routing.test.ts、上轮官方路由报告未读或仅 grep 抽查；本轮补丁未触及这些文件，契约漂移以被审 diff 与调用链核对为限。
- Windows 行为、取消/强杀/失联生命周期矩阵、skills/Hook/插件叠加执行能力未覆盖；两批复跑均为 macOS 本机采样，不可外推。
- 代理 URL 校验对 URL 解析器边缘形态（编码 userinfo、非常规 scheme 大小写等）仅按代码与 WHATWG URL 语义推理，未实测。

## 实际查阅的项目文件

- `.reviews/QoderCN只读审核准入与Custom模型接入/code/_meta/changes-20261028T041304Z.diff`
- `.reviews/QoderCN只读审核准入与Custom模型接入/code/2026-10-28-QoderCN只读审核准入与Custom模型接入-glm.md`
- `.reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-r2-codex.md`
- `src/trivium/adapters/qoder-cn-native.ts`
- `src/trivium/adapters/qoder-cn.ts`
- `src/trivium/probes/qoder-cn.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/util/fsx.ts`
- `src/trivium/agents/registry.ts`
- `test/unit/qoder-cn-model.test.ts`
- `scripts/acceptance/kimi-qoder-cn/qoder-custom.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-index.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-secrets.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-secrets.test.mjs`
- `scripts/acceptance/kimi-qoder-cn/README.md`
- `doc/05_testing/REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md`
- `doc/05_testing/evidence/qoder-cn-admission-20261028/index-2026-10-28T04-12-55-606Z-2b294a.json`
- `doc/05_testing/evidence/qoder-cn-admission-20261028/readonly-2026-10-28T04-12-18-095Z-595da8.json`
- `doc/05_testing/evidence/qoder-cn-admission-20261028/custom-2026-10-28T04-10-34-193Z-5bc31a.json`
- `doc/05_testing/evidence/qoder-cn-admission-20261028/index-2026-10-28T04-11-29-838Z-d3881d.json`

> 编排器从工具轨迹中记录到的读取次数：{"read":15,"grep":7,"glob":0,"run_command":0,"project_reads":17}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
