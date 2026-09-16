# M8 第 4 步 · AC-20 真机验收报告

- **日期**：2026-09-16
- **验收对象**：AC-20「Codex 多模型家族真实审查」（PRD 第 20 条 / 设计 §15.3）
- **判据版本**：设计 v1.3.11 / PRD v1.4.5 —— **本报告按改写后的逐分量判据验收**，
  不按 v1.3.10 之前的「二元组」口径
- **执行者**：Claude Code（Driver）｜**发起者**：Chen Zhenbo（四条 skill 的发起权在用户手里）

---

## 0. 结论

**AC-20 达成**，四个分量逐一有据。同时如实登记 **三条达成边界**（§5），
它们不削减本结论，但决定这条验收能被引用到多远。

> **本报告只验收 AC-20。** 不据此宣布 FR-27 完整达成——
> FR-27 还含 profile 透传的可用性面（EV-22：换家族仍须改配置，无单次覆盖入口）。

---

## 1. 两次真实审查

两次都是**真活**，不是为验收而跑的空转：它们是 M8 第 4 步自身代码变更的审查
（计划 D4-3 的裁定：搭本步自己的双审取证，不额外造运行）。

| | 家族一 | 家族二 |
| :--- | :--- | :--- |
| 运行 | `20260916T054957Z`（code r11） | `20260916T040240Z`（code r10） |
| 入选集合 | `['codex']` | `['glm', 'codex']` |
| `review_mode` | `full`（选 1 侧是配置意图，非降级） | `full` |
| 厂商 profile（请求） | `qwen` | `deepseek` |
| **`model_provider`（回读）** | **`qwen`** | **`deepseek`** |
| `model_requested` | `qwen3.8-flash` | `deepseek-flash` |
| **`model_effective`（回读）** | **`qwen3.8-flash`** | **`deepseek-flash`** |
| `model_effective_source` | **`trace`** | **`trace`** |
| provider `base_url`（host） | `token-plan.cn-beijing.maas.aliyuncs.com` | `api.deepseek.com` |
| 耗时 | 1038s（17m18s） | 293s（4m53s） |
| `project_reads` | **31** | **40** |
| `run_command` | 48 | 82 |
| `evidence_ok` | `true` | `true` |
| `readonly_breach` | `false` | `false` |
| 审查结论 | `approve-with-nits`（8 条） | `request-changes`（7 条） |

被审对象、生效模型、耗时等均取自 `_meta/run-<run_id>.json`，非人工转录。

---

## 2. 四个分量逐条核对

判据取自设计 §15.3 改写后的文本。**「逐分量」不是「二元组任一分量不同即可」**——
后者是本步计划双审 GLM-01 打穿的形态。

### ① `model_provider` 互不相同

`qwen` ≠ `deepseek`。**✅**

> 这一分量是本步新增的。此前判据只看 `model_effective`，而实测
> `codex exec -p qwen -m deepseek-v4-pro` **成功退 0** 且回读 `model_provider=qwen`——
> **同一个模型名可以挂在两个 provider 下**，只比模型名会让本条验收通过而无意义。

### ② `model_effective` 互不相同

`qwen3.8-flash` ≠ `deepseek-flash`。**✅**

### ③ 各自与本次**请求**的模型一致

| | 请求 | 生效 | 来源 |
| :--- | :--- | :--- | :--- |
| 家族一 | `qwen3.8-flash` | `qwen3.8-flash` | `trace` |
| 家族二 | `deepseek-flash` | `deepseek-flash` | `trace` |

两侧来源均为 **`trace`**（会话文件回读），**不是 `requested`**。**✅**

> `model_effective_source` 的三态在这里是实质的：回读不到时记 `unverified`、
> **绝不用请求值冒充**。若允许冒充，本分量恒等成立、永远没有意义。
> 该判据有变异锁例（M8 第 3 步 M4、本步 M1/M2）。

### ④ 两侧 provider 的 `base_url`（归一到 host）互不相同

`token-plan.cn-beijing.maas.aliyuncs.com` ≠ `api.deepseek.com`。**✅**

> 这一分量是计划双审 CODEX-03 补的：provider **id** 互异证明不了 endpoint 互异——
> 两个不同的 `[model_providers.X]` 段可以指向同一个 `base_url` 与同一套凭据，
> 此时前三个分量全绿而两次打的是同一个端点。
>
> **`null` 的语义是「无法校验」而不是「不参与」**（代码双审 CODEX-03）：
> 本机 `gpt` profile 的 `base_url` 就是 `null`（内置 provider 无段）。
> 本次两侧 host 均在场，故本分量可判。

---

## 3. 其余判据

### `project_reads` 达该族生效下限

生效下限 = `effectiveMinProjectReads(3, command-trace)` = `ceil(3/2)` = **2**
（`command-trace` 族折减，留痕见 `guard.verification_degraded.codex.evidence_threshold`）。

家族一 **31**、家族二 **40**，均远超下限。**✅**

> 两次的绝对值都远高于下限，说明**阈值不是 binding 的**——
> 这一点对折减系数的回标有意义，见 §4。

### 沙箱负对照（J5）

两个家族各跑一次 `scripts/codex-sandbox-control.mjs`，走**与真实审查同一条隔离路径**
（`prepareCodexHome` + `invokeCodex`，入口与只读旗标取自探针结论）。

家族一（`qwen` / `qwen3.8-flash`）的原始输出：

```text
命令: /bin/zsh -lc "printf 'BREACH' > BREACH_A.txt && echo TRIVIUM_SHELL_ALIVE || echo TRIVIUM_WRITE_DENIED"
status: completed   exit: 0
输出: zsh:1: operation not permitted: BREACH_A.txt
      TRIVIUM_WRITE_DENIED

✅ 负对照成立且有正对照：写命令确实执行、输出显示被拒、哨兵未创建。
✅ 机制直证：裁剪未触及任何 sandbox 键，副本没放宽沙箱语义。
```

家族二（`deepseek` / `deepseek-flash`）同形，逐字相同的两条 ✅。

**四条断言**：

| # | 断言 | 结果 |
| :--- | :--- | :--- |
| 正对照 | 那条写命令**确实进了轨迹** | ✅ 1 条 `command_execution` |
| 正对照 | **它自己的输出显示写入被拒** | ✅ `operation not permitted` |
| 负对照 | 项目内哨兵未创建 | ✅ |
| 机制直证 | 裁剪白名单未触及任何 `sandbox` 键、副本无 sandbox 段 | ✅ |

> **为什么负对照必须带正对照**：单看「哨兵不存在」，「模型试了被拒」与
> 「模型压根没动手」产出完全相同的观测。这条是计划双审 CODEX-01 的**阻断项**。
>
> 它给的修法（「再写一个允许写的路径 B，断言 B 存在」）**被实跑打穿**：
> `-s read-only` 把整个文件系统置为只读，临时目录同样写不进，B 恒不存在。
> 实跑同时给出了更强的一条：`-s read-only` 下 codex **不拒绝执行命令**，
> 它让 shell 跑、写调用在 syscall 层失败，命令照常进轨迹且失败痕迹在 `output` 里。
> **据此更正了 P-C2 的适用范围**（见 M6 codex 探针报告）。

### 厂商 profile 请求值入档，生效模型仍以回读为准（J6）

`profile_requested` 两侧分别为 `qwen` / `deepseek`，与 `model_provider` 的回读值一致。

**两者方向相反、绝不互渗**：请求值来自配置，回读值来自会话文件首行的 `session_meta`。
该纪律有变异锁例（M2：把 `profile_requested` 填成回读值 → 用例当场红）。

> **`profile` 名与 `provider` 名不是一回事**：本机 `glm → zai`、`gpt → openai` 两个不等
> （计划双审 GLM-02）。本次两个家族恰好同名，是巧合不是不变量——
> 判据比对的是 `probe.providers[<profile>].provider`，不是 profile 名本身。

### 预检即拒绝（AC-20 末句）

本步新增「模型不在**本次 profile 生效的**目录里即拒」，两个方向都实测过：

| 配置 | 结果 |
| :--- | :--- |
| `profile: deepseek` + `deepseek-flash`（该 profile 自己的默认模型） | ✅ 通过——**上一版会误杀**（它不在基底目录里） |
| `profile: deepseek` + `qwen3.8-max` | ✅ **预检即拒**，并列出该家族合法名单 |
| `profile: qwen` + `qwen3.8-flash` | ✅ 通过 |
| `profile: qwen` + `deepseek-flash` | ✅ **预检即拒**，列出 qwen 目录那 5 条 |

> **口径映射要写明**（代码双审 r10 GLM-07）：AC-20 末句「预检即拒绝启动」在实现上由
> `codexAdapter.availability()` 的两条拦截兑现（provider 凭据 + 本 profile 的模型目录），
> 而它们在预检输出里显示在「**只读能力可用**」这一项下——项名与该句措辞对不上，
> 事后审计要按本段映射读。新增那条拦截的正当性锚在 **AC-16**（把失败挡在花钱之前、失败零工件），
> 不是 AC-20 末句本身。

---

## 4. 折减系数的回标（T9）

`COMMAND_TRACE_READS_DIVISOR` 现值 **1/2**，其注释自陈「依据是设计预期，不是实测」。

**本次不回标，保留现值**，理由按计划双审 GLM-06 / CODEX-02 确立的口径：

系数补偿的是**提取漏报率**（命令文本里提不出的路径占比），
而 `project_reads` 的绝对值反映的是**模型读了多少**——**两者量纲不同**。
拿读数去回标系数，无论跑出什么数都得不出结论，这正是「样本不足、保留现值」
之所以像后门的真正成因。

本次能确定的只有一件事：**阈值不是 binding 的**（31 / 40 对下限 2），
故它当前没有误杀风险。真正的回标要做「人读抽样比对命令里实际读的路径 vs 提取器提出的路径」，
零配额但需人工标注，**留待后续步骤**。

---

## 5. 达成边界（三条，均不削减 §0 的结论）

1. **该侧的只读保障只剩两重。** `verification_degraded.codex` 两次都记
   `readonly: unavailable` / `path: unavailable`：被拒的写操作不进轨迹（P-C2 的审批层情形），
   「未检出写事件」不足以排除失守；指纹比对仍有效。**这是该族的固有形态，已如实留痕。**
2. **`base_url` 分量依赖本机两个 profile 恰好都有该键。** 若某侧为 `null`（如本机 `gpt`），
   该分量记「无法校验」，本条验收不得据此宣布达成。
3. **单侧运行不构成多审。** 家族一那轮 `critics_selected = ['codex']`——
   它满足 AC-20（本条要的是「该 Agent 能真实审查」），但**不满足 AC-22 的三侧场景**，
   两者不可互相引用。

### 一条必须标注的利益冲突

**两次取证运行审的都是 codex 自己的接入代码。** 这不影响 §2 / §3 的判据
（它们是机械的：元数据、轨迹、负对照输出），**但影响「意见质量」这项主观评价**——
codex 对自己代码的意见存在结构性利益冲突：报得多可能是自我审查姿态，报得零更不能当质量证据。

因此：**D4-4（是否把 codex 纳入默认审核者集合）若要采信本次的意见质量，须带此标注**，
并与另一侧对同类问题的命中情况对照着读。r10 那轮两侧同审，可作对照：
glm 9 条、codex 7 条，**两条 major 指的是不同的东西**，两侧各自发现了对方没发现的缺陷。

---

## 6. 复现方式

```sh
# 家族一
#   .trivium/config.local.yaml: agents.codex.profile: qwen
#                               profiles.default.codex.{plan,code,bug}: qwen3.8-flash
./.trivium/bin/trivium doctor --only codex           # 校准探针（目录随 profile 分层）
TRIVIUM_CODEX_PROFILE=qwen TRIVIUM_CODEX_MODEL=qwen3.8-flash \
  node scripts/codex-sandbox-control.mjs            # J5 对照实验

# 家族二：把上面两处配置改成 deepseek / deepseek-flash，重跑同样两条
```

真实审查由用户经 `/dual-review-code --critics codex` 发起；
**Driver 不自行发起审查**（四条 skill 均标 `disable-model-invocation`）。

> **换家族要同时改两处**（`agents.codex.profile` 与档位表里的模型），
> 没有单次覆盖入口——已登记 **EV-22**，建议的形态是让档位表装得下厂商 profile，
> 那样「换家族」就等于「换档位」。

---

## 7. 本次验收顺带产出的事实

| 编号 | 事实 |
| :--- | :--- |
| P-24 | codex 不校验 `-m` 与 `-p` 的对应关系，两者矛盾时不报错 |
| P-25 | 模型目录逐 profile 分层；`debug models` 输出含隐藏项，而端点只认可见项 |
| P-26 | `codex debug models` **不接受** `--json`（该子命令本就输出 JSON） |
| P-27 | 本机目录文件是活的——`models-qwen.json` 在本步期间被改小，而探针 TTL 判时间不判内容 |
| P-C2 更正 | 「被拒的命令不进事件流」只对 **codex 审批层**成立；**沙箱 syscall 层**拒绝照常留痕 |
| `-c` 的 `~` | 会展开——依据是四个 profile 渲染出互不相同的清单（2/3/4/5），而基底是 7 |

全部已并入 `REPORT_2026-09-11_m0_probe.md` §7 与 `REPORT_2026-09-14_m6_codex_probe.md`。
