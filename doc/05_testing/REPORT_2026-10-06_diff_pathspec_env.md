# 补丁排除不受 pathspec 环境变量影响 · 实施报告（EV-222）

> - **日期**：2026-10-06
> - **主题**：`补丁排除钉住pathspec解释`（EV-222，单题；**本题未走双审**，用户 2026-10-06 回「按照你的建议：修」，由执笔方直接开发；提交与推送等用户确认）
> - **起点**：`c7f61ae`（`main`，工作树干净）
> - **证据目录**：`doc/05_testing/evidence/diff-pathspec-env-20261006/`
> - **配额**：零配额（桩审查员，不调任何真实审查员 CLI）
> - **方案**：用户定 EV-222 候选 A——在生成补丁的 `git diff` 调用里钉住 pathspec 的解释方式，并顺查其余带魔法 pathspec 的 git 调用

## 0. 动手前：现状、修法与边界

### 现状（已核）

1. **补丁的排除靠 git pathspec**：`src/trivium/util/git.ts` `diffAgainst`（:427 起）把归档根、`.trivium`、`.git` 写成 `:(exclude)<前缀>/**`，把 `review.sensitive_globs` 写成 `:(exclude,glob)<glob>`（:444～447），交给 `git diff --find-renames <base> -- . …`（:448）剔除已跟踪文件的改动；未跟踪文件另走 `ls-files --others` 加 JS 侧 `excluded()` 过滤，不经 pathspec。调用方是送审冻结（`freeze.ts`）、`prepareRun` 的 code 阶段取补丁与跑后复算（`review.ts`）。`diffExcludePrefixes` 的文档块写明这是安全边界：对方产出或敏感文件进了补丁，就经**被审对象本身**进 BRIEF 与 argv，禁读清单与轨迹核验都绕过。
2. **git 有四个改变 pathspec 解释的全局环境变量**，由用户环境继承下来，编排器没管：实测（`env-matrix.sh` / `env-matrix.txt`，照抄 `diffAgainst` 的写法，夹具里已跟踪的业务文件、归档文件、`.trivium/config.yaml`、`.env` 各改一行）——
   - 不设：补丁只有业务文件；
   - `GIT_LITERAL_PATHSPECS=1`：魔法前缀被当字面路径，三类排除**全部失效**，补丁多出归档文件、`.trivium/config.yaml` 与 `.env`；`git diff` 对不匹配的 pathspec 不报错、照常退 0；
   - `GIT_NOGLOB_PATHSPECS=1`：`/**` 被当字面，归档根与 `.trivium` 的排除失效（敏感 glob 带显式 `glob` 魔法，仍有效）——**这是顺查新核出的一格**，登记时只写了 LITERAL；
   - `GIT_GLOB_PATHSPECS=1`、`GIT_ICASE_PATHSPECS=1`：结果与不设相同（该夹具里没有大小写不同的路径；ICASE 的影响另测，见 §2）；
   - 四个都显式钉 `0` 时，用户环境再设 `1` 也不影响，补丁与不设相同。
3. **其余带 pathspec 的 git 调用**：`workTreeHash` 的 `add`（:169，EV-221 起只钉了 `GIT_LITERAL_PATHSPECS=0`；排除写成 `:(exclude,literal)`，GLOB / NOGLOB 不影响，ICASE=1 会让排除不分大小写）；`status --porcelain -- <路径>`（:248）与 `deletedOrModifiedTracked` 的 `diff -- <前缀>`（:599）是不带魔法、不带通配的普通前缀，实测四个变量下结果都不变；`diff --no-index -- /dev/null <文件>` 的参数是路径不是 pathspec。另有审批摘要打印给人复制的完整列表命令（`worktree-summary.ts` :246，`:(exclude)<前缀>`），在用户自己的 shell 里跑、不经编排器。
4. **改前经真实 CLI 的复现**：见 §2 第一行（code 阶段 `review --start` 带 `GIT_LITERAL_PATHSPECS=1` / `GIT_NOGLOB_PATHSPECS=1`，冻结的 `changes-<run_id>.diff` 里有没有归档文件、`.trivium/config.yaml` 与 `.env`）。

### 修法

1. `util/git.ts` 新增导出常量 `PATHSPEC_ENV_DEFAULTS`：`GIT_LITERAL_PATHSPECS`、`GIT_NOGLOB_PATHSPECS`、`GIT_GLOB_PATHSPECS`、`GIT_ICASE_PATHSPECS` 四个都为 `'0'`，即 git 的缺省解释方式。
2. `diffAgainst` 的已跟踪 `git diff` 调用带上它（无条件）；`workTreeHash` 有排除时 `add` 的环境由单钉 `GIT_LITERAL_PATHSPECS` 改为带上它。两处的 pathspec 写法不变，不设这些变量的环境里补丁与工作树哈希逐字节不变。
3. 用例：单测——四个变量逐个设 `1`，`diffAgainst` 的补丁与不设时逐字相同、只含业务文件；`workTreeHash` 在 ICASE=1 / NOGLOB=1 下与不设同值；源码护栏——`src/` 里含 `:(` 魔法前缀的字面量按文件登记，`util/git.ts` 两处、审批摘要的人读命令一处（豁免：用户 shell）。集成——code 阶段经真实 CLI，两个变量各跑一轮，冻结补丁只含业务文件。

### 不改的边界

- pathspec 写法、补丁内容与格式（不设这些变量时）、工作树哈希、漂移判定、BRIEF 都不改。
- 不改 JS 侧的未跟踪文件过滤（不经 pathspec，不受影响）。
- 审批摘要打印给人复制的完整列表命令不改：那是用户在自己 shell 里执行的诊断命令，改它会改输出措辞；用户全局设了 LITERAL / NOGLOB 时，它会把被排除的文件也列出来（只多列、不影响任何判定），在 §4 记为残余。
- 普通前缀的两处 git 调用（`status --porcelain`、`deletedOrModifiedTracked`）实测不受影响，不加。

## 1. 改了什么

1. `src/trivium/util/git.ts`：
   - 新增导出 `PATHSPEC_ENV_DEFAULTS`（`GIT_LITERAL_PATHSPECS` / `GIT_NOGLOB_PATHSPECS` / `GIT_GLOB_PATHSPECS` / `GIT_ICASE_PATHSPECS` 都为 `'0'`），文档块写明各变量的实测影响与用到的地方。
   - `diffAgainst` 的已跟踪 `git diff` 调用带上它（经 `git()` 的 `env` 参数叠在用户环境之上，后者被覆盖）。
   - `workTreeHash` 有排除时 `add` 的环境由 `{ ...env, GIT_LITERAL_PATHSPECS: '0' }` 改为 `{ ...env, ...PATHSPEC_ENV_DEFAULTS }`。
2. 用例：
   - 新文件 `test/unit/diff-pathspec-env.test.ts` 7 格：P1 四个变量逐个设 `1`，`diffAgainst` 的补丁与不设时逐字相同、只含业务文件（夹具里已跟踪的归档原稿、`.trivium/config.yaml`、`.env` 都改过）；P2 `ICASE=1` 时排除写 `Docs`、目录叫 `docs` 照常进补丁；H1 四个变量逐个设 `1`，`workTreeHash`（带排除）与不设同值；H2 `ICASE=1` 的工作树哈希一格；H3 常量就是四个变量取 `0`；G1 / G2 源码护栏——TypeScript AST 扫 `src/` 的字符串与模板字面量，pathspec 魔法（长形式 `:(exclude|literal|glob|icase|top|attr…)`、短形式 `:!` `:^` `:/`）按文件登记：`util/git.ts` 3、`worktree-summary.ts` 1（人读命令，豁免）。
   - 新文件 `test/integration/diff-pathspec-env.test.ts` 2 格：经真实 CLI（桩审查员）跑 code 阶段，`GIT_LITERAL_PATHSPECS=1`、`GIT_NOGLOB_PATHSPECS=1` 各一轮（环境经 `cli` 第 5 参给 `--start` 与 `--wait`，工作进程继承），冻结补丁里的文件只有 `src/a.ts`、被排除文件的标记串不在补丁里、跑后复算无漂移。
3. 文档：主设计 v1.3.126（9.2 code 行补一句、要点新增一条、EV-221 那条「钉 LITERAL」补指向、变更记录）；LLD v1.1.48（3.3 补一段、EV-221 段补指向）；BACKLOG EV-222 结案；本报告登记索引。PROTOCOL 第四章只写到「add 排除归档根、.trivium/、.git」，不涉及补丁的 pathspec 写法，未改；用户手册与 RUNBOOK 不描述这些变量，未改。

## 2. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 现状实测（照抄 `diffAgainst` 写法） | 不设：只有业务文件；`LITERAL=1`：多出 `.env`、归档文件、`.trivium/config.yaml`；`NOGLOB=1`：多出归档文件与 `.trivium/config.yaml`；`GLOB=1` / `ICASE=1`：与不设相同；四个钉 `0` 后用户环境再设 `1` 均与不设相同；普通前缀的 `status --porcelain` 与 `diff -- <前缀>` 四个变量下都不变 | `env-matrix.sh`、`env-matrix.txt` |
| ICASE 能否观测 | 本机 `core.ignorecase=true`；排除写 `Docs`、目录叫 `docs`：不设时补丁含 `docs/f`、`ICASE=1` 时被排除；工作树哈希同理（`ICASE=1` 时等于 HEAD 的 tree） | `icase-probe.sh`、`icase-probe.txt` |
| 改前经真实 CLI 复现（`c7f61ae` 的 bundle） | 集成 2 格都红：`LITERAL=1` 冻结补丁含 `.env`、`.reviews/EV222补丁/plan/…`、`.trivium/config.yaml`、`src/a.ts`；`NOGLOB=1` 含后三者 | `repro-before.txt` |
| 类型检查 | 退 0 | 全量内含 |
| 构建（`build.mjs --with-tests`） | 退 0 | `build.txt` |
| 相关套件（新增两文件、EV-221 两文件、code-stage 单测与集成、freeze-drift、worktree-summary、temp-index-cleanup、fixture-repo-init、build-stamp、registry-parity、scratch-guard） | 210/210 | `suite-related.txt` |
| 变异逐条预跑 | 5/5：M1 补丁不钉环境红 P1 / P2，亦跑集成红两格；M2 去 LITERAL 红 P1 / H1 / H3，亦跑红 LITERAL 格；M3 去 NOGLOB 红 P1 / H3，亦跑红 NOGLOB 格；M4 去 ICASE 红 P2 / H2 / H3；M5 工作树哈希退回只钉 LITERAL 红 H2。GLOB 一项对现有写法无影响，不设变异 | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置 | 5/5 咬住（首次一跑；随后常量文档块订正一句，定稿源码上重跑仍 5/5） | `first-mutation/`、`mutation-output.txt`、`mutation-spec.json`（`gen-mutation-spec.mjs` 生成） |
| 全量第 1 次 `npm run check` | 2931 / 2929 / 0 / 2，退 0（比起点 2922 多 9 格：新单测 7、集成 2） | `check-1.txt` |
| 全量第 2 次（串行） | 2931 / 2929 / 0 / 2，退 0 | `check-2.txt` |
| `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| 全量之后补填本表与索引描述，补跑读 `doc/` 的套件（`test/contract/` 全部与 8 个读文档的单测文件） | 463/463 | `doc-suites-after-report.txt` |
| 临时目录新建 | 两次全量期间分别 2 个、1 个，全是 `trivium-index-`（已知残留 EV-204 残余五）；自检期间 0；除 `trivium-index-` 外为 0。未用 `TRIVIUM_KEEP_FIXTURES` | `count-new-check-1.txt`、`count-new-check-2.txt`、`count-new-doctor-selftest.txt` |

**源码护栏首跑误报两次**：扫描器起初只认 `:(` 两个字符，命中 `hooks.ts` 正则源串里的 `(?:(?:`；收紧到 git 的魔法词之后，短形式 `:/` 又命中 `probes/zcode.ts` 判 URL 的 `'://'`。改为长形式只认魔法词、短形式 `:/` 后面不能是 `/`，两处都写进扫描器自测。被测代码没改。

## 3. 提交前自审

1. **注释失实**：常量文档块初稿写「GLOB / ICASE 对现有写法实测无影响」，与 icase 实测不符（大小写不同时 ICASE 会改变排除结果），已改准；EV-221 在设计、LLD 里写的「这一步钉 `GIT_LITERAL_PATHSPECS=0`」补了指向，EV-221 报告与 BACKLOG 落地记要是当时的记录，不回改。
2. **断言范围**：新用例只断言「设了变量与不设时结果相同」与补丁里的文件，没有借机断言别的补丁语义；既有用例没有改动。
3. **调用点登记**：`src/` 里含魔法 pathspec 的字面量都进了 G2 登记表，人读命令那处写明豁免理由；EV-221 的 `workTreeHash` 调用点护栏不受影响（调用点没有增减）。
4. **默认环境不变**：P1 / H1 以不设变量时的输出为基准逐字比对；不设这些变量时 `git()` 叠加的四个 `0` 就是 git 的缺省值。

## 4. 残余

- 审批摘要打印给人复制的完整列表命令（`worktree-summary.ts` 的 `fullListCommand`，`:(exclude)<前缀>`）不改：在用户自己的 shell 里执行，用户全局设了 `LITERAL` / `NOGLOB` 时会多列出被排除的文件，只影响人读、不进任何判定。要改就得改输出措辞（如前缀 `GIT_LITERAL_PATHSPECS=0`），属产品决策，未做。
- 候选 B（冻结补丁后按 `excluded()` 逐文件核补丁头、命中即拒跑）未做，可作纵深防御另议。
