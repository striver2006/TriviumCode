---
schema: trivium.disposition.v1
topic: EV-136-glm探活选模路径
stage: code
role: claude
kind: response
run_id: 20260926T051412Z
addresses:
  - 2026-09-26-EV-136-glm探活选模路径-codex.md
  - 2026-09-26-EV-136-glm探活选模路径-gemini.md
  - 2026-09-26-EV-136-glm探活选模路径-glm.md
---

# 代码审应答：EV-136 glm 认证探活改走审查运行的选模路径

三侧结论均为 `approve-with-nits`，无 blocker / major。共 11 条（codex 4 minor；gemini 1 nit；glm 4 minor + 2 nit），**全部接受**。
其中三组两侧同指：CODEX-01 ≡ GLM-04（副本源损坏抛裸异常）、CODEX-02 ≡ GLM-02（退路支不设落点根）、CODEX-04 ≡ GLM-03（命令行 / 主题级覆盖不进探活），
AGY-01 与 GLM-05 同指「档位无模型」退路缺 authProbe 级用例。

`addresses` 按契约填三份审查文档的文件名（本仓此前多数裁决件填的是意见编号，见「留痕与文案小修」计划 §6.2；从本件起照契约写）。

## 逐条裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 属实：改动前探活不读 `cli/config.json` 内容，现在 `prepareZcodeHome` 的 `JSON.parse` 与指纹的 `sha256File` 都可能抛，`probeAuth` 无兜底，会把预检崩成「内部错误」而非一条可读的检查项失败；EV-136 的实遇恰是「用户配置处于坏状态」，敏感面不该变宽 | `zcode.ts` `authProbe.probe()`：副本准备段包 try，读 / 解析失败转 `{ ok: false, detail: '副本源 ~/.zcode/cli/config.json 读取或解析失败：<原因>' }`（`finally` 删目录不变）；`fingerprint()` 读失败返回 null（缓存判失效、交给 probe 报可读失败）。新增用例：副本源为非法 JSON ⇒ `ok: false` 且不抛；变异：去掉 try ⇒ 用例红 |
| CODEX-02 | codex | minor | 接受 | 属实：`run()` 无副本支自 EV-112 起也传落点根（产物拉回运行目录、短路启动期 beta 改写），探活退路支传 null，「与 run() 同一支」在落点维度不成立；退路支传 `zcodeHomeUnder(runDir)` 与 `run()` 真正同形，产物随 `finally` 整目录删除，还消除真实 HOME 残留 | `zcode.ts` 探活两支恒传 `storageRedirectRoot: zcodeHomeUnder(runDir)`；「副本源缺失」用例改断言落点根在临时目录下（原断言钉的是改动前形态）；变异 M5 改为「退路支不设落点根」；`storageRedirectRoot` 注释同步 |
| CODEX-03 | codex | minor | 接受 | 属实：详情里的「模型 X」是编排器请求的模型，不是回读的生效模型；置首挪不动（`reorder.kind === 'not_movable'`）时 0.16.9 会回落首个可见 provider 的首个模型，正结论可能来自别的模型却以 X 的名义缓存。探活里起日志回读全套属重设计，本次只把可见事实如实写出 | `zcode.ts`：`prep.reorder?.kind === 'not_movable'` 时详情写「模型 X（置首未生效：<原因>；实际生效模型未核）」；用例构造整数样键名的不可挪副本源断言该措辞；BACKLOG EV-136「残余」登记「探活不回读生效模型」 |
| CODEX-04 | codex | minor | 接受 | 属实：`routeModel(cfg, 'glm', 'plan')` 不带覆盖，`--model-glm` / 主题级覆盖不进探活与指纹，与 EV-136 同族；给 `authProbe` 传入当轮生效模型要改 `AuthProbe` 接口与四家适配器，超出本条范围，本次按两侧的最小建议如实声明 | `zcode.ts` `authProbe` 注释写明「不分阶段、不分命令行 / 主题级覆盖」及量级判断；BACKLOG EV-136「残余」并列登记，并写中期方向（由调用方按 `run()` 同一 `routeModel` 式子算好当轮模型传入、指纹随之派生） |
| AGY-01 | gemini | nit | 接受 | 属实：`no_model` 退路只有 `prepareZcodeHome` 的函数级用例，authProbe 层没有正向锁定 | `test/unit/zcode-auth-probe.test.ts` 补一格：删掉档位 glm.plan ⇒ 真实 HOME、注入个人配置、落点根在临时目录下、详情含退路说明（措辞见 GLM-05） |
| GLM-01 | glm | minor | 接受 | 属实：`source_missing` 的 reason 嵌用户主目录绝对路径，经详情进预检输出，而预检输出常被抄进 evidence（`displayHomePath` 的存在理由）；改动前探活详情不含家目录 | `zcode.ts` 拼 `probed` 前把 reason 中的 `os.homedir()` 前缀归一为 `~`（适配层自持，不从 `preflight.ts` 引以免循环依赖）；「副本源缺失」用例断言详情不含临时 HOME 的绝对路径；变异：去掉归一 ⇒ 红 |
| GLM-02 | glm | minor | 接受 | 同 CODEX-02 | 同 CODEX-02 |
| GLM-03 | glm | minor | 接受 | 同 CODEX-04 | 同 CODEX-04 |
| GLM-04 | glm | minor | 接受 | 同 CODEX-01 | 同 CODEX-01 |
| GLM-05 | glm | nit | 接受 | 属实两处：一是 `no_model` 缺 authProbe 级用例（同 AGY-01）；二是退路支文案「ZCode 个人缺省模型」在「个人配置也不存在」时不准——那时 CLI 走 legacy 导入真实 HOME 的 `cli/config.json` | 用例同 AGY-01；退路支文案改为「真实 HOME 下 ZCode 自选的缺省模型（<原因>）」，不再断言一定是个人配置那份；两格退路用例随之改断言 |
| GLM-06 | glm | nit | 接受 | 属实：失败详情只有兜底 `other` 支带路径说明；`model_config_missing` 在副本支出现时（文件在、provider 段不可用），「缺 ~/.zcode/cli/config.json」与刚对该文件算过指纹的事实自相矛盾 | `zcode.ts`：`model_config_missing` 与 `provider_config_unresolved` 两支也拼上 `probed`；`model_config_missing` 按 `prep.homeDir` 分叉措辞（副本支：「副本源在，但 CLI 报模型配置缺失，provider 段可能不可用」；退路支沿用原文）；用例锁副本支措辞 |

## 实施与验证计划（审批后执行）

1. 按上表改 `zcode.ts` 与 `test/unit/zcode-auth-probe.test.ts`；变异规格 M5 改写，新增 M9（副本准备不兜底）、M10（家目录不归一）、M11（置首未生效不注明）、M12（`model_config_missing` 副本支不分叉）；全量 `npm run check`。
2. BACKLOG EV-136 行更新：「残余」补「不分覆盖」「不回读生效模型」两条，读数刷新。
3. 设计文档：主设计 11.3 第 7 条（provider 配置注入）补一句「认证探活自 EV-136 起与 `run()` 同形，副本支不注入个人配置」——glm 未覆盖范围所提的回补，经核该条是唯一描述探活注入口径的落点。
4. 用户在终端重装（`--targets claude,glm,codex`），我复核安装副本与构建一致并跑一次预检取读数；然后按用户指示提交。
