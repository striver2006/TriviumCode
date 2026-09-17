---
schema: trivium.disposition.v1
topic: 凭据副本残留与参数静默丢失
stage: code
role: claude
kind: response
run_id: 20260917T045959Z
addresses:
  - 2026-09-17-凭据副本残留与参数静默丢失-r2-codex.md
  - 2026-09-17-凭据副本残留与参数静默丢失-r2-gemini.md
  - 2026-09-17-凭据副本残留与参数静默丢失-r2-glm.md
---

# 代码应答（r2）：两处「修了一半」，三侧各自从不同角度指出来

## 0. 总裁决：22 条全部接受，零驳回

三侧齐备（codex 10、gemini 7、glm 5）。**两处三侧独立收敛**，且都不是新缺陷，是我 r1 修复**只收了一半**：

1. **PEM 判据的误报没关死**（CODEX-01 ≡ GLM-01 ≡ AGY-06）。我把「只认标记」改成「标记 + 400 字符窗口内有 40 连续 base64」，而 `[A-Za-z0-9+/]` 覆盖整个十六进制字母表——`sha256:` 是 64 位 hex，git SHA-1 是 40 位，**本项目每一份 BRIEF 与审查文档的被审对象表里都有**。于是「谈论 PEM 标记 + 顺手引一个哈希」照旧命中，r2 那次三侧配额作废的路径原样还在。三侧各自实测复现了，我也复现了：标记 + sha256 → 1 处命中。
2. **`worker_lost` 与清扫并不同源**（AGY-01、CODEX-05 ≡ GLM-02，三条指向同一处但切口不同）。最严重的是 AGY-01：`waitRun` 判 `heartbeat_stale` 时**把活着的进程写成 `failed`**，而清扫对终态目录根本不查进程——我那句「留给会话启动清扫」的承诺，反过来变成了「下次会话启动无条件抹」。我 r1 加的复核只挡住了同一次 `--wait` 内的那一瞬，闭环的另一半自己捅开了。

两条的共同形状：**我修的是症状所在的那一行，没有回头问「这个判据在别的入口上是什么样」**。r1 的教训写的是「落点清单不能靠记性」，这次是它的下一层——判据本身要有唯一落点，否则同一个决定会在三个地方长出三个版本。现在 `workerConfirmedGone` 是唯一落点，三处共用。

其余 18 条见 §1 逐条裁决。实施完成，全量 1268 条全绿，冻结预扫 0 命中，变异验证见 §3。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | major | 接受 | 属实且我复现了：标记 + `sha256:` → 命中。判据写成「附近有长串」而不是「正文位上是材料」，等于把误报面交给了上下文的运气，而本项目的留痕里哈希密度极高 | `secrets.ts`：`PEM_GAP` 只允许跨换行与 PEM 头部行（`Proc-Type:` / `DEK-Info:`），材料必须在**正文起点**；设计 §10.5 那句「两个方向一起收口」改准 |
| GLM-01 | glm | major | 接受 | 同一事实，且给出了更锋利的判据：材料段要求至少一个非 hex 字符。它的论证是对的——真 base64 前 40 字符全落在 hex 的概率是 4^-40，排除纯 hex 几乎不损失检出面，而抬高长度下限挡不住 64 位的 SHA-256 | `secrets.ts` 的 `PEM_BODY` 加 `[g-zG-Z+/]` 要求；用例覆盖「标记 + 40 位 SHA-1」「标记 + 64 位 SHA-256」「正文位上的纯 hex」三种都不命中 |
| AGY-06 | gemini | nit | 接受 | 与上两条同一事实（它把严重度记为 nit，三侧交叉后按 major 处置）。它另提的「PEM 正文按 32/36 字符折行会漏报」我核了：标准 PEM 每行 64 字符，openssl 不产出 32 字符折行；非标准折行属 R25 的蓄意规避边界，不在论域 | 同 CODEX-01 / GLM-01；折行一条不改，理由记在此处 |
| CODEX-02 | codex | major | 接受 | 属实。我复现的形态与它描述的略有出入——JSON 仍然合法，但**相邻的 `hash` 字段被整个吞进占位串而消失**，比解析失败更隐蔽：没有任何报错，数据静悄悄少一块 | `secrets.ts` 的 `PEM_REDACT` 尾部只吃 base64 与换行，不吃引号逗号；新增用例断言相邻 JSON 字段一个不丢 |
| CODEX-03 | codex | major | 接受 | 属实，是 EV-24 同族的第三格，而且**我本轮新写的 skill 指引正好诱导它**：教用户把原文整段传 `--reason`，而本项目的附言极可能以 `--focus` 这类词开头。`parseArgs` 把它降级成布尔真、`flagString` 返回 null、命令退 0、reason 落 null | `cli.ts` 的 `flagString`：值为 `true` 即退 64 并给出 `--k=<值>` 的出口；集成用例断言退 64、且 `--reason=<值>` 形态真能用并原样落盘 |
| AGY-01 | gemini | major | 接受 | **本轮最重要的一条**。属实：`waitRun` 在 `heartbeat_stale` 下把 phase 写成 `failed`（终态），而 `pruneRunDirs` 只在 `!isTerminal` 时查 `processAlive`——我承诺的「留给清扫」于是变成「下次会话启动直接抹」，而进程可能还活着。我 r1 的复核只覆盖了同一次 `--wait`，没回头看闭环的另一端 | `status.ts` 新增 `workerConfirmedGone`：**终态也查进程**；三处挂载点共用它 |
| CODEX-05 | codex | minor | 接受 | 同一处的另一个切口：② 只读 `status.worker_pid`，取不到就判「不活」直接抹；④ 对同一状态跳过并计 unknown；② 还不用同函数里已有的 `fallbackPid`。建议的「抽共用判据」正是采纳的形态 | 同 AGY-01；`worker_lost` 分支改用 `workerConfirmedGone(meta0, fallbackPid)` |
| GLM-02 | glm | minor | 接受 | 同上，且它点明了可达性边界（status 与 worker.pid 两个独立文件同时故障）与「注释里『与 ④ 同源』在这一档不成立」——后半句比缺陷本身更值得记：**注释写了同源就得真同源** | 同 AGY-01；判据里「拿不到 pid 时只有终态才敢下结论」这一档是按它与 CODEX-05 的建议定的 |
| AGY-02 | gemini | major | 接受 | 属实，且它与 r1 的 CODEX-02 各要一半：那边说「跳过超大文件不该报失败」，这边说「跳过意味着还有未脱敏内容，不该报 ok 让清扫永久收工」。两个都对，所以要第三档 | `ScrubOutcome` 加 `complete`：`ok` 回答「有没有出错」，`complete` 回答「扫完了没有」；哨兵判「已处理」要两者都真；会话启动待办新增一行 |
| AGY-04 | gemini | minor | 接受 | 属实且危害不小：`{"api_key": "…"}` 零命中，而运行目录里的 `stdout.json`、`trace.json`、`auth.json` 全是标准 JSON。我复核了三种形态：TOML 命中、标准 JSON 漏、转义键名漏 | `secrets.ts` 新增 `KEY()`：键名两侧同样允许可选引号（含任意层转义）；用例覆盖三种形态 |
| GLM-03 | glm | minor | 接受 | 属实且我复现了：内容以 `++` 开头的新增行在 diff 里是 `+++i;`，被 `startsWith('+++')` 当文件头排除，整行退出扫描论域。「新增行仍然整份扫」那句承诺确实过头了 | `scanDiffSecrets` 改按 **hunk 位置**判：`@@` 之后才按前缀解析，文件头行在 hunk 之前按名单跳过 |
| CODEX-07 | codex | minor | 接受 | 属实：放宽只落在补丁上，BRIEF 内嵌同一份节选却走整份扫，于是拒绝点只是从补丁搬到 BRIEF——而且报错指向一个开发者没亲手写过的文件，此时补丁已落盘，留半套工件 | 同一函数按 hunk 分档后天然支持「散文整份扫 + hunk 内只看新增」；`review.ts` 的 BRIEF 落盘改传 `scan: 'added-lines'` |
| CODEX-10 | codex | minor | 接受 | 属实：`request.json` 的交接包逐字含整份送审包（`brief_text`），`status.json` 的侧 note 含厂商 stderr 片段，`worker.log` 是 stdio 重定向目标——三份都在运行目录**那一层**，不在我的脱敏论域里 | `scrubRunDir` 对运行目录那一层按 `RUN_DIR_FILES` 清单做同款就地脱敏（清单与写入点同源，沿用 v1.3.14 的手法） |
| AGY-03 | gemini | minor | 接受 | 属实：`exists()` 内部是 `fs.access`，权限异常或软链损坏同样返回 false，于是「删不掉」被读成「本来就没有」而报 ok。建议的「直接依赖 `fs.rm({force:true})` 的幂等」是对的 | `zcode.ts` 去掉门禁，只保留「删之前记一下在不在」用于报告，真异常进 `errors` |
| GLM-04 | glm | minor | 接受 | 属实：原先「行首或空白」的前界让 `重点看--topic 主题甲` 这类中文黏连写法检不出，主题照旧静默回落——正是 EV-18 的原始危害。而设计与 BACKLOG 写的是「字样」，实现收窄成了「空白界定的字样」，承诺强于实现 | `topic-args.ts` 前后界改用 `(?<![A-Za-z0-9_-])` / `(?![A-Za-z0-9_-])`，仍不误伤 `--topic-x` |
| CODEX-04 | codex | minor | 接受 | 属实：`writeAtomic` 是 `writeFile` + `rename`，新文件 mode 由 umask 定（0644），不继承原权限。同一模块给准备出来的副本刻意 chmod 0600，却在脱敏这一步把可读性放宽——方向不自洽 | `scrub.ts` 新增 `writeAtomicPreservingMode`，两处写回（自有目录脱敏、日志脱敏）都用它 |
| CODEX-06 | codex | minor | 接受 | 属实：`warnings` 只进哨兵，而哨兵一旦 `ok:true` 就被判 `already-scrubbed` 永不再读；二进制与非普通文件连 warnings 都没有。「告警不影响 ok」这条判据顺带把真残留也静音了 | 与 AGY-02 合并处置：`complete` 档 + 会话启动那一行；二进制跳过补 warning 并计数 |
| GLM-05 | glm | nit | 接受 | 两条登记性边界都成立：①二进制静默跳过（与超大文件不同档）；②厂商 stderr 片段进 `fail_reason` → `status.json.message` 不经脱敏。第二条正好被 CODEX-10 的落点覆盖 | ①二进制跳过补 warning；②`status.json` 纳入脱敏论域（同 CODEX-10） |
| CODEX-09 | codex | minor | 接受 | 属实，而且它指出的那处遗留（`archive.test.ts:129` 的完整假凭据）我确实漏了——本轮把 `secrets.test.ts` 的同形字面量逐条改成拼接，却没顺手清它。约定靠人记，第三次同形 | 新增 `test/contract/fixture-credentials`：全仓扫 `src/` `test/` `scripts/`，命中即红（当下会先红在 archive.test.ts）；随后把那处改成拼接 |
| AGY-07 | gemini | nit | 接受 | 同上（独立提出）。它的措辞「属于开发者自觉纪律」正是 AGENTS.md 纪律 12 要消除的形态 | 同 CODEX-09 |
| AGY-05 | gemini | minor | 接受 | 属实：对账正则只认单引号，换双引号或模板串就静默退出论域。GLM 在「认为正确」里核了当前三家都用单引号形态——当前成立不等于判据可靠，这正是 EV-31 记过的那族 | `orchestrator-logs-parity` 的正则放宽到单引号、双引号、无插值模板串 |
| CODEX-08 | codex | minor | 接受（登记，不本轮实施） | 论证成立且是我论证里缺的一半：我只算了入站（进 Git），没算出站。`sensitive_globs` 是文件名 glob，挡不住写在 `.ts` 里的内容级凭据——此前整份扫让它在冻结阶段就失败、因而不出网，现在它作为上下文行合法进补丁并送达三家端点。**不本轮实施**的理由：建议的「出站前跑一次 `redactSecrets`」会改变送审内容，与 FR-20 的逐字承诺直接相抵，该先拍板哪一边优先——这属于新范围 | BACKLOG 新增 **EV-34**（含「文件名 glob 挡不住内容级凭据」这一句）；设计 §10.5 密钥扫描行写明这是明示接受的代价 |

## 2. 两处「认为正确」里与事实不符的，我主动更正

- glm 在「认为正确」里写「运行时拼接约定**自带机器守卫**——未来谁写回整段字面量，`review --start` 冻结补丁时会被新增行扫描当场拒绝」。这句只对**新写入**成立：已经在 HEAD 里的字面量以上下文行进补丁，而补丁只扫新增行，所以它对旧夹具**永久隐形**（CODEX-09 说的正是这一格）。新增的 `fixture-credentials` 契约测试补上了这个缺口。
- codex 在「认为正确」里说我「用打包产物复跑了一遍，源码与新增行都零命中」——这是它自己的复核，结论我确认；但同一段里「整份扫则 10 处，全在删除/上下文侧」的数字是本轮改动前的状态，改完之后整份扫的命中只剩 `test/` 下的拼接片段（不构成完整形态）。

## 3. 变异验证

| # | 变异 | 应变红 |
| :-- | :-- | :-- |
| ㉑ | PEM 材料退回「任意 400 字符窗口」 | secrets |
| ㉒ | PEM 材料允许纯 hex | secrets |
| ㉓ | 脱敏窗口改回跨任意字符 | secrets |
| ㉔ | 键名不认引号 | secrets |
| ㉕ | 终态目录不复核进程（AGY-01 回归） | retention、gate-loop |
| ㉖ | 取值旗标的值以 `--` 开头时静默返回 null | gate-loop |
| ㉗ | 跳过目标仍判 complete | credential-scrub、retention |
| ㉘ | diff 前缀改回 `startsWith` 判据 | secrets |
| ㉙ | BRIEF 改回整份扫 | archive |
| ㉚ | 黏连字样检不出 | topic-args |

**第一遍跑下来有五条「仍绿」**——㉓㉕㉗㉘㉙㉚ 里的多数：我修了实现却没写能咬住它的用例。逐条看：

| 变异 | 第一遍为什么没红 | 补了什么 |
| :-- | :-- | :-- |
| ㉓ | 我的用例把标记与哈希放在同一形态里，而材料判据已经排除纯 hex，所以宽窗口根本不匹配——两条修复耦合了，单独改窗口复现不出来 | 加一条「标记在一个字段、真 base64 材料在另一个字段」的构造，宽窗口会吞掉中间的 `","body":"` |
| ㉕ | retention 的用例造的 status 没有 `worker_pid`，变异前后都判「可抹」，走的不是 AGY-01 那条路 | 补 AGY-01 的**原始场景**：`phase: failed` + 活着的 pid + `worker_lost（heartbeat_stale）` 的 message |
| ㉗ | 完全没有断言 `complete` 的用例 | 补「跳过超大文件 → `ok:true` 但 `complete:false`，且非 force 清扫不判 already-scrubbed」 |
| ㉘ | GLM-03 那个形态我只在验证脚本里跑过，**没写进用例** | 补 `+++i;` 在 hunk 内的用例 |
| ㉙ | BRIEF 落盘没有任何判据 | 契约测试扫 `review.ts` 的两处 `writeMeta` 调用，断言都带 `scan: 'added-lines'`；另在 `archive.test.ts` 补 `writeMeta` 两种模式的行为用例 |
| ㉚ | 黏连形态同样只在脑子里验过 | 补中文黏连用例，并断言 `--topic-x` 不被误伤 |

补完后**十条全部变红**。这一段值得单记：`npm run check` 全绿只说明「我写的用例过了」，变异验证才说明「用例咬得住我改的东西」。本轮如果只报前者，上面六处修复里有一半是没有防线的。

另有一条 ㉛ 是**故意不回归**的对照：把 `fixture-credentials` 的扫描论域从三个目录缩到一个，测试变红（因为 `test/` 下的拼接片段不再被扫到，而它断言了「确实扫到了源码」的前提）。记在这里，下次有人改那个数组时能看见它有前提守着。

## 4. 本轮之外的一件事

r2 那次三侧配额作废，起因是我新加的 PEM 处理代码让审查员必然引用 PEM 标记，而归档闸对「谈论」与「贴出」不作区分。**这轮修完之后，这条路径才算真的关上**——而 r2 那份没能落盘的 glm 结论里，恰好就有「标签枚举漏掉 pkcs8」这个发现。技术事实不会因为流程失败而消失，但它没有经过裁决，所以我在 r1 应答里把它记在正文而不是当作意见。这次三侧重新独立提出了同族问题，它才真正进了裁决表。

## 5. 修改清单（已实施）

| # | 文件 | 改动 | 对应 |
| :-- | :-- | :-- | :-- |
| 1 | `src/trivium/secrets.ts` | PEM 正文起点 + 非 hex 材料；脱敏窗口不跨结构字符；键名引号容差；`scanDiffSecrets` 改按 hunk 分档 | CODEX-01/02/07、GLM-01/03、AGY-04/06 |
| 2 | `src/trivium/status.ts` | 新增 `workerConfirmedGone`（不可逆动作的唯一准入判据） | AGY-01、CODEX-05、GLM-02 |
| 3 | `src/trivium/retention.ts`、`run-protocol.ts` | 三处挂载点共用该判据；`incomplete` 计数 | 同上、AGY-02 |
| 4 | `src/trivium/scrub.ts` | `complete` 档；二进制跳过记 warning；保留权限位；运行目录那一层纳入脱敏论域 | AGY-02、CODEX-04/06/10、GLM-05 |
| 5 | `src/trivium/cli.ts` | `flagString` 对「值被降级成布尔真」退 64 | CODEX-03 |
| 6 | `src/trivium/review.ts` | BRIEF 与补丁共用一套扫描判据 | CODEX-07 |
| 7 | `src/trivium/topic-args.ts` | 黏连字样的前后界 | GLM-04 |
| 8 | `src/trivium/adapters/zcode.ts`、`codex-home.ts`、`base.ts`、`types.ts` | 去 `exists` 门禁；`skipped` 计数入契约 | AGY-03、AGY-02 |
| 9 | `test/contract/fixture-credentials.test.ts`（新）、`orchestrator-logs-parity`、`archive.test.ts` | 夹具约定的机器判据；对账正则放宽；清掉遗留字面量 | CODEX-09、AGY-05/07 |
| 10 | `test/unit/secrets.test.ts`、`credential-scrub`、`retention`、`gate-loop` | 各补边界用例 | 全部 |
| 11 | 设计 §10.5 与 §21 v1.3.15「十一」、BACKLOG 新增 EV-34 | 文档同步与代价登记 | CODEX-08 |
