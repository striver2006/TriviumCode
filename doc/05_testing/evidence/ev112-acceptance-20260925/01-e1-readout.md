# EV-112 E1 零配额验收读数（2026-09-25）

- **被验代码**：`1d80e23`（EV-112 实施提交，代码双审 r1 收口）
- **安装副本**：干净工作树 `npm run build` 与 `npm run install:local` 各一条后，`trivium doctor --only env --no-model-calls` 读数「编排器构建标识：1d80e23 … 本仓模式：安装副本与当前工作树一致」
- **脚本与输出**：`e1-acceptance.mjs` / `e1-output.json`（同目录）
- **依据**：计划 `.reviews/EV-112-无副本审查运行载体落点/plan/` r3 §6.3 E1

## 做法

- 宿主 `ZCODE_*` 键为空（脚本断言，不为空即停）；
- 合成 `cli/config.json`（custom provider，`baseURL` 指向脚本自起的 `127.0.0.1` 服务、apiKey 为探针哨兵），本地服务一律回 401，不读任何真实配置的值；
- 所有目录来自 `mkdtemp`，脚本不含删除调用；所有 argv 元素断言不匹配 beta 改写的 argv 判据；
- 运行组（每次新的 mkdtemp HOME，组间交替顺序，每组 3 次）：
  - **N**：无副本支，经 `zcodeAdapter.run`（`model: null`）；
  - **A / B**：无副本形态，经 `invokeZcode` 直调，不设 / 设落点根；
  - **C / D**：副本支，同一份新代码经 `prepareZcodeHome(…, { requestedFirst: true })` 造副本，不设 / 设落点根。

## 判据与读数

| 判据 | 结果 |
| :-- | :-- |
| N 的 log / rollout / db 落在 `<运行目录>/glm/home/.zcode/cli/` | ✓（各 1） |
| N 的假 HOME 下没有 log / rollout / db / artifacts / memories / sessions / debug | ✓ |
| B 三轮都落在指定根、假 HOME 下为 0 | ✓ |
| A 三轮都落在假 HOME（对照组） | ✓ |
| **C / D 三轮落盘集合逐字相同**（会话 id 与日期归一后）、plugins 文件数相同、rollout 前缀相同 | ✓ ✓ ✓（D2-(a) 的旁证：副本支设三键不改布局） |
| 所有运行都没有 `.zcode-beta/` | ✓ |
| 每次运行的模型请求都只打到本地服务 | ✓ |
| **真实 HOME 未被写入**（按内容核：`~/.zcode/cli/log` 各文件里本次 13 个会话的出现次数、rollout / artifacts / sessions 下的会话名、`db.sqlite` 及其 `-wal` / `-shm` 里的出现次数；`~/.zcode-beta`、`~/.zcode/mailbox` 的存在性） | ✓（全为 0 / 不存在） |
| doctor（`--only zcode --no-model-calls`）：宿主未预置时不出十一键 note、入口不在 beta 路径时不出 beta note、文案不含「持久留存」 | ✓ |

N 在 401 后非零退出，`run()` 在失败早退处返回，`carriers_landed` 缺席——计划 r3 §6.3 已写明 E1 到不了回读与自检，那两段由假入口用例（U3 / U3b / U8 / 跨午夜）与变异 M4 / M9 / M11 / M13～M16 覆盖。

## stderr 首行（计划双审第 1 轮 GLM-01 的重复取样）

| 运行 | 设落点根 | stderr 首行 |
| :-- | :-- | :-- |
| N | 是 | `ZCode Built-in missing` |
| A1 / A2 / A3 | 否 | `ProviderBusinessError: e1 local sentinel: unauthorized` |
| B1 / B3 | 是 | 同上 |
| B2 | 是 | `ZCode Built-in missing` |
| C1 / C2 / C3 | 否 | `ProviderBusinessError …` |
| D1 | 是 | `ZCode Built-in missing` |
| D2 / D3 | 是 | `ProviderBusinessError …` |

E1 里这一行只出现在「设落点根」的运行（7 次里 3 次，不设的 6 次里 0 次）；而 E0 里它只出现在**不设**的对照组。两次合起来，两种形态都出现过，所有运行 HOME 侧的 `zcode-builtin*.json` 都是 2 份。
**判读：未观察到稳定关联**（计划 r3 §6.3 三档之二）。样本只够说明「这一行不稳定地跟随任一形态出现」，不下「与三键无关」一类的因果结论；它不影响任何一条落点判据，也不影响模型请求的发出。机理未定位。

## 临时目录

`$TMPDIR/ev112-e1-*`（本次）与 `$TMPDIR/ev112-e0-*`（E0 三轮）都还在，去留由用户定。
