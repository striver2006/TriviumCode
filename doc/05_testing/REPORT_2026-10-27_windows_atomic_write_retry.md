# Windows 原子写重试测试报告（EV-260，主题 `Windows原子写重试`）

- **日期**：2026-10-27 ｜ **Driver**：glm（ZCode）｜ **审核者**：codex（qwen3.8-flash）、gemini（gemini-3.8-flash-high，经 agy 1.4.8）、claude（kimi-for-coding[1M]）
- **流水线**：`/dual-run` 命令 A 全流程。计划审 run `20261027T091039Z`（7m12s，1 通过 / 2 修改后通过，12 条意见：11 条接受、CODEX-02 的内容级防护子建议驳回）；代码审 run `20261027T093854Z`（6m19s，**3 通过 / 0 修改后通过 / 0 不通过**，7 条意见全接受）
- **起点**：`6e5f3131`（main，工作树干净）；本机 win32 10.0.26300、Node v22.23.2、Git 2.54.0.windows.1
- **上位**：BACKLOG EV-260；Bug 清单 §3.1 第 17 条；证据 `evidence/release-132-20261027/windows-check-bd5c0635.txt` 的 `not ok 357`

## 1. 缺陷与修法

**缺陷**：`writeAtomic`（`src/trivium/util/fsx.ts`，全部原子写的公共函数，8 个消费模块）先写同目录临时文件再 `fs.rename` 覆盖目标、无任何重试；win32 上目标被并发写者（`--start` 与 worker 同写 `status.json`）或杀毒/索引服务短暂占用时报 `EPERM`/`EACCES`/`EBUSY`，`--start` 以「内部错误：EPERM … rename …」退出（1.3.2 Windows 发版全量 `not ok 357`，EV-160 I2，同文件单跑过）。POSIX 的 rename 覆盖打开中的文件自始成功，无此面。

**修法**（主设计 v1.3.182）：

1. `fsx.ts` 拆出 `renameOverwriting` 原语：**只在 win32** 上对三码按 `[25,50,100,200,400]` ms 指数退避有界重试——6 次尝试、**总睡眠 ≤775 ms**，耗尽清 tmp 后抛**最后一次原始错误**（引用不换、不包装）；`onExhausted` 异常在原语内吞掉、绝不顶替原始错误（计划审 AGY-01）。缺省平台判定引 `IS_WIN`（代码审 CODEX-05）；缺省表导出并由 T10 钉值（代码审 CODEX-03 / CLAUDE-01）。
2. **POSIX 分支与非三码错误**：单次直通、立即抛出、tmp 不清，行为与原先逐字相同（注入 `platform` 参数仅供测试在 macOS 跑 win32 分支）。
3. **上界的预算论证**：775 ms 占 Hook 预算 15 s 的 5%（不致「超时即放行」）；占 `withGlobalLock` 等待侧缺省预算 40×100 ms ≈ 4 s 的 19%（不给等待方引入取锁超时，计划审 CODEX-01 补数值）；心跳/失联判定 30 s/120 s 级。**耗尽路径墙钟最坏 ~1.1 s**（含 `onExhausted` 里 `fs.rm` 的 maxRetries 3 × 缺省 retryDelay ~100 ms，代码审 CODEX-02 口径）；`--start` 单链路串行 writeAtomic ≤12 处，最坏 ~13 s，远小于阶段预算。每次调用独立计界，不设全局预算。
4. **三个直连 rename 调用点逐个处置**（全仓恰 4 处，claude 侧独立复核）：
   - `lock.ts:289` 回收改名**不加重试**：rename 是仲裁步，失败（`catch → return false`）=「别人先动手了」的合法结局；上游 `acquireLock` 自带重试预算。锁获取走 `link` 的 O_EXCL，不经 rename。
   - `review.ts` `stashVoidedOutput`：同口径换 `renameOverwriting`（目录挪移同语义）；耗尽落回既有「warn + 整删 + 照样重跑」兜底，外层行为面零变化。
   - `doctor-deadline.ts` `TempDirLedger.update`：手写 tmp+rename 改调 `writeAtomic`（同形状），外层 chain 串行与吞错语义逐字保留；顺带消灭旧实现 rename 失败留 `.tmp` 残件的既有小残件面（台账清扫 `LEDGER_RE` 不认两种 tmp 后缀，读取面无影响）。

## 2. 回归锚（`test/unit/fsx-write-atomic-retry.test.ts`，9 例，全平台跑）

| # | 情形 | 锚 |
| :-- | :-- | :-- |
| T1×3 | win32 前两次抛可重试码、第三次成功 | 三码各一格；恰 3 次尝试；无 tmp 残留 |
| T2×3 | win32 一直失败（三码各一格） | 抛**最后一次注入的同一错误对象**（引用相等）；恰 `delays+1` 次；tmp 已清 |
| T3 | win32 非重试码（ENOENT） | 恰 1 次、立即抛、tmp 不清（与原先一致） |
| T4 | 非 win32（darwin、linux） | 恰 1 次、EPERM 也不重试、错误透传、tmp 不清 |
| T5 | win32 首次成功 | 恰 1 次 |
| T6 | 后写者胜（形式语义） | 真实 rename + 受控执行序（A 首试挂起至 B 落地后失败、重试覆盖）；最终内容 = 后执行的 rename；**毫秒隔离**防 tmp 名碰撞（代码审 CODEX-01，测试侧修法） |
| T7 | `renameOverwriting` 直用（stashVoidedOutput 同形） | 目录 rename 的重试与耗尽（不带 onExhausted 时源路径不动） |
| T9 | onExhausted 自身异常不顶替原始错误 | 抛出的是 rename 原始错误 |
| T10 | 缺省表钉值 | `deepEqual [25,50,100,200,400]`、总和恰 775——预算论证的受保护事实 |

**变异必红口径**（注释随文件）：删重试循环 → T1×3/T2×3「恰 3 次」变 1、T6 以 EPERM 快速红（机理订正，代码审 CODEX-04）；删 onExhausted 清理 → T2×3 红；三码改宽 → T3 红；三码漏任一 → 对应码格红；改缺省表 → T10 红；删 onExhausted 防护 → T9 红。

单跑：`tsc --noEmit` 绿；`node --test dist/test/test/unit/fsx-write-atomic-retry.test.js` **9/9 绿**。接线回归：`void-rerun`（stashVoidedOutput 三态）、`doctor-deadline`（含新增「落盘后无 `.tmp` 残件」断言）、`run-files-parity`（tmp 名首匹配形状）全绿。

## 3. Windows 零配额实测（装置与判读详见 `evidence/windows-atomic-write-retry-2026-10-27/判读.md`）

被测对象为 esbuild 即时打包的**缺省参数** `writeAtomic`（与产品同源零改编）；PowerShell 以 `FileShare.None` 按住目标、READY 握手后起表：

| 场景 | 断言 | 读数 |
| :-- | :-- | :-- |
| A：按住 400 ms 放开 | 重试后成功 | **826 ms** 成功、内容更新、无 `.tmp-*` |
| B：按住 5 s（≫上界） | 原始错误 + tmp 已清 | **824 ms** 抛原始 `EPERM`（错误原文与 not ok 357 同构）、无 `.tmp-*`、目标内容未破坏 |

场景 A 的实测还带出一个插曲：**开发期本测试自己的「成功步」在本机撞上了真实的瞬时占用**（注入失败之后的真实 rename 偶发被拒）——EV-260 的争用形态在这台机器的日常负载下真实存在，顺带成为缺陷的又一现场证据。

## 4. S10 编译测试（verify）

- `npm run typecheck`、`npm run build` 六次全绿（构建标识 `6e5f313` + 未提交改动）。
- `npm test` 全量 **3129 例 / 43 跳过**，六次运行红格数 **5 / 5 / 4 / 3 / 1 / 3，未达 0 红**，verify 闸门判失败（六份 verify 记录保留于 `.reviews/Windows原子写重试/verify/`）。

### 逐格归因（§4.4 口径：单跑复跑）

| 运行 | 形态 | 红 | 身份与单跑结局 |
| :-- | :-- | :-- | :-- |
| ①–⑥ verify | 编排器 | 5/5/4/3/1/3 | 编排器只留尾部、身份未留档 |
| 补充捕获 ×3 | 直接 `npm test` 全捕获 | 1 / 1 / 4 | EV-160 I5 → 单跑 6/6 绿；EV-146 K5 → 单跑 42/42 绿；EV-160 I1+I2、gate-loop C4、shared-root S6 → 错误原文全部为「`--cancel` 取不到工作进程启动时刻（进程枚举未返回）退 69」，属 PowerShell 枚举风暴族；对应文件单跑全绿（plan-final-recheck 首跑偶发 1 红、复跑全绿） |

判读：全部已识别红格属 **Bug 清单第 6 / 13 条登记的既有底噪族**（满负载下 PowerShell 进程枚举超时，红格逐轮轮换、单跑全绿；1.3.2 发版全量同机 5–6 红放行同族）。**与本主题的相关性反证：原 EPERM 崩溃形态在今日全部 8 次全量里零出现**——正是本主题修掉的那个；本主题自身锚 9/9 绿。**收口判读（按底噪放行）已于 2026-10-27 经用户认可**；macOS 侧全量复跑由用户后续安排，读数可回填本报告。

## 5. 剩余边界（BACKLOG EV-260 收口行同步）

- `EBUSY` 为前瞻纳入（graceful-fs 同列），本机无实测样本；`writeFile`（写自建 tmp）不重试——无覆盖语义、无争用面。
- 杀毒/句柄持有超过 775 ms 仍会失败：改善为「有界等待后以原始错误失败」，不是保证成功。
- **win32 新交错**：重试使延迟写者可能在较新写入后以较旧快照成功覆盖（窗口 ≤775 ms；仅 `status.json` 类无锁并发写可见；`heartbeat_at` 回退 <1 s，距 30 s 心跳 / 120 s 失联阈值余量 30 倍以上；POSIX 自始有此交错，本修正对齐跨平台既有语义）。内容级防护（心跳取 max / 序号拒退）经计划双审 CODEX-02 提议、裁决驳回（跨平台语义变更超出授权、余量过大）。
- 同进程同毫秒并发写同一目标的 tmp 名碰撞（`pid + Date.now()` 毫秒粒度）属形状边界：`ATOMIC_TMP_SUFFIX` 是机读契约（`run-files.ts:65` + parity 测试 + 主设计形状描述），生产面各目标或经锁/链串行、或跨进程（pid 不同），不触发；测试侧已隔离并注释（代码审 CODEX-01）。
- macOS / POSIX 侧无实机回归（POSIX 分支零变化由 T4 与「分支不进循环」结构保证、C 调用点差异由 R5 论证）；**惯例的 macOS 全量复跑待用户在 Mac 侧执行**，读数可回填本报告。

## 6. 文档同步

主设计 v1.3.182（文档头 + 变更记录行 + 提交锚上下文 ：1928 的 `writeAtomic` 原子落盘句）；中文导读 §7.1 新增「原子写的 win32 有界重试（EV-260）」段；坑清单新登 P-35（PS 5.1 无 BOM `.ps1` 按 ANSI 读）；BACKLOG EV-260 → done；Bug 清单 §3.1 第 17 条同步；`package.json` 版本号不动（1.3.2）。证据：`evidence/windows-atomic-write-retry-2026-10-27/`（`hold.ps1`、`entry.ts`、`live-output.json`、`判读.md`）。
