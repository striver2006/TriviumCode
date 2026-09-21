# r4 五条落地后的真实链路留痕（2026-09-21）

- 对应：`.reviews/zcode-provider配置注入/code/2026-09-21-zcode-provider配置注入-r4-response-claude.md` §二
- 入口同前两轮：只走全量校验 / 全局副本刷新 / `trivium doctor`，不手搓脚本复刻内部逻辑。
- **未打印任何配置文件内容**。

## 1. 全量校验

```
ℹ tests 1515
ℹ pass 1513
ℹ fail 0
ℹ skipped 2
```

较 r4 送审时（1512 / 1510）+3 条，全部落在 `test/unit/zcode-provider-env.test.ts`：
未识别失败形态全判 `indeterminate`（§2.1）、doctor 的 `warnings` 唯一住户存在（§2.3 ①）、
告警不进 `blockers`（§2.3 ②）。后两条用 `runDoctor` 实跑，临时 `triviumDir` 下无 wrapper
⇒ `checkWrapper` 返回空，不引入无关 blocker；探针结论写进临时目录，不碰真实仓库。

## 2. `./.trivium/bin/trivium doctor --only zcode --no-model-calls`

零配额，退 0。**本轮最该看的一行**：

```
  [zcode] readonly_flags 接受=["--mode plan","--mode yolo","--disallowed-tools Write,Edit,MultiEdit,ApplyPatch,Bash"]；
          拒绝=["--allowed-tools Read,Grep,Glob","--max-turns 40","--permission-mode plan","--settings /nonexistent-probe-settings.json"]
✓ 未发现阻断级问题
```

判据从否定式换成正向证据之后，**本机真实 CLI 的结论没有变**（仍是接受 3 / 拒绝 4）——
说明实测停点 `Model creation failed` 确实命中 `ZCODE_ARGV_PARSED_RE`，新判据没有把正常路径
误判成「本轮未判定」。这是这次换判据最需要确认的一件事：正向证据列表若不覆盖真实停点，
症状就是 doctor 从此再也刷新不了 `readonly_flags`。

宿主预置变量的那条 note（§2.2）本次未出现——本机 shell 里没有预置这两个变量，属预期。
它由 `probeZcode` 读 `process.env` 触发，无用例（判据是一行 `filter`，形态与既有 note 同构）。

| 落点 | 证据 |
| :--- | :--- |
| §2.1 正向证据判据 | 真实 CLI 结论不变（接受 3 / 拒绝 4）+ 新增用例锁「未识别形态全判不出」 |
| §2.2 宿主预置值告警 | 本机未触发；RUNBOOK 排障表已加行 |
| §2.3 warnings 守卫 | 两条 doctor 层用例，`runDoctor` 实跑 |
| §2.4 P-28 观察项 | 纯文档 |
| §2.5 EV-83 grep 锚 | `grep -n 'os\.homedir()' src/trivium/adapters/zcode.ts src/trivium/probes/zcode.ts` 实测 12 行命中、其中 9 处真实取值 |

**未验到**：`killTree` 的真实收割、`provider_config_unresolved` 的真机触发（同前两轮，需破坏真实安装布局）；
以及正向证据列表在**别的机器/别的 CLI 版本**上的覆盖度——这正是判不出就告警、不回落成接受的理由。
