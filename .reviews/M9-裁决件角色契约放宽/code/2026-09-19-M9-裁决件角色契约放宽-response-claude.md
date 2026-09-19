---
schema: trivium.disposition.v1
topic: M9-裁决件角色契约放宽
stage: code
role: claude
kind: response
run_id: 20260919T045154Z
addresses:
  - 2026-09-19-M9-裁决件角色契约放宽-codex.md
  - 2026-09-19-M9-裁决件角色契约放宽-gemini.md
  - 2026-09-19-M9-裁决件角色契约放宽-glm.md
---

# 代码审应答：裁决件角色契约放宽（EV-66）

## 0. 裁决总览

17 条意见：**接受 17 · 驳回 0 · 暂缓 0**。
三侧结论：codex `request-changes`、gemini `request-changes`、glm `approve-with-nits`。

**我这一轮写进留痕的失实断言有三处，全部被独立命中，这是本轮最该记的事。**

1. **「原稿照抄不会当场报错」是我编的**（CODEX-02 ≡ AGY-01，两侧独立 high）。
   实况是 `topic.ts:123` 按 `c.parsed.role === driver` 过滤原稿候选，非缺省 Driver 照抄
   会在 `review --start` 的**第一步**退 65。更难堪的是：那一行的注释逐字写着
   「写死 'claude' 会让非 Claude Driver 在第一步就找不到被审对象并退 65」——
   **我为了给自己的豁免找个理由，绕过了一行就在那儿的反证。**
   这条推翻的不只是一句注释，是我在计划阶段对「原稿命名面豁免」的整个裁定依据。
2. **「非缺省 Driver 的裁决件在类型上根本构造不出来」也是我编的**（CODEX-06）。
   `Disposition` 接口在 src 与 test 里**零消费方**（grep `: Disposition` / `as Disposition`
   均无命中），真实解析形状是 `disposition.ts` 的 `DispositionFrontMatter`（`role: string`）。
   改动本身无害（口径一致），但理由是假的。
3. **gate.ts 与 T-11 第 2 格的注释被我自己的改动变成了失实留痕**（GLM-01）。
   它们仍以现在时断言「资产面今天写死的正是 `role: claude`……三份 SKILL.md 与
   `templates/README.md` 也仍写 `…-revised-claude.md`」——而那正是本步刚改掉的。
   **我在 T-11 第 3 格删旧断言时写的理由是「留着只会把人引向一个不存在的边界」，
   却没回头看同一条链路上的另外两处。** glm 把这句话原样引回来了。

另外两条是真实的覆盖缺口，不是措辞问题：

4. **判据看不见最权威的那份 Driver 指令**（CODEX-01 ≡ GLM-02）。
   论域只收 `.md` / `.template`，而 `skills/dual-critic/protocol/CLAUDE.md.snippet:12`
   写着「你的产出后缀是 `-claude`」，由 `init` 幂等并入每个目标项目的 CLAUDE.md。
   **它还漏了 `-codex.md`**——本仓根 CLAUDE.md 那段自记「这句括号在 M8 接入 codex 后
   就漏过一次」，而随 `init` 分发给新项目的模板**至今仍是漏掉的那一版**。
   所以 EV-66 关闭记录里「资产面第一次有机器判据看着」这句要读窄成
   「`.md`/`.template` 面」，我会照改。
5. **「变异自测」那一维是半纸面的**（GLM-03 ≡ AGY-02 部分）。
   它只对 `hardcodedRolePatterns()` 的返回值做字符串匹配，**不经过扫描管线**
   （collect → 逐行 → 豁免 → hits）。管线写坏（守卫写反、豁免行号错位、hits 永不入队）
   时它照绿。这正好回答了我自己问的「五条里哪一条是纸面上的」。

**我在这一轮推翻了自己计划阶段的一个裁定。** 计划双审时我把原稿命名面判为「豁免，
归 EV-55 族」，理由是「照抄不会当场失败」。该理由已被证伪，所以豁免的依据不存在了。
处置不是换个理由继续豁免，而是**把那 6 处原稿命名字面一并改掉**（见 §2.2）——
成本 6 行文本，收益是非缺省 Driver 不再在第一步撞墙。

对三侧在「闸门闭环第一次真正走通」上的分歧，我的判断写在 CODEX-07 一栏：
补两笔口径限定，但不采信「明显说过头」的定性。

## 1. 逐条裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 核过属实，且比指出的更糟。`collectAssets` 只收 `.md` / `.template`，`skills/dual-critic/protocol/` 下 3 份 `.snippet` 结构性进不来；而 `CLAUDE.md.snippet:11-12` 正是判据要治的同类祈使句（「你的产出后缀是 `-claude`」），并且**它的保护集还漏了 `-codex.md`**——根 CLAUDE.md 已在 M8 之后改准并自记漏过一次，分发模板却没跟上。`init.ts` 的 `appendSnippet` 会把它幂等并入目标项目 CLAUDE.md，即它是 Driver 会话真正读到的项目记忆。我取提出者给的第 ① 条出路（扩论域）而不是第 ② 条（改宣称），因为这一面不是「不该改」，是「漏了」。 | §2.1：`collectAssets` 扩展名集加 `.snippet`；`CLAUDE.md.snippet:11-12` 改为不枚举后缀的表述（保护集指向 `criticRoleSuffixes()`，产出后缀写「当轮 Driver 自己的 Agent id」）；EV-66 关闭记录里「资产面第一次有机器判据」补限定为「`.md`/`.template`/`.snippet` 三类文本资产」 |
| CODEX-02 | codex | minor | 接受 | **我写错了，这条把理由连根拔了。** `review.ts:274/692` 传 driver 给 `locateSubject`，`topic.ts:123` 按 `c.parsed.role === driver` 过滤，找不到就退 65（`missingArtifact`）。所以原稿后缀不是「不进定位所以不报错」，而是**进另一个定位、报得更早**。提出者给的反证尤其硬：T-11 自己的夹具准备就必须删掉缺省后缀原稿、改写成当轮 Driver 后缀，否则整轮跑不起来——那段代码就在我改的同一个文件里。严重度按 minor 记我没有异议（症状 fail-closed 且文案点名期望形态），但它推翻的是我计划阶段那个豁免裁定的**全部依据**。 | §2.2：`templates/README.md` 的「已知缺口」段与 N-4 的 `EXEMPTIONS` 注释，把「不会当场报错」改为实测结论「在 `review --start` 退 65，文案点名期望的 `<日期>-<主题>-<driver>.md`」；并按 §2.2 直接改掉那 6 处原稿命名字面，缺口段随之改写为「已消除」 |
| CODEX-03 | codex | minor | 接受 | 核过属实：`PROTOCOL:6` 仍写「固定 Claude Code Driver」，而我本次在同一个引言块里新增的段落说 `role` 是当轮 Driver 的 Agent id——**同一块两种口径并存**，且该文以「本文描述的是当前真实生效的契约」自称。`--driver` 自 M9 第 5 步生效（`cli.ts` USAGE 有它），而全文 `grep -- '--driver'` 零命中。`AGENTS.md` 的改动同步清单要求 CLI 参数变更同步 PROTOCOL，这一处恰好就在我这次动过的同一块里，属于「我改了一半」。 | §2.4：`PROTOCOL:6` 的「固定 Claude Code Driver」改为「`--driver <id>`（缺省 `claude`）自 M9 第 5 步生效」，并把该旗标补进引言块已生效清单（写法对齐 `--critics` 那段） |
| CODEX-04 | codex | minor | 接受 | 核过属实：`.reviews/README.md:46/47` 写 `-revised` / `-response`「只出现在 `plan/`、`bug/`（`code/`）的 `claude` 文件」，:38 写「角色 = claude \| gemini \| glm ＃当前生效」并把 codex 标成【待实施 · M8/M9】——而 M8 第 3 步已接入 codex、本步之后 `…-revised-<非缺省 Driver>.md` 已是合法且通过闸门的工件。这份文件进 Git、是归档命名的事实来源，设计 §24 也把它列在 A 类待并入清单里，属于「留痕同步」该覆盖的面。 | §2.5：`.reviews/README.md:38` 的角色取值改为注册表全集（删掉 codex 的【待实施】标记）、:46/47 改为「出现在**当轮 Driver 后缀**的文件」 |
| CODEX-05 | codex | nit | 接受 | 与 AGY-03 ≡ GLM-05 三侧同指，且三侧都精确指出了同一处：`role: ""` 是字符串、必然不是已登记 id，于是 ajv 的 `minLength` 与 `checkDispositionRole` 各报一行，与我自己写的「免得同一处错误出两行」相抵。提出者同时核了另两格（缺失 / 非字符串）确实单报，定性为「注释过度承诺 + 一处小冗余」准确。我取「空串早退让 ajv 独占」这一支，而不是改注释——注释说的那个性质本来就该成立。 | §2.3：`checkDispositionRole` 的判据加 `role.length === 0` 早退；注释同步点明「空串交给 ajv 的 minLength 独占」 |
| CODEX-06 | codex | nit | 接受 | **又一处我编的理由。** grep 实核：`: Disposition` / `as Disposition` / `<Disposition>` 全仓零命中，`report.ts` 的 `loadDisposition` 是函数名不是类型消费。所以「非缺省 Driver 的裁决件在类型上根本构造不出来」这句是假的——那条约束从来不存在。改动本身仍要保留（它消除的是类型层的第二份 id 声明，与 schema 同口径），但理由必须换成真的。提出者另指出「同一事实两份声明且取值类型不同（`AgentId` vs `string`）」，这一点我记进 BACKLOG 而不在本轮合并两个类型——那是结构调整，不该混进契约修正。 | §2.6：改写 `types.ts:1067-1082` 的注释，理由换成「与 schema 同口径、不在类型层留第二份 Agent id」，并如实写明该接口当前无消费方；`Disposition` 与 `DispositionFrontMatter` 的合一登记 BACKLOG |
| CODEX-07 | codex | nit | 接受 | 两笔限定是事实，我核过：①schema 经 `import ... with { type: 'json' }` **构建期内联**进 bundle，未重装前用户侧 `gate --check` 仍按旧的 `const: claude` 判；②T-11 第 3 格的裁决件是 `fs.writeFile` 直写的，不覆盖「非缺省 Driver 照资产自己写出这份件」那一步——而那一步正是 EV-68 与 CODEX-01 的落点。**但我不采信 AGY-01 里「明显说过头」的定性**：提出者自己也判「在该用例口径下为真、不是过度承诺」，glm 独立判「不算说过头」，且我原文紧接着第二节就写明「另两条阻碍未解除前验收同样跑不完」。所以处置是补限定，不是撤回该句。 | §2.7：设计 v1.3.29 台账第五节那句后补口径限定（T-11 夹具 = 工作树产物 + `TRIVIUM_ASSET_ROOT` + 桩审核者、裁决件由测试直写；真实会话需重新构建并装到全局后同效） |
| AGY-01 | gemini | major | 接受 | 与 CODEX-02 同源，但主张更进一步：直接改 `dual-run/SKILL.md:53`。**我采纳，并扩到原稿命名面全部 6 处。** 理由是我计划阶段那个豁免裁定的依据（「照抄不会当场失败」）已被证伪，而**换个理由继续豁免**与**花 6 行文本消除绊脚石**之间，后者明显划算：改完非缺省 Driver 不再在第一步撞墙，N-4 的论域也能顺势覆盖裸后缀形态（见 GLM-04）。**其定性部分不采信**：「非缺省 Driver 闸门闭环第一次走通仅在 T-11 人工绕过生产链路时成立，定性为整体闭环走通明显说过头」——另两侧独立判该句在 T-11 口径下为真，我按 CODEX-07 补限定而非撤回；「人工绕过」这个措辞也不准确，T-11 走的是真实 `gate --check` 子进程，只是裁决件由测试直写。 | §2.2：`dual-run/SKILL.md:53`、`plan.md.template:5`、`rca.md.template:5`、`templates/README.md:7,8` 共 6 处原稿命名字面改为 `<当轮 Driver>`；`templates/README.md` 的「已知缺口」段随之改写 |
| AGY-02 | gemini | minor | 接受 | 三点核过，两点属实一点要改判据而非改注释：①注释写「三种形态……以及裸后缀」而 `hardcodedRolePatterns()` 只返回 2 条正则——**注释过度承诺**，属实；但处置不是「校准注释为两种形态」，而是**把裸后缀那条真的补上**（§2.2 改完原稿面之后，裸后缀形态就该进论域，否则改完没人守）。②变异自测硬编码字面 `'claude'` 而非派生——属实，与 GLM-04 合流处理。③正向检验用写死数组、新增资产无法自动扩展——属实，改为从论域发现（含 front-matter 的模板必须有 `{{ROLE}}`；提及裁决件产出的 SKILL.md 必须有 `<当轮 Driver>`）。 | §2.1：`hardcodedRolePatterns()` 补裸后缀形态；变异样本由注册表派生；§2.8：`mustHavePlaceholder` / `mustMentionDriver` 改为自动发现，不再硬编码文件清单 |
| AGY-03 | gemini | minor | 接受 | 与 CODEX-05 ≡ GLM-05 同指同因，三侧一致。修法取「空串早退」，与另两侧建议一致。提出者另给了 `role.trim().length === 0` 的变体——我不取 `trim()`：`" "` 是长度 1 的字符串，ajv 的 `minLength` 放行它而它确实不是已登记 id，那一格该由身份校验报，`trim()` 会把它一并静默掉。 | 同 CODEX-05 的 §2.3（判据用 `role.length === 0`，不用 `trim()`） |
| AGY-04 | gemini | minor | 接受 | 核过属实，**而且这处冲突是我自己在同一次提交里造出来的**：我在设计 §24 台账写「`addresses` 基数 1～3 已随 M7b `--critics` 落地」，却把 PROTOCOL 里同一项留在「均尚未生效」清单里——我当时只顾着销 `role` 那一项。实核 `disposition.v1.json` 的 `addresses` 是 `minItems: 1` 无上限，本件自己的 `addresses` 就是 3 份且已过闸门，1～3 确已生效。 | §2.4：`PROTOCOL:19-20` 把「`addresses` 基数 1～3」从「尚未生效」清单移出，与设计台账及 schema 现状对齐（意见编号前缀扩为四值、`--tier-*` / `--effort-*` 保留在该清单） |
| AGY-05 | gemini | nit | 接受 | 属实：`gate.ts:207` 的 `fm.schema !== 'trivium.disposition.v1'` 与 ajv 的 `const`、:242 的 `addresses` 空判与 ajv 的 `minItems` 各自重叠。**但这是存量、本步未触碰**（glm 也判「不必本步处理」），所以只取「如实标注」那一支，不清理。清理要动闸门的失败消息拼装，属存量重构，混进一次契约修正里会让变异验证失去干净的对照。补注释的价值在于：我这次刚在 `schemas.ts` 写了「免得同一处错误出两行」，若不标注，下一个人会以为这条链路上没有冗余。 | §2.9：`gate.ts` 的 `mismatches` 拼装处补一段注释，写明 `schema` 与 `addresses` 两格与 ajv 的重叠是**刻意保留的闸门层双重防御**（闸门要在 front-matter 整体不过 schema 时仍能点名具体是哪一格），并指向 `schemas.ts` 的空串冗余记载 |
| GLM-01 | glm | minor | 接受 | **这条最该羞愧：它引的是我自己写的话。** `gate.ts:219-231` 三句现在时断言（「资产面今天写死的正是 `role: claude`」「诚实写 role → 卡在 `disposition.v1.json` 的 role const」「本条不改契约：schema 仍把 role 钉成 claude……EV-66 修好之后」）与 `gate-loop.test.ts:1277-1287` 的同形句子，描述的边界全是本步废除的。而我在第 3 格删旧断言时写的理由逐字是「留着只会在下一次有人读这段时把人引向一个不存在的边界」——**同一条链路上的另外两处我没回头看**。本仓「归档件里的失实断言先改再提交」的口径覆盖同一情形。 | §2.10：`gate.ts:211-238` 与 `gate-loop.test.ts:1273-1290` 两处注释改为过去时并标注「EV-66 落地前如此」，与第 3 格新注释同一口径；纯注释修改，不动行为 |
| GLM-02 | glm | minor | 接受 | 与 CODEX-01 同指，且补了两点后者没说的：①边界注释枚举「论域不含原稿命名面」时只列了 4 处，**给人完备印象却没提 protocol 面**——这正是我最该防的形态（判据的论域声明本身不完备）；②snippet 的保护集漏 codex 这件事，根 CLAUDE.md 已改准而分发模板没跟上，**该面已在实际漂移**。M10 按演进设计 §7.5 泛化四家 snippet 时若产物仍落 `.snippet`，判据照旧看不见。 | 同 CODEX-01 的 §2.1；另在 N-4 的边界注释里把「论域覆盖哪三类扩展名、不覆盖什么」写全，不再只列原稿面 4 处 |
| GLM-03 | glm | nit | 接受 | **这是「五维里哪一条是纸面的」的正确答案。** 核过属实：第三条用例只调 `patterns.test(v)`，不经 `collectAssets` → 逐行 → `isExempt` → `hits` 这条管线。管线写坏（匹配守卫写反、豁免行号错位、hits 永不入队）时它照绿，而第一条用例在零命中上恒绿——判据整体失效而无红。提出者给的修法（抽纯函数、喂合成内容、断言 hits 非空、不向 `skills/` 写任何文件）正确且成本低。另指出 violations 缺 `role: "claude"` 引号形态——一并补。 | §2.8：把逐文件扫描抽成纯函数 `scanContent(rel, content, patterns)` → hits，第一条用例与变异用例共用它；变异用例喂合成内容断言 hits 非空、且豁免命中时为空；violations 补引号形态并决定 pattern 吃不吃引号 |
| GLM-04 | glm | nit | 接受 | 属实且指出了判据的真实覆盖面：它只守「不写死 `claude`」这一半，一份指引若写死别家 id（`…-revised-codex.md`、`role: gemini`）两个 pattern 都不命中，而那同样会把非该家 Driver 引向 `missing_disposition`。改从 `ALL_AGENT_IDS` 派生仍是注册表单源、不违纪律 7，提出者也实测了「扩到全部已登记 id 今天不会误伤」。我会在 §2.2 改完原稿面之后重新实测一次（改完论域内容变了，旧的零命中结论不能直接沿用）。 | §2.1：`hardcodedRolePatterns()` 改从 `ALL_AGENT_IDS` 派生（后缀与 `role:` 两形态各一组，加上 AGY-02 要求的裸后缀形态）；变异样本同步补别家 id；改完重跑并实测误伤面 |
| GLM-05 | glm | nit | 接受 | 与 CODEX-05 ≡ AGY-03 同指，三侧一致，修法相同（空串早退）。其附带判断「同一段 `mismatches` 里既有的 schema 双报是同形存量实例、本步未触碰、不必本步处理」我采纳，并按 AGY-05 补一段注释把它标注出来——两条合起来正好是「存量知悉 + 留痕如实」。 | 同 CODEX-05 的 §2.3；存量部分同 AGY-05 的 §2.9 |

## 2. 修改计划与落点

> 本节是**接下来打算怎么改**，尚未执行。按 `/dual-review-code` 的执行契约，
> 代码修改要等 `/dual-approve` 之后才能动手。

### 2.1 判据论域与形态补全（CODEX-01 ≡ GLM-02、GLM-04、AGY-02 部分）

[test/contract/disposition-role-assets.test.ts](test/contract/disposition-role-assets.test.ts)

- `collectAssets` 的扩展名集加 `.snippet`（今日新增 3 份进论域：`CLAUDE.md.snippet`、
  `AGENTS.md.snippet`、`gitignore.snippet`）。
- `hardcodedRolePatterns()` 改从 `ALL_AGENT_IDS` 派生，**三种形态**：
  裁决件后缀 `-(revised|response)-<id>.md`、front-matter 取值 `role: <id>`、
  **裸后缀**（`产出后缀是 -<id>`、`-<id>.md` 这类祈使句里的形态）。
  注释里那句「三种形态」到此才与实现相符。
- 边界注释重写：写全「覆盖 `.md` / `.template` / `.snippet` 三类、不覆盖 `schema/*.json`
  与仓库根 `CLAUDE.md`」，不再只列原稿面 4 处。

[skills/dual-critic/protocol/CLAUDE.md.snippet](skills/dual-critic/protocol/CLAUDE.md.snippet)（:11-12）

改为不枚举后缀的表述——保护集指向 `hooks.ts` 的 `criticRoleSuffixes()`（全部已登记角色
减当轮 Driver），产出后缀写「当轮 Driver 自己的 Agent id」。
**顺带修掉漏 `-codex.md` 这个已漂移了一个里程碑的缺口。**

### 2.2 原稿命名面：从「豁免」改为「改掉」（CODEX-02 ≡ AGY-01）

6 处字面改为 `<当轮 Driver>`：

| 文件 | 行 |
| :-- | :-- |
| `skills/dual-run/SKILL.md` | 53 |
| `skills/dual-critic/templates/plan.md.template` | 5 |
| `skills/dual-critic/templates/rca.md.template` | 5 |
| `skills/dual-critic/templates/README.md` | 7、8 |

`templates/README.md` 的「已知缺口」段随之改写：缺口已消除，保留一句实测记载
（「非缺省 Driver 若照旧文本写原稿，会在 `review --start` 退 65，文案点名期望形态」）
作为**为什么要改**的证据，而不是继续挂着一个不存在的缺口。

N-4 的 `EXEMPTIONS` 仍为空——改完之后连原稿面都不需要豁免了。

### 2.3 空串双报（CODEX-05 ≡ AGY-03 ≡ GLM-05）

[src/trivium/schemas.ts](src/trivium/schemas.ts) 的 `checkDispositionRole`：

```ts
if (typeof role !== 'string' || role.length === 0 || isAgentId(role)) return [];
```

注释同步：非字符串与缺失交给 ajv 的 `required` / `type`，**空串交给 `minLength` 独占**。
不用 `trim()`——`" "` 是长度 1 的字符串，ajv 放行而它确实不是已登记 id，
那一格该由身份校验报出来。

### 2.4 PROTOCOL 两处口径（CODEX-03、AGY-04）

[doc/03_api/PROTOCOL_dual_critic_relay.md](doc/03_api/PROTOCOL_dual_critic_relay.md)

- :6 的「固定 Claude Code Driver」→「`--driver <id>`（缺省 `claude`）自 M9 第 5 步生效」，
  并把该旗标补进引言块的已生效清单（写法对齐 `--critics` 那段）。
- :19-20 把「`addresses` 基数 1～3」移出「尚未生效」清单——它与我自己在设计 §24
  写的「已随 M7b `--critics` 落地」冲突，是我上一步只销了 `role` 一项留下的。

### 2.5 归档命名契约文档（CODEX-04）

[.reviews/README.md](.reviews/README.md)：:38 角色取值改为注册表全集（删掉 codex 的
【待实施 · M8/M9】标记，M8 第 3 步已接入）；:46/47 的「只出现在 … 的 `claude` 文件」
改为「出现在**当轮 Driver 后缀**的文件」。

### 2.6 类型层注释（CODEX-06）

[src/trivium/types.ts](src/trivium/types.ts)（:1067-1082）：删掉「非缺省 Driver 的裁决件
在类型上根本构造不出来」这句假话，理由改为「与 schema 同口径，不在类型层留第二份
Agent id」，并如实写明该接口**当前无消费方**、真实解析形状是 `DispositionFrontMatter`。
两个类型的合一登记 BACKLOG（结构调整，不混进契约修正）。

### 2.7 设计台账补口径（CODEX-07）

[doc/02_design/2026-09-10-…设计.md](doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md)
v1.3.29 那行第五节，在「第一次真正走通」后补：

> （口径：T-11 夹具——工作树产物 + `TRIVIUM_ASSET_ROOT` + 桩审核者，裁决件由测试直写；
> schema 是构建期内联进 bundle 的，真实会话需重新构建并装到全局后同效；
> 该格不覆盖「非缺省 Driver 照资产自己写出这份件」，那一步见 EV-68。）

### 2.8 判据自测走真实管线（GLM-03、AGY-02 部分）

[test/contract/disposition-role-assets.test.ts](test/contract/disposition-role-assets.test.ts)

- 抽出纯函数 `scanContent(rel, content, patterns)` → `hits`，第一条用例与变异用例**共用**它。
- 变异用例喂**合成内容**（不向 `skills/` 写任何文件）断言 `hits` 非空；
  再喂一条落在豁免上的内容断言 `hits` 为空——管线的两个方向都验到。
- `violations` 补 `role: "claude"` 引号形态，并决定 pattern 是否吃引号（倾向吃）。
- 正向检验改为自动发现：`templates/` 下含 `schema: trivium.disposition.v1` 的模板必须有
  `role: {{ROLE}}`；`skills/*/SKILL.md` 里提及裁决件产出的必须有 `<当轮 Driver>`。
  不再硬编码 6 个文件名。

### 2.9 闸门层冗余标注（AGY-05、GLM-05 附带）

[src/trivium/gate.ts](src/trivium/gate.ts) 的 `mismatches` 拼装处补注释：`schema` 与
`addresses` 两格与 ajv 的 `const` / `minItems` 重叠是**刻意保留的闸门层双重防御**
（front-matter 整体不过 schema 时，闸门仍要能点名具体是哪一格），并指向 `schemas.ts`
里空串那处的记载。**只加注释，不动行为**——清理属存量重构，不在本步范围。

### 2.10 两处失实注释（GLM-01）

- [src/trivium/gate.ts](src/trivium/gate.ts)（:211-238）：三句现在时断言改为过去时并标注
  「EV-66 落地前如此」。
- [test/integration/gate-loop.test.ts](test/integration/gate-loop.test.ts)（:1273-1290）：
  T-11 第 2 格注释同改，与第 3 格新注释同一口径。

纯注释修改，不动行为。

### 2.11 改完之后要重跑的

1. `npm run typecheck` → `npm run pretest` → `npm run check` 全量（当前 1459 tests /
   1457 pass / 0 fail / 2 skip；本轮会新增变异用例，通过数会涨、跳过数应仍为 2）。
2. **N-4 的误伤面重新实测**：§2.2 改完原稿面、§2.1 扩到 `ALL_AGENT_IDS` 与裸后缀之后，
   论域内容与判据面都变了，glm 那句「扩到全部已登记 id 今天不会误伤」的实测结论
   **不能直接沿用**，要重跑一次确认零误伤。
3. 变异验证重跑：§2.8 改完后，管线变异（守卫写反）必须当场红——这是这条判据从
   「半纸面」变成实证的唯一凭据。
