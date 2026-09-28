---
schema: trivium.review.v1
topic: worker启动时刻规范化
stage: plan
role: codex
vendor: openai
agent_cli: codex/0.157.1
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: trace
model_route: config_copy
run_id: 20260928T110842Z
rerun_index: 1
snapshot_hash: sha256:88c5d085b6972b67266173a81daa4d38d69006c174225742938a397e735666cc
blind: true
started_at: 2026-09-28T11:08:44.037Z
finished_at: 2026-09-28T11:18:11.727Z
duration_s: 566
tool_calls:
  run_command: 20
  project_reads: 28
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 3
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a0e7b3-f068-7590-abb5-1fd84c7ef52d
---

# 计划审查：worker启动时刻规范化

> Critic-C · OpenAI Codex ｜ 模型 `qwen3.8-flash`
> ｜ 运行 `20260928T110842Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

计划对现状的复述经我逐条回源核实基本准确：写者恰好三个加 newStatus、身份消费方恰好八个另加两处只看存活、fallbackPidStartedAt 生产确实不传、mismatch 告警现文已引用 EV-158、patchStatus/writeStatus 整读整写保留未知键（A7 的依据成立）、D4 的 spread 隐患在 :437/:638 两处真实存在。范围守住了用户决策，配额与成本路径成立（全桩、零厂商 CLI）。三条意见都是计划便宜时能补的：①规范化形态本身成为盘上契约却无格式不变量的登记，未来改渲染会制造比 EV-158 更坏的静默全量错配；②W/R 环境对没有「形态确实互异」的自检断言，同形机器上 b 格断言会静默真空；③basis=canonical 下「活进程而规范化值不符」的方向二形态只在 C7 钉了格，C2/C4 的抹除与回收没有对应对。均为 minor，不拦。

**结论**：`approve-with-nits`

## 审查意见（共 3 条：次要 3）

### CODEX-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4.1 / §9 D1、D3` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | medium |

**问题**：规范化形态（`-o lstart=` + LC_ALL=C + TZ=UTC0 的产物）自本主题起成为跨进程、跨版本的盘上比对基准，且新读者「有规范化字段就只看它」，但计划没有把「这个形态是冻结契约」写成一条可依据的规范：未来任何一次改动——换渲染格式、调 env、换旗标——若就地改而不换字段名/版本位，旧版规范化写下、新版读取的记录会**同环境也全部判「不是同一进程」**，方向恰是最坏的那一侧（活 worker 判复用 ⇒ 抹凭据、回收锁、补收 run.json），而且这正是本主题在格子 d/e/f 上花大力气论证过的那类跨版本窗口的第二次发生，只是这次连环境相同都救不了。

**依据**：src/trivium/util/exec.ts:524-539（processStartTime 的 canonical 实现：`env: { LC_ALL: 'C', TZ: 'UTC0' }` 叠加在 :194 拷贝的 process.env 之上）——该形态现在是磁盘记录的一部分；计划 §4.3 规定 basis=canonical 时「不再看 rec.legacy」；BACKLOG EV-158 条目（doc/08_project/BACKLOG.md:256）的候选设想同样是「改用规范化形态」而未提形态变更的治理。项目惯例是盘上契约带版本号（run.v1/v2、status.v1、config.v2），本字段是首个无版本位的比对基准。

**建议**：在设计 7.5 新增段与 `processMatchesRecord`/`processStartTime` 的文档块里写死一句契约线：「规范化形态 = 该组旗标与环境的确切产物，是 status.json/锁文件的盘上契约；任何变更必须换新字段名（或带版本前缀的取值），禁止就地改渲染」；不需要加版本机制，只需把这条判据落在文字与注释里，让改它的人撞见论证。

### CODEX-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5.1、§5.4` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | medium |

**问题**：全部「b 格翻过来」的断言（U1、I2~I6、A1）的判据强度依赖「W 与 R 的缺省形态确实互异」这一环境前提，而计划只把这一点写在 §2 的实测里、没有把它变成用例的前置断言。§2 自己承认存在「写者恰在 TZ=UTC 且 C 区域时缺省形态与规范化形态逐字相同」的巧合、并要求验收避开——同样的巧合在别的机器/别的 locale 安装状态下（fr_FR/de_DE/zh_CN 未安装时 macOS 的 libc 回退、CI 镜像精简）也会让「W≠R」名义成立而实际同形；那时 U1 的 alive&&sameProcess 在 basis=legacy 下也能给对（同形 ⇒ 缺省比较相符），断言静默退化为真，M5（去掉 canonical）一类变异未必还咬得住全部格子。

**依据**：计划 §5.1 定义了 W=R 的环境对但未要求构造时自检；§2 巧合段；src/trivium/util/exec.ts:193-198（run() 的 env 叠加语义：canonical 覆盖必然生效，但缺省形态 = 叠加前的 process.env，是否互异取决于本机 tzdata/locale）；test/unit/cli-group-record.test.ts:236 的 U16 也是靠进程内改 env 后「缺省的随之变化」的断言把这一前提做成了可执行事实——同一做法应搬到本主题的每格构造里。

**建议**：在 §5.1 补一条共享前置：每格造记录时先断言「W 下取的缺省形态 ≠ R 下取的缺省形态，且两者 ≠ 规范化形态」，不满足即该格 fail fast（或在 §5.4 验收脚本的环境准备段一次性自检并打印三个形态）；§5.2/§5.4 说明这条自检同样适用于真实子进程一侧。

### CODEX-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5.1 U5/U6/U8 与 §4.4 表` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：「进程活着、但规范化字段有值且与真实启动时刻不符」（真 PID 复用 / 手改记录）这一形态只在 C7 有一格（U8 的「规范化字段填一个别的时刻 ⇒ mismatch」）。而本主题翻转过来的正是方向二的承重路径：C4 会据此把活持有者的锁当 `pid_reused` 回收、C2/C3 会据此放行抹凭据与整删候选——这些「不符 ⇒ 判不是同一进程」的新读者分派没有各自的直接钉格（U5 的回归格是删字段、U6 的判据是 R 环境下的正常比对）。按现在的计划做完，若某消费方在 mismatch 分支接错（例如把 sameProcess=false 误并进 alive），要到真实复用事故才会现形。

**依据**：计划 §5.1 各格列出的构造里没有 C2/C3/C4 的「活进程 + 规范化值不符」格；src/trivium/lock.ts:80-83（judgeStale：!sameProcess ⇒ pid_reused，回收在跑的锁）；src/trivium/status.ts:191-196 与 src/trivium/retention.ts:99-103（gone/alive 两判据在 sameProcess=false 时放行抹除与整删候选）——这三处的后果面（不可逆回收/抹除）重于 C7 一格。

**建议**：在 U5、U6 各补一格：本线程起的活 sleep 进程，把记录/锁的规范化字段改成另一个合法形态的值 ⇒ C4 判 `pid_reused`、C2 判可抹、C3 不算活着；并在 §5.3 对应变异里加一条（如 C4 把 mismatch 误当持有者）验证该格咬得住。

## 认为正确的部分

- §1.2/§1.3 的写者与消费方清单经全量 grep 核实完备：`worker_started_at`/`pid_started_at` 的写点恰为 newStatus（status.ts:107）、acquireLock（lock.ts:171）、startRun（run-protocol.ts:433-448）、settleOrphanedStart（:621-640、:697-708），身份比对消费方恰为所列 8 处，另两处 `processAlive` 调用（hooks.ts:1748、run-protocol.ts:1154）确实只取 `.alive`，§4.5 的「不改」判断成立；hooks.ts:1718 的注释与实现不符也属实（它只取 .alive，文档块却写『比对启动时间』）。
- D4 是真隐患且指认准确：run-protocol.ts:437 与 :638 两处 spread 改写今天确实只覆盖 run_id/pid/pid_started_at，本主题后会把 --start 自己的规范化值留给 worker 的 pid；收成 `workerLockContent` 纯函数 + U4 + M2 的钉法是三处里成本最低的。
- A7 的依据成立：patchStatus（status.ts:142-161）读改写整份对象、writeStatus 直接 JSON.stringify（:118-121）、readStatus 不校验白名单（:123-131），旧版读改写确实保留不认识的新键。
- §1.3 末段「fallbackPidStartedAt 生产不传」属实：run-protocol.ts:1118-1121 的 interpretStatus 入参只有 heartbeatStaleMs 与 fallbackPid，全仓仅此一处生产调用。
- D6 与现状衔接正确：run-protocol.ts:1600-1607 的现告警确实写着「也可能是本命令的 TZ / 区域设置与 --start 不同（BACKLOG EV-158）」并让人换回原环境——basis=canonical 后这句不成立，按 basis 分写是必要的；处置不变符合 CODEX-02 既有结论与用户决策。
- D5 的取舍成立：run() 在每次调用时拷贝 process.env（exec.ts:194），缺省形态缓存会改今天行为、规范化形态与环境无关可缓存；withGlobalLock 40 次重试每次多一次派生的成本判断与 lock.ts 现状相符。
- §7.1 对 BACKLOG 原候选「比对时两种形态都试」的否决论证成立（没有规范化字段就没有规范化基准，『都试』退化成今天的比法）；格子矩阵 a~j 对覆盖矩阵的回应用户决策逐条对得上（新旧两方向、判据不读人读文案、取不到的处置、严格判据沿用）。
- EV-158 注记要求的「一并复核 --cancel 按记录结束 CLI 那两格」已被 C2/C5/C7 的换读法实际覆盖；`sides[].cli.started_at` 一侧本就是规范化形态（status.ts:283、judgeCliGroup），不需要动，计划的「不做」清单与此一致。
- 零配额路径成立：全部验证走真实 bundle + 桩（hang_cli 在 6b89cc0 已存在，evidence/lost-worker-cancel-20260928 骨架可直接沿用）、真实 git/子进程夹具，不触任何厂商 CLI；成本面（两次 ps、缓存、basis 分派）的增量核算如实。

## 未覆盖范围（本侧盲区）

- 未执行任何构建、测试或实测命令（沙箱只读），§2 实测表只核对了它与 U16 既有实测（REPORT_2026-09-28_cli_pgroup_record 的 U16/M15 我只引用未全文复核）。
- 未逐行核对 §1.4 列举的既有用例行号（lock.test.ts :27 等约 20 处），只对 fixture.ts 的 cli() 签名（确不收 env）与 U16 存在性做了核实。
- 未读 .reviews/CLI进程组记录 与 .reviews/失联后取消挂住的worker 两主题的历史审查件原文（计划转述与其在 LLD/BACKLOG 的记载一致，判为可引用），亦未读另一审查员的任何产出。
- 锁改写非原子（run-protocol.ts:434-442 直接 fs.writeFile 而非临时文件 + link，撕裂读 ⇒ unparsable ⇒ 活锁被回收）是本计划未触及的既有隐患，与 EV-158 无直接因果，我没有展开成意见——建议 Driver 自行判断是否登记 BACKLOG。
- 未评估 gate/禁读矩阵/registry 派生面（本主题不新增 Agent 差异，判断为不相关）；未评估 run.v2 与归档 schema（计划明确不动）。
- 回滚路径只核了文件格式面（旧读者忽略新键、patchStatus 保留），未实际演练 `git archive 6b89cc0` 构装旧 bundle 的工具链前提。

## 实际查阅的项目文件

- `.reviews/worker启动时刻规范化/plan/2026-09-28-worker启动时刻规范化-claude.md`
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/LLD_orchestrator.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/08_project/BACKLOG.md`
- `src/trivium/util/exec.ts`
- `src/trivium/lock.ts`
- `src/trivium/status.ts`
- `src/trivium/retention.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/hooks.ts`
- `test/helpers/fixture.ts`
- `test/unit/cli-group-record.test.ts`
- `skills/dual-critic/schema/`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":20,"project_reads":28}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
