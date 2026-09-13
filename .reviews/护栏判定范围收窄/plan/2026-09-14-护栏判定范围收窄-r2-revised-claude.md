---
schema: trivium.disposition.v1
topic: 护栏判定范围收窄
stage: plan
role: claude
kind: revised
run_id: 20260913T162911Z
addresses:
  - 2026-09-14-护栏判定范围收窄-r2-gemini.md
  - 2026-09-14-护栏判定范围收窄-r2-glm.md
---

# 计划修订（r2）：护栏判定范围收窄

## 0. 裁决总览

两侧均判 `request-changes`。gemini 3 条（1 blocker），glm 侧**解析降级**、落为 2 个 fallback 单元（`GLM-F02` 内含四条实质意见 GLM-01～04，其中 2 blocker）。

**逐条裁决：接受 5 个单元（含内含的 7 条实质意见），驳回 0，暂缓 0。**

**一组独立收敛**——两侧在背靠背状态下命中同一处死穴：

| 问题 | gemini | glm |
| :--- | :--- | :--- |
| D-2 的**介入条件**没改，进程替换形态照旧放行 | AGY-01 | GLM-01（F02 内） |

glm 另外单独查出一条同级开口（**搬运式伪造**，GLM-02），gemini 未覆盖；gemini 则单独指出 `immutableChangeReason` 的签名与调用处细节（AGY-03），glm 未展开。两侧互补，都不冗余。

### r2 错在哪

我在 r1 被打穿后重写了 D-2 的**放行侧**（干净纯路径白名单），却没动**介入侧**——规则仍以 `basename` 匹配角色后缀（`$` 锚定）作为介入条件。于是：

```
git commit -F <(rm .reviews/t/plan/a-gemini.md)
  → tokenize 产出 token `.reviews/t/plan/a-gemini.md)`
  → basename 是 `a-gemini.md)`，带尾括号，不匹配 /-(?:gemini|glm)\.md$/
  → 判「不匹配后缀 ⇒ 本规则不管」→ 放行
```

我在 §3.3 表里写着「含 `(` `)` `<` → 拦」，**但那条检查根本执行不到**——脏字符判据只作用于已介入的 token，介入不了就无从拦。两侧都用同一句话点破：§3.3 与 §3.2 的算法自相矛盾。

这正是 r1 的死因**原样保留**：r1 死于「resolve 成功 ≠ resolve 正确」，r2 死于「basename 匹配 ≠ 命令里没有该字面量」。**两次都是把一个更窄的信号当成了更宽的判据。**

glm 的纠正一针见血：**宽介入、严放行**。介入判定必须与现行整条命令正则同宽，严格白名单只用于决定**放行**。它还明确否掉了我可能走的下一条弯路：「不建议只把 `)` 加进脏字符表——那还是穷举路线，RV-B1 已证明走不通。」

---

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | blocker | 接受 | 核实属实。`.reviews/…/a-gemini.md)` 的 basename 带尾括号不匹配 `$` 锚定正则，规则①不介入即放行；`cmd.split(/(?:&&\|\\\|\\\|\|[;&\|])/)` 不含 `\n`，多行命令下 `cd` 段之后的行也漏检。两处都实打实 | §2.1 重写介入条件为「宽介入」；§2.3 段分割补 `\n` |
| AGY-02 | gemini | major | 接受 | 三点全部成立：①归档内软链指向归档外时，只按 realpath 落点判会误放行对归档内文件的修改——保护应为「词法或真实路径**任一**在归档内」；②`realpathSync(archiveRoot)` 在归档根未建时抛 ENOENT，我写的「抛错即按归档内」会把 `doc/` 下全部编辑锁死，测试夹具 `fakeCtx` 未真建 `.reviews/` 就会踩到；③伪代码 `realpath(dirname) + basename` 丢了分隔符 | §3 重写解析顺序：词法先判 + 逐级回溯祖先目录 + `path.join` |
| AGY-03 | gemini | minor | 接受 | 属实且其**替代方案更优**：`deletedOrModifiedTracked` 传入的范围本就是 `archiveRel`（已由 git 索引限定在归档内），提交锚处直接用 `hasCriticRoleSuffix(base)` 即可，无需每次 commit 对归档文件做 realpath I/O。我原方案在那里套组合判定属于多余 | §4 提交锚改用纯后缀检查；不扩 `immutableChangeReason` 签名 |
| GLM-F01 | glm | — | 接受 | 该 fallback 单元是审查员的开场陈述（「已按任务书逐条回仓核实…结论如下」），**不含待办**。如实记录、无修改动作——按 FR-14 不得静默忽略，故在此显式裁决 | 无（陈述性内容） |
| GLM-F02 | glm | blocker | 接受 | 该单元是 glm 的完整结构化结论，内含 GLM-01～04 四条实质意见，**逐条接受**，分解见 §1.1 | 见 §1.1 分解表 |

### 1.1 `GLM-F02` 内含意见的逐条分解

| 内含编号 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- |
| GLM-01 | blocker | 接受 | 与 AGY-01 独立收敛。其「宽介入、严放行」的表述比我自己的重写更准确地定位了病灶，且额外给出一个不在任何负例清单里的同类形态：`python3 -c "open('.reviews/…-gemini.md','w')"`（token 尾部 `,w)`） | §2.1；§5 测试补该形态 |
| GLM-02 | blocker | 接受 | **gemini 未覆盖的一条，且是本次收窄引入的静默回归**。`cp doc/x-gemini.md .reviews/t/plan/`：后缀在源 token（归档外→按我的方案放行），目的地 token 无后缀（不介入），而规则②③只保护 `_meta`/`task.json`/`.trivium`、**不保护阶段目录**→整条放行。现状靠整条文本正则拦得住。更要命的是它能**成链**：本次解锁正是允许在 `doc/` 下写 `-gemini.md`，再一条 `cp` 即入归档，而 `listStageArtifacts` 按文件名清点阶段目录，`checkStageArtifacts` 据此判「审查件在位」——留痕与 `--check-artifacts` 双双被伪造，且 git 锚对新增未跟踪文件失明，无跑后兜底 | §2.2 新增放行条件 (d)：同段其余 token 不得解析进归档根；§5 补 mv/cp/install/rsync 的「后缀在源」负例，并纳入 D-5 |
| GLM-03 | major | 接受 | 与 AGY-02② 是同一处代码的两个方向：AGY 说会**误杀**（过严），GLM 说会 **fail-open**（过松）——取决于异常在哪一层被捕获。glm 的追查更深：若异常穿透到 `runHook`，外层 catch 直接 `return ALLOW`（exit 0）；若走「程序缺陷」分支返回 `EXIT.FAIL=1`，而 `hooks.json` 约定「1 = 非阻断」——**两条路径都是静默放行**，与我「fail-closed 不变」的自我主张正相反 | §3.2 明确失败语义：函数内消化异常、回退纯词法比较，**禁止穿透**到 `runHook` |
| GLM-04 | minor | 接受 | 属实，我漏了 `AGENTS.md` 强制的文档同步。主设计 §8.4 现文是「若目标路径以 `-gemini.md`/`-glm.md` 结尾 → 一律 `deny`」（:950），与收窄后直接冲突；`CLAUDE.md` 第 12-13 行的禁令、第 25-31 行的误拦描述也随之失准 | §6 新增文档回补步骤，列入实施第 0 步 |

---

## 2. D-2 第三版：宽介入、严放行

### 2.1 介入条件与现行正则同宽

```
if (!/-(?:gemini|glm)\.md\b/.test(cmd)) return false;   // 全文无该字面量 → 本规则不管
// 全文有 → 默认【拦】，仅当能完整举证时才放行
```

介入条件**与现状逐字相同**（`\b` 词边界，非 `$` 锚定，不看 basename）。这一步不收窄任何东西——收窄全部发生在「放行」侧。

### 2.2 放行需要完整举证

命中介入条件后，只有**全部**成立才放行；任何一条不满足即拦：

| # | 条件 | 堵住的形态 |
| :--- | :--- | :--- |
| (a) | 命令能完整分段，且每段 `cwd` 可推断 | `cd $VAR && rm x-glm.md` |
| (b) | 命令中**每一个**含该字面量的 token 都是「干净纯路径」 | `core.editor=rm …`、`$(rm …)`、`<(rm …)`、`'…',w)` |
| (c) | 这些 token 经 `isInsideArchiveResolved` 判定后**全部在归档外** | 换行接 `rm .reviews/…`、附着重定向 |
| (d) | **同段内其余全部 token**（含 `-` 开头、含 `=` 内嵌值）经同一判定后，**没有任何一个落在归档根内** | **搬运式**：`cp doc/x-gemini.md .reviews/t/plan/` |

「干净纯路径」= 不含空格、`=`、`(`、`)`、`<`、`>`、`&`、`;`、`|`、`$`、反引号、引号残留，且不以 `-` 开头（D-6 的遍历口径见原计划 §6）。

**(d) 是本版新增**，专为 GLM-02。它把判定从「这个后缀 token 在哪」扩展到「这条命令会不会往归档里写东西」。代价是 `cp .reviews/a/plan/x-gemini.md /tmp/` 这类「从归档往外拷」也会被拦——**这个代价我接受**：往外拷没有正当的高频需求，而误拦有 Write/Read 出口。

### 2.3 段分割补换行符

`cmd.split(/(?:&&|\|\||[;&|])/)` 不含 `\n`。多行命令下 `cd /tmp` 之后的行会与 `cd` 同段，`continue` 后整段 token 漏检（AGY-01 后半）。分隔符集合补 `\n`（RV-B1 的换行负例本就依赖这条，现状靠整条正则兜住，收窄后必须自己站稳）。

### 2.4 重写后 D-5 负例的走向

| 负例 | 判定 | 依据 |
| :--- | :--- | :--- |
| `core.editor=rm .reviews/…-gemini.md` | 拦 | (b) 含 `=` 与空格 |
| `GIT_EDITOR="rm …-glm.md" git commit` | 拦 | (b) |
| `sh -c "rm …-gemini.md" git commit` | 拦 | (b) |
| `git commit -F <(rm …-gemini.md)` | 拦 | (b) 含 `(` `)` `<` ← **r2 在此放行** |
| `git commit -m "$(rm …-gemini.md)"` | 拦 | (b) 含 `$` |
| `git commit -m x` ⏎ `rm .reviews/…-gemini.md` | 拦 | (c) 在归档内（且 2.3 已能正确分段） |
| `git commit -m x > .reviews/…-glm.md` | 拦 | (c) |
| `python3 -c "open('.reviews/…-gemini.md','w')"` | 拦 | (b) 含引号与 `,w)` ← **新增形态** |
| `cp doc/x-gemini.md .reviews/t/plan/` | 拦 | (d) 目的地落在归档内 ← **新增形态** |
| `cd $VAR && rm x-glm.md` | 拦 | (a) |
| **`git mv doc/a-glm.md doc/b.md`** | **放行** | (a)(b)(c)(d) 全部满足 ← 本次要解锁的 |

---

## 3. D-3 第二版：词法优先 + 逐级回溯 + 异常不外泄

### 3.1 解析顺序

```
isInsideArchiveResolved(target, projectRoot, archiveRoot):
  1. lexical = path.resolve(projectRoot, target)
     if (isInside(archiveRoot, lexical)) return true          ← 词法先判
  2. root = safeRealpath(archiveRoot)                          ← 对称规范化
     if (root === null) return false                           ← 见 §3.2
  3. resolved = 逐级向上回溯至首个真实存在的祖先目录做 realpath，
                再用 path.join 拼回其余部分                     ← 不因 ENOENT 就下结论
  4. return isInside(root, resolved)
```

**步骤 1 与步骤 4 是「任一在归档内即算归档内」**（AGY-02 建议）：

- 步骤 1 抓「归档内的软链指向归档外」——词法在归档内，不许因真实落点在外而放行对归档内路径的写入；
- 步骤 4 抓「归档外的软链指向归档内」——真实落点在归档内，不许因词法在 `doc/` 下而放行。

步骤 3 的逐级回溯替掉了 r2 的「ENOENT 即按归档内」，后者会锁死 `doc/new_sub/x-glm.md` 这类新建子目录的合法写入，也会在测试夹具没真建 `.reviews/` 时把一切拦死。

### 3.2 失败语义：函数内消化，禁止外泄

`safeRealpath` 捕获全部异常返回 `null`；`root === null` 时**回退到纯词法比较**——步骤 1 已经做过，故直接 `return false`。此时行为与「两侧都不做 realpath」等价，即与现状一致。

**硬性约束**：该函数**不得抛出**。glm 追查到的两条 fail-open 路径（`runHook` 外层 catch → `ALLOW`；`EXIT.FAIL=1` 而 `hooks.json` 约定「1 = 非阻断」）都是异常外泄的后果。测试要覆盖「`archiveRoot` 不可解析时，归档内的后缀写入**仍被拦**」。

---

## 4. D-1 微调：提交锚不做位置判定（AGY-03）

`immutableChangeReason` 的签名**不扩**。`deletedOrModifiedTracked` 传入的范围已是 `archiveRel`，能进 `tracked.modified` 的文件天然在归档根内，位置判定是多余的：

```ts
// hooks.ts:120
if (hasCriticRoleSuffix(base)) return '审查文档只能由编排器落盘，改动即伪造';
```

保留传 `base` 不变，只把函数换成拆分后的纯后缀检查。这样既修掉 r1 的静默失效隐患（组合判定传 basename 恒为 false），又不引入每次 commit 的 realpath I/O。

`hookPreWrite:155` 仍用组合判定 `isForgedRoleFile(target, projectRoot, archiveRoot)`。

---

## 5. 测试计划增补

在原计划 §7 之上增补，**全部纳入 D-5 准入硬条件**：

| 形态 | 期望 | 来源 |
| :--- | :--- | :--- |
| `git commit -F <(rm .reviews/…-gemini.md)` | 拦 | AGY-01 / GLM-01 |
| `python3 -c "open('.reviews/…-gemini.md','w')"` | 拦 | GLM-01 |
| `cp doc/x-gemini.md .reviews/t/plan/` | 拦 | GLM-02 |
| `mv` / `install` / `rsync` 的同形态 | 拦 | GLM-02 |
| `cd /tmp` ⏎ `rm .reviews/…-gemini.md`（多行） | 拦 | AGY-01 |
| 归档内软链 → 归档外 | 拦（词法在内） | AGY-02 |
| `doc/` 下软链 → 归档内 | 拦（真实在内） | AGY-02 |
| `doc/new_sub/x-glm.md`（父目录不存在） | 放行 | AGY-02 |
| `archiveRoot` 不可解析时，归档内后缀写入 | **仍拦** | GLM-03 |
| `git mv doc/a-glm.md doc/b.md` | 放行 | 本次目标 |

---

## 6. 文档回补（GLM-04）——列为实施第 0 步

按 `AGENTS.md` 的「改动同步清单」，行为与设计不一致时**先回补设计文档**：

| 文档 | 位置 | 改法 |
| :--- | :--- | :--- |
| 主设计 §8.4 | `…流水线设计.md:950` | 「以 `-gemini.md`/`-glm.md` 结尾 → 一律 deny」改为「**归档根内**的该形态 → deny」，升补丁版本并记变更 |
| `CLAUDE.md` | 第 12-13 行 | 「禁止产出 `*-gemini.md` / `*-glm.md`」补限定：指归档内；`doc/` 下同形态文件不再拦 |
| `CLAUDE.md` | 第 25-31 行 | 已知误拦的描述随行为改写：干净路径且在归档外的写命令不再被拦，误拦面缩小但未消除（commit message 仍按 §8 用 `-F`） |

---

## 7. 修订后的实施顺序

| 步 | 内容 | 回退 |
| :--- | :--- | :--- |
| **0** | 文档回补（§6）：主设计 §8.4 + `CLAUDE.md` 两处 | 文档单独 revert |
| 1 | `hasCriticRoleSuffix` + `isInsideArchiveResolved`（§3）+ `hookPreWrite` 与提交锚两个调用点（§4）+ 单元测试 | `git revert`，Bash 侧未动 |
| 2 | Bash 侧宽介入严放行（§2）+ 段分割补 `\n` + §5 全部负例 | `git revert` |

**执行细节不变**：`.trivium/bin/trivium` 指向全局安装副本，改完 `hooks.ts` 必须 `npm run build && node dist/install.cjs` 才生效，否则验证的是旧代码。

---

## 8. 两侧盲区的处置

两侧申明的未覆盖范围，我逐条确认**本阶段无需补审**：

- **硬链绕过**（glm）：`realpath` 不揭示硬链，两侧现状均不拦。属**既有缺口、非本次回归**，登记但不在本次范围。
- **TOCTOU**（glm）：判定后换软链再执行。威胁模型是 Agent 自身而非并发对手，影响有限。
- **`isInsideArchive`（`hooks.ts:79`，闸门写锁分支）的对称问题**（glm）：同样是朴素路径比较，软链同样能骗过。glm 已确认它不受本次改动影响。**值得另立任务**，我同意其判断，本次不扩范围。
- **未实际运行验证**（两侧）：两侧都是静态推演。这正是 D-5 把负例实测列为准入硬条件的理由——推演到此为止，实测在实施期把关。
- **NFS/多挂载点下的 realpath 行为**（gemini）：本项目定位 macOS 本地 APFS，不扩。
