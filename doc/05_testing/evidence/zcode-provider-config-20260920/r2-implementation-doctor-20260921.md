# r2 十三条落地后的真实链路留痕（2026-09-21）

- 对应：`.reviews/zcode-provider配置注入/code/2026-09-20-zcode-provider配置注入-r2-response-claude.md` §二 / §六
- 目的：回应 r2 CODEX-05 的一半——「补丁里没有任何真实链路的留痕，实测全是手工 node 调用」。
  本轮**只走编排器入口**（`npm run check` / `install:local` / `trivium doctor`），不再手搓脚本复刻内部逻辑。
- 机器：macOS，`/Applications/ZCode.app`（`0.16.9`），node v25.2.1。
- **未打印任何配置文件内容**：两份 provider 配置只做存在性判断（`~/.zcode/v2/provider_config.json` 0600 含凭据）。

## 1. `npm run check`

```
ℹ tests 1509
ℹ suites 0
ℹ pass 1507
ℹ fail 0
ℹ cancelled 0
ℹ skipped 2
ℹ todo 0
```

用例由 10 条增至 14 条（新增：软链入口派生、入口不存在时词法回落、exit 0 + stderr 含同名词的负例、
宿主环境预置诱饵变量后子进程必须拿不到）。

> 附注：`node_modules/typescript` 缺 `_tsc.js` / `typescript.js`（2026-09-20 事故清扫波及），
> `npm ci` 重装后恢复；本仓 git 对象库经检查完好，工作树改动就地续做，未重 clone。

## 2. `npm run install:local`

29 个文件写入全局副本（`~/.claude/skills/dual-critic/…` 等）。验证走的是全局副本，不是仓库里的 `dist/`。

## 3. `./.trivium/bin/trivium doctor --only zcode --no-model-calls`

零配额（不发生模型调用），逐字抄录关键几行：

```
· 探测 ZCode（zcode.cjs）…
  [zcode] provider_config：内置=/Applications/ZCode.app/Contents/Resources/config/provider/zcode-builtin.json；
          个人=/Users/chenzhenbo/.zcode/v2/provider_config.json（个人那份按用户目录 /Users/chenzhenbo 取）
          （拉起时经 ZCODE_*_PROVIDER_CONFIG_FILE 注入，0.16.9 起独立拉起必需）
  [zcode] readonly_flags 接受=["--mode plan","--mode yolo","--disallowed-tools Write,Edit,MultiEdit,ApplyPatch,Bash"]；
          拒绝=["--allowed-tools Read,Grep,Glob","--max-turns 40","--permission-mode plan","--settings /nonexistent-probe-settings.json"]
  [zcode] 跳过需要真实模型调用的 ZCode 探针（配置缺失或已显式跳过）——response_field / path_deny / scratch_paths / model_override 保留上一次的结论
  探针结论已写入 …/.trivium/config.local.yaml

✓ 未发现阻断级问题
```

退 0。这一跑同时验到四件事：

| 落点 | 证据 |
| :--- | :--- |
| §2.6 探针 note 写出用户目录（CODEX-03） | note 里的「按用户目录 `/Users/chenzhenbo` 取」 |
| §2.3 入口先 `realpath`（CODEX-04 ≡ AGY-03） | 本机入口无软链，派生结果与词法路径一致，未退化 |
| §2.2 第三态不覆盖结论（CODEX-02） | 无 ⚠️ 未判定行，`readonly_flags` 为本轮判定所得：接受 3 / 拒绝 4，与 0.16.5 的已知真相一致（2026-09-19 那次「七个全接受」的污染不再出现） |
| §2.4 doctor 的两条新 blocker 不误伤（CODEX-06 ≡ AGY-05） | 内置文件在、旗标判定完成且非空 → 0 blocker，`--no-model-calls` 下退 0 |

**未验到**：`provider_config_unresolved` 的真实触发路径与 glm 侧真实审查跑通——前者要故意破坏 ZCode 安装布局，
后者受 **EV-82** 阻断（0.16.9 下 `config_copy` 的 `model.main` 已不生效，glm 会静默跑在个人配置默认模型上）。
两者都用假入口的用例覆盖（`test/unit/zcode-provider-env.test.ts`），不以真实安装布局做破坏性实验。
