# GUIDE：本地开发与调试

> 面向**修改 TriviumCode 自身**的人。只想用它的话看
> [`doc/07_manuals/QUICKSTART.md`](../07_manuals/QUICKSTART.md)。

---

## 一、工具链

| 项 | 要求 | 说明 |
| :--- | :--- | :--- |
| Node.js | ≥ 18 运行，开发建议 ≥ 22 | 产物 `--target=node18`；测试构建用 `node22`（需要 import attributes） |
| TypeScript | `devDependency` | 只做类型检查（`noEmit`），产物一律由 esbuild 出 |
| esbuild | `devDependency` | 打单文件零依赖 CJS |
| 运行期依赖 | `yaml`、`ajv` | **内联进产物**，运行期零 `node_modules`（AD-12） |

不引 eslint / prettier。靠 `tsc --strict` 兜底，与「运行期零依赖」的极简取向一致。
`strict` 之外另开了 `noUncheckedIndexedAccess`、`noUnusedLocals`、`noUnusedParameters`——
后两项在实现期抓出过 7 个残留 import。

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # 两个 bundle
npm test            # pretest 会先全量构建
npm run check       # typecheck + build + test
```

---

## 二、产物与目录

```
src/trivium/cli.ts  → skills/dual-critic/scripts/trivium.cjs   随核心 skill 分发
src/install.ts      → dist/install.cjs                          安装器
src/ + test/        → dist/test/（逐文件转译 ESM，供 node --test）
```

两处要注意：

- 打包用 `charset: 'utf8'`。默认 `ascii` 会把全部中文转成 `\u` 转义——本项目的人读输出
  与提示词全是中文，产物会变得又大又不可 grep。
- 测试构建必须把 `skills/dual-critic/schema/` 按同样的相对路径拷进 `dist/test/`，
  否则 `parse.ts` 的 JSON import 解析不到。

---

## 三、分层测试（§17.1）

| 层 | 位置 | 特征 |
| :--- | :--- | :--- |
| 单元 | `test/unit/` | 纯函数与单模块，毫秒级 |
| 契约 | `test/contract/` | 守跨文件的对账关系：`hook-guard.test.ts` 比对 `hooks.json` 下发的守卫形态，`skill-flag-parity.test.ts` 比对 SKILL.md 的 `argument-hint` 与 CLI 实际接受的旗标。改了一侧忘了另一侧，这层会红 |
| 集成 | `test/integration/` | **调真实打包 CLI 的子进程**，动真实 git 仓库 |
| 自检 | `trivium doctor --selftest` | 整条流水线端到端，14 步 |

集成层的共享夹具在 `test/helpers/fixture.ts`：造真 git 仓库、写 `.trivium/config.yaml`、
按需预置原稿，并提供 `cli()` 调用打包产物。

### 为什么集成测试必须走子进程

`review --start` 会派生**独立的** `trivium review --worker <runId>` 进程，
那个进程自己 `rebuildContext`、自己构造适配器。在测试主进程里替换对象对它毫无影响。

实现期踩过这个坑的两个实例，都值得记住：

1. **故障注入**：只在主进程替换 `CriticAdapter` 的话，worker 照旧用真适配器——
   注入静默失效，测试通过而什么都没测到。解法是环境变量
   `TRIVIUM_STUB_CRITIC` 跨进程注入（`spawnDetached` 继承环境变量），
   并且每个用例都断言产出带着桩指纹 `cli_version: 'stub/0.0.0'`——
   那个字段只可能由**真正执行适配器的进程**写入。
2. **闸门护栏**：四个拦截型 Hook 读 `state.json`，而 `review` 当时只写 `run.json`。
   单元测试直接调 `hookXxx` 并手工 `setGate`，正好绕过缺口，于是
   「裁决未齐备不得提交/收工」这条最核心的护栏一直没在工作而测试全绿。

**结论**：凡是「A 进程算的东西 B 进程要用」的地方，测试必须真的起两个进程。

### 桩适配器的故障形态

`TRIVIUM_STUB_CRITIC` 接一段 JSON，如
`{"gemini":{"mode":"timeout"},"glm":{"mode":"no_tools"}}`。可用 `mode`：

`ok` ｜ `timeout` ｜ `fail` ｜ `dirty_output`（非 JSON）｜ `no_tools`（exit 0 但零工具调用）｜
`no_project_reads`（只读了送审材料）｜ `write_breach`（写项目文件）｜ `peer_leak`（读禁读清单）

生产路径检出该变量会打**醒目告警**——桩能伪造「审查通过」，不能静默生效。

---

## 四、实现纪律（§16.2）

这几条不是风格建议，每一条背后都有踩过的坑。

1. **先探路后编码。** 两家 CLI 的行为与文档记载不符是常态——M0 实测出 12 条冲突
   （`ZCODE_MODEL` 环境变量根本不存在、四个 `--help` 列出的 flag 实测被拒、
   `--print-timeout` 到期以 exit 0 退出）。适配层读 `probe` 结论构造命令行，
   **绝不硬编码**（原则 P7）。实测与设计不符时改适配层并回补修订设计，不改外部产品、
   不改验收口径。
2. **`archive` 是 `.reviews/` 的唯一写出口。** 命名生成、`O_CREAT|O_EXCL` 防覆盖、
   `-r<N>` 抬升只在那一处实现。散落到第二处就必然出现两套命名。
3. **Hook wrapper 检测不到 `.trivium/config.yaml` 一律退 0。** 它是全局安装的，
   误伤其它仓库比漏拦更糟。但注意这条**只覆盖「没有 config.yaml」那一支**：
   `hooks.json` 下发的外层 `sh -c` 守卫里还有另一支——**有 `config.yaml` 但 wrapper
   缺失或不可执行 → exit 2**。护栏被破坏与项目未初始化是两回事，后者放行，前者必须拦，
   否则一条 `rm -rf` 打在 wrapper 上就能无声解除全部拦截型 Hook。
   照着旧语义写新 Hook 会把这个洞重新开出来，`test/contract/hook-guard.test.ts` 守着这条。
4. **git 快照只用临时索引。** `GIT_INDEX_FILE` + `read-tree` + `add -A` + `write-tree`，
   绝不触碰用户的暂存区。所有 git 调用前缀 `-c core.quotePath=false`，
   否则中文路径会变成八进制转义。
5. **不动用户的全局配置。** 需要独立配置时走临时副本（`0600`，跑完即删）。
6. **超时一律用 Node 侧的 `AbortSignal` + SIGTERM→宽限→SIGKILL。**
   macOS 默认没有 `timeout` / `gtimeout`（本机实测两者均不存在）。
7. **进程存活性比对 `ps -o lstart=`。** macOS 复用 PID，`kill(pid,0)` 会把
   「别人的新进程」当成「我们的 worker 还活着」。
8. **状态文件的写入一律「读 → 改 → 原子替换」，且在持锁时进行。**
   `state.json` 是**全局**的，必须用全局锁——用按主题的锁会让两个主题互相丢更新。
   这个错误在实现期犯过三次。
9. **计数不要用读-改-写。** 并发下会丢。`stop_block_count` 改为「每次增量写一个唯一文件、
   计数取 `readdir().length`」，无锁且原子。
10. **Agent 注册表是所有 Agent 差异的单一来源**（设计 16.2 纪律 7，M7a 起）。
    归档后缀、意见编号前缀、配置键、探针段、镜头键、**禁读矩阵**、Hook 字面集
    一律从 `src/trivium/agents/registry.ts` 派生。**除注册表本身与各厂商适配器内部之外，
    任何模块不得出现具体 Agent id / 后缀 / 前缀的字面量**——
    `test/unit/registry-parity.test.ts` 以 grep 级对账守着这条，加硬编码会直接打红。
11. **禁读矩阵禁止手工枚举。** 人工清单维持不住完整性：本项目的计划稿自称已补全 4 处硬编码，
    双审又查出 8 处，其中按 `['gemini','glm']` 字面循环的一处会让第三家审核者的意见
    **对闸门整体不可见**（静默漏裁）。完整性一律由注册表派生 + 机器对账保证。
12. **回溯修订的颗粒度是里程碑**（设计 16.2 纪律 6）。改动与设计文档不一致时先回补设计——
    但**分两类**：需要实测才能定稿的事实条目（第 3 章的能力表）是**测后回填**、作里程碑的完成判据；
    由设计决定的契约条款（旗标、数据契约、路由、Hook 形态）是**开工前并入**、作准入前置。
    两类都不得在设计正文里写成既成事实——**设计文档不能描述一个不存在的系统**。

---

## 五、常用调试姿势

```bash
# 不烧配额跑通整条流水线
node skills/dual-critic/scripts/trivium.cjs doctor --selftest --keep-fixture

# 在夹具里手工验收真实审查（去掉桩）
cd <selftest 保留的夹具目录>
TRIVIUM_ASSET_ROOT=<repo>/skills/dual-critic \
  node <repo>/skills/dual-critic/scripts/trivium.cjs review --stage plan --topic 自检任务 --focus 并发与幂等

# 只探一侧，不消耗配额
node <bundle> doctor --only zcode --no-model-calls

# 看某次运行的原始产物
ls ~/.trivium/runs/<repo_id>/<run_id>/<critic>/

# 只跑一类测试
node --test "dist/test/test/unit/**/*.test.js"
node --test "dist/test/test/integration/gate-loop.test.js"
```

### ⚠️ 改完代码必须重装，否则你验的是旧产物

`trivium init` 生成的 `.trivium/bin/trivium` 指向的是**已安装副本**
`~/.claude/skills/dual-critic/scripts/trivium.cjs`，**不是**仓库里刚 `npm run build`
出来的那个。所以：

```bash
npm run build && node dist/install.cjs   # 两步都要，缺一不可
```

只 `npm run build` 就去跑 `.trivium/bin/trivium`，跑的还是改之前的代码。
实测踩过：修完 agy 的 `--effort` 冲突直接重跑真实审查，仍以同样方式失败，
查了才发现 wrapper 指向的是旧副本——白烧一次配额。

调试时想绕开重装，可以直接调仓库产物：

```bash
node skills/dual-critic/scripts/trivium.cjs <子命令>
```

改了 `skills/` 下的**资产**（`lenses.yaml`、`prompts/`、模板、`hooks.json`）同理，
或用 `TRIVIUM_ASSET_ROOT=<repo>/skills/dual-critic` 指向工作树。

---

## 六、改动时同步什么

| 改了什么 | 必须同步 |
| :--- | :--- |
| 任何与设计文档不一致的行为 | 先回补修订 [设计文档](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md)，升补丁版本并在变更记录列明。**禁止两套规范并行** |
| 四份 JSON Schema | 同步 `parse` / `gate` / `meta` 的校验与 [`PROTOCOL_dual_critic_relay.md`](../03_api/PROTOCOL_dual_critic_relay.md) |
| CLI 参数或退出码 | `USAGE` 字符串、PROTOCOL 文档、相关 SKILL.md |
| 探针项 | 设计 §3.5 的清单与 [M0 坑清单](../05_testing/REPORT_2026-09-11_m0_probe.md) |
| BRIEF 段落 | **八段结构是契约**，增删段会让所有既有段号引用错位。新内容并入现有段 |
