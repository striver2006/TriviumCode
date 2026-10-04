---
schema: trivium.disposition.v1
topic: 临时索引与清扫删除收尾
stage: plan
role: claude
kind: revised
run_id: 20261004T055413Z
addresses:
  - 2026-10-04-临时索引与清扫删除收尾-codex.md
  - 2026-10-04-临时索引与清扫删除收尾-gemini.md
  - 2026-10-04-临时索引与清扫删除收尾-glm.md
---

# 裁决：临时索引与清扫删除收尾 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-04-临时索引与清扫删除收尾-claude.md`（r1，起点 `e00a1e2`）
> ｜ 运行：`20261004T055413Z`（约 14 分 9 秒）
> ｜ 结论：codex `approve-with-nits`（次要 2、吹毛求疵 3）｜ gemini `request-changes`（重要 1、次要 1、吹毛求疵 1）｜ glm `approve-with-nits`（次要 3、吹毛求疵 1）
> ｜ 共 12 条：接受 10、驳回 1、暂缓 1
> ｜ 修订后的计划：`plan/2026-10-04-临时索引与清扫删除收尾-r2-claude.md`；命令 A 不设人工闸门

三侧都复算了 §1 的现状核对：selftest `:202` 走不到、`finish` 无 `await` 的拒绝穿出 `runSelftest`、八处递归删除加 `fsx.ts:155` 本体与豁免表计数一致、`EV-206` / `v1.3.84` 不撞号；三侧也都支持决策四的「两层读法」（删不掉的目录自己也落回抹除）与全树守卫加豁免表的取舍。

AGY-01 是本轮唯一改变用例设计的意见，经核属实：`review.ts:810` 对每个入选侧各调一次 `freeze`，`freeze.ts:442` 每次都算一遍 `workTreeHash`，两侧的夹具在 `--start` 里就有两个临时索引目录，r1 D1「第一个不锁、第二个起上锁」会在第二侧冻结时误锁、当场红。glm 在「认为正确的部分」里写的「`--start` 只有 `freeze.ts:442` 一次」核错了（漏看了外层的逐侧循环），不构成反对理由。r2 改为按进程身份区分：过滤器沿祖先进程向上找命令行含 `review --worker` 的那一个，只在 worker 里上锁，与侧数无关。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| AGY-01 | gemini | major | 接受 | 属实（已回源码核）：`review.ts:810` 的 `for (const critic of sides)` 逐侧调 `freeze`，两侧即两次 `workTreeHash`。三条建议里不取「单侧 `--critics gemini`」与「按侧数加一放行」——两者都把用例押在冻结次数上，冻结逻辑一变就静默错位；取第三条「按进程身份区分」：worker 由 `spawnDetached` 以 `〈node〉 〈bundle〉 review --worker 〈run_id〉` 派生，过滤器沿 `$PPID` 向上逐级 `ps -o args=`（至多 8 级，跨过 git 与它起的 shell），命中 `review --worker` 才上锁。`--start` 进程链里没有这个字样，冻结几次都不锁。「`--start` 的 stderr 不含提示」「恰好一个带锁目录」两条断言保留，含义变为「只有 worker 里的复算被锁」 | r2 §2.6 D1；§1 第 9 条（补逐侧冻结的事实） |
| AGY-02 | gemini | minor | 暂缓 | 缺口属实（`selftest.ts:124` 把 `run_root` 设为夹具根的兄弟目录，`finish` 只删夹具根；测试侧 `test/helpers/fixture.ts:95` 同形），但修它不在用户决策三的两处删除之内，任务目标对新缺口的口径是「双审核出新缺口则登记」，不是本题扩范围。按 GLM-03 另登 EV-207（自检与集成夹具两侧一并）。附带一处更正：AGY-02 说「残余文案声称审查留痕在 root 内与事实不符」——自检的归档根是夹具里的 `.reviews/`，审查文档、裁决件与 `_meta/` 确实在夹具根内；不在根内的是运行目录（`worker.log`、交接文件）。r2 措辞把「审查留痕」写成「审查留痕（`.reviews/`）」以免歧义 | BACKLOG 新登 EV-207（编码阶段落）；r2 §2.2 第 4 条措辞；r2 §5 |
| AGY-03 | gemini | nit | 驳回 | 进程内用例（G1～G3b）**不断言** stderr，标志被 G2 置真只会让后续进程内用例少打一行 `⚠️`，不影响任何断言；「只打一次」只在 G4 的子进程里断言，子进程每次新起、标志天然是初值。为测试往生产模块导出一个重置函数，是给不存在的污染开口子；`node --test` 每个测试文件本就是独立进程，标志不跨文件 | 无（r2 §2.1 末句补写「进程内用例不断言 stderr」的理由） |
| CODEX-01 | codex | minor | 接受 | 属实：递归删除删掉部分直接子项会刷新运行目录 mtime，到期判据取 `max(mtime, heartbeat)`（`retention.ts:218-223`），下次会话判为未到期、不进整删分支，`removeFailed` 那一行也随之消失，要再过一个保留期才重试。到期判据不改（决策四），改措辞与文档：待办句由「下次会话启动会再试」改为「请人工删除（删掉一部分的目录要再过一个保留期才会自动重试）」；§4 残余与 §10.5 补句写明这一形 | r2 §2.3 第 3 条措辞；§4 残余第 5 条；§6 主设计补句 |
| CODEX-02 | codex | minor | 接受 | 合理：只读目录里删文件在 APFS 非 root 下拿到 EACCES，但这不是 Node 契约，换卷或换机器可能是 EPERM。所有错误码断言改为「取实际码」：断言码属于 `{EACCES, EPERM}`，期望措辞用同一个实际码拼，逐字比对照旧 | r2 §2.6 摆锁法末段；G4 / S1 / R1 / R3 |
| CODEX-03 | codex | nit | 接受 | 合理：摆锁依赖三条 git 行为（clean 过滤器继承 git 的环境、`filter.〈名〉.required`、`GIT_CONFIG_GLOBAL`——后者约 git 2.32 起），r1 只记了一次 2.54 的实测。补两样：①测试文件头与报告写明这组用例的 git 机制前提与本机版本；②过滤器第一次被调时往私有根写标记文件，用例先断言标记在，把「环境没跑过滤器」与「改动错了」分成两种红 | r2 §2.6 摆锁法；新文件头注释；报告「覆盖」一节 |
| CODEX-04 | codex | nit | 接受 | 属实：r1 措辞「其中剩下的只会是 git 临时索引文件」是对目录全貌的断言，而本题自己的摆锁法就证明第三方进程（用户仓库里的 clean 过滤器、git-lfs）能往这个目录写东西。主语收到本程序：「TriviumCode 只往里写了 git 临时索引、没有凭据，请手工删除」——`index` 与被杀时可能留下的 `index.lock` 都是 git 经 `GIT_INDEX_FILE` 写的索引文件，都在这句之内。自检那句同理改为「自检只往里写了…」。两处都相对决策二 / 三的原话有改动，收尾时向用户说明 | r2 §2.1 措辞；§2.2 第 4 条措辞 |
| CODEX-05 | codex | nit | 接受 | 合理：观察只进报告就没有台账承接。§5 观察 1（被杀进程遗留的 `trivium-index-*`，110 个）写进 EV-204 结案语的残余句；观察 2（`-runs` 遗留）按 GLM-03 另登 EV-207 | r2 §5；§6 BACKLOG |
| GLM-01 | glm | minor | 接受 | 属实：r1 S1 整个换掉 `buildFixture`，生产里的 `made.dir = raw` 不在执行路径上，M11 咬不住。注入点下沉一层：`runSelftest(opts, deps = { initFixtureRepo })`，真 `buildFixture` 照常 `mkdtemp`、赋 `made.dir`、写文件，最后调注入的 `initFixtureRepo`；S1 的假件在夹具根里摆锁后抛错。这样 M11（删掉赋值）让 `cleanupResidue` 变 null、`fixtureRoot` 变 `''`，S1 红；另把 r1 M11 原本想测的 catch 侧补成 M15（catch 不调 `tryRemoveTempDir`） | r2 §2.2 第 6 条；§2.6 S1 / S2；§2.7 M11、M15 |
| GLM-02 | glm | minor | 接受 | 属实：递归删除若先删掉 `status.json`、再卡在锁上，下次会话该目录以 status 为 null 进来——mtime 已刷新故不到期，落回抹除时 `admitScrub(dir, null)` 记 `unknown`、不抹，待办显示的是「状态读不到…请人工检查后删除」那一行而不是新行。仍然可见，行为可接受，不改代码；§4 残余、§10.5 补句与 RUNBOOK 新行点名「删掉一部分之后的两种后续形态」（status 还在：静默保留到下一个保留期；status 没了：进 unknown 那一行） | r2 §4 残余第 5 条；§6 主设计补句与 RUNBOOK |
| GLM-03 | glm | minor | 接受 | 合理：双审已确认 `-runs` 遗留是缺口，满足任务目标「双审核出新缺口」的登记条件。随本题结案登记 EV-207：自检（`selftest.ts:124`）与集成夹具（`test/helpers/fixture.ts:95`）的 `${root}-runs` 无人清理，修法方向是收尾时一并 `tryRemoveTempDir` 该兄弟目录或把 `run_root` 挪进夹具根。编号按 EV-206（lock）之后顺延 | r2 §6 BACKLOG；r2 §5 |
| GLM-04 | glm | nit | 接受 | 属实：`pruneRunDirs` 按 `readdir` 原序遍历，APFS 的顺序不受命名控制，r1 用固定名加前置断言会在锁目录恰好殿后时确定性走红。改为构造性：先建齐四个到期目录（都不锁），读实际 `readdir` 顺序，取排第一的那个上锁——它后面必有三个，鉴别力由构造保证；注释写明遍历顺序是文件系统行为、用例不依赖它 | r2 §2.6 R1 |

## 2. 无修改的部分及原因

- 三侧都认可的部分不改：`workTreeHash` 签名与八处调用方不动、selftest 先修「走得到」再按决策三处置、retention 两层读法、全树守卫与豁免表三项、安装器与 lock 的甄别结论、EV-206 另登。
- codex 与 gemini 的「未覆盖范围」（未实跑用例与变异、未跨 git 版本实测、ENOSPC 未模拟）属本题零配额与计划阶段的既定边界；git 版本前提已按 CODEX-03 写进文件头与报告。
- 措辞相对用户原话的两处改动（`workTreeHash` 提示、自检提示）与决策四的两层读法，收尾时向用户单独说明。
