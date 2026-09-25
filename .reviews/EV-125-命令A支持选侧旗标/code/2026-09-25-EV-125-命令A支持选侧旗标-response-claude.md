---
schema: trivium.disposition.v1
topic: EV-125-命令A支持选侧旗标
stage: code
role: claude
kind: response
run_id: 20260925T102608Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - CODEX-05
  - CODEX-06
  - CODEX-07
  - AGY-01
  - AGY-02
  - AGY-03
  - GLM-F01
  - GLM-F02
---

# 应答：EV-125（命令 A 支持选侧旗标）· 代码双审第 1 轮

> 被审对象：相对 `694e6ce` 的未提交改动（30 个文件，164.2 KB）
> ｜ 运行：`20260925T102608Z`（8m10s）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `request-changes` ｜ glm 解析回退（原文自报 `approve-with-nits`、3 minor 2 nit，但意见正文没有落到输出里）
> ｜ 共 12 个单元：重要 1 ｜ 次要 4 ｜ 吹毛求疵 5 ｜ glm 回退单元 2
> ｜ **接受 11、驳回 1（AGY-03）**。同指两组：AGY-01 ≈ CODEX-01（S2 / S6 / S0.6 三处交接没把 `--profile` 这一项锁住，gemini 从契约缺项、codex 从断言缺口各看一面）；AGY-02 ≈ CODEX-01（逐段断言只锁了两个旗标）

## 0. 用户的五个焦点

- **焦点一 三处是否同一组**：codex 核实判定层成立（入选与模型覆盖都由 `topic resolve` 一处解析、同一函数校验）。**但契约文本有一处缺项**：S2 交接清单和 S6 的枚举都没列 `--profile`，只靠后面一段总述带到（AGY-01）；S0.6 的 `profile` / `models` 那一句也没有任何断言看着（CODEX-01）。「各拼各的」在 `--profile` 这一项上是真实风险，接受并补齐。
- **焦点二 逐段断言的锚点**：codex 认为锚点选择对、锚点漂移时失败是响亮的；gemini 认为过脆并要求放宽标点。取前者：锚点就在本仓自己的契约源里，改了会当场红，不会漏网。gemini 另一半说得对——断言只锁了 `--critics` / `--allow-single` 两个旗标，`--profile` 漏了照样绿，这正是 AGY-01 能存在的原因。扩到三段、三个旗标。
- **焦点三 意外输出**：codex 核出一条——`--only <x> --allow-single` 会往 `notes` 里推一条说明，而命令 A 的契约从头到尾没交代 `notes` 怎么处理。同一通道还有「主题由任务目标推导」「主题异常短」两条对命令 A 有用的提示，一并没人念（CODEX-07）。接受。
- **焦点四 改主题重跑**：codex 核出一处缺口：没写重跑时怎么把新主题传回去——S0.5 命令模板里没有 `--topic`，照原样重跑会推导出同一个主题（CODEX-02）。接受。gemini 建议把 driver 加进重跑条件（AGY-03），驳回，理由见表。
- **焦点五 文档漏改**：codex 找到三处：两处旧 `S0` 注释（CODEX-04）、MANUAL §4.2 用法块与「当前即 `--model-gemini` / `--model-glm`」一句（CODEX-05）、`preflight` 的 USAGE 与 PROTOCOL 签名行没列 `--model-<id>`（CODEX-06）。全部接受。

## 1. 裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 属实。S0.6 的「`profile` 非空时传 `--profile`；`models` 非空时逐个传……」整句删掉，现有套件全绿：这几个旗标字样在别处都还在，整篇断言和两段逐段断言都够不着它。这正是本轮为 S2 / S6 修过的同一形状。E2 验收也只传了 `--critics`，S0.6 的完整形态没真跑过 | ①逐段断言扩到三处：S0.6 交接（代码块之后的清单）、S2 交接清单、S6 那一段，每处都要点名 `--critics` / `--profile`，并交代模型覆盖（S0.6 / S2 查 `--model-`，S6 查「模型覆盖」字样），S2 / S6 另查 `--allow-single`；②`contract-mutations.mjs` 补 C7「删掉 S0.6 的 profile / models 那一条」、C8「S6 枚举去掉 `--profile`」；③验收补 E2b：`preflight --stage all --driver codex --critics claude,glm --profile default --model-glm GLM-5.3 --skip-auth-check --json` 退 0（零配额） |
| CODEX-02 | codex | minor | 接受 | 属实。S0.5 的命令模板里没有 `--topic`；不带新主题照原样重跑，`inferTopic` 会从同一个任务目标推导出同一个名字，确认永远收敛不了 | S0.6 末句改为可直接照抄的写法：「用户改了主题，就把改后的主题作为 `--topic <主题>` 加进 S0.5 的命令重跑（正文与其余旗标不变）；重跑后 `critics` / `profile` / `models` 仍取自新输出，与本步所用不同时才重跑本步」 |
| CODEX-03 | codex | minor | 接受 | 属实。这个脚本原地改写四家 28 份入口资产的唯一源，却没有照装置设哨兵：一旦中断，下一次运行会把残留的变异版当基线读入，再在收尾时写回去。`find` 命中数不为 1 时它也只记一行就 `continue`，不中止。本轮两次运行都善终，读数干净；这是工具自身的健壮性问题 | ①照装置加哨兵：开跑时在脚本同目录独占创建 `.contract-mutations-running`（`flag: 'wx'`），已存在即拒跑，并提示「基线可能已被上次的变异污染，先核对 `git diff`」；善终才删；②任何写盘之前先断言每条 `find` 在基线里恰好命中一处，有一条不满足就整体拒跑（等价于装置的闸 7 前移），脏基线会在这一步被拦下；③00-readout 补一句 |
| CODEX-04 | codex | nit | 接受 | 属实。`S0` 标签已经废止，同批改过 `entry-render-parity` 的注释，这两处是漏改 | `topic-args.ts` :358 改为「S0.5 / S0.6 / 两次认领 / S2 / S6」；`run-protocol.ts` :348 改为「命令 A 的 S0.6 与 S2 之间隔着起草」 |
| CODEX-05 | codex | nit | 接受 | 属实。这不是本轮引入的，但本轮改了同一节的 §4.1 和 §4.7，同一页里就成了自相矛盾：照 §4.2 读，用户不知道 B/C/D 可以写 `--model-claude` / `--model-codex` | MANUAL §4.2 用法块改为 `[--model-<审核者 id> <模型>]` 与 `[--only <一侧>]`（§4.3 / §4.4 仍「其余同上」继承）；「当前即 `--model-gemini` / `--model-glm`」改为「旗标名随注册表派生，四家皆可，只对本轮入选侧有效（见 §4.7）」 |
| CODEX-06 | codex | nit | 接受 | 属实。S0.6 是第一次有入口契约往 `preflight` 传模型覆盖，而 `preflight` 的 USAGE 查不到 `--model-<id>`，PROTOCOL 的签名行也只写了 `--critics`。至于 `body.md` 那句「独立的 preflight 看不到覆盖值」，它只渲染进 B/C/D，那里预检仍在解析之前，这句话成立，所以不改 | `cli.ts` preflight 的 USAGE 补 `--model-<审核者 id> <模型>` 一行（口径同 review 段：只对本轮入选侧有效，未入选退 64）；PROTOCOL :341 签名行补成 `[--critics <id,…>] [--profile <名称>] [--model-<id> <模型>]`；`body.md` 不改（理由见左） |
| CODEX-07 | codex | nit | 接受 | 属实。命令 A 的契约里 `notes` 零命中：`--only` + `--allow-single` 推的那条说明、「主题由任务目标推导」、「主题异常短 ⇒ 正文多半被裸露旗标截断」都只停在 `--json` 里，而最后一条恰好出现在准备回显主题的时点。取建议的前一半（补转述约定），不取后一半（把那条 note 限定在 `scope !== 'all'`）：那条说明本身对命令 A 同样成立 | S0.5 字段清单后补一句：「`notes` 非空时逐条原样念给用户——尤其是『主题由任务目标推导』『主题异常短』两条，它们决定 S0.6 之后回显确认时要不要提醒用户核对」；`skill-flag-parity` 对 `dual-run` 加一格断言：正文交代 `notes` 的转述 |
| AGY-01 | gemini | major | 接受 | 属实。S6 的括号枚举列了 `--goal` / `--focus` / `--context` / `--critics` / `--allow-single` / 模型覆盖，唯独没有 `--profile`；S2 的交接清单同样没列，只有其后「模型覆盖、档位……要一并传下去」那段总述带到了它。EV-125 之前的 S6 就少这一项（`694e6ce` 的原句同样没有），但本轮 S0.6 写了「三样必须与 S2 / S6 传的是同一组」，缺它就对不上了。执行者照枚举拼命令时丢掉档位，第二轮会静默回退到 `active_profile` | S2 交接清单加一条「`--profile` 传 S0.5 的 `profile`，为空则不传」；S6 的枚举补上 `--profile`；由 CODEX-01 落点①的三段逐段断言锁住 |
| AGY-02 | gemini | minor | 接受 | 后一半属实：逐段断言只锁了 `--critics` 与 `--allow-single`，`--profile` 漏了照样绿，这正是 AGY-01 能存在的原因。前一半（锚点过脆、应容忍全半角标点）不取：锚点就在本仓自己的契约源里，改了会在 `assert.ok(start >= 0)` 响亮失败，不会漏网；按首个空行截断只会让切出的段落更短、断言更严，不会放过缺项（codex 焦点二的核实与此一致） | 同 CODEX-01 落点①；锚点保持现状，并在测试注释里写明「锚点改写时响亮失败」这一取舍 |
| AGY-03 | gemini | nit | 驳回 | 前提不成立。命令 A 的每次解析都由渲染显式注入 `--driver {{DRIVER}}`（`run.contract.md` S0.5 命令模板），`topic resolve` 取 `explicitDriver ?? inherited ?? 缺省`，所以输出的 `driver` 恒等于注入值。新主题的留痕或声明与它冲突时，解析退 64（`crossCheckDriver`）而不是改换 driver。把 driver 写进重跑条件，反倒暗示它可能变，会误导执行者 | 无修改。重跑规则按 CODEX-02 改写后，在同一句里写明「driver 恒为本载体、不在比对之列」，免得下一位读者提同样的问题 |
| GLM-F01 | glm | — | 接受 | 回退单元原文是「所有核实完成。汇总审查发现并提交审查结论。」，没有可执行的意见内容。glm 在原始输出里自报「3 条 minor、2 条 nit」，但意见正文没有落进输出（`review-glm-*.json` 的 `raw` 只有这两段），与 BACKLOG EV-113（glm 输出截断）同形 | 无代码改动。BACKLOG EV-113 追记本轮这次复现（run `20260925T102608Z`：自报 5 条、正文 0 条）；请用户知悉 glm 这一侧本轮实际上没有交付意见 |
| GLM-F02 | glm | — | 接受 | 回退单元是审查过程小结：列了读过的文件，结论「五个审查焦点逐项核实完毕，未发现 blocker/major」。作为一侧的总判断如实收下，但它没有给出任何一条具体意见，不能据此判断 glm 与另两侧是否同指 | 同 GLM-F01 |

## 2. 修改方案（审批后执行）

1. **契约**（`skills-src/commands/run.contract.md`，随后 `npm run render`，只应有四份 `dual-run` 变化）：
   - S2 交接清单补 `--profile` 一条（AGY-01）；S6 枚举补 `--profile`（AGY-01）；
   - S0.5 字段清单后补 `notes` 转述约定（CODEX-07）；
   - S0.6 末句按 CODEX-02 改写，并注明 driver 恒为本载体（AGY-03 的说明）。
2. **测试**（`test/contract/skill-flag-parity.test.ts`）：逐段断言扩到 S0.6 / S2 / S6 三段、三个旗标（CODEX-01 ≈ AGY-02）；`dual-run` 交代 `notes` 转述一格（CODEX-07）。
3. **证据工具**（`contract-mutations.mjs`）：哨兵 + 写盘前全量 `find` 预检（CODEX-03）；补 C7 / C8（CODEX-01）；重跑，读数与 00-readout 更新。
4. **验收**：`run.mjs` 补 E2b（CODEX-01）；重跑，00-readout 更新。
5. **注释与文档**：`topic-args.ts` :358、`run-protocol.ts` :348（CODEX-04）；MANUAL §4.2 与 :468 一带（CODEX-05）；`cli.ts` preflight USAGE、PROTOCOL :341 签名行（CODEX-06）；BACKLOG EV-113 追记（GLM-F01）。
6. **收尾**：`npm run check` 全绿；变异装置在当前代码上重跑一遍（`src/` 只动了两处注释，预期五条 fail 数不变）；**真实 HOME 按 `--targets claude,glm` 再装一次**（入口资产又变了，预检 → 安装 → 复核，与上次同法）。
7. 以上完成后由用户决定是否再审一轮；按本仓惯例，契约与测试的改动面不大时通常直接提交。

## 3. 其它登记

- **编排器提示两条，均非本题缺陷**：①codex 与 gemini 再次被标「evidence 引用但未列入 consulted：`src/commands/run.contract.md`」，即 EV-127 的误报，本轮是第二次复现，已登记的条目足够，只在 BACKLOG EV-127 追一句；②codex 侧「疑似写入」是 `mkdir -p /tmp/ev125rev`，目标在项目外，编排器自己也判定不算失守。
- **「构建时工作树有未提交改动：安装副本不对应任何一个提交」**：这是用户要求在提交前重装的预期结果（EV-111 的构建标识在如实报告），不是异常。提交之后再装一次，这条就会消失。
