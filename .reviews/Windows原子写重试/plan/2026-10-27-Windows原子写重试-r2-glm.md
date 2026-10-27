# Windows原子写重试 实施计划（r2）

> **性质**：BACKLOG **EV-260**（产品缺陷，偶发；1.3.2 Windows 发版全量观察到，不卡发版）。用户 2026-10-27 经 `/dual-run` 发起（driver glm，入选 codex / gemini / claude）。
> 行为变更集中在 `src/trivium/util/fsx.ts` 的 `writeAtomic`（win32 上 rename 覆盖失败的有界短重试）与两个同口径调用点。全程零配额（实测用 PowerShell 句柄争用，不碰任何厂商 CLI 与凭据）。
> **计划双审第 1 轮**（run `20261027T091039Z`）：codex、gemini `pass-after-changes`，claude `pass`；三侧 12 条意见（codex 5 条为 schema 降级件），裁决**接受 12 条、其中 CODEX-02 的内容级防护子建议驳回**，裁决件 `2026-10-27-Windows原子写重试-revised-glm.md`。
> **r2 相对 r1 的改动**：
> - §6.1 R2 补等待侧取锁预算的数值比较（`withGlobalLock` 40×100 ms ≈ 4 s vs 持锁新增 775 ms）——**CODEX-01**；
> - 新增 §3.5「延迟写者与陈旧内容后落」逐文件分析，T6 注释口径改为钉形式语义并引用 §3.5；内容级防护建议驳回（理由见裁决件）——**CODEX-02**（分析）、**CLAUDE-01**；
> - §6.2 新增「win32 新交错」登记行——**CLAUDE-01**；
> - §4.3 实测重写：PS 按柄 READY 握手 + 次数断言改时序边界口径，场景 B 耗时窗口放宽至 0.7～3 s——**CODEX-03**、**CODEX-05**、**AGY-03**、**CLAUDE-02**；
> - §0 的「POSIX 零变化」限定辖域，R5 补 LEDGER_RE 判据出处——**CODEX-04**；
> - §3.1 `onExhausted` 的异常防护挪进原语（原始错误最高优先）——**AGY-01**；
> - §4.1 T1/T2 对 EPERM / EACCES / EBUSY 三码参数化——**AGY-02**；
> - §5 文档同步表补 GUIDE_local_pitfalls 的 PS 5.1 ANSI 坑新条目——**CLAUDE-03**；
> - §4.1 接线回归点名 `run-files-parity` 的首匹配抓取约束——**CLAUDE-04**。

- **日期**：2026-10-27
- **主题**：`Windows原子写重试`
- **起点**：`6e5f3131`（`main`，工作树干净）。下文行号均取自该提交（r2 新增的事实行号同此）
- **上位**：BACKLOG EV-260 整行；Bug 清单 §3.1 第 17 条；证据 `doc/05_testing/evidence/release-132-20261027/windows-check-bd5c0635.txt` 的 `not ok 357`（EV-160 I2，构建 `bd5c0635` = 标签 `v1.3.2`，Node v22.23.2）
- **全量基线**：2026-10-27 同构建 Windows 全量 3117 例 / 3067 过 / 6 红 / 1 取消 / 43 跳过（Bug 清单第 17 条第二次读数）；本主题改后须 `npm run check` 全绿（红的归因口径见 §4.4）

---

## 0. 范围与不做

| 做 | 不做 |
| :-- | :-- |
| `fsx.ts` 的 `writeAtomic`：**只在 win32** 上对 `EPERM` / `EACCES` / `EBUSY` 三个错误码做**有界短重试**；其余错误码立即抛出；最终失败抛**最后一次的原始错误**并清掉本次的临时文件 | **POSIX 零变化的辖域**（r2 按 CODEX-04 限定）：指 `fsx.ts` 的 POSIX 分支（`writeAtomic` / `renameOverwriting` 的非 win32 路径——单次 rename、不重试、失败照旧抛出、tmp 照旧留在盘上）与 B 调用点（非 win32 单次直通）。**不含** C 调用点：`TempDirLedger` 并入 `writeAtomic` 在 POSIX 上有可观察但无害的差异（残件形状与 mkdir 形态，§6.1 R5 单独声明） |
| 新增可注入的改名原语（平台 / 延迟表 / rename 函数皆可作参数传入），回归锚在 **macOS 上也能跑出 win32 分支** | `package.json` 版本号不动；CLI 参数、退出码、USAGE、schema、入口资产零改动（无契约测试同步面） |
| 逐个核对并处置三个不经 `writeAtomic` 的直接 rename 调用点（`lock.ts` / `review.ts` / `doctor-deadline.ts`），每个写明结论与理由（§3.4） | `lock.ts` 的回收改名**不加重试**（§3.4 A：rename 失败是仲裁结局而非错误路径） |
| 回归锚四种情形（三码参数化）+ 后写者胜 + 变异必红（§4.1）；Windows 零配额实测两场景（§4.3） | `writeFile`（写新建 tmp）不加任何重试：写的是自己独占新建的文件，无覆盖语义，不存在「目标被占」的争用面 |
| 文档：BACKLOG EV-260 收口、Bug 清单第 17 条同步、主设计 v1.3.181 → v1.3.182、中文导读 §7.1 补段、GUIDE_local_pitfalls 补 PS 5.1 ANSI 坑、测试报告 + evidence 目录 + README 归档索引（§5） | 真实厂商 CLI 调用、含凭据配置的读取（任务书明令：需要花配额或动凭据的步骤先停下问用户；本主题没有任何此类步骤） |
| | 历史 `*.tmp-*` 残件的清扫（POSIX 分支行为零变化约束下不动失败面）；status.json 的内容级防护（心跳取 max / 序号拒退——CODEX-02 子建议，驳回理由见裁决件） |

---

## 1. 现状（逐条对照代码，`6e5f3131`）

（与 r1 相同，claude 侧已独立复核全部事实；为完整起见保留。）

### 1.1 `writeAtomic` 与证据

| # | 事实 | 出处 |
| :-- | :-- | :-- |
| F1 | `writeAtomic`：`ensureDir` → 写 `${target}.tmp-${pid}-${Date.now()}` → `fs.rename(tmp, target)`。**无任何重试**；rename 失败时错误原样上抛，tmp 留在盘上 | `src/trivium/util/fsx.ts` :26-31 |
| F2 | 失败样本（`not ok 357`，EV-160 I2 桩集成）：`--start` 在派生 worker 之后写 `status.json` 时 `✗ 内部错误：EPERM: operation not permitted, rename '…\status.json.tmp-51308-1793068354174' -> '…\status.json'`，随后编排器按既有收尾路径终止 worker 组、归档判 failed。同文件单跑通过——**偶发、与并发争用相关** | 证据 :2326-2353；错误原文 :2342 |
| F3 | 推测成因（EV-260 原文，未实测证实）：win32 上 rename 覆盖目标时目标被别的进程短暂占着（`--start` 与 worker 并发写同一 `status.json`、杀毒或索引服务扫描）报 EPERM / EACCES / EBUSY；POSIX rename 无此面。graceful-fs 对同类问题在 win32 上对 rename 做 EPERM 重试，是业界同型做法 | BACKLOG EV-260 行 |
| F4 | `writeAtomic` 是全部原子写的公共函数：`state.ts`（**state.json**）、`status.ts`（**status.json**——F2 的失败文件）、`archive.ts`、`run-files.ts`、`meta.ts`、`scrub.ts`、`init.ts`、`hook-config.ts` 共 8 个模块走它。改这一处即覆盖观测点 | `grep -rln writeAtomic src/trivium/`（8 文件 + fsx 自身；claude 侧独立复核一致） |
| F5 | tmp 中间态的既有消费者都认 `*.tmp-*` 形状：漂移判据认 `status.json.tmp-<pid>-<ms>`（主设计 v1.3.14 五）；`workTreeHash` 排除 `.reviews` 与 `.trivium` 前缀（v1.3.125，EV-221）；`run-files-parity.test.ts` :92 用首匹配抓 `const tmp = \`${target}…\`` 字面量钉 ATOMIC_TMP_SUFFIX；运行根在 `~/.trivium/runs`（仓库外）。**重试不新增任何文件形状，只是同一 tmp 在 win32 上最长多活约 1 s** | 主设计 :2378、:2179；`test/unit/run-files-parity.test.ts` :82-102 |

### 1.2 三个不经 `writeAtomic` 的直接 rename 调用点

| # | 事实 | 出处 |
| :-- | :-- | :-- |
| C1 | **`lock.ts` `renameAndVerify`**（回收遗留锁的后半段）：`fs.rename(p, tmp)` 把判定为遗留的锁挪走，**`catch { return false; }`——注释「别人先动手了」**。rename 在这里是**仲裁步**：原子性保证「只有一个能成功」，失败是合法结局（别的回收者先动了 / 文件已不在），不是错误路径。后续有「复验 + `link` 放回」兜底，且外层 `acquireLock` 自带 `retries × retryDelayMs` 的取锁重试预算 | `src/trivium/lock.ts` :284-315（catch :290-292）；LLD :598-605 独立佐证 |
| C2 | **锁获取不经 rename**：`acquireLock` 写 tmp 后用 `fs.link(tmp, p)` 进位，`EEXIST` 即占用——原子性由 link 的 O_EXCL 语义承担，本主题不碰 | `src/trivium/lock.ts` :376-394 |
| C3 | **`review.ts` `stashVoidedOutput`**（把被作废尝试的 `out/` 挪到 `voided/<侧>/attempt-<n>/`）：`fs.rename(outDir, target)`，**目录**挪移；**不抛**——失败（非 ENOENT）时 warn + 对 `outDir` 尽力整删一次 + 照样重跑。它的目的正是防止重跑侧把上一次的输出读回去（守卫盲区），挪移失败且删不掉时该防护失效、只留 warning | `src/trivium/review.ts` :2541-2560 |
| C4 | **`doctor-deadline.ts` `TempDirLedger.update`**：手写「写 `${file}.tmp` → `fs.rename(tmp, file)`」——与 `writeAtomic` 完全同形状的台账落盘；整条 chain `.catch(() => undefined)` 吞错。rename 失败会留 `${file}.tmp` 残件（今天如此）；台账清扫只认 `LEDGER_RE = /^doctor-temp-(\d+)\.json$/`，`.tmp` 与 `.tmp-<pid>-<ts>` 后缀都不会被误读成别家台账 | `src/trivium/doctor-deadline.ts` :229-240、:98、:102-104 |
| C5 | 全仓 `fs.rename` 调用恰 4 处：`fsx.ts:30`、`lock.ts:289`、`review.ts:2547`、`doctor-deadline.ts:239`，别无遗漏 | `grep -rn "\.rename(" src/`（claude 侧独立复核一致） |

### 1.3 重试上界的相关预算（r2 补齐等待侧，CODEX-01）

| # | 事实 | 出处 |
| :-- | :-- | :-- |
| B1 | Hook 预算：PreToolUse 15 s、Stop 30 s——Hook 进程内的 state 写走 `withGlobalLock` → `writeAtomic`，重试上界须远小于 15 s，否则把 Hook 拖到「超时即放行」（更危险的失败模式） | `skills/dual-critic/hooks/hooks.json`（timeout 15 / 15 / 15 / 30） |
| B2 | **等待侧取锁预算**：`withGlobalLock` 缺省 `retries: 40 × retryDelayMs: 100` ≈ **4 s**（`lock.ts:481-482`；`updateState` 即用此缺省，`state.ts:146`）；持锁者新增的 重试睡眠 ≤775 ms 占该预算约 19%，**等待方预算（4 s）> 持锁增量（775 ms）× 5**，重试不给等待方引入取锁超时这一新失败模式。锁内容重建里的规范化启动时刻有进程内缓存（`selfCanonicalStartTime`，`lock.ts:68-77`），等待尝试不重复派生 `ps` | `src/trivium/lock.ts` :472-485、:350-351；`src/trivium/state.ts` :146 |
| B3 | `--start` / worker 写 `status.json` 的心跳与状态节奏是 30 s 级（`WORKER_HEARTBEAT_MS` 下限 30 s；失联阈值 `heartbeat_stale_s` 缺省 120 s）；单次原子写多花亚秒不影响任何时限判定 | `lock.ts:169-178`；`status.ts` |
| B4 | 既有测试对 `writeAtomic` 无直接单测文件；`stashVoidedOutput` 与 `TempDirLedger` 各有既有测试承接接线回归；`run-files-parity.test.ts` 另钉 tmp 名形状（F5） | `test/unit/void-rerun.test.ts`、`test/unit/doctor-deadline.test.ts`、`test/unit/run-files-parity.test.ts` |

---

## 2. 实测（只读 / 零配额）

### 2.1 已有证据（不再复跑）

`not ok 357` 的失败原文、退出码、`--start` 收尾四行警告已入库（§1.1 F2 的出处行），直接引用；复现依赖真实争用时机，交给 §4.3 的**受控**实测（PowerShell 显式按住句柄）。

### 2.2 本机环境事实（零配额核对，2026-10-27）

| # | 事实 | 用途 |
| :-- | :-- | :-- |
| E1 | Windows 开发机 win32 10.0.26300、Node v22.23.2、Git 2.54.0.windows.1（doctor `host` 段） | §4.3 实测环境 |
| E2 | 坑清单 `P-xx` 无 rename/EPERM 条目；**PS 5.1 无 BOM `.ps1` 按 ANSI 读**的坑只在记忆与发布脚本先例、P-xx 台账没有——本主题顺带补登（§5，CLAUDE-03）。§4.3 的 `.ps1` 全文 ASCII-only，一切 `Set-Content` / `Get-Content` 显式 `-Encoding UTF8`（任务书同款要求） | `GUIDE_local_pitfalls.md`（claude 侧核过 P-34 为最后一条） |

---

## 3. 改法

### 3.1 新原语：`fsx.ts` 导出 `renameOverwriting`

```ts
export interface RenameRetryOptions {
  /** 判定平台；缺省 process.platform。测试注入 'win32' 即可在 macOS 上跑 win32 分支 */
  platform?: NodeJS.Platform;
  /** 重试间隔表（毫秒）；缺省 [25, 50, 100, 200, 400]。测试注入小值避免真实等待 */
  delaysMs?: readonly number[];
  /** 被测改名函数；缺省 fs.rename。回归锚的故障注入点 */
  rename?: (from: string, to: string) => Promise<void>;
}

/**
 * 改名覆盖目标。win32 上对 EPERM / EACCES / EBUSY 做【有界短重试】（EV-260）：
 * 间隔按 delaysMs 指数退避，耗尽后抛最后一次的原始错误；其余错误码与非 win32
 * 平台单次、立即抛出（POSIX 行为与原先逐字相同）。onExhausted 在 win32 三码
 * 耗尽、抛出之前回调（writeAtomic 用它清本次临时文件）；**其自身异常在原语内
 * 一律吞掉**——原始错误最高优先，清理失败不得顶替它（AGY-01）。
 */
export async function renameOverwriting(
  from: string,
  to: string,
  opts?: RenameRetryOptions & { onExhausted?: () => Promise<void> },
): Promise<void>
```

实现轮廓（细节编码时定，语义以此为准）：

- 平台取 `opts?.platform ?? process.platform`；**非 `win32`：`await rename(from, to)` 一次、直接返回 / 抛出——不进任何循环**。
- `win32`：循环尝试；捕获后取 `code`，`EPERM` / `EACCES` / `EBUSY` 之外**立即 `throw e`**（不清理、与今天行为一致）；可重试码若还有剩余间隔则 `sleep(delays[i])` 后再试；间隔用尽 → `try { await onExhausted?.() } catch { /* 吞：原始错误优先（AGY-01）*/ }` → `throw` **最后一次捕获的原始错误对象**（引用不换、不包装）。
- 成功即返回；不改动 mtime 之类任何额外语义；不拼 tmp 名（tmp 名只由 `writeAtomic` 拼，见 §4.1 接线段）。

**参数取值理由（D1，用户要求在计划里给）**：缺省 `delaysMs = [25, 50, 100, 200, 400]`，共 6 次尝试、**总睡眠上界 775 ms（< 1 s）**。依据：

1. **争用窗的现实尺度**：自家双写者（`--start` 与 worker 各自的 `writeAtomic`）争用的是对方 rename 的一瞬，毫秒级——首个 25 ms 档即解；杀毒 / 索引服务对刚写文件的实时扫描通常几百毫秒内放开——100 / 200 / 400 ms 档覆盖。F2 的失败是**单发**的（同文件单跑全过），说明争用窗远小于秒级。
2. **上界对预算的占比**：Hook 预算 15 s（B1），775 ms 占 5%，不会把 Hook 拖到「超时即放行」；**等待侧取锁预算 4 s**（B2），持锁增量占 19%、余量 5 倍，不给等待方引入取锁超时；心跳 / 临界区判定 30 s 级（B3），单次写 +775 ms 不影响任何判定；`--start` 的用户可感延迟在「偶发 +775 ms」与「直接内部错误退出」之间取前者。
3. **每次调用独立计界**：上界按**单次 `writeAtomic`** 计，不设全局预算——`--start` 一次最多写几个状态文件，极端全撞也就几秒；满负载下不会叠加成无界等待（每写的重试只由自己的争用触发，争用消失重试即停）。
4. **不采 graceful-fs 的零延迟紧循环**：满载下空转烧 CPU；指数退避以最少的尝试次数覆盖最长的现实争用窗（6 次尝试覆盖 775 ms，线性 25 ms 档要 32 次才等效）。
5. `EBUSY` 在 rename 上的本机实测样本没有（F2 只见过 EPERM）——纳入它是与 graceful-fs 同列的前瞻口径，任务书点名三码，照办。

### 3.2 `writeAtomic` 接线

```ts
export async function writeAtomic(target: string, content: string | Buffer, opts?: RenameRetryOptions): Promise<void> {
  await ensureDir(path.dirname(target));
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, content);
  await renameOverwriting(tmp, target, {
    ...opts,
    onExhausted: async () => {
      // win32 三码耗尽：清掉本次 tmp（尽力而为，清不动不吞掉原始错误——原语侧已防护 AGY-01）
      await fs.rm(tmp, { force: true, maxRetries: 3 }).catch(() => undefined);
    },
  });
}
```

行为面：

- **POSIX / 非 win32**：`renameOverwriting` 单次直通——单次 rename、错误原样抛、tmp 不清，与今天逐字相同（F1）。
- **win32 + 三码 + 耗尽**：清 tmp 后抛**最后一次的原始错误**（`onExhausted` 内部已吞清理异常；`fs.rm` 自带 maxRetries 3，应对 AV 也按着 tmp 的边角）。
- **win32 + 非三码**：立即抛、tmp 不清（与今天一致；任务书只把「清 tmp」绑在重试最终失败上）。
- **并发「后写者胜」**：两个写者各持独立 tmp（pid+时间戳），rename 覆盖语义不因重试改变；重试只是把**同一个**覆盖动作延后，最终内容 = 最后一次成功 rename 的内容（§4.1 T6 钉形式语义；「延迟者内容较旧」的方向见 §3.5）。
- `fs.writeFile(tmp)` 一步不加任何重试（§0 不做栏的口径）。

### 3.3 注释与文案

`fsx.ts` 头部「原子写」注释补一行 win32 重试口径（EV-260）；`writeAtomic` 的 JSDoc 写明三种结局（成功 / win32 三码耗尽清 tmp 抛原错误 / 其余立即抛）与 POSIX 零变化。`review.ts`、`doctor-deadline.ts` 改动处各留一行指向 EV-260 的短注（对齐仓库注释密度，不展开）。

### 3.4 三个调用点逐个结论（D2，用户点名必须逐个写明）

| 调用点 | 结论 | 理由 |
| :-- | :-- | :-- |
| **A. `lock.ts:289` `renameAndVerify` 的 `fs.rename(p, tmp)`** | **不加重试，保持原样** | 这是回收仲裁步：rename 的原子性保证「只有一个回收者能成功」，**失败是合法结局**（`catch → return false`＝「别人先动手了」），不是暂时性错误。给它加三码重试会把「仲裁输了」误读成「再试试」，拉长认领文件（`RECLAIM_CLAIM_STALE_MS` 10 s 语义）与「挪走的可能是活锁」窗口的时间面；而短暂 EPERM 在现语义下只是**本轮不回收**，`acquireLock` 上游有自己的重试预算（C1），下一轮自然再试——fail-closed 且无丢失。锁**获取**（C2）走 `link` 的 O_EXCL，不经 rename，不在讨论面 |
| **B. `review.ts:2547` `stashVoidedOutput` 的 `fs.rename(outDir, target)`** | **与 writeAtomic 同口径**：换成 `renameOverwriting(outDir, target)`（缺省参数即 win32 三码重试） | 普通挪移、非判定步：失败不走仲裁而走「warn + 尽力整删 + 照样重跑」的尽力路径（C3）。但它的目的是防重跑侧读回作废输出，win32 上同样的句柄争用会让这道防护偶发失效——提高它在 win32 上的成功率与 `writeAtomic` 同理。目录 rename 与文件 rename 走同一 `fs.rename` 语义，原语通用。耗尽后**照旧落入既有 catch**（warn + `tryRemoveTempDir(outDir)` 兜底 + 重跑），外层行为面零变化；不传 `onExhausted`（清理决策归既有 fallback，不由改名原语代删 `outDir`）。POSIX 上非 win32 分支单次直通，行为与今天相同 |
| **C. `doctor-deadline.ts:239` `TempDirLedger.update` 的手写 tmp+rename** | **与 writeAtomic 完全同口径**：整段改调 `writeAtomic(this.file, JSON.stringify({...}))`，删掉手写 tmp 与 `fs.mkdir`（writeAtomic 自带 `ensureDir`） | 它就是 `writeAtomic` 的形状（C4）：同目录 tmp + rename 覆盖 + 吞错 chain。改后获得 win32 重试与耗尽清 tmp；台账清扫 `LEDGER_RE` 不认 `.tmp-*` 后缀（C4），tmp 名变化（`.tmp` → `.tmp-<pid>-<ts>`）不影响任何读取面。外层 `this.chain` 串行与 `.catch(() => undefined)` 吞错语义逐字保留。顺带修掉「rename 失败留 `.tmp` 残件」的既有小残件面。**POSIX 上的可观察差异**（残件形状、mkdir→ensureDir）属本调用点特有，在 §6.1 R5 声明（CODEX-04） |

### 3.5 延迟写者与陈旧内容后落（r2 新增，CODEX-02 / CLAUDE-01）

重试在 win32 上引入一种**今天以响亮失败收场的新交错**：写者 A 的 rename 撞可重试码退避期间，写者 B 的 rename 已成功落较新内容，A 随后重试成功、用较旧快照覆盖 B。今天 win32 上这一交错以 A 抛错告终（B 的新内容保住）；改后它静默成功且内容回退。逐文件分析：

| 文件 | 写入方与串行化 | 陈旧后落的影响 | 结论 |
| :-- | :-- | :-- | :-- |
| `state.json` | 全部经 `updateState` → `withGlobalLock`，同机串行（B2） | 锁已把写者排队，重试延长的是持锁时长、不产生「旧盖新」交错 | 无此面 |
| `status.json` | `writeStatus` 直写 `writeAtomic`、**不经全局锁**（`status.ts:132-137`）；`--start` 补写与 worker 心跳本就并发（F2） | 延迟 rename（≤775 ms）落在较新写之后，`heartbeat_at` 与快照回退 ≤ 快照年龄（秒级），对 30 s 心跳间隔与 120 s 失联阈值是噪声；`--start` 补写「`phase` 已终态不再改回 running」的字段级防护已是既有设计（导读 §7.1） | 影响可忽略，如实登记（§6.2），不加内容级防护 |
| 其余 6 个消费模块 | 各自的场景（归档、run 元数据、清扫清单、hook 配置等）无同一目标的双写者争用面（F4 模块清单逐一核对：或单写者、或目标唯一） | — | 无此面 |

**POSIX 对照**：rename 覆盖「打开中的文件」在 POSIX 上成功，这一交错**自始存在**于 macOS / Linux——本修正是把 win32 对齐到 `writeAtomic` 跨平台既有语义，不是发明新语义。内容级防护（心跳取 max、序号拒退）被驳回（裁决件：跨平台语义变更超出授权、余量 38 倍以上的过度设计）。

---

## 4. 验证

### 4.1 单测（新增 `test/unit/fsx-write-atomic-retry.test.ts`，全平台跑）

全部用 `writeAtomic` / `renameOverwriting` 的注入参数（`platform` / `delaysMs` / `rename`）构造，**macOS 上同样跑出 win32 分支**；`delaysMs` 注入 `[1, 1]` 一类小值避免真实等待：

| # | 情形 | 断言 |
| :-- | :-- | :-- |
| T1×3 | 前几次失败、之后成功：`platform:'win32'`，注入 rename 前两次抛可重试码、第三次成功——**对 EPERM / EACCES / EBUSY 三码各跑一格**（AGY-02） | resolve；注入函数恰被调 **3** 次；目标内容正确；目录无 `.tmp-*` 残留 |
| T2×3 | 一直失败：全部抛可重试码——**三码各一格**（AGY-02） | rejects，抛出的是**最后一次注入的同一错误对象**（引用相等）；注入函数恰被调 `delays.length + 1` 次；`.tmp-*` 已清 |
| T3 | 非重试类错误码：首次抛 `{code:'ENOENT'}` | rejects 且 code 透传；注入函数恰被调 **1** 次（没进循环重试）；`.tmp-*` **未**清（win32 与 POSIX 同形：立即抛不清） |
| T4 | 非 win32 不重试：`platform:'darwin'` 与 `'linux'` 各一格，抛 `{code:'EPERM'}` | rejects 且透传；恰调 **1** 次；`.tmp-*` 未清 |
| T5 | win32 首次成功 | resolve；恰 1 次；零额外行为 |
| T6 | 后写者胜（形式语义）：真 `fs.rename`，注入执行序——写者 A 的 rename 被延到写者 B 的 rename 完成之后才放行（`platform:'win32'`，A 首次抛可重试码制造延后）。**注释口径（r2，CODEX-02）**：钉的是「最后一次成功 rename 胜」的形式语义；「延迟者内容较旧」的方向不在此断言、由 §3.5 分析与 §6.2 登记承接 | 目标最终内容 = **A**（后执行的 rename 胜）；无 tmp 残留 |
| T7 | `renameOverwriting` 直用（B 调用点同形）：目录 rename 的 win32 重试 | 同 T1/T2 口径各一格（目录夹具） |
| T8 | **变异必红口径**（写进用例注释）：删掉重试循环（win32 也单次抛）后，T1 的「恰 3 次」变 1、T2 的「恰 3 次」变 1——两格必红；删掉 `onExhausted` 清理后 T2 的「无 `.tmp-*`」必红；把三码判定改宽（如收 `ENOENT`）后 T3 的「恰 1 次」必红；删掉三码里的任一码（如只判 EPERM）后 T1/T2 的 EACCES、EBUSY 格必红（AGY-02 的目的） | 上述断言本身即锚，无需独立变异脚本 |

接线回归（不新开注入面，避免为接线伪造生产不可达路径）：

- `void-rerun.test.ts`（stashVoidedOutput 成功 / ENOENT / 失败 fallback 三态）与 `doctor-deadline.test.ts`（台账落盘与清扫）既有用例全量跑绿；`doctor-deadline` 补一格「落盘后无 `.tmp` 残件」断言（旧实现的残件面，C4）。
- `run-files-parity.test.ts` 的「原子写临时文件名形态」用例从 `fsx.ts` 源码**首匹配**抓 `const tmp = \`${target}…\`` 字面量（F5，CLAUDE-04）：实现保持 `writeAtomic` 内该行为 fsx.ts 中首处同形态出现——`renameOverwriting` 只收 `from` / `to`、不拼 tmp 名，天然满足；该用例列入回归面，若实现挪动字面量须同步更新其抓取。

### 4.2 集成

不加新集成用例：EV-160 I2（`heartbeat-threshold-warning`，F2 的失败格）本身就在全量里以桩适配器反复走 `--start` → `status.json` 写链路，是现成的端到端回归；真实争用时机不可控，端到端的争用验证交给 §4.3 受控实测。

### 4.3 Windows 零配额实测（一次性，不进常规套件）

**为什么不进套件**：依赖真实句柄争用的计时（按住 400 ms / 5 s），满负载下会引入新的底噪族（Bug 清单第 13 条教训）；回归职责已由 §4.1 注入锚承担。作为发证实测跑一次，输出入 evidence。

工作目录在**仓库外**（`$TEMP` 下自建），脚本与输出事后遴选拷入 `doc/05_testing/evidence/windows-atomic-write-retry-2026-10-27/`：

1. **被测对象**：经 esbuild 即时打包的入口（`import { writeAtomic } from '<repo>/src/trivium/util/fsx.ts'`，与产品同一源码、零改编），缺省参数（真 775 ms 档）——测的是缺省行为而非注入行为。
2. **同步握手（r2，CODEX-03）**：PowerShell 持柄方 `File.Open` 成功后向 stdout 打一行 `READY`（ASCII），node 侧读到 `READY` 才发起 `writeAtomic`——消除子进程启动抖动造成的「该拒未拒」假绿 / 假红；场景 B 同样确认按柄成功后才起表计时。
3. **场景 A（短暂占用 → 重试成功）**：先 `writeAtomic` 建目标；PS 以 `[System.IO.File]::Open($p, 'Open', 'Read', 'None')` 按住 **400 ms** 再放开（`FileShare.None` 不含 Delete ⇒ rename 覆盖被拒）；握手后调用 `writeAtomic` 写新内容。断言：成功、目标内容为新值、目录无 `.tmp-*`、**耗时 0.1～1.5 s**（真实耗时 ~400 ms；下界 0.1 s ≥ 3 次睡眠之和 75 ms，证明确实发生过重试——时序边界口径，不依赖进程外计数，AGY-03 / CLAUDE-02）。
4. **场景 B（按住超过上界 → 原错误 + tmp 已清）**：同一按法持续 **5 s**（≫ 775 ms）。断言：`writeAtomic` rejects、错误 `code` 为 `EPERM` / `EACCES` 之一（原始错误透传，不包装）、目录无 `.tmp-*`、**耗时 0.7～3 s**（r2 放宽上界：775 ms 档 + 6 次 syscall + `onExhausted` 的 `fs.rm maxRetries:3`（Node 缺省 retryDelay ~100 ms/次，CODEX-05）+ 满载抖动，3 s 上界给足余量）。
5. **PowerShell 细节**：`.ps1` 全文 **ASCII-only**（PS 5.1 无 BOM 按 ANSI 读，§2.2 E2）；一切文件读写显式 `-Encoding UTF8`（任务书要求）；输出由 node 侧收集回拼，不经 shell 重定向。
6. **验收读数写在仓库外**，入库的是遴选后的脚本 + 输出 + 一段判读（与 §5 的 evidence 目录同批提交）。

### 4.4 全量与判读口径

- `npm run check`（typecheck + build + test）须全绿；Windows 本机跑，读数记入报告。
- 本机（同机、满并发）历史上的底噪红族见 Bug 清单第 6 / 13 条：若全量出现红格，按「同文件单跑复跑」归因——单跑过＝底噪登记，单跑仍红＝本主题缺陷回头修；**失败不得宣称成功**。

---

## 5. 文档同步

| 对象 | 改动 |
| :-- | :-- |
| BACKLOG EV-260 | `todo` → `done`：写清修法（win32 三码有界重试 + 775 ms 上界 + 三调用点结论）与剩余边界（§6.3 的口径原文搬入，含 win32 新交错登记） |
| Bug 清单 §3.1 第 17 条 | 行首状态同步：「EV-260 当天已修、Windows 已实测」（与 EV-259/261/262 并列口径） |
| 主设计（`2026-09-10-…主攻双审流水线设计.md`） | **v1.3.181 → v1.3.182**：文档头版本行 + 变更记录一行（修法、上界、三调用点、§3.5 分析口径、回归锚与实测读数出处）；正文在引 `writeAtomic` 原子落盘为依据的段落（提交锚上下文，:1928 一带）补 win32 重试规范一句，指向 `fsx.ts` |
| 中文导读（`系统设计说明书.md`） | §7.1 末尾补一段「原子写的 win32 有界重试（EV-260）」短段（口径同主设计，含延迟写者交错的登记；产品版本行不动——package.json 不升版） |
| GUIDE_local_pitfalls.md（r2 新增，CLAUDE-03） | 补登 P-xx 新条目：「PS 5.1 无 BOM `.ps1` 按 ANSI 读坏中文字面量——脚本一律 ASCII-only 或存带 BOM，`Set-Content` / `Get-Content` 显式 `-Encoding UTF8`」（编号按台账末尾顺延，发布脚本惯例作依据） |
| 测试报告 | 新增 `doc/05_testing/REPORT_2026-10-27_windows_atomic_write_retry.md`：修法、三调用点结论、§3.5 分析、T1–T8 清单、实测 A/B 判读、全量读数、剩余边界 |
| evidence | `doc/05_testing/evidence/windows-atomic-write-retry-2026-10-27/`：实测脚本（ASCII `.ps1` + 打包入口源）、两场景输出（含握手与耗时读数）、判读短文 |
| README 归档索引 | `doc/05_testing/README.md`「当前已归档文件」按该文件规范句补 REPORT 条目（形态以 `test/helpers/doc-archive-index.ts` 判定为准，编码时照抄现役样例） |

`skills-src/`、PROTOCOL、QUICKSTART、schema、`AGENTS.md` 契约面：零改动（无 CLI / 形状 / 入口措辞变化）。

---

## 6. 风险与边界

### 6.1 对既有不变量

| # | 风险 | 处置 |
| :-- | :-- | :-- |
| R1 | 重试期间 tmp 多活 ≤ 775 ms（仅 win32）：目录扫描者可能撞见 | F5 的消费者已认 `*.tmp-*`（漂移判据、workTreeHash 排除、run-files-parity 钉形状、运行根在仓库外）；不新增形状，只是既有中间态的存活时长变长，仍在所有既有容忍口径内 |
| R2 | **持锁时长与等待方预算**（r2 按 CODEX-01 补数值）：重试睡眠发生在 `withGlobalLock` 持锁区间内，持锁时长上抬 ≤775 ms | 等待侧预算 `withGlobalLock` 40×100 ms ≈ 4 s（B2），持锁增量占 19%、余量 5 倍；Hook 侧 15 s 预算占 5%；**重试留在锁内**——移出持锁区间会制造「锁已放、rename 未落」的窗口，得不偿失。数值表随报告留档 |
| R3 | `--start` 满负载被重试拖慢 | 单次调用独立计界（D1.3）：争用消失重试即停；对比现状「直接失败退出 + worker 被终止」，亚秒重试是严格改善 |
| R4 | `stashVoidedOutput` 换原语后行为面漂移 | 耗尽后落回**既有** catch 路径（warn + 整删 + 重跑），只有「重试期间成功」是新增结局；既有三态测试全量回归（§4.1 接线段） |
| R5 | `TempDirLedger` 改 `writeAtomic` 后 POSIX 上可观察的形状差异（r2 按 CODEX-04 声明） | ① rename 失败残件 `.tmp` → `.tmp-<pid>-<ts>`：读取面只认 `LEDGER_RE = /^doctor-temp-(\d+)\.json$/`（`doctor-deadline.ts:98`），两种后缀都不匹配、同样无读取者；② 手写 `mkdir` 换 `ensureDir`：同为 `recursive` 语义，幂等无差异；③ 新形状即 `writeAtomic` 全平台统一形状，F5 的消费者口径覆盖 |

### 6.2 如实登记的边界（写进 BACKLOG 收口行与报告）

- **win32 新交错（r2 新增，CLAUDE-01 / CODEX-02）**：重试使延迟写者可能在较新写入后以较旧快照成功覆盖（窗口 ≤775 ms，仅 `status.json` 类无锁并发写可见；`heartbeat_at` 回退 <1 s，不影响 30 s 心跳与 120 s 失联判定；POSIX 自始有此交错，本修正对齐跨平台既有语义）。
- `EBUSY` 样本未实测到（前瞻纳入，graceful-fs 同列）；`writeFile(tmp)` 不重试（无覆盖语义，无争用面）。
- AV 持有目标超过 775 ms 仍会失败——改善的是「必然立即失败」→「有界等待后以原始错误失败」，不是保证成功。
- 非三码错误（如 `ENOENT`、跨盘 `EXDEV`）行为与今天完全一致（立即抛、win32 也不清 tmp）。
- macOS / POSIX 侧**没有**对应回归的实机实测（`fsx.ts` POSIX 分支零变化由 T4 与「分支不进循环」的结构保证；C 调用点的无害差异由 R5 论证）；惯例上 macOS 全量复跑一次 `npm run check` 收尾读数（本机是 Windows，报告里如实写「macOS 复跑待用户在 Mac 侧执行」）。

### 6.3 BACKLOG 收口行预写（剩余边界原文）

> done（2026-10-27，主题 `Windows原子写重试`）：`writeAtomic` 拆出 `renameOverwriting` 原语，win32 上对 EPERM / EACCES / EBUSY 按 [25,50,100,200,400] ms 指数退避有界重试（共 6 次、总睡眠 ≤ 775 ms），耗尽清 tmp 后抛最后一次原始错误；POSIX 与非三码行为逐字不变。三调用点：`lock.ts` 回收改名不重试（仲裁语义，上游取锁自带预算）；`review.ts` stashVoidedOutput 同口径换原语（耗尽落回既有 fallback）；`doctor-deadline.ts` 台账改调 `writeAtomic`。剩余边界见报告 §6.2（EBUSY 前瞻、AV 超上界仍败、win32 延迟写者交错 ≤775 ms 已登记、macOS 复跑待做）。

---

## 7. 决策点（第 1 轮双审后维持或修订）

| # | 决策 | 取值与理由（r2 变化加注） |
| :-- | :-- | :-- |
| D1 | 延迟表与上界 | `[25,50,100,200,400]` ms、6 次、775 ms（§3.1 五条依据；r2 补等待侧取锁预算 4 s 的比较——CODEX-01） |
| D2 | 三调用点处置 | A 不重试 / B 同口径换原语 / C 并入 `writeAtomic`（§3.4 逐个理由；第 1 轮三侧均认同） |
| D3 | 耗尽清 tmp 的范围 | 只在「win32 + 三码 + 耗尽」清；非三码与 POSIX 不清（任务书把「清掉」绑在重试最终失败上；最小差异面原则） |
| D4 | 注入面 | `platform` / `delaysMs` / `rename` 三参数，挂在导出原语上；`writeAtomic` 透传 |
| D5 | 实测形态 | 一次性发证实测不进套件（§4.3 理由）；**r2 补 READY 握手与时序边界断言**（CODEX-03 / AGY-03 / CLAUDE-02），场景 B 窗口 0.7～3 s（CODEX-05） |
| D6（r2 新增） | `onExhausted` 异常防护的位置 | 放在 `renameOverwriting` 原语内吞掉、不依赖调用方自觉（AGY-01：原始错误最高优先） |
| D7（r2 新增） | 延迟写者交错 | 如实登记、不加内容级防护（§3.5 分析 + §6.2 登记；CODEX-02 子建议驳回、CLAUDE-01 建议采纳） |

---

## 8. 流程

命令 A（本主题由此发起）：S1 原稿 → S2 计划双审第 1 轮（run `20261027T091039Z`，1 通过 / 2 修改后通过）→ S3 本 r2 + 裁决件 → S4 闸门校验 → S4.5 认领 code → S5 编码（§3 全部 + §4.1 测试）→ S6 代码双审 → S7/S8 应答改码 → S9 校验 → S10 `verify`（`npm run check` 全量）→ §4.3 Windows 实测 + §5 文档与证据收口。提交与推送等用户明示后进行。
