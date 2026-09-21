# r3 八条落地后的真实链路留痕（2026-09-21）

- 对应：`.reviews/zcode-provider配置注入/code/2026-09-21-zcode-provider配置注入-r3-response-claude.md` §二
- 入口同 r2：只走 `npm run check` / 全局副本刷新 / `trivium doctor`，不手搓脚本复刻内部逻辑。
- **未打印任何配置文件内容**（两份 provider 配置只做存在性判断）。

## 1. `npm run check`

```
ℹ tests 1512
ℹ pass 1510
ℹ fail 0
ℹ skipped 2
```

较 r3 送审时（1509 / 1507）+3 条，全部落在 `test/unit/zcode-availability.test.ts`：
布局判据本身、布局与旗标同时成立时的**顺序**守卫、旧结论缺格（`undefined`）不误拦。
`test/unit/zcode-provider-env.test.ts` 条数不变（14），但两条 `invokeZcode` 用例改传
`userHome` 并新增 `personal === null` 直接断言——这正是 r3 CODEX-F01-02 指出的假阴性。

## 2. 全局副本刷新

29 个文件写入 `~/.claude/skills/dual-critic/…` 等；下面的 doctor 走的是刷新后的副本。

## 3. `./.trivium/bin/trivium doctor --only zcode --no-model-calls`

零配额，退 0，逐字抄录关键几行：

```
  [zcode] 可用模型 4 个（含短名与全限定形态）：GLM-5.3, GLM-5.3-Flash, bigmodel-coding-plan/GLM-5.3, …
  [zcode] provider_config：内置=/Applications/ZCode.app/Contents/Resources/config/provider/zcode-builtin.json；
          个人=/Users/chenzhenbo/.zcode/v2/provider_config.json（个人那份按用户目录 /Users/chenzhenbo 取）
  [zcode] readonly_flags 接受=["--mode plan","--mode yolo","--disallowed-tools Write,Edit,MultiEdit,ApplyPatch,Bash"]；
          拒绝=["--allowed-tools Read,Grep,Glob","--max-turns 40","--permission-mode plan","--settings /nonexistent-probe-settings.json"]

✓ 未发现阻断级问题
```

| 落点 | 证据 |
| :--- | :--- |
| §2.4 version 探针清两个键 | 入口与版本照常探到（模型清单能采出来说明 `zcode.cjs` 起得来），清底色未破坏 version 子命令 |
| §2.7 第三态判据补退出码门控 | 本机定位成功 ⇒ `indeterminate` 为空，旗标判定照常（接受 3 / 拒绝 4） |
| §2.6 `DoctorReport.warnings` | `indeterminate` 为空 ⇒ 无告警行，退 0——新档位不误伤正常路径 |

**未验到**（与 r2 同）：`provider_config_unresolved` 的真实触发路径要故意破坏 ZCode 安装布局；
旗标第三态与 `warnings` 的真实触发同此。两者均由假入口用例覆盖，不在真实安装布局上做破坏性实验。
`killTree` 的实际收割行为也未在真机验证——它只在「第三态前提被破 + 七次调用超时」时才生效，
构造该条件需要真实模型调用。
