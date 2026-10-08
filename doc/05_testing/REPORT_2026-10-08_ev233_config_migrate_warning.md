# EV-233 · config v1 迁移告警补用例报告

> - **日期**：2026-10-08
> - **依据**：BACKLOG EV-233；主设计 17.2「演进增补用例」表「config v1 输入 → 内存迁移」一行、13.1.1 方框；M11 第 12 步前置（用户 2026-10-08 定：启用第 9 步「§24 无 ◐ / ⏳」断言之前先补这条用例，让 24.1「17.2」行与 17.2 表内迁移行两处都名副其实）
> - **起点**：`a54e680d`
> - **性质**：只加测试，源码与 bundle 不变；B 档，**未走双审**，提交前由执笔方自审补丁。证据在 [`evidence/ev233-config-migrate-warning-20261008/`](./evidence/ev233-config-migrate-warning-20261008/)
> - **配额**：零（全部走打包产物与假探针）
> - **结论**：迁移告警走 stderr、每次 CLI 调用恰一条、`--json` 的 stdout 仍只有单个 JSON——三点首跑即成立，**实现无需改动**；新用例三格，变异 5/5 咬住；17.2 迁移行 ◐ → ✅，EV-233 结案

---

## 1. 缺口

17.2 那一行写三点期望：告警走 **stderr**、每次调用**恰一次**、stdout 仍只有**单个 JSON**。迁移本身与行为等价早有 `test/unit/config-migrate.test.ts` 守着；这三点只有代码审读（`src/trivium/config.ts` `loadConfig` 末段：两个源的迁移说明合并成一条、经 `warn()` 走 stderr），`test/` 下对告警文案零命中（M11 第 10 步核出，当时把该行拆开标 ◐）。

这三点只在真实进程里看得见：同一条命令若多加载一次配置、或告警改走 stdout，单元层直接调 `loadCtx` 测不出来，而 skill 读 `--json` 输出的协议会当场坏掉。所以用例走打包产物。

开工前核过调用面：`src/trivium/cli.ts` 每个命令函数入口各调一次 `loadCtx`（review、doctor、preflight、topic claim、topic、init、hooks、gate、approval、verify、report、status、scrub；hook 入口经 `runHook` 传入同一个加载函数），`src/` 里没有别的调用点。

## 2. 新用例

`test/integration/config-migrate-warning.test.ts`（夹具 `makeFixture`，经 `scratchDir` 登记、进程退出即删；判告警用 `CONFIG_SCHEMA_ID_V1` 拼出的告警头前缀计数；stdout 不经候选抽取、整段 `JSON.parse`）：

| 格 | 构造 | 命令 | 断言 |
| :--- | :--- | :--- | :--- |
| M1 | 共享层 `config.yaml` 加 v1 schema 标识与旧名 `critics` 段 | `topic resolve … --json` | 退 0；stdout 整段即单个 JSON、不含告警；stderr 告警头恰 1 次，且点名共享配置文件 |
| M2 | 共享层同上；本机层 `config.local.yaml` 写 v1 覆盖片段（无 schema 键，靠旧名 `review.allow_single_flag` 识别）；`seedFakeProbes` 只写 probe 段、保留本机层已有键 | `topic resolve … --json`、`preflight --critics gemini --skip-auth-check --json` | 两条命令各：退 0；stdout 单个 JSON；stderr 告警头恰 1 次，**两个文件在同一条里点名** |
| M3 | 不改夹具（v2） | `topic resolve … --json` | 退 0；stdout 单个 JSON；告警头 0 次、「已在内存中」0 次——防 M1 / M2 的计数在文案改动后变成恒假的空转 |

单跑（`node scripts/build.mjs --with-tests` 后）：tests 3 / pass 3 / fail 0。

## 3. 变异

正式装置 `scripts/mutation-check.mjs`（七道闸；每条变异重打 bundle 与测试产物），规格 [`mutation-spec.json`](./evidence/ev233-config-migrate-warning-20261008/mutation-spec.json)，输出 [`mutation-output.txt`](./evidence/ev233-config-migrate-warning-20261008/mutation-output.txt)。开跑前自检：五条 `find` 在源文件中各恰好命中一处，替换串不含 `$'` 一类特殊替换模式。

| # | 变异 | 位置 | 结果 | 预期红的格（按构造推断；装置只记失败数） |
| :--- | :--- | :--- | :--- | :--- |
| W1 | 逐源各打一条（`for (const _m of migrated) warn(…)`） | `config.ts` `loadConfig` 末段 | 咬住，fail=1 | M2（两源 ⇒ 两条） |
| W2 | 告警改走 stdout | 同上（`warn` 换成写 stdout） | 咬住，fail=2 | M1、M2（stdout 不再是单个 JSON） |
| W3 | 告警整条不打 | 同上（`migrated.length > 0` → `> 99`） | 咬住，fail=2 | M1、M2（计数 0） |
| W4 | 只登记共享层的迁移 | `loadConfig` 逐源循环 | 咬住，fail=1 | M2（本机层文件未点名） |
| W5 | 预检入口多加载一次配置 | `cli.ts` `cmdPreflight` | 咬住，fail=1 | M2（preflight 一次调用两条） |

基线：装置前置「工作树干净、基线全绿（1 个套件）」通过；每条跑完恢复件与基线逐字节一致，收尾后 `src/` 无改动、哨兵已清。

## 4. 文档

- 主设计 v1.3.141：17.2「config v1 输入 → 内存迁移」行 ◐ → ✅ 并补用例名；§24.1「17.2 必测故障注入表增用例」行的状态句改准（表内已无 ◐）；16.1 M11 行补本项；变更记录一行。
- BACKLOG EV-233 → done。
- 第 9 步测试 ③（`NO_PENDING_SKIP`）**本项不启用**，随第 12 步收口一起启用；它按 §24 状态列去掉加粗后的首字符判定，状态句正文里提到 ◐ 的历史描述不影响判定。

## 5. 全量检查

文档与用例落定后串行两次 `npm run check`（一次只发一条，跑时不改 `doc/`）：两次均 tests 3081 / pass 3078 / fail 0 / skipped 3，退 0（[`check-1.txt`](./evidence/ev233-config-migrate-warning-20261008/check-1.txt)、[`check-2.txt`](./evidence/ev233-config-migrate-warning-20261008/check-2.txt)）。这两份读数是在收进本目录之前跑的；收入后按同一纪律再串行两次，读数见提交说明。
