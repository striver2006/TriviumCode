# 锁回收误判已删锁文件 · 实施报告（EV-173 / EV-149）

- **日期**：2026-09-30
- **主题**：`锁回收误判已删锁文件`；计划 `.reviews/锁回收误判已删锁文件/plan/`（计划双审 run `20260930T021449Z`：codex / gemini `request-changes`、glm `approve-with-nits`，10 条全接受 → r2 定稿）。命令 A 一口气跑，不设人工闸门
- **起点**：`3e38d29`（`main`；工作树只有用户自己改的 `doc/01_requirements/原始需求.txt`，与本主题无关）；计划与本报告的行号取自该提交
- **状态**：实施与验证完成，**含一处偏离 r2 的新增修法 D8（§3.1）**；代码双审 r1（run `20260930T050232Z`）8 条全接受并已按接受项修订（§5、§6）；未提交
- **evidence**：`doc/05_testing/evidence/lock-reclaim-enoent-20260930/`

---

## 1. 逐条落地（按 r2 §3）

| r2 | 落点 | 验证 |
| :--- | :--- | :--- |
| D1 读锁三态 | `lock.ts` 新增 `readLockFile(p)`：`fs.open` → `fh.stat({ bigint: true })` → `fh.readFile` → `JSON.parse`，同一描述符取内容、身份（`dev:ino:mtimeNs`）与修改时刻，`finally` 关描述符；ENOENT ⇒ `missing`；其余失败都并入 `present`、`content: null`（`stat` 成功则身份与时刻照给）。`readLock` 改为薄包装，对外行为不变。`acquireLock` 撞 EEXIST 后读到 `missing` 立刻 `continue` | U1、U2、U10；M1 |
| D2 同 inode 年龄 | 不可解析锁的 2 s 防御改用同一描述符的 `mtimeMs`；`fileAgeMs` 只作 `mtimeMs === null` 的兜底，ENOENT ⇒ `null`（调用方按已释放重试），其余失败仍 +∞ | U3、U9；M2、M11、M12 |
| D3 预检 | `reclaimStaleLock(p, expected, identity?)`：rename 前按谓词再读一次；给身份比身份，不给比内容且 `expected` 非空时不再容忍「此刻读不出」（AGY-01）；复验同一谓词 | U4、U4′、U4b、U5；M4、M5 |
| D4 放回用 link | 复验不符 ⇒ `link(tmp, p)`；EEXIST ⇒ 告警「回收主题「X」的锁时挪走了一把新建的锁且放不回，可能有两个持有者」；`finally` 一律删 tmp（AGY-02） | U6；M6、M7 |
| D5 告警后移 | `reclaimStaleLock` 返回 true 才打「回收主题…的遗留锁（原因 …）」，文字不变 | U5、U7、EV-149 用例断言④；M8、M8x |
| D6 tmp 随机段 | `${p}.stale-${pid}-${randomUUID()}` | U8；M9 |
| D7 `--cancel` 播报 | `run-protocol.ts` :1876 起按返回值分两句（沿用 :1558 的两句） | U11；M10；既有 E1 / K3 / N1 仍断言「已回收」 |
| **D8 回收认领（偏离 r2，§3.1）** | 回收前以 `O_EXCL` 创建 `<锁>.reclaim-<身份 sha256 前 16 位>`，拿不到即放弃；拿到后复查身份；`finally` 删认领；认领残留 10 s 以上按认领者中途死了清掉、本轮放弃 | U12 ①②③；M13、M14 |
| §5.2 EV-149 用例 | worker 回报持锁区间；断言区间不重叠 → 赢家恰一个 → 无 `unparsable` → 回收告警恰一条 `pid_gone` | 验收 A4、重复读数 |
| §5.2 X3 | 4 进程 × 25 次 `withTopicLock`（缺省阈值、`retries: 2000`、`retryDelayMs: 5`），断言零「回收主题」、区内 ≤ 1、计数 100 | 验收 A4、重复读数（旧构建 240/240 红） |
| §7 文档 | 主设计 v1.3.64（§12.6 新增「遗留锁的回收流程」、变更记录）；LLD v1.1.22（4.3 判据表与回收段、2.7 行数、已知缺口表新增一行）；BACKLOG EV-149 / EV-173 结案、新登 EV-174；PRD、MANUAL 核后不改（MANUAL :664、:785 只说「会自动回收 / 回收主题锁」，与本修法不冲突；PRD 无相关描述） | — |

源文件改动：`src/trivium/lock.ts`（394 → 515 行，含代码双审 r1 修订）、`src/trivium/run-protocol.ts`（+6 −2；代码双审 r1 GLM-04 更正了原写的「+8 −2」）。测试改动：`test/unit/lock.test.ts`（新增 U1～U14 共 15 条，含 U4′、U4b；U13、U14 为代码双审 r1 修订所加）、`test/integration/lock-cross-process.test.ts`（EV-149 用例加强、新增 X3）、`test/integration/run-protocol.test.ts`（新增 U11）。

## 2. 读数

### 2.1 探针（计划阶段，旧构建 `3e38d29`）

| 探针 | 读数 |
| :--- | :--- |
| `probe-inproc`（`probe-inproc-3e38d29.json`） | P1 删锁后读 ⇒ 告警 `unparsable`、拿到锁；P1c 对照 70；P2 慢回收者挪走活锁 ⇒ C 在空档里拿到句柄时 A 仍持有（`double_holder: true`） |
| `probe-xproc` e149 200 轮（`probe-xproc-e149-3e38d29.json`） | 双赢家 1 轮（区间重叠）、先后 0、晚就绪 0；`unparsable` 告警 44 轮 |
| `probe-xproc` x1 200 轮 | 回收告警 5 轮（全 `unparsable`），区内 > 1 与丢更新 0 |

### 2.2 零配额验收（`acceptance.mjs`，新旧两份构建，旧 = `git archive 3e38d29` + 移植三份新测试）

**r2：17 / 17**（`acceptance-output.txt`、`acceptance-readout.json`）。r1 是 16 / 17（§3.1，读数留在 `*.r1.*`）。

| 格 | 读数 |
| :--- | :--- |
| A0 | `package.json`（`f2fefaa5…`）、`package-lock.json`（`2b4a1019…`）新旧逐字节相同；三份移植测试拷入前与新树不同、拷入后相同；`trivium.cjs` 旧 `5af11d60c9a9…` / 新 `b196568f8d02…`，`lock.js` 旧 `62c105b8323c…` / 新 `3e24bc65c4d7…` |
| A1 `probe-inproc` | P1：旧告警 `unparsable`，新无告警且拿到锁；P1c：两边 70 无告警；P2：旧双持有（C 在 B 复验的空档里拿到），新单持有（C 在 A 持有时抢、得 70），回收告警 1 条 |
| A2 e149 600 轮 | 旧：`unparsable` 告警 159 轮（213 次），多赢家 2 轮（都重叠），晚就绪 0；**新：`unparsable` 0、多赢家 0、D4 放不回告警 0，`pid_gone` 回收告警恰 600 条（每轮一条）** |
| A3 x1 600 轮 | 旧：告警 40 轮（`unparsable` 44 次、`pid_reused` 1 次），区内 > 1 与丢更新 0；**新：告警 0** |
| A4 移植测试 | 旧构建：16 条目标用例全部出现并执行（正面断言，CODEX-02）；其中 15 红、U10 绿（U10 测的是新代码新增的「open 之后读出错」格，旧实现读锁不经 `open`，桩够不到——它不是回归判据）；新构建 16/16 绿（该三文件 99 / 99） |
| A5 CLI 对照（`topic claim` 碰 `.task` 锁） | 死持有者：新旧都回收、退 0，stdout / stderr 归一化后逐字相同（告警文字未改）；活持有者：新旧都退 70、逐字相同 |

600 轮新构建 0 次 ⇒ 单轮命中率 95% 上界约 0.5%（3/600）。D8 之后另跑 e149 1200 轮（`probe-xproc-e149-d8.json`）：多赢家 0、放不回告警 0、`pid_gone` 恰 1200 条。

### 2.3 高并发重复（辅助信号，`repeat.mjs`，`lock-cross-process.test.js` 8 路并发 × 30 次）

| 构建 | 读数 |
| :--- | :--- |
| 新（`repeat-new.json`） | **240 / 240 绿**，294 s |
| 旧 + 移植测试（`repeat-old.json`） | 240 / 240 次运行有红：X3 **240 / 240**、EV-149 用例 113、EV-161 X1 26、X2 28、「临界区串行化，并发读改写不丢更新」1（截到的只有一条 `pid_gone` 回收告警，断言文案没截全——`repeat.mjs` 截文案的正则对 spec 报告器不准，如实登记） |

240 次 0 红只把单次红率的 95% 上界压到约 1.2%，不单独作结论（CODEX-03）；主判据是 §2.2 的 600 轮探针。

### 2.4 源码变异（`scripts/mutation-check.mjs`，规格 `mutation-spec.json` 由 `gen-mutation-spec.mjs` 从源码截锚点并核对唯一）

**15 / 15 咬住**（`mutation-output.txt`；基线三套件全绿）。失败用例名与首行文案见 `mutation-names-output.json`（`mutation-names.mjs`，逐条带 60 s 用例超时预跑）：

| # | 变异 | 红在 |
| :--- | :--- | :--- |
| M1 | 删 missing 分支 | U1（`runTerminal` 被调用） |
| M2 | 年龄改回按路径 stat | U3 |
| M4 | 身份去掉 `mtimeNs` | U4、U4′、U6、U12 |
| M5 | 谓词容忍「此刻读不出」 | U4b |
| M6 | 放回改回 rename | U6 |
| M7 | 放回后不删 tmp | U6 |
| M8 / M8x | 告警挪回回收之前 | U4′、U5、U7 / EV-149 用例断言④ |
| M9 | tmp 名去掉随机段 | U8 |
| M10 | `--cancel` 无条件播报 | U11 |
| M11 | `fileAgeMs` 对 ENOENT 回 +∞ | U9 |
| M12 | 解析失败时丢掉描述符的修改时刻 | U3 |
| M13 | 不认领 | U12 |
| M14 | 认领后不复查 | U12③ |
| M0x | `acquireLock` 一侧整段退回 `3e38d29` 的判定 | EV-149 用例、X3 |

计划 r2 §6.4 的「D3 预检删除」（原 M3）自 D8 起是**等价变异**：认领之后的复查用同一谓词再核一次，结局相同，只多建删一次认领文件；「rename 之前不核」由 M14 覆盖（预检仍在时，迟到的回收者正是靠复查挡住的）。

### 2.5 其他

| 项 | 读数 |
| :--- | :--- |
| Node 18（CODEX-04，`node18.txt`） | `npx -y -p node@18` 取得 v18.20.8：`lock.test.js` + `lock-cross-process.test.js` 50 / 50 绿；`probe-inproc` P1 无告警、P2 单持有 |
| `npm run check` | 两次都是 **2323 / 2321 / 0 / 2**（起点 2308，新增 15 条：`lock.test.ts` 13 条、U11、X3），约 262 s / 264 s（`check-1.txt`、`check-2.txt`）；本主题期间全量未见既有偶发红 |
| `doctor --selftest`（仓库新构建） | **14 / 14**（「自检：✅ 通过（14/14 步）」，`doctor-selftest.txt`） |
| 环境 | Node v25.2.1，macOS（APFS） |

## 3. 偏离与如实登记

### 3.1 D8：r2 暂缓的残余窗口被读数推翻，偏离 r2 补上（送代码双审判）

r2 §4 R1 把「预检与 rename 之间的残余窗口」暂缓，理由是命中要「另一回收者在两次系统调用之间完成 rename → 复验 → 删除 → link」、三重巧合。验收 r1 的 A2 新构建 600 轮出现 **1 轮双持有**（区间重叠），r1 判 16 / 17。补截 D4 告警后再跑 1200 轮（`probe-xproc-e149-d7-residual.json`）：又 1 轮双持有，且**恰是那一轮**出现一条「挪走了一把新建的锁且放不回」。那一轮的角色：id 0 回收死锁（`pid_gone`）、id 1 link 进空档、id 2 对同一把死锁的预检早已通过、rename 挪走了 id 1 的活锁、id 3 再 link 进空档、id 2 放不回。

也就是说命中只需要「两个回收者对**同一份**遗留锁都过了预检」加「非回收者一次 link」——比 r2 的估计容易得多，压测下约千分之一，EV-149 那条用例仍会以这个量级偶发红。按 r2 的暂缓结论交付就不能如实把 EV-149 结案。

关死它**不需要** r2 担心的「带自己遗留判据的通用守卫」：按遗留锁**身份**命名的认领文件（`O_EXCL`）只在同一份遗留锁的回收者之间互斥；认领后复查身份，迟到的回收者（上一个认领者已收掉那一份）在复查处放弃；认领只存在于几次系统调用之间，只有认领者中途崩溃才会残留，按 10 s 年龄清掉。补后 e149 600 轮（验收 r2）+ 1200 轮都是 0 双持有、0 放不回告警。

这是计划外的修法，r2 §3 取舍表里「回收者之间另加互斥——不做」一行由此失效。已同步进主设计 §12.6、LLD 4.3 与缺口表、BACKLOG EV-149 / EV-174。请代码双审重点看：认领命名与复查是否真把「回收者对回收者」关死、10 s 按年龄清理的竞争（EV-174 ③）、`finally` 删认领在各返回路径上是否都执行。

### 3.2 首轮变异装置被我写的测试挂死

首轮装置跑到 M4 时，U12① 里 `await reachedRename` 没有超时：M4 下第一个回收者预检失败、走不到 rename，测试永远等下去；装置不给套件加超时，跑满 1 小时的后台时限被强制终止，`src/trivium/lock.ts` 停在 M4 变异态。处置：按装置备份目录（`trivium-mut-*`，与哨兵的开跑时刻一致）逐字节核对，差异恰是 M4 那一行，用备份恢复后再核一次；删哨兵；U12① 与 U5 的等待改为带 5 s 超时、`finally` 里放开扣留；另写 `mutation-names.mjs`（带 60 s 用例超时）逐条预跑 15 条确认都不挂，再正式跑装置。首轮输出留在 `mutation-output.hung-r0.txt`（只跑完 M1、M2）。修 U12① 时我又写出过一次死锁（断言消息的模板串里 `await first`，会被立即求值），单跑时发现并改掉，没有进入任何读数。

### 3.3 其他

- 计划期探针 `probe-inproc.mjs` 在编码后改过一次：新实现读锁走 `open` 而不是 `readFile`，P1 的桩与 P2 的扣留点都改为两种都拦、扣在「判定之后对锁路径的第二次触碰」（不能扣在 rename 上：新实现的 rename 在预检之后，扣在那里测的是残余窗口）。改后在旧构建上仍复现（A1 旧），计划期读数文件 `probe-inproc-3e38d29.json` 是改前版本跑的，未覆盖。
- `probe-xproc.mjs` 在 r1 验收后补截 D4 告警（`displaced_unrestorable`）。
- 验收的中断试跑：第一次小轮数试跑时，旧构建上的 U5 因扣留点只数 `open` / `rename` 而挂住，手工终止并删了它自己的 mkdtemp 目录；U5 随即改为也拦 `readFile`、带超时。
- 三份计划审查都带「审查期间工作树发生漂移」标记，审查期间本会话未写文件（见裁决件 §0）。
- `doc/01_requirements/原始需求.txt` 的改动（另一个项目的机型冒烟记录）是用户自己的工作树改动，会话开始时就已是 `M`，本主题没有写过它，但它进了代码双审的 `changes.diff`（代码双审 r1 CODEX-01 ≡ GLM-01）。处置：不代改用户内容，**不随本主题提交**——提交时按文件名逐个 add，由用户决定它的去留。

## 4. 审计边界

- 不花配额，未做真实 CLI 实测。
- 身份判据只在本地 APFS 上实测；ext4 的 inode 复用与网络卷行为只做了论证（LLD 4.3 写明适用面）。
- EV-174 的剩余格（非回收者删除、取不到身份、认领者崩溃后的清理竞争、崩溃残件无通用清扫）与 `release()` 的同族窗口未构造复现。

## 5. 代码双审 r1

run `20260930T050232Z`（约 9 分钟；相对 `3e38d29` 的 50 个文件、补丁 1025 KB）：gemini `approve`（零意见），codex `approve-with-nits`（次要 2、吹毛求疵 2），glm `approve-with-nits`（次要 1、吹毛求疵 3）；8 条全接受，应答件在 `.reviews/锁回收误判已删锁文件/code/`，`gate --check` 8/8 通过。

| 意见 | 落点 |
| :--- | :--- |
| CODEX-01 ≡ GLM-01 `原始需求.txt` 混入 diff | §3.3 登记；不改、不随本主题提交 |
| CODEX-02 认领被占时零间隔空转 | `acquireLock` 回收返回 false 后隔一个 `retryDelayMs` 再重来（`missing` 那一路仍立刻重试）；U14；M15 |
| CODEX-03 ≡ GLM-03 崩溃残件无通用清扫 | 不改码；主设计 §12.6、LLD 4.3 注明「同身份后来者撞上时的机会性清理」，EV-174 与 LLD 缺口表补第④格 |
| CODEX-04 清理失败把原始异常抛给调用方 | `reclaimStaleLock` / `renameAndVerify` 的 `finally` 与陈旧认领清理都 `.catch(() => undefined)`；U13（锁路径被旧目录占着照常拿到锁）；M16 |
| GLM-02 认领创建的非 EEXIST 错误静默 | 告警「回收主题「X」的遗留锁时认领失败（errno），本轮不回收」，仍 fail-closed；U13；M17 |
| GLM-04 报告行数 | §1 改为 +6 −2 |

## 6. 修订后读数（r3）

§2 的读数是修订前（r2，文件名带 `.r2.`）的；修订后全部重跑，文件名不带后缀：

| 项 | 读数 |
| :--- | :--- |
| 变异 | 规格 18 条（原 15 条 + M15、M16、M17）：逐条带超时预跑 18/18 咬住、无挂死（`mutation-names-log.txt`、`mutation-names-output.json`）；装置 **18 / 18 咬住**，基线三套件全绿（`mutation-output.txt`）。M15 → U14，M16 / M17 → U13 |
| 零配额验收 | **17 / 17**（`acceptance-output.txt`）：e149 600 轮旧 `unparsable` 告警 154 轮、多赢家 6 轮，新 `unparsable` 0、多赢家 0、`pid_gone` 恰 600 条；x1 600 轮旧告警 38 轮、新 0；移植测试旧构建 101 条中 17 红、新构建 101 / 101 绿；A5 CLI 对照新旧逐字相同；新 `trivium.cjs` `4c9e52a8d788…`、`lock.js` `b4e78aaf0ace…` |
| 高并发重复 | 新构建 8 × 30 = **240 / 240 绿**，297 s（`repeat-new.json`）；旧构建未变，沿用 §2.3 |
| Node 18 | v18.20.8：`lock.test.js` + `lock-cross-process.test.js` **52 / 52** 绿（`node18.txt`） |
| `npm run check` | 两次都是 **2325 / 2323 / 0 / 2**（起点 2308，新增 17 条），约 265 s（`check-1.txt`、`check-2.txt`） |
| `doctor --selftest` | **14 / 14**（`doctor-selftest.txt`） |

**verify（S10）**：`trivium verify --topic 锁回收误判已删锁文件`（run `20260930T054509Z`）**通过，退 0**：typecheck ✓、build ✓、`npm test` ✓（264 s），留痕在 `.reviews/锁回收误判已删锁文件/verify/`。

验收 A4 的目标用例清单未加 U13 / U14（它们是修订所加），两条在新构建的该三文件运行与全量里都是绿的，变异 M15～M17 证明它们会红。
