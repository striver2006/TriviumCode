# r5 五条落地后的真实链路留痕（2026-09-21，本主题收口）

- 对应：`.reviews/zcode-provider配置注入/code/2026-09-21-zcode-provider配置注入-r5-response-claude.md` §二
- 入口同前三轮：只走全量校验 / 全局副本刷新 / `trivium doctor`。
- **未打印任何配置文件内容**。

## 1. 全量校验

```
ℹ tests 1517
ℹ pass 1515
ℹ fail 0
ℹ skipped 2
```

较 r5 送审时（1515 / 1513）+2 条，都在 `test/unit/zcode-provider-env.test.ts`：
旗标探针退 0 仍记接受但要出声（§2.2）、宿主预置两个 provider 变量时 doctor note 说明独占（§2.4）。
后者补上的正是 r4 §五 判断 3 那个被证伪的借口。

## 2. `./.trivium/bin/trivium doctor --only zcode --no-model-calls`

零配额，退 0，**无告警**：

```
  [zcode] readonly_flags 接受=["--mode plan","--mode yolo","--disallowed-tools Write,Edit,MultiEdit,ApplyPatch,Bash"]；
          拒绝=["--allowed-tools Read,Grep,Glob","--max-turns 40","--permission-mode plan","--settings /nonexistent-probe-settings.json"]
✓ 未发现阻断级问题
```

**没有退 0 告警**，这正是本轮新判据要确认的：真实 CLI 仍停在模型层（`Model creation failed` 退 1），
零配额前提成立。告警只在前提被打破时出现——它是异常信号，本次本就不该出现。
宿主预置告警同样未出现（本机 shell 没设这两个变量），两条都由用例覆盖。

| 落点 | 证据 |
| :--- | :--- |
| §2.1 版本前提 | 纯文档（常量注释 + 设计 §3.5）+ 登记 EV-85 |
| §2.2 退 0 出声 | 新用例锁「七次全靠退 0 判接受 ⇒ 告警出现、blockers 仍为空」；真实 CLI 无告警 |
| §2.3 version 探针 `killTree` | 入口与版本照常探到，未破坏 version 子命令 |
| §2.4 hostPreset 用例 | 新用例实跑 `runDoctor`，断言 note 含「独占」字样 |
| §2.5 脱敏 | 五处 CLI stderr 外泄点接 `redactSecrets()`；RUNBOOK §六 增一节 |

**未验到**（与前三轮同界）：`killTree` 的真实收割、`provider_config_unresolved` 的真机触发、
正向证据列表在别的机器/别的 CLI 版本上的覆盖度（EV-86 是让这条冻结可见的那一项）。
`redactSecrets()` 的真实命中也未验到——本机 stderr 里没有凭据形态，用例覆盖的是它被调用、
不是它能识别某种真实回显；这一层的残量在 EV-84 的实施说明里也记了同源约束。
