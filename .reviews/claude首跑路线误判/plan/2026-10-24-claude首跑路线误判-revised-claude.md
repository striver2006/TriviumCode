---
schema: trivium.disposition.v1
topic: claude首跑路线误判
stage: plan
role: claude
kind: revised
run_id: 20261024T065502Z
addresses:
  - 2026-10-24-claude首跑路线误判-codex.md
  - 2026-10-24-claude首跑路线误判-gemini.md
  - 2026-10-24-claude首跑路线误判-glm.md
---

# 裁决：claude首跑路线误判 · 计划三审第 1 轮

> 被审对象：`plan/2026-10-24-claude首跑路线误判-claude.md`（r1，基线 `db876910`）。
> 评审循环第 1/3 轮：codex `pass`（零意见），gemini `pass`（1 nit），glm `pass-after-changes`（3 minor）。计票 2 通过 / 1 修改后通过 / 0 不通过 → 通过。
> 4 条：全部接受。合入后的计划见 `plan/2026-10-24-claude首跑路线误判-r2-claude.md`。
> 裁决前核过的依据：`src/trivium/adapters/claude-route.ts:107-143`（native 缺省配置下指纹七项的取值来源）；`src/trivium/preflight.ts:398-492`（`checkCliVersions` 按所选路线比对现场版本与探针记录，不一致判失败并给校准目标——gemini 总判断里「已有 preflight 版本核验兜底」一句据此成立，一并写进边界）；`src/trivium/adapters/claude.ts:454-465`（目录指纹对入口与 native 二进制取哈希）。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | nit | 接受 | 成立：块内既然已有副本，再混用 `opts.config` 只会让读者疑心两者不同；浅拷贝下 `cfg.review` 与调用方共享同一引用，换写法不改变「绑定真实项目配置」的语义，既有用例 `claude-structured-probe.test.ts:273` 的引用相等断言照样成立 | r2 D1「改法」：块内除进入条件那一行外，`opts.config` 全部换成 `cfg`，含 `claudeSensitiveGlobsHash` 三处（`claude.ts:1754`、`1760`、`1765`）；注释写明 `cfg.review` 就是调用方的 `review` |
| GLM-01 | glm | minor | 接受 | 成立：修复后比对两侧读同一份盘上结论，缺省 native 配置（未配 `agents.claude.bin`、未开 `settings_env_source`）下七项指纹没有一项会在探测期间变，这条 blocker 对该形态恒不触发；r1 的边界清单漏了这条直接推论，照它写 §12 与 Bug 清单会让人以为 native 路线仍有「探测期间变化」保护。修复前同一形态也只会被写回误触发、从未真正检测过环境变化，所以不是本主题新开的口子，但必须写明 | r2 第一节边界清单补第三条（含「剩下的保护是目录臂窗口内的目录指纹与下一次预检的版本 / 入口核对」）；同句进 D3 的 doctor 注释、第五节 §12 新段与 Bug 清单第 15 条闭合文；第三节新增边界锚 N4（native 缺省配置，目录桩在窗口内改入口二进制内容并改 `settings.json`、新放 `~/.local/bin/cld`：无该 blocker、路线照常登记、仅目录事实作废）；不改指纹组成 |
| GLM-02 | glm | minor | 接受 | 成立：`.trivium/bin/trivium` 与用户终端的短名都指向全局安装副本，不是本次工作树的构建；真实验收要花配额，验错对象代价最高 | r2 第六节第 4 步写明入口：夹具项目里直调仓库构建产物 `node 〈仓库〉/skills/dual-critic/scripts/trivium.cjs doctor --only claude --json`，`TRIVIUM_ASSET_ROOT` 指向仓库资产根；跑前记下该产物的 sha256 与构建标识（HEAD、dirty），报告里写明实际入口与构建来源；不走 wrapper、不需要先重装 |
| GLM-03 | glm | minor | 接受 | 成立：首跑引导本是 Windows 线引入、两平台共用，新套件在 win32 跳过，Windows 侧从此没有这条行为的回归锚；EV-253 的 Windows 实测还没做，不登记的话做实测的人清单里不会有这一项 | r2 第五节：新报告「已知边界」与 Bug 清单第 15 条闭合文各登记一句「EV-254 回归锚只在非 win32 运行；Windows 侧待 EV-253 实测时顺带复核：CLI 升级后与全新项目首跑 `doctor --only claude` 应退 0、无该 blocker、`routes` 按新版本登记」；Bug 清单里 Windows 实测待办那一条同步加一句指向第 15 条 |

## 不改动的部分

codex 零意见；gemini 与 glm 其余认可项（候选 A 的取舍、R1～R4 与四项环境类指纹一一对应、M1 / M2 一正一反、N1 两条强断言的推导、D4）不需改动。
