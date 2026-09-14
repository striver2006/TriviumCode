# Codex `exec --json` 事件流录制样本

**这些是真跑出来的输出，不是手编的。** 计划 §6.2 把这条写死：手编的 fixture
只能证明「解析器能解析我以为的格式」，而探针存在的全部理由是**我以为的格式可能不对**。

录制于 **2026-09-14**，`codex-cli 0.154.0`，本机 macOS 26.0（Darwin 25.6.0）。

| 文件 | 原始命令行 | 录它是为了固定什么 |
| :--- | :--- | :--- |
| `read-sentinel.jsonl` | `codex exec -p deepseek -m deepseek-flash -c model_reasoning_effort=low -s read-only --json -C <夹具> "读取文件 <夹具>/sentinel.txt 并只回显它的第一行"` | 事件类型图谱、读文件走 shell 命令而非专用工具、`usage` 形状 |
| `readonly-denied.jsonl` | 同上，提示词改为「在当前目录创建文件 breach.txt」 | **只读沙箱拒绝写入时，轨迹里什么都不剩** |
| `header-stderr.txt` | `codex exec -p deepseek --skip-git-repo-check "x" < /dev/null 2>&1 1>/dev/null \| head -14` | **header 走 stderr**，以及五个标签的逐字拼写 |

> `header-stderr.txt` 是 **stderr**，另两份是 **stdout**。这不是笔误：
> codex 0.154.0 把生效配置打在 stderr、把模型回复打在 stdout。
> 手工验证时习惯写 `2>&1` 所以两者混在一起看得见，代码里只挂 stdout 回调
> 会一行 header 都收不到——本步真机第一遍就栽在这里，
> 于是五个派生字段全拿成 null，而 null 又让判据静默判反。

## 两条录制时坐实的事实

**① 读取路径没有结构化字段。** codex 读文件是让模型跑 shell：

```
{"type":"item.completed","item":{"type":"command_execution",
 "command":"/bin/zsh -lc 'head -n 1 /tmp/.../sentinel.txt'",
 "aggregated_output":"SENTINEL-OPEN-7f3a2b91\n","exit_code":0,"status":"completed"}}
```

路径只在 `command` 文本里。agy 与 zcode 的读事件都带独立路径字段，codex 没有——
所以 codex 侧的 `project_reads` 下限与禁读核验**只能靠命令文本解析**
（BACKLOG EV-01 的「措施 b」对另两家是补充手段，对 codex 是唯一手段）。

**② 被沙箱拒绝的命令完全不进事件流。** `readonly-denied.jsonl` 里
`command_execution` 事件数为 **0**，而模型的最终回复明说它试了两条写入途径、
都被拒（`operation not permitted` 与 `blocked by read-only sandbox`）。

写入**确实被挡住了**（沙箱有效，不是安全漏洞），丢的是「审查员尝试过写入」这个
行为信号——设计 §10.3 的「轨迹有写事件即判失守」对 codex 侧**恒为假**。

## 为什么 header 也要有样本

事件流有「图谱变了就重录」的守卫（`codex-events.test.ts` 第一条用例），
而 header 原先一个测试都没有——防护不对称。codex 若把 `reasoning effort`
改成 `effort`，`parseHeaderLines` 会全部落空、五个派生字段集体变 null，
**没有任何测试变红**。所以它与事件流样本同等对待（审查意见 GLM-07）。

## 重录的时机与办法

`preflight` 比对 CLI 版本漂移时会提示重跑 doctor；CLI 升版后这三份样本可能与现实分叉，
而**测试仍会全绿**（它们只喂给解析器）。所以升版后要按上表的原始命令行**逐份**重录，
并更新本文的版本号与日期。这条是 M6 计划 §8 第 3 问自认的最大缺口，
处置就是把重录办法写在这里，而不是指望下一个人记得。
