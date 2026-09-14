
<!-- BEGIN TriviumCode -->
## 审查员身份说明（TriviumCode）

若你是通过 TriviumCode 编排器以**审查员**身份被启动的（提示词首段会明确声明角色），
则以**提示词首段的角色与禁令为准**，忽略本文件中面向执笔者的任务指令——
那些是给主攻方（Driver）的，不是给你的。

作为审查员你只读不写：不得修改任何文件、不得执行写命令、不得读取任务书中
禁读清单列出的文件。你的结论由编排器落盘，不要自行写文件到仓库。
<!-- END TriviumCode -->

## 项目概览

TriviumCode 是「主攻 + 双审」（Driver-DualCritic）多智能体流水线编排器：
Claude Code 主攻执笔，Antigravity（`agy`）与 ZCode 背靠背只读双审。
TypeScript 编写，esbuild 打成**单文件零依赖 CJS**；仅支持 macOS + VS Code，
Node ≥ 18（开发建议 ≥ 22）。

- `src/trivium/` — 编排器全部实现（`cli.ts` 入口，`adapters/` 收敛两家 CLI 差异，
  `agents/registry.ts` 是 Agent 差异的唯一登记处）
- `src/install.ts` — 安装器（→ `dist/install.cjs`）
- `skills/` — 8 个 Claude 用户级 skill，核心资产在 `skills/dual-critic/`
  （`scripts/trivium.cjs` 为打包产物**不进 Git**；`schema/` 机读契约，含当前形状与只读保留的历史形状、
  `prompts/` `lenses.yaml/`、`hooks/`）
- `test/{unit,contract,integration}/` — 分层测试，共享夹具在 `test/helpers/fixture.ts`
- `doc/` — 工程文档（八个一级子目录，**单层扁平**，文件名带前缀）
- `.reviews/` — 流水线审计留痕（进 Git）

## 常用命令

```bash
npm run typecheck                 # tsc --noEmit（strict + noUncheckedIndexedAccess + noUnused*）
npm run build                     # esbuild 出两个 bundle（会重建 skills/ 下产物）
npm test                          # pretest 自动全量构建（含测试），再 node --test dist/test
npm run check                     # typecheck + build + test，提交前的完整闸门
node --test "dist/test/test/unit/<name>.test.js"   # 构建后跑单个测试文件
```

不引 eslint / prettier，`tsc --strict` 就是静态检查。提交遵循 Conventional Commits
（feat/fix/docs/refactor/test/chore），注释与文档全中文。

## 架构纪律（改代码前必读）

这些不是风格建议，每条背后有踩过的坑，详单见 `doc/04_development/GUIDE_env_setup.md` §四：

1. **适配层只读探针结论，绝不硬编码 CLI 旗标**——两家 CLI 行为与官方文档不符是常态。
   实测与设计冲突时改适配层并回补设计文档，不改外部产品、不改验收口径。
2. **`archive.ts` 是 `.reviews/` 的唯一写出口**：命名生成、`O_CREAT|O_EXCL` 防覆盖、
   `-r<N>` 抬升只在那一处实现。
3. **Hook wrapper 两支语义**：检测不到 `.trivium/config.yaml` → exit 0（全局安装不误伤
   其它仓库）；有 config 但 wrapper 缺失/不可执行 → exit 2（护栏被破坏必须拦）。
   `test/contract/hook-guard.test.ts` 守着这条。
4. **git 快照只用临时索引**（`GIT_INDEX_FILE` + read-tree/write-tree），所有 git 调用
   前缀 `-c core.quotePath=false`（否则中文路径变八进制转义）。
5. **超时一律 Node 侧 `AbortSignal`**（SIGTERM→宽限→SIGKILL）；macOS 没有 `timeout`。
6. **进程存活比对 `ps -o lstart=`**，不能用 `kill(pid,0)`（macOS 复用 PID）。
7. **`state.json` 全局，写入必须持全局锁 + 读改原子替换**；按主题加锁会互相丢更新。
8. **计数禁止读-改-写**：每次增量写唯一文件、计数取 `readdir().length`。
9. **不动用户全局配置**；需要独立配置走临时副本（`0600`，用完即删）。
10. **`agents/registry.ts` 是所有 Agent 差异的唯一来源**（设计 16.2 纪律 7）。归档后缀、
    意见编号前缀、配置键、探针段、镜头键、禁读矩阵、Hook 字面集全部由它派生。
    **除它本身与各厂商适配器内部外，任何模块不得出现具体 Agent id / 后缀 / 前缀的字面量**——
    `test/unit/registry-parity.test.ts` 以 grep 级对账守着，加硬编码直接打红。
11. **禁读矩阵禁止手工枚举。** 人工清单维持不住完整性：计划稿自称补全 4 处硬编码、
    双审又查出 8 处，其中按 `['gemini','glm']` 字面循环的一处会让第三家审核者的意见
    **对闸门整体不可见**（静默漏裁）。一律注册表派生 + 机器对账。
12. **JSON Schema 的枚举与前缀集必须与注册表 parity。** 改了注册表就要同步 schema，
    反之亦然；两边任一单改都属于埋坑。**新增一份机读契约时，对账要跟着建**——
    `registry-parity` 的 schema 扫描是显式路径清单，不会自动覆盖新文件
    （`run.v2` 与 `config.v2` 各漏过一次，都是补出来的）。

## 测试要点

- **契约层守跨文件对账**：改了 `hooks.json` / SKILL.md 的 `argument-hint` / CLI 旗标，
  必须同步另一侧，否则 `test/contract/` 红。
- **集成测试走真实子进程**调打包产物、动真实 git 夹具仓库。凡是「A 进程算的东西
  B 进程要用」，测试必须真起两个进程；故障注入用环境变量 `TRIVIUM_STUB_CRITIC`
  （跨进程生效），且必须断言桩指纹 `cli_version: 'stub/0.0.0'`。
- 不烧配额跑通整条流水线：`trivium doctor --selftest`（桩适配器，14 步）。

## 已知坑

- **改完代码必须重装才生效**：`.trivium/bin/trivium` 指向已安装副本
  `~/.claude/skills/.../trivium.cjs`，不是仓库刚构建的产物。要 `npm run build &&
  node dist/install.cjs` 两步都做；调试可直接 `node skills/dual-critic/scripts/trivium.cjs <子命令>`，
  改 `skills/` 资产可用 `TRIVIUM_ASSET_ROOT=<repo>/skills/dual-critic` 指向工作树。
- `trivium` 有意不在 PATH 上。
- esbuild 必须 `charset: 'utf8'`（默认 ascii 会把中文全部 `\u` 转义）；测试构建需把
  `skills/dual-critic/schema/` 按原相对路径拷进 `dist/test/`。
- 集成产物 `dist/` 与 `skills/dual-critic/scripts/trivium.cjs` 均为生成物，不手改。

## 改动同步清单

| 改了什么 | 必须同步 |
| :--- | :--- |
| 与设计文档不一致的行为 | 先回补修订 `doc/02_design/` 设计文档（唯一实现依据），升补丁版本 |
| JSON Schema（含新增一份） | `parse` / `gate` / `meta` 校验、`doc/03_api/PROTOCOL_dual_critic_relay.md`、`skills/dual-critic/SKILL.md`、**本文件的契约面描述**、`registry-parity` 的 schema 扫描盯防点 |
| CLI 参数或退出码 | `USAGE` 字符串、PROTOCOL 文档、相关 SKILL.md |
| 探针项 | 设计 §3.5 清单与 `doc/05_testing/REPORT_2026-09-11_m0_probe.md`（M0 坑清单） |
| BRIEF 段落 | 八段结构是契约，只并入现有段，不得增删段号 |

改敏感区域（适配层、guard/gate、hooks、schema）前，先读对应设计章节与
`doc/04_development/GUIDE_env_setup.md`。
