---
schema: trivium.review.v1
topic: M10-任意Driver
stage: plan
role: codex
vendor: openai
agent_cli: codex/0.155.1
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: trace
model_route: config_copy
run_id: 20260922T004543Z
rerun_index: 3
snapshot_hash: sha256:843b35476b44e9830f4145d2ea501c5908dea482b0637d2d0fd88904c6291c95
blind: true
started_at: 2026-09-22T00:45:44.477Z
finished_at: 2026-09-22T00:56:21.448Z
duration_s: 637
tool_calls:
  run_command: 15
  project_reads: 9
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 0
  minor: 0
  nit: 0
degraded: false
parse_fallback: true
peer_deny: false
drift: false
readonly_verification: unavailable
path_verification: unavailable
joint_check:
  state: skipped-insufficient-sides
  effective_sides: 1
heterogeneous: true
session_id: 01a0c693-6a10-7cd2-b0a2-b8ebf070021a
---

# 计划审查：M10-任意Driver

> Critic-C · OpenAI Codex ｜ 模型 `qwen3.8-flash`
> ｜ 运行 `20260922T004543Z` ｜ 第 3 轮
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **解析降级**：本侧输出未能解析为结构化结论，下方为原文。该侧不参与阻断判定。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 原始输出（未能结构化解析）

```
```json
{
  "schema": "trivium.review.v1",
  "verdict": "request-changes",
  "summary": "r3 的两处全节重写方向正确且核心事实经代码核实成立（原稿确不进 artifacts[]、判据改「登记 ∪ 位置」后 GLM-01 缺口在提交锚侧确实消失）。但发现两个 blocker：①§4.1.2 第 2 条「_meta/ 内一切拦」与现行刻意豁免的便利副本 changes.diff 冲突——每轮收尾都覆盖写该文件，按位置一刀切会把正常的留痕提交全拦死，且 §4.3 用例把它锁成测试事实；②D11 + §1.3.1 + §1.2 三处合读构成循环依赖——EV-82 的结案证据由第 7 步 gemini 轮充当，而第 7 步开工钩子要求 EV-82 先结案，按字面第 7 步永远启动不了。另有 claim 与同阶段留痕的不变量洞、§1.4 触发口径缺时点等四条中低意见。逐行核对明细见 findings 与 agreed。",
  "findings": [
    {
      "id": "CODEX-01",
      "severity": "blocker",
      "layer": "plan",
      "kind": "correctness",
      "location": "§4.1.2 第 2 条 / §4.1.3 行为表第 4 行 / §4.3「_meta/ 内任一文件改 ⇒ 拦」",
      "problem": "「位于 _meta/ 目录内 ⇒ 拦」按位置一刀切，与现行设计中刻意留着的豁免正面冲突：`_meta/changes.diff`（便利副本）每轮被 writeMeta 覆盖写，review.ts:846 注释明写「它不进保护集：它只是指向最新一轮的便利副本，会被下一轮覆盖」，hooks.ts:485 也把「便利副本 changes.diff」与 task.json、原稿、裁决件并列为「本就可变」。现行 IMMUTABLE_META 正则（hooks.ts:487）写作 `changes-.+\\.diff`、刻意不匹配裸名 `changes.diff`，是有意区分而非疏漏。按 r3 的行为表与 §4.3 用例实施后，任何包含新一轮归档的 `git add .reviews && git commit` 都会因该文件状态为 M 而被提交锚拦死，claude 兼容回归（J3「Hook 行为不变」）直接爆红，且这是阻塞正常工作流的回归——本仓自己 r1→r2→r3 的提交工作流第一个撞上。",
      "evidence": "读 src/trivium/review.ts:836-852（alias 写入且不进 metaArtifacts）、src/trivium/hooks.ts:483-508（IMMUTABLE_META 与 null 豁免注释）、被审件 §4.1.2/§4.1.3/§4.3 相应段落。§4.1.3 行为表第 4 行写「_meta/ 内一切｜不可改」，全文（含 R-j 回补条款）无一处提及该豁免的去留。",
      "suggestion": "在第 2 条上显式处理便利副本：要么为其保留具名豁免并同步改 §4.1.3 行 4 与 §4.3 用例措辞（「_meta 内除便利副本外」），要么把删掉 alias 一并纳入第 3 步范围并记入 §8.3 白名单（它本身就是 claude 侧 `.reviews` 布局差异）。二者都要写明，不能靠实施时「按既有不变量」兜。",
      "confidence": "high"
    },
    {
      "id": "CODEX-02",
      "severity": "blocker",
      "layer": "plan",
      "kind": "plan",
      "location": "§1.2「EV-82…完成判据」+ §1.3.1 第 7 步钩子 + §8 前置① + D11 回退行",
      "problem": "三处合读构成循环依赖：§1.2 钉死「EV-82 的复验由 §8.2 的 gemini 轮充当，不要求小主题自带」——即 EV-82 唯一的结案证据产生于第 7 步内部；而 §1.3.1 与 §8 前置①规定「第 7 步开工前核对 EV-82 已结案；未结案则退非零并停止」，并明文拒绝「推迟带 glm 的轮次」这条出路。结论：按本稿字面，EV-82 在第 7 步之前永远无法结案，钩子永远退非零，第 7 步永远启动不了。另 §1.3 依赖图旁注写的是「须早于第 7 步的 gemini 轮」，与 §1.3.1 的「第 7 步开工前」措辞不一致，恰好掩盖了这个矛盾。",
      "evidence": "被审件 §1.2（「该复验由 §8.2 的 gemini 轮充当（D11），不要求小主题自带」）、§1.3.1（「第 7 步开工前：同样核对 EV-82 已结案；未结案则退非零并停止……不是推迟带 glm 的轮次」）、§1.3 依赖图（「[并行小主题 B] EV-82 ──→（须早于第 7 步的 gemini 轮，D11）」）、§8 抬头前置①。四处互相引用，构成闭环。",
      "suggestion": "三选一并全文对齐：(a) EV-82 小主题自带一次含 glm 的最小复验（把「不要求小主题自带」倒过来），第 7 步 gemini 轮只作 FR-06 的里程碑证据而非结案判据；(b) 钩子核对对象改为「EV-82 修复已落地（代码合入 + 探针级证据）」，结案状态由 gemini 轮跑绿后在第 8 步登记；(c) 接受 r2 CODEX-03 选项②（前置改指 FR-06 证据面），与 D11 二选一。无论选哪条，§1.3.1、§1.3 图、§8 前置、D11 回退行的时点措辞必须逐字一致——这正是 D11 自己批判 r2 的「散文前置」病灶换了个方向复发。",
      "confidence": "high"
    },
    {
      "id": "CODEX-03",
      "severity": "major",
      "layer": "plan",
      "kind": "contract",
      "location": "§3.2.2 / §3.2.3 / §3.2.4",
      "problem": "「drivers 与 runs 两份取值的不变量」有洞：claim 只与自身声明字段比对（§3.2.2 只写「该阶段已声明且不同 ⇒ 64」），不核同阶段已有的 run 留痕。合法序列：不带 claim 的 `review --start --driver claude`（CLI 手工路径、第 5 步之前的过渡形态）落了 code 阶段留痕 ⇒ 之后 `topic claim --stage code --driver zcode` 成功（无既有声明）⇒ 产生「同阶段声明= zcode、留痕=claude」的死锁态：此后 zcode 入口资产跑 `--start --driver zcode` 被 §3.2.3「有留痕 ⇒ 与最新留痕比对，不符则报错」拒绝；claude 再 start 又被 drivers 声明方向的校验卡住；无覆盖旗标、task.json 对 Write/Edit 独占（isOrchestratorOwned 含 basename==='task.json'），用户侧唯一出路是绕过护栏手改文件。且 §3.2.4 为「不一致 ⇒ 以留痕为准、只提示不报错」给出的理由是「跨阶段换 Driver 合法」——按阶段键之后，drivers[stage] 与 runs[stage] 的不一致根本不可能是跨阶段造成的，该论证自相矛盾：同阶段不一致没有任何合法来源。",
      "evidence": "被审件 §3.2.2/§3.2.3/§3.2.4 原文；src/trivium/hooks.ts:477-481（isOrchestratorOwned 含 task.json，直改不可能「合规」发生）；src/trivium/meta.ts（task.json 读写为编排器临界区）。跨阶段换 Driver 的合法形态在 §3.3 用例里是「plan 有留痕 + code 零留痕」——该用例本稿确能放行，问题只出在「先 start 后 claim」这个未列举的同阶段序。",
      "suggestion": "claim 在写入前核该阶段最新 run 留痕：有留痕且不同 ⇒ 退 64（fail fast，与 §3.2.3 对称）；§3.2.4 随之改为「同阶段不一致没有合法来源 ⇒ 预检报错」，删去「跨阶段换 Driver 合法」这句放错了位置的括号理由，或把它改写到真正跨键的场景上。§3.3 补一条「start 之后 claim 不同 driver ⇒ 64」的用例。",
      "confidence": "high"
    },
    {
      "id": "CODEX-04",
      "severity": "major",
      "layer": "plan",
      "kind": "scope-drift",
      "location": "§1.4 量级表与「触发口径」段",
      "problem": "量级仍偏乐观且触发口径不可执行：①「双审轮次实际 > 9 ⇒ 回补 §16.1 估算」没有计点时点——轮次是逐步累计的，不写明「每步收尾时核对累计」就永远不会有人去数；②「第 1 步结束时累计墙钟 > 1 个工作日」的时点恰好选在唯一不可能超支的环节（第 1 步只含约 12-16 次调用），把触发窗口设在了风险最小的地方，而超支真正发生在第 5-7 步（P-2 不可降级的 zcode 真载体反复重试、glm 行人机串行、重跑口径「单侧失败整轮重跑」上不封顶）；③「6～9 轮」口径不含第 7 步 4 轮命令 B（每轮 2-3 次真实调用、14-19 分钟）与重跑，若本里程碑各步的计划稿也走 plan 档双审（本主题自身的 r1→r2→r3 已是 3 轮 plan 档），合计翻倍。综合看「2～3 天」的 §16.1 估算在本稿证据下已可判不成立，不该等触发条件命中才回补。",
      "evidence": "被审件 §1.4 全表（含 r2 CODEX-07 补的四行）、§1.3「缩减口径/重跑口径」、§8.2 四行剧本、§11 R-b/R-h（P-2 硬阻塞不封顶重试）；本主题自身留痕（抬头「r1 实测 plan 三侧 14m23s／r2 18m19s」）即是各步计划稿也要 plan 档双审的直接证据。",
      "suggestion": "两件事：(a) 按纪律 1 在计划里直接回补 §16.1 的「2～3 天」为修正值（如「2～3 周墙钟、10～14 轮真实双审」），触发口径降级为兜底而非主机制；(b) 把「每步收尾核对累计轮次与累计墙钟」写成 §12 的可执行步骤，与 §1.3.1 两条钩子同一执行形态，并定义「工作日」按墙钟还是按有人值守时间。",
      "confidence": "medium"
    },
    {
      "id": "CODEX-05",
      "severity": "minor",
      "layer": "plan",
      "kind": "test-gap",
      "location": "§4.2.1 五形态表",
      "problem": "表格漏了 WRITE_LIKE 已列而本仓库日常会用的另一族形态：`git stash push <path含 -claude.md>`、`git checkout -- <该文件>`、`git restore`、`git reset <该文件>`（hooks.ts:678 全部在 git 写动词清单内）。D3 后这些「撤销/暂存带后缀已跟踪文件」的命令因命令文本含全集体字面被拦，而表内给出的出口（改用 Write / Edit、`git commit -F`）对「丢弃工作树改动 / 暂存某文件」这个意图不适用——Write/Edit 无法反向 restore。焦点问题点名「有没有遗漏本仓库当前在用的形态」，这一族是真实在用的。",
      "evidence": "src/trivium/hooks.ts:672-687（WRITE_LIKE 的 git 动词清单含 checkout|restore|switch|stash|reset|…）与 :869-871（roleSuffixAnywhere 全命令文本字面拦）；被审件 §4.2.1 表五行均未覆盖 restore/stash 形态。",
      "suggestion": "补一行「撤销/暂存带后缀文件（git stash/checkout/restore）」并写明出口（终端直接执行——反正提交锚只挂 Claude Bash matcher，这条出口与 R-c「强制力单向」的登记天然一致），或论证该形态在入口资产流程里不会出现。",
      "confidence": "medium"
    },
    {
      "id": "CODEX-06",
      "severity": "minor",
      "layer": "plan",
      "kind": "contract",
      "location": "§4.1.1 / §4.1.3 行 2 / §8.3 白名单第 3 行",
      "problem": "「原稿」被当成了一个跨阶段的单一概念，但 code 阶段的「原稿」就是 `_meta/changes-<runid>.diff`（code-stage.ts:15 注释明写「它就是 subject_path」），而它已经在 metaArtifacts 登记进 artifacts[]。后果有三：①4.1.1 的「只需多 push 一条」在 code 阶段会重复登记同一路径；②§8.3 白名单第 3 行的取值口径「该轮被审原稿的归档相对路径」对 code 轮次指向的是一份本就已登记的补丁，兼容性 diff 的「新增条目」在 plan 轮与 code 轮形状不同，口径没写死；③§4.1.3 行 2「审查件……落盘即登记」不确——登记发生在 run 收尾（review.ts:1485-1494 追加），落盘到收尾之间该文件靠后缀保护而非第 1 条，行为表措辞会让实施者按「prepareRun 时机」去理解。另外新条目在数组中的插入位置（前置/追加）未钉，「逐字节不变」的白名单比对需要一个确定值。",
      "evidence": "src/trivium/code-stage.ts:5-15、src/trivium/freeze.ts:440-452（code 阶段 subjectPath=changes-<runid>.diff）、src/trivium/review.ts:835-852（补丁先行登记）与 :1484-1494（收尾追加语义）；被审件 §4.1.1「原稿路径在运行期 request.subject_path」、§4.1.3、§8.3。",
      "suggestion": "§4.1.1 加一句阶段判别：subject_path 已出现在本轮 artifacts[]（code 阶段）则跳过重复登记；§8.3 第 3 行补「条目位置=数组尾部追加（或具名）」并写明 code 轮该白名单行预期为空/不新增；行 2 依据改为「收尾时登记；窗口期由 Bash/Write 后缀保护覆盖」。",
      "confidence": "medium"
    }
  ],
  "agreed": [
    "§4.1 的根因诊断经代码核实成立：prepareRun 的 metaArtifacts 只含补丁与两份 brief（review.ts:835-893），收尾追加的只有 protectedMeta 与审查工件（:1485-1494），run.json 对原稿只有 subject_sha256 无路径——「4.1.1 是第 1 条对原稿生效的前提」为真，§4.3 的对应变异（去掉登记 ⇒ 送审后改原稿用例红）设计正确。",
    "判据改为「登记 ∪ 位置」后，提交锚不再需要按后缀区分原稿与审查件，GLM-01 指出的「需要当轮 Driver 才能判别」缺口在跨时间面上确实消失；Write/Edit 当轮面继续用 resolveRoundDriver 不受影响，两界分得干净。",
    "§4.1.3 行 3 裁决件落可变侧成立（不登记、不在 _meta/），且免掉了 r2 的显式排除特例；行 5 task.json 成立（meta.ts:132 在主题根、不在 _meta/ 下）。",
    "§3.2 按阶段拆分与第 1 级「按阶段取留痕」同构，D1 的回退路径干净（可选字段、读侧忽略即回今天）；§3.3 的跨阶段核心用例（plan 有留痕 + code 零留痕 + claim zcode）在三级判定下逐步推演确能放行。",
    "§8.3 白名单第三行作为 J3 的松动是必要的：把原稿登记限定于非缺省 Driver 会重新引入「按 Agent id 分叉保护集」，违背纪律 7/12 的精神，白名单是两害相轻的那一个。",
    "§2.6「无运行期消费方不进 ProbeSection」是对 F-1/EV-06 教训的正确应用；§6.2.3 临时 home 注入与两层安装验证与纪律 9 一致；§4.2.3 对 AGY-01 两轮读法的存档与「若实测推翻按纪律 1 回补」的处理方式是诚实的。"
  ],
  "not_covered": [
    "未逐字核对 doc/02_design 主设计 §16.1/§7.1/§8.5/§24.1 与演进设计原文是否与计划引用一致（只抽查了代码侧行号引用）。",
    "未运行 npm run check，「1566 用例」基线数字未复验。",
    "F-2/F-3/F-4 涉及的探针与适配器实现细节（probes/zcode.ts、prepareZcodeHome）未逐行读。",
    "§6 渲染层（skills-src/、carriers yaml、四处 --driver 注入点是否覆盖全部命令面）未展开审查。",
    "§8.2 剧本中 codex 行「夹具级」与 EV-77 真载体写事件的具体操作性未评估（属另一位镜头角度亦未越界深挖）。",
    "配额数值（各家 CLI 计费、900s 超时配置的出处）未对 settings/registry 实测核对。"
  ],
  "consulted": [
    ".reviews/M10-任意Driver/plan/2026-09-22-M10-任意Driver-r3-claude.md",
    "src/trivium/hooks.ts",
    "src/trivium/review.ts",
    "src/trivium/meta.ts",
    "src/trivium/archive.ts",
    "src/trivium/freeze.ts",
    "src/trivium/code-stage.ts",
    "src/trivium/cli.ts",
    "src/trivium/types.ts",
    "src/trivium/agents/registry.ts"
  ]
}
```
```
