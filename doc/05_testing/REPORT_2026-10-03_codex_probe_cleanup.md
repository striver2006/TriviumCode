# codex 探活删除收尾 · 实施报告（EV-200）

> - **日期**：2026-10-03
> - **主题**：`codex探活删除收尾`（命令 A `/dual-run`，Driver claude）
> - **起点**：`9ce191f`（`main`，工作树干净）
> - **计划**：`.reviews/codex探活删除收尾/plan/` r2（计划双审第 1 轮 run `20261003T142424Z`：codex `request-changes`（4 条，均因缺 `confidence` 逐条降级，落在测试摆法）、gemini `approve-with-nits`（次要 1、吹毛求疵 2）、glm `approve-with-nits`（次要 3、吹毛求疵 2），12 条全接受；另登 EV-202）
> - **证据目录**：`doc/05_testing/evidence/codex-probe-cleanup-20261003/`
> - **代码双审**：见 §5
> - **配额**：全程零配额（用户决策六）：认证探活用假入口（一个可执行的 node 脚本），经 `CODEX_HOME` 指向合成源目录，没有任何真实 codex 调用

## 1. 问题

codex 认证探活 `authProbe.probe()`（`src/trivium/adapters/codex.ts`）用 mkdtemp 建 `trivium-codex-auth-` 临时根，`prepareCodexHome` 在其下的 `codexhome/` 里写副本；结果在 try 里直接 return，finally 是裸 `fs.rm({ recursive: true, force: true })`。`force` 只吞 ENOENT，ENOTEMPTY / EBUSY / EACCES 从 finally 抛出、顶替探活结果，穿过无兜底的 `probeAuth` 与 `runPreflight` 的 `Promise.all`，整个预检崩成内部错误；同时含真实凭据的副本留在系统临时目录，没有任何提示。与 EV-197 修之前的 zcode 探活同形。

副本里有三份凭据载体：裁剪后的 `config.toml` 与本次 profile 的分层 toml（`trimCodexToml` 保留整段 `[model_providers.*]`，里面可以有 `experimental_bearer_token`），以及原样拷入的 `auth.json`。所以残留提示没有哨兵档。

`prepareCodexHome` 本身也会抛（读、写、收紧权限、追加信任记录都没有兜底），同样穿透。

## 2. 改了什么

- `src/trivium/util/fsx.ts`：
  - 新增 `tryRemoveTempDir(dir, copies)`：删 mkdtemp 的返回值，`maxRetries: 3`、失败不抛；删成功返回 null，失败返回 `{ code, remaining }`——`copies` 里删除失败后现场 stat 仍在（或查不了）的那些，ENOENT 才算不在。只删 `dir`，`copies` 只 stat。从 `removeZcodeTempDir` 抽出，措辞不在这里。
  - `tildeHome` 自 `adapters/zcode.ts` 挪来（codex 探活要用它，而 `adapters/codex.ts` 引 `adapters/zcode.ts` 会让两个载体互相依赖）。
- `src/trivium/adapters/zcode.ts`：`removeZcodeTempDir` 改为调 `tryRemoveTempDir` 的薄包装，签名与三档措辞不变；`tildeHome` 原名再导出，`probes/zcode.ts` 与测试的 import 不动。
- `src/trivium/adapters/codex-home.ts`：
  - 新增导出 `codexCredentialCopies(codexHome, profile)`：`[config.toml, <profile>.config.toml（profile 非 null 时）, auth.json]`，与 `isCredentialCarrier`、`scrubCodexHome` 同一口径；`isCredentialCarrier` 改为导出，单测按它对账（代码双审 CODEX-01）。
  - `prepareCodexHome` 各步用 `prepStep` 包住：抛出时在**原错误对象**上挂 `codexPrepStep`（已有不覆盖；原始值原样重抛不挂），不改消息、不换类型，`run()` 的兜底文案逐字不变。步骤名：建副本目录、裁剪 〈文件名〉、重写 〈文件名〉 里的 ~/ 路径、拷入 auth.json、写入项目信任记录。新增导出 `codexPrepStepOf(e)` 读取。
- `src/trivium/adapters/codex.ts`：
  - 新增导出 `codexTempDirResidueText(runDir, code, hasCopies)`，两档共用前缀（家目录统一归一 `~`）：有 ⇒「其中的 codexhome 凭据副本（auth.json 与 toml）含真实凭据，请手工删除」；无 ⇒「其中没有凭据副本，剩下的是本次探活的临时文件，请手工删除」（用户决策二原话是「是本次探活的 CLI 产物」，代码双审 CODEX-02 ≡ GLM-01 指出副本准备失败与模型目录拷贝两条路径下不属实，改为不断言内容全貌）。
  - `probe()` 照 zcode 探活的形态拆出内部 `attempt`：结果在 `attempt` 里拼完，外层 finally 调 `removeCodexAuthTempDir`（`tryRemoveTempDir` + 三份凭据副本位置），删不掉时提示以 `；` 接在详情末尾，`ok` 不变；删除成功时两句详情逐字节不变。
  - `attempt` 里 `prepareCodexHome` 外加 catch：落成 `{ ok: false, detail: '准备 codex 隔离副本失败（〈步骤〉）：〈消息，家目录归一 ~〉' }`，副本没备好就不拉起 CLI；前缀与 `run()` 同一句。
- `src/trivium/probes/zcode.ts`：只在同形臂注入选项 `removeTempDir` 的文档块里点名它与 `tryRemoveTempDir` 不是一回事（计划双审 GLM-04）。

拉起参数、判据、指纹、缓存口径、`probeAuth` 不变（用户决策三）。

## 3. 用例

新文件 `test/unit/codex-auth-probe.test.ts`，11 格。假入口首行 shebang 写 `process.execPath`，先写观测文件、再按 `FAKE_LOCK` 摆现场，摆不出退 3：

| 格 | 摆法 | 断言要点 |
| :--- | :--- | :--- |
| C1 | 通过；`codexhome/` 改 0o500 | 不抛、`ok` true、以「探活通过（」开头、末尾「含真实凭据」档（字面正则 + 函数输出） |
| C2 | 失败（退 1）；同上锁 | `ok` false、以「探活失败：fake auth failure。」开头、末尾同上 |
| C3 | 入口删掉三份凭据副本、锁兄弟目录 `locked/`（内放文件 `f`） | 末尾「没有凭据副本」档 |
| C3b | 三次各只留一份（`config.toml` / `qwen.config.toml` / `auth.json`），锁 `codexhome/` | 三次都取「含真实凭据」档 |
| C4 | `codexhome/` 改 0o000 | 查不了按在说 |
| C5a | 源 `config.toml` 是个目录（root 下也成立） | 「准备 codex 隔离副本失败（裁剪 config.toml）：EISDIR…」、不拉起 CLI、无残留 |
| C5b | 源 `auth.json` 改 000 | 「（拷入 auth.json）：EACCES…」、含 `~/.codex/auth.json`、不含家目录绝对路径 |
| C6 | 不锁：通过、失败各一次 | 通过支匹配 `^探活通过（\d+s）$`，失败支逐字相等，无残留 |
| C7 | `prepareCodexHome` 摆齐三份源，profile 为 qwen 与 null 各一次 | 副本里凭据载体名的文件恰为 `codexCredentialCopies` 给出的那几个 |
| C8 | 措辞两档 | 写死完整字面；两档都把家目录归一 |
| F1 | `tryRemoveTempDir` 直测 | 删成功返回 null；失败时 ENOENT 不进 `remaining`、在的进 |

权限格 root 下跳过（C5a、C6～C8 除外）。各格的假入口与假家目录在文件结束时整删。

## 4. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 新用例 | 11/11 | — |
| 相关回归（zcode 认证探活 A1～A4 / R7、doctor 探针 D10 系列、旗标探针 R1、同形臂 R2～R6、codex 适配器、codex 抹除、凭据抹除） | 172/172 | — |
| 变异预跑（逐条带超时） | 第一批 16/16、代码双审后第二批 16/16 咬住（规格逐字相同），源码逐字节恢复；M7 在 zcode 侧顺带红 D10b / D10c，M8 顺带红 D10d，M13 顺带红 R6 | `mutation-spec.r1.json` / `mutation-spec.json`、`mutation-names-log.r1.txt` / `mutation-names-log.txt` 及同名 `output` |
| 变异装置（`scripts/mutation-check.mjs`） | 第一批、第二批均 16/16 咬住，基线全绿（2 个套件） | `mutation-output.r1.txt` / `mutation-output.txt` |
| 全量 `npm run check`（双审前） | 第一次 2644/2641/1/2 **红**：`contract/fixture-credentials` 拦下新用例夹具里完整形态的 `experimental_bearer_token = "…"` 字面量（真红，本题引入），改为键名分段拼接后单跑 12/12；随后两次 2644/2642/0/2，退 0 | `check-1.txt`（红）、`check-2.txt`、`check-3.txt` |
| 全量 `npm run check`（双审后） | 两次均 2644/2642/0/2，退 0 | `check-4.txt`、`check-5.txt` |
| `trivium doctor --selftest`（仓库 bundle `skills/dual-critic/scripts/trivium.cjs`） | 双审前后各一次，均 14/14、退 0 | `doctor-selftest.r1.txt`、`doctor-selftest.txt` |
| 代码双审后相关用例单跑（新用例、凭据契约、zcode 回归、codex 适配器与抹除） | 184/184 | — |

变异与计划 r2 §3.2 的出入：M15 原写「没有凭据副本档不归一家目录」，实现里两档共用一个前缀（计划双审 AGY-01），改为变异前缀；M16（凭据副本位置少拼一层 `codexhome`）为编码时补。

**变异轮在系统临时目录留下 10 个 `trivium-cauth-priv-*`**（UTC 14:41 / 14:42，即预跑与装置的 M1 两批各 5 个；每个下面一个 `trivium-codex-auth-*`，里面只有夹具假值）：M1 让 `probe()` 抛出，用例收尾里「残留目录名」是 probe 返回后才算的，权限没恢复、私有根删不掉。已改为在 finally 里重新读私有根再恢复权限；单条 M1 复跑仍咬住、残留数不再增加。这 10 个目录未删，待用户定。上面两次绿的全量在这处收尾修改之前跑，双审后的全量会覆盖它。

## 5. 代码双审

run `20261003T150101Z`（约 9 分 14 秒）：codex `approve-with-nits`（次要 1、吹毛求疵 2）、gemini `approve`（零意见）、glm `approve-with-nits`（吹毛求疵 1），4 条全接受（应答件 `.reviews/codex探活删除收尾/code/` 的 `response` 件），按接受项改码：

- CODEX-01：`isCredentialCarrier` 改为导出，C7 用生产谓词过滤写入面，并断言清单里每个名字都被它认作载体；假入口脚本里那份手抄只用于摆现场，注释写明。
- CODEX-02 ≡ GLM-01：「没有凭据副本」档后半句由「是本次探活的 CLI 产物」改为「剩下的是本次探活的临时文件」——副本准备失败时 CLI 从未拉起、模型目录等拷贝文件也可能后删，原话说过头。这句是用户决策二的原话，改动如实说明。zcode 侧同句式不动（决策二，见 §6 第 7 条）。不补「准备失败 + 删不掉」的端到端格：现有装置在那条路径上没有上锁时机，由 C8 字面断言覆盖同一句。
- CODEX-03：`tryRemoveTempDir` 的 `code` 回退到错误消息时也过 `tildeHome`（这一支近于不可达）。

改码后的读数见 §4（变异第二批、双审后全量两次、自检）。

## 6. 残余

1. 残留提示只在当次预检可见：正结论入缓存后 TTL 期内不再出现（`probeAuth` 缓存条目不含 detail，同 EV-197 残余 ②）。
2. `attempt` 抛错且删不掉时提示随异常丢失：与 zcode 两侧同形；codex 侧副本准备已兜住、`invokeCodex` 不 reject、事件解析逐行兜底，抛出面近于空。
3. `mkdtemp` 本身失败照抛（同 zcode 探活）。
4. 步骤名挂在原错误对象上：将来若有人在 `prepareCodexHome` 外再包一层新错误，括注会退化成没有——C5a 会红。
5. `maxRetries` 只对瞬时错误重试，用例摆的 EACCES 不重试，未覆盖（同 EV-197 残余 ③）。
6. 指纹读盘无兜底另登 EV-202（计划双审三侧同指，用户决策三定了不改指纹）。
7. zcode 侧「没有副本」档的后半句「是本次探测的 CLI 产物」与 codex 改前同一句式，在 zcode 的副本源解析失败且删不掉时同样说过头（CLI 未拉起）；按决策二「zcode 侧输出逐字不变」本题不动，未登记。
