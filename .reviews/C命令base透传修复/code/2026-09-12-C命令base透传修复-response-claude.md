---
schema: trivium.disposition.v1
topic: C命令base透传修复
stage: code
role: claude
kind: response
run_id: 20260911T155806Z
addresses:
  - 2026-09-12-C命令base透传修复-gemini.md
  - 2026-09-12-C命令base透传修复-glm.md
---

# 代码审应答：C命令base透传修复

## 0. 应答总览

两侧各判 `request-changes`，gemini 4 条、glm 5 条，共 9 条：
**接受 7 条、驳回 0 条、暂缓 2 条**。

九条我逐条回仓核实，**没有一条虚报**。更值得记的是两侧在背靠背状态下
**四组独立收敛**：

| 问题 | gemini | glm |
| :--- | :--- | :--- |
| B/D 的 `--plan-file` / `--rca-file` 不透传 | AGY-01 | GLM-02 |
| 四份 skill 的 `--model-gemini` / `--model-glm` 不透传 | AGY-02 | GLM-01 |
| §9.2 算法列「在②得到的 tree 基础上生成」与实现不符 | AGY-03 | GLM-03 |
| `--profile` 全链路断裂 | AGY-04 | GLM-05 |

**本次修复的判定是「对但不够」**：`--base` 那一处改得准确（两侧都逐句核实并确认
说明属实），但我只堵了撞见的那一个洞，没有回头做同族排查。argument-hint 声明了
参数、resolve 也解析了、CLI 也支持，唯独第 3 步模板没有槽位——这个形状在仓库里
一共有四处，我修了一处就收工。审查焦点问的正是「是否还有同类缺口」，答案是有，
而且 `--model-*` 那处比 `--base` 更普遍：它影响全部四条送审命令。

决定性证据是 glm 找到的 `src/trivium/review.ts:280` 注释原文——
「独立的 `preflight` 命令看不到 skill 步骤 3 才传来的 `--model-*` 覆盖值」。
代码作者写这句时默认步骤 3 会传这两个旗标，模板里却从来没有。这说明它是遗漏
而非设计取舍，不必再争论。

## 1. 逐条应答表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | major | 接受 | 回仓核实成立：`skills/dual-review-plan/SKILL.md:40` 与 `skills/dual-review-bug/SKILL.md:40` 的模板都只有 `[--goal]` `[--context]`。与 GLM-02 独立收敛同一处。后果比 base 更隐蔽——`subjectFile` 为 null 时 `locateSubject` 自动取最新原稿，用户指定历史原稿会被静默换掉 | 与 GLM-02 合并处理，见 GLM-02 落点 |
| AGY-02 | gemini | major | 接受 | 回仓核实成立：四份 skill（含我刚改过的 dual-review-code）的第 3 步模板都没有 `--model-*` 槽位，而 `cli.ts:269-272` 与 `topic-args.ts:180-182` 两端都支持。与 GLM-01 独立收敛同一处 | 与 GLM-01 合并处理，见 GLM-01 落点 |
| AGY-03 | gemini | minor | 接受 | 成立，且这是我上一次改漏的：只改了 §9.2 表格的「快照对象」列，同一行「算法」列仍写着「在②得到的 tree 基础上生成」。`review.ts:347` 的 `diffAgainst` 直接跑 `git diff`，不消费②的临时索引树 | 与 GLM-03 合并处理；GLM-03 的描述更完整（多指出两者内容不等价），以它为准 |
| AGY-04 | gemini | nit | 暂缓 | 事实成立（`grep profile src/trivium/cli.ts` 零命中，`--profile` 确实断裂），但它给的两条出路——「实现 profile 覆盖」与「从声明中移除」——是产品取向而非修 bug，该由项目负责人定。且本次被审补丁只动了两个 md 文件，把一个未实现能力的去留塞进来会让这次修复失焦 | 暂不实施。与 GLM-05 一并列入待决事项，闸门审批时请项目负责人在「实现」与「摘掉声明」之间拍板，定了再单独开一次改动 |
| GLM-01 | glm | major | 接受 | 与 AGY-02 同一处，此侧证据更硬：`review.ts:280` 注释明写「独立的 `preflight` 命令看不到 skill 步骤 3 才传来的 `--model-*` 覆盖值」——作者预期步骤 3 会传，模板却没有，确证是遗漏。用户指定模型被静默丢弃、回退到 profile 配置模型，与 base 缺口同族：不报错、留痕正常、跑的不是用户以为的东西 | 四份 SKILL.md（dual-review-code / dual-review-plan / dual-review-bug / dual-run）第 3 步模板补 `[--model-gemini <slug>] [--model-glm <id>]`，并照本次 `--base` 的写法要求无条件透传 resolve 输出的 `models` 字段。同时采纳其防回归建议：补一条契约测试，断言「argument-hint 里声明且需透传的参数必须出现在第 3 步模板中」——这才是真正堵住这一族缺口的东西 |
| GLM-02 | glm | major | 接受 | 与 AGY-01 同一处。核实 `cli.ts:281` 的 `subjectFile: flagString(args,'plan-file') ?? flagString(args,'rca-file')` 透传通道现成，模板未用即可定为缺口。resolve 阶段的存在性校验反而让一切看起来正常，这一点尤其毒 | `dual-review-plan/SKILL.md` 第 3 步模板补 `[--plan-file <路径>]`、`dual-review-bug/SKILL.md` 补 `[--rca-file <路径>]`，并指示「resolve 输出的 `subject_path` 非空时原样传入」，让 start 与 resolve 锁定同一份被审对象 |
| GLM-03 | glm | minor | 接受 | 与 AGY-03 同一处，此侧多给了一条我和 gemini 都没说到的：②树包含 `.reviews/` `.trivium/` 下的未跟踪文件，而补丁由 `code-stage.ts:104-109` 显式剔除它们，两者内容根本不等价。照现算法描述复现实现的人会得到不同结果 | 设计 §9.2 表格 code 行的「算法」列改为如实描述：补丁 = 两点 `git diff <base>`（实时工作区，含已暂存/未暂存）+ 未跟踪文件逐个 `--no-index`，无条件剔除 `.reviews/` `.trivium/`；②树仅用于跑后 `tree_hash'` 漂移复算 |
| GLM-04 | glm | minor | 接受 | 核实成立：`git.ts:199-206` 给 `ls-files` 那步补了抛错，但紧随其后 208-214 的逐文件循环只判 `if (d.stdout)`，完全不看 `d.code`。对照同文件 186-196 行 tracked 分支的显式抛错与「残缺补丁带着正常头部落盘」那段长注释，这一分支确实没贯彻同一原则——GLM-r2-04 当初只修了一半 | `util/git.ts` 未跟踪文件循环区分退出码：0/1 放行，其余抛错并回显文件名与 stderr 摘要；`git diff --no-index` 的路径参数前加 `--` 分隔，防 `-` 前缀文件名被当选项。补一条用例：未跟踪文件 diff 失败时必须抛错而非静默产出残缺补丁 |
| GLM-05 | glm | minor | 暂缓 | 同 AGY-04，事实与证据均成立（此侧还多核实了 `/dual-run` 的 S0-S10 全流程根本不运行 resolve，所以 profile 连回显都到不了）。暂缓理由同上：去留是产品取向，需项目负责人拍板 | 暂不实施，与 AGY-04 一并列入待决事项 |

## 2. 本次实跑中我自己撞到的两件事（不在审查意见内）

这次是为验证 `--base` 修复而做的真实跑批，过程中撞到两个审查员看不到的问题——
它们不在被审 diff 里，两侧无从发现，记在这里以免丢失。

### 甲 · 提示语里出现白名单参数字样会被静默吞掉（我判断比 GLM-01 更严重）

第一次跑 `topic resolve` 时我传的焦点提示语里含有 `--base` 四个字符（在讨论
「`--base` 透传说明是否准确」），`splitArguments` 把它当成具名参数解析，连同紧随
其后的一个 token 一起吃掉，之后真正的 `--base HEAD~1` 又把值覆盖回去。结果：

- 传入：`重点核实 --base 透传说明是否准确、是否还有同类「skill 声明了参数……`
- 回显：`重点核实 声明了参数……`

两段文字凭空消失，`ok: true`，无任何告警。

这直接打穿 FR-20 / AC-09——`brief.ts:120` 的注释写着「第 2 段是 FR-20 / AC-09 的
**唯一落点**（提示语**逐字**嵌入）」，而提示语在进 brief 之前就已经不逐字了。
命令 B/C/D 的焦点提示语天然会讨论参数名（本次就是活例），这不是边缘输入。

`topic-args.ts:40-71` 的现有设计只保证「非白名单 `--xxx` 原样留在正文」，
对白名单内的参数名出现在正文中没有防护。可考虑的方向：`--` 之后只认第一个
位置参数为提示语、或要求焦点必须走 `--focus`、或对「提示语被具名参数切断」
的情形显式告警。方向需定，故此处只记录不预设结论。

### 乙 · 补丁头部 `# base:` 记的是 ref 字符串而非解析后的 sha

本次产出的 `changes-20260911T155806Z.diff` 头部是 `# base: HEAD~1`，
而同一头部的 `# head:` 记的是完整 sha `063286f4…`。`HEAD~1` 是相对引用，
日后回看这份留痕时它会指向另一个 commit，离线复核对不上。
建议 `buildDiffHeader` 记 `git rev-parse <base>` 的结果（或两者并记）。
严重度不高，但留痕的意义正在于日后可复核，两边不一致说不过去。

## 3. 待项目负责人拍板的事项

1. `--profile`（AGY-04 / GLM-05）：实现覆盖能力，还是从 `/dual-run` 的
   argument-hint 摘掉声明？
2. 第 2 节甲项的防护方向：`--` 后单一位置参数 / 强制 `--focus` / 仅告警？

## 4. 实施顺序（闸门通过后）

1. 先补契约测试（GLM-01 建议的那条），让四处缺口以失败形式暴露出来；
2. 再改四份 SKILL.md 的模板与透传说明（GLM-01 + GLM-02）；
3. 改设计 §9.2 算法列（GLM-03）；
4. 改 `util/git.ts` 未跟踪文件循环与其用例（GLM-04）；
5. `npm run check` + `npm run install:local`，再跑一次 `--base HEAD~1` 回归。

闸门未通过前不动任何业务文件。
