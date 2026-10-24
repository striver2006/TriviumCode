# 网关凭据传法：方案对比与实测计划（Bug 清单 §3.1 第 14 条，2026-10-24）

## 现状与缺口

`settings_env_source: user_settings` 开启时，`resolveClaudeRoute` 从 `~/.claude/settings.json` 的 env 段
提取 `ANTHROPIC_*` / `CLAUDE_*` 键（CC Switch 写入的网关配置，含凭据），`invokeClaude` 经 `mergeSettingsEnv`
把它并进 `--settings` 的**内联 JSON**。内联载荷出现在 claude 子进程的 argv 里——本机任何能列进程命令行的
进程都看得到（日志与留痕里的命令行已由 `scrubGatewayEnv` 脱敏，进程表没有）。

当时选内联的依据（claude-route.ts 注释）：`--restricted` 忽略 user/project/local settings **文件**，
但**仍认内联** `--settings`——内联是当时已实测的、受限模式下唯一生效的通道。

## 方案 A：经子进程环境变量传入

- **机制**：spawn claude 时子进程 env 带网关键值；`--settings` 不再内联 env 段（`permissions.deny` 等
  非凭据注入照旧内联，不受影响）。
- **暴露面**：命令行（本机所有进程可见）→ 环境块（同用户进程可见；Windows 上无便捷的跨进程环境读取，
  POSIX 上 `/proc/<pid>/environ` 仅属主可读）。**严格小于现状**。
- **无落盘**：不产生任何临时文件，无残留清扫问题。
- **实现面**：`invokeClaude` 的 env 拼装处注入 `route.settingsEnv`（在 `claudeRouteEnv` 清除父进程
  `ANTHROPIC_*` 之后注入，与路线隔离的先后次序要固定）；`mergeSettingsEnv` 停用 env 段。
- **生死判据（未知数 1）**：`--restricted` 是否忽略**进程环境变量**形式的 `ANTHROPIC_BASE_URL` /
  `ANTHROPIC_AUTH_TOKEN`。若与 settings 文件同批被忽略，A 直接不可行。未实测。

## 方案 B：`--settings` 指向 0600 临时文件、用完即删

- **机制**：env 段写进临时文件（0600），传文件路径，调用后删。
- **暴露面**：文件短暂落盘。POSIX 上 0600 仅属主可读（同用户仍可读，与 A 的 env 同级）；
  **Windows 上 Node 的 chmod 只支持只读位，0600 等于不设防**（Bug 清单 §3.1-1 权限位语义降级族），
  同用户进程可读。仍小于现状（现状是全进程可见的命令行）。
- **残留风险**：进程被硬杀时「用完即删」做不到，需要台账 + 下次清扫（doctor-temp 同款机制，run_dir 内
  已有可复用的清扫链）。
- **生死判据（未知数 2）**：`--restricted` 是否忽略**命令行显式指定的 settings 文件路径**。
  若它与 user/project/local 文件同批被忽略，B 不可行。未实测。

## 共同的只读不变量验证

两个方案都不触碰 `--restricted` / `--strict-mcp-config` / `--tools` 只读旗标组合；生效形态下须与现状
行为一致（只读面不因传法变化）。实测时一并核对。

## 推荐

**首选 A、备选 B**：A 的暴露面、落盘、实现面全面占优；B 的 0600 在 Windows 降级 + 硬杀残留两个坑
都是已知残余族。判据都过不了则维持现状（内联）并在 Bug 清单记「无更优传法」。

## 实测计划（动用凭据、花少量配额；经同意后执行）

真实 claude、`--restricted` 模式，每形态一次模型探活级调用（一次几秒、几条消息）：

1. **对照组（现状·内联）**：照现状调一次，确认基线可用（历史已证，补一次当轮对照）。
2. **A 形态**：去掉 `--settings` 的 env 段，网关键经子进程 env 注入。不报「未登录」且正常回复 = 生效。
3. **B 形态**：env 段写 0600 临时文件、`--settings <文件>`。同判据。
4. 生效形态追加一次**只读不变量核对**：与现状相同的只读旗标组合下行为一致（被拒工具仍被拒、
   readonly_breach 检测不变化）。
5. 凭据不经终端：脚本直接从 `~/.claude/settings.json` 读取（不打印），输出里核对无键值。

每步的退出码与结论记入本目录；改代码属于改调用链，按用户当时指示决定是否走 /dual-run。
