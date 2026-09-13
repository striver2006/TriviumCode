---
schema: trivium.disposition.v1
topic: 护栏判定范围收窄
stage: code
role: claude
kind: response
run_id: 20260913T164857Z
addresses:
  - 2026-09-14-护栏判定范围收窄-gemini.md
  - 2026-09-14-护栏判定范围收窄-glm.md
---

# 代码审应答：护栏判定范围收窄

## 0. 应答总览

gemini 判 `request-changes`（2 blocker / 1 major / 1 minor），glm 判 **`block`**（2 blocker / 1 major / 1 minor）。共 8 条，**全部接受**。

**两组独立收敛**：

| 问题 | gemini | glm |
| :--- | :--- | :--- |
| 条件 (d) 对脏 token `continue` 跳过 = 放行 | AGY-01 | GLM-01 |
| deny 文案与收窄后的真实判定脱节 | —— | GLM-04（gemini 未覆盖） |

### 触发 D-5：方案作废，不做局部修补

我在计划 §7 写下的准入硬条件是：

> RV-B1 五类负例一条都不许变绿。若任一条放行，**方案作废重设计，不做局部修补**——r1 的教训正是「局部看着能圆，整体是 fail-open」。

现在正是触发它的时刻，而且触发的不止一条。**按自己定的规矩执行，不给自己开例外。**

三轮迭代的账：

| 轮次 | 被打穿的形态 |
| :--- | :--- |
| plan r1 | `core.editor=`、`GIT_EDITOR=`、`sh -c`、进程替换（4 类） |
| plan r2 | 进程替换（介入条件仍用 basename）、搬运式 `cp doc/x .reviews/` |
| **code r1（本轮）** | 脏 token 跳过（`--target-directory=`、`$DEST`、`$(...)`）、`~` 与 glob 展开、管道分段割裂、子 shell `(cd …)`、**目录级搬运 `cp -R doc/ .reviews/`** |

每一轮我都以为这次堵住了，每一轮审查都找出新形态。这不是运气问题——**是方向问题**，与 RV-B1 撤回时的判定逐字同构：

> 原判定是 fail-closed（看见字面就拦，代价是误拦），豁免把它变成需要穷举危险形态的 fail-open，而 shell 的攻击面穷举不完。

### GLM-03 是压垮方案的那一条

它指出了一件前两轮没人看到的事：**收窄创设了新的系统状态**——`doc/` 下从此可以合法存在 `-gemini.md` 形态的文件。于是：

```
cp -R doc/ .reviews/t/plan/
```

**全程不含任何角色后缀字样** → `ROLE_SUFFIX_ANYWHERE` 不命中 → 规则①不介入；`.reviews/t/plan/` 不含 `_meta`/`task.json`/`.trivium` → 规则②③也不拦 → 放行。`doc/` 下合法存在的同形态文件成批落进阶段目录，而 `checkStageArtifacts` 按 `parseArtifactName` 的结果判「审查件在位」。

**攻击不再需要提到后缀**，那么以后缀字面量为介入信号的整个规则①就失去了覆盖能力。这不是补一个字符集、加一条负例能解决的。

---

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | blocker | 接受 | 核实属实。我在条件 (d) 写的 `if (DIRTY_TOKEN.test(t)) continue` 注释是「不据此放行也不据此拦」，但整个规则的结构是「全部举证通过 → 放行」，**跳过就等于放行**。注释与结构自相矛盾，`--target-directory=.reviews/…`、`$DEST` 全部逃逸 | §2 撤回 Bash 侧收窄（条件 (d) 随之消失） |
| AGY-02 | gemini | blocker | 接受 | 核实属实且**与 Bash 侧无关，必须单独修**。悬空软链（指向归档内尚不存在的文件）会让 `realpathSync` 抛 ENOENT，`resolveExisting` 回溯到 `doc/` 后拼回归档外路径 → 放行，而 Write 会沿链在归档内创建文件 | §3 用 `lstatSync` + `readlinkSync` 处理软链自身 |
| AGY-03 | gemini | major | 接受 | 属实。`SEGMENT_SPLIT` 含 `\|`，管道两端被拆成不同段，条件 (d) 只看同段 → `tar … \| tar -C .reviews/…` 逃逸 | 同 AGY-01（撤回后消失） |
| AGY-04 | gemini | minor | 接受 | 属实。`(cd /tmp && …)` 的首 token 是 `(cd`，不等于 `cd`，cwd 不会被置 null，也不会进入保守分支 | 同上 |
| GLM-01 | glm | blocker | 接受 | 与 AGY-01 独立收敛。其反例更完整：`D=.reviews/t/plan; cp doc/x-glm.md $D/` 全程放行——段 1 无后缀不检查，段 2 的 `$D/` 含 `$` 被跳过。它还指出 `MENTIONS_OWNED` 不含 `.reviews`、`isOrchestratorOwnedPath` 只护 `_meta`/`task.json`，两道兜底都够不着阶段目录 | 同 AGY-01 |
| GLM-02 | glm | blocker | 接受 | 属实，且指出了我选错了工具：「干净纯路径」用**黑名单**定义，漏了 `~`、`*`、`?`、`{}`、`\`。`cp doc/x-glm.md ~/Work/TriviumCode/.reviews/t/plan/` 在本仓库布局下直接可用——`~` 不在黑名单判为干净，`path.resolve` 把它当普通目录名拼成 `<cwd>/~/Work/…` 判归档外，而 shell 展开成 `$HOME`，实际落进归档。它的定性是对的：**黑名单面临「漏一个字符漏一类攻击」的穷举问题** | 同 AGY-01 |
| GLM-03 | glm | major | 接受 | **压垮方案的一条**，见 §0。收窄创设新系统状态后，`cp -R doc/ .reviews/t/plan/` 不含后缀字样即可搬运，以字面量为介入信号的规则①结构性失效。它给的第二个方向（跑后核对）不依赖命令行解析，是真正的硬防线 | §4 采纳其**兜底侧**建议：`checkStageArtifacts` 校验角色工件是否在 `run.json.artifacts[]` 登记内 |
| GLM-04 | glm | minor | 接受 | 属实。我改了 `CLAUDE.md`，却漏了 Hook 自己的 deny 文案——被拦的 Driver 会按失准文案误判原因与出口 | §5 按两类保护对象拆开表述 |

---

## 2. 范围调整：撤回 Bash 侧收窄

**决定：`bashTargetsProtected` 的规则①恢复为收窄前的整条文本扫描。**

```ts
// 恢复
if (ROLE_SUFFIX_ANYWHERE.test(cmd)) return true;
```

`roleSuffixRuleBlocks`、`DIRTY_TOKEN`、四个放行条件全部删除。`SEGMENT_SPLIT` 补 `\n` 的修复**保留**（那是独立的正确性修复，glm 确认它顺带修了 v1.2.5 记载的残留，与收窄无关）。

### 2.1 为什么撤回而不是继续修

| 维度 | Bash 侧收窄 |
| :--- | :--- |
| 收益 | `git mv doc/a-glm.md doc/b.md` 这类命令可直接用——**低频**，且有 Write/Edit 与人工两条出口 |
| 代价 | 三轮迭代引入 11 类绕过形态，其中 GLM-03 属结构性失效 |
| 误拦的代价 | 有零成本出口（Write/Edit 工具；本次会话已多次实走） |
| 漏拦的代价 | 伪审查件直接落进阶段目录，`--check-artifacts` 与留痕被伪造，**无跑后兜底** |

这张表与 RV-B1 撤回时的那张，逐行同构。

### 2.2 原始痛点仍然解决

本任务的起因是 `doc/` 下的设计文档被锁死。**Write/Edit 侧的收窄保留**，痛点消除：

- 改文件内容 → `Edit`/`Write` 工具，本次会话已实测通过（`reference/` 下那份历史答卷的 Hook 探测返回 exit 0）；
- 重命名 → 仍需 Bash 或人工，属低频操作。

glm 明确确认了 Write 侧是干净的：「`isInsideArchiveResolved` 的词法∪realpath 并集与 `resolveExisting` 回溯在 Write 侧无残余绕过（焦点二通过）」。唯一的洞是 AGY-02 的悬空软链，可修且已修（§3）。

---

## 3. 修悬空软链（AGY-02）

`realpathSync` 对悬空软链抛 ENOENT，回溯逻辑会把它当成「不存在的普通文件」。改为在回溯前先用 `lstatSync` 判断当前路径自身是不是软链：

```
resolveExisting(abs):
  若 lstat(abs) 是软链 → readlink 取目标，相对 dirname(abs) resolve 后递归解析
  否则 → 按现有逻辑逐级回溯到首个存在的祖先
```

递归设深度上限防软链环。这一步**与 Bash 侧无关**，是 Write 侧判定的必要补强。

---

## 4. 新增跑后兜底（GLM-03 方向②）

即便撤回 Bash 侧收窄，**GLM-03 的目录级搬运通道依然存在**——因为它的成因是 Write 侧放开后 `doc/` 下可以合法存在同形态文件，而 `cp -R doc/ .reviews/` 收窄前的整条正则也不含后缀字样、同样拦不住。

采纳 glm 的**兜底侧**建议，在 `checkStageArtifacts` 增加一道核对：

> 阶段目录内被 `parseArtifactName` 解析为**审核者角色**的工件，若不在本轮 `run.json.artifacts[]` 的登记内 → 报「工件未登记」，`--check-artifacts` 不通过。

它不依赖命令行解析，是路径信号而非字面信号，因此对「怎么进来的」不敏感——`cp -R`、`tar`、手工拖拽一视同仁。这道兜底补上了「对新增未跟踪文件完全失明」的既有缺口，**比收窄前更严**。

---

## 5. 修 deny 文案（GLM-04）

Hook 的 deny 文案按两类保护对象拆开：

- `_meta` / `task.json` / `state.json` / `.trivium`：**一律字面拦**，出路是 Write/Edit 与 `git commit -F`（表述不变，仍准确）；
- 角色后缀：归档内拦、归档外的 Write/Edit 放行（Bash 侧因撤回而维持字面拦），出路说明相应调整。

---

## 6. 修改计划

1. **`hooks.ts`**：删 `roleSuffixRuleBlocks` / `DIRTY_TOKEN` / `ROLE_SUFFIX_ANYWHERE` 的放行逻辑，规则①恢复整条扫描；保留 `SEGMENT_SPLIT` 的 `\n`；`resolveExisting` 加软链处理（§3）；deny 文案拆分（§5）。
2. **`archive.ts`**：`checkStageArtifacts` 增「角色工件须在 run.json 登记内」核对（§4）。
3. **`test/unit/hooks.test.ts`**：删 Bash 侧放行用例（`git mv doc/…` 等 3 条），恢复「含角色后缀的写命令一律拦」；保留并扩充 Write 侧用例；新增悬空软链负例。
4. **`test/unit/archive.test.ts`** 或就近：新增「未登记的角色工件被 `--check-artifacts` 拦下」用例，覆盖 `cp -R` 形态。
5. **文档回滚**：主设计 §8.4 与 `CLAUDE.md` 中关于 **Bash 侧**收窄的描述改回；**Write 侧**的收窄描述保留。主设计升 v1.2.7 并记明「Bash 侧收窄经代码双审撤回，Write 侧保留」。

全部改完跑 `npm run check`，并重新 `npm run build && node dist/install.cjs` 后用真实 Hook 子进程复验。

---

## 7. 两侧盲区

- **gemini 未覆盖**：`~`/glob 展开（GLM-02）、目录级搬运（GLM-03）、deny 文案（GLM-04）——三条都由 glm 补上。
- **glm 未覆盖**：悬空软链（AGY-02）、管道分段（AGY-03）、子 shell（AGY-04）——由 gemini 补上。
- 两侧都未实际运行构建验证（只读审查），静态推演的结论我已在实施期用真实 Hook 子进程实测 10 例复核过一轮；撤回后需重跑一遍。
