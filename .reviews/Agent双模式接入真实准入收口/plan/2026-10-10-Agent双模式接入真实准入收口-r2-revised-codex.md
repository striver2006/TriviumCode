---
schema: trivium.disposition.v1
topic: Agent双模式接入真实准入收口
stage: plan
role: codex
kind: revised
run_id: 20261010T135427Z
addresses:
  - 2026-10-10-Agent双模式接入真实准入收口-r2-gemini.md
  - 2026-10-10-Agent双模式接入真实准入收口-r2-glm.md
---

# 目录压缩补充计划逐条裁决

本轮按用户明确授权仅gemini、glm两侧，入口A、Driver=codex，主题累计第3次正式运行。两份全文均已读；Gemini request-changes（1 blocker、2 major、1 minor），GLM approve-with-nits（2 minor、2 nit），双方结构化/evidence_ok有效、parse_fallback=false。共同阻断状态pending，待裁决复算，不提前称通过。服务端身份未取证；Driver模型未声明，不猜本会话身份。GLM读取自己历史审查件合法，事后同行/敏感读取未命中；两侧不支持CLI路径级deny，不能称事前拦截。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | blocker | 接受 | 活跃TV指向安装副本，新的doctor与压缩逻辑必须先安装；否则最后三审再次运行旧bundle，确有依赖倒置。 | r5完整顺序：实现/单项检查→build/install并核对→新doctor目录取证→固定源码后两次串行check/14步桩/最终build/install→核对稳定bundle/module/config→版本与能力臂→三家代码审；能力取证之后不再无故重建改变bundle指纹。 |
| AGY-02 | gemini | major | 接受 | 异质工具绑一臂会因早退全部null；接受拆臂，不接受仅Read成功即可宣称其它工具目录拦截。 | ClaudeProbe按运行时读工具名保存可缺三态map；Read/Grep/Glob与目录查询分臂，各自只消费实际唯一ID/精确目标/配对拒绝+完整交付。未核实工具维持原逐文件规则；不降原验收标准、不反复换提示。 |
| AGY-03 | gemini | major | 接受 | 混合精确与目录规则需明确报告字段的组合条件，既有A14语义不能静默失真。 | 混合注入时peer_deny_applied=file_shape_verified===true且所有实际压缩工具的目录探针===true；不压缩时保持原条件。trace保存逐工具投影/目录证明，现有数量/字节/skipped进结果判定面；更新A14及各出口、旧字段缺省回归。 |
| AGY-04 | gemini | minor | 接受 | 字符串前缀会误吞calls_extra，必须写死分隔符边界。 | 同一规范路径坐标下P===D或P.startsWith(D+'/')才归属；拒绝父目录/非字面glob/非规范段，不擅自realpath或猜共同前缀；相邻前缀、嵌套根和去重单测。 |
| GLM-01 | glm | minor | 接受 | 临时夹具与真实项目正对照需要明确环境，不能把夹具读数叫真实路径复测。 | 独立cwd夹具复制生产目录拓扑，archive出口构造假己方历史/Driver稿与audit-snapshots，全部假哨兵；其CLI正对照仅证该拓扑。真实项目完整枚举另做静态不连坐对账，并在最终真实三审核验合法文件读取；两种证据分别记录。 |
| GLM-02 | glm | minor | 接受 | dotfile、嵌套与特殊文件名必须实测，当前字符串包含不等于厂商glob语义。 | 各目录工具臂点名普通/嵌套/.hidden/嵌套隐藏/中文空格逗号及带方括号文件名；缺实际调用null、泄漏false，工具不启用压缩并保留原规则。不同意实测失效后仍宣称压缩覆盖而仅靠事后兜底；事后检测保持。 |
| GLM-03 | glm | nit | 接受 | 含/**的投影输出会被现有representable拒绝，需钉死裸目录形状与留痕归属。 | 投影输出为裸目录D；现有buildDenySettings生成D与D/**两规则。CLI逐工具投影、来源覆盖计数、源/投影hash落trace.json.denySettings；run.v3现有deny_rule_count/deny_bytes/deny_skipped及peer_deny_applied保留，不修改历史Schema，不将压缩比例冒充报告通过。 |
| GLM-04 | glm | nit | 接受 | 目录事实新增doctor路径但桩自检是编排闭环，两者要分清并覆盖三态持久化消费。 | selftest仍14步桩编排闭环、cli_version=stub/0.0.0，不增加真实CLI步骤、不声称验证目录能力；新增单测/假CLI验证可缺map、缺/null/false/true逐工具消费、路线版本/入口指纹失效、保存/读取及各失败出口。 |

8条全部接受，无静默遗漏。以上合入r5完整计划，本轮人工批准前不实施生产目录投影、厂商新探针或其字段。先gate检查再await-approval，不自行approve，不借code1审批。原写标准、模型/effort/共享三审、历史原件均不改；下一次恢复三家代码审是主题第4次，不能另起主题绕上限。

审查期间297个冻结源码/测试/报告hash均未变；start/wait/status与worker的calls/ledger/loaded新增被记录为无关漂移warn，完整原件保留，不称零漂移。模型族unknown及安装副本过期告警原样保留。review预检9次超过事前估8一次的偏差已登记；本正式启动批实际4次，在19/40起始的硬上限21内，当前review23/40，全部完成；admission136/156。原预算记录不覆写，不把事后纠偏当成事前满足。

Driver另外核对到现有canonical还需收紧两处：Codex版本引用必须消费同一manifest关联的实际native子边界入口/hash（当前native_entry字段仍可能指Node包装器，另有ledger真实原件）；Codex读取helper应显式拒绝缺fixtureRoot的上下文，不能让两个null路径比较相等。二者属于code1已接受的版本/精确目标整改，不推断当前实现已完整。r5列明待完成及反例回归；本轮停点期间不修改代码。
