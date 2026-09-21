# ZCode 0.16.9 provider 配置定位 · 本机实测原始输出

- 日期：2026-09-20；机器：macOS，`/Applications/ZCode.app`（`node zcode.cjs version` → `0.16.9`）
- 对应坑清单：P-28 / P-29 / P-30（[`REPORT_2026-09-11_m0_probe.md`](../../REPORT_2026-09-11_m0_probe.md) §7）；BACKLOG EV-81
- 全部命令由 Driver（Claude Code 会话）手工执行，输出逐字抄录，只删去 traceId 之外的无关噪声。
  **未打印任何配置文件内容**：`~/.zcode/v2/provider_config.json` 为 0600 含凭据，只做 `ls -l` 与存在性判断。

## 0. 文件存在性

```
$ ls -la /Applications/ZCode.app/Contents/Resources/config/provider/
-rw-r--r--  1 chenzhenbo  admin  182180 Sep 19 09:51 zcode-builtin.json
$ ls -la ~/.zcode/v2/provider_config.json
-rw-------  1 chenzhenbo  staff  3870 Sep 20 06:51 /Users/chenzhenbo/.zcode/v2/provider_config.json
$ ls /Applications/ZCode.app/Contents/Resources/glm/
packages  zcode.cjs
```

约定：`Z` = `…/Resources/glm/zcode.cjs`，`B` = `…/Resources/config/provider/zcode-builtin.json`，
`P` = `~/.zcode/v2/provider_config.json`，`H` = `mktemp -d` 的空目录（充当空 HOME）。

## 1. P-28：不注入时的形态（先于参数解析）

```
$ node $Z version
0.16.9

$ HOME=$H node $Z --prompt ok --cwd . --json --no-color --bogus-flag
无法定位 CLI ZCode Built-in Provider Config：/Applications/ZCode.app/Contents/Resources/glm/provider/zcode-builtin.json, /config/provider/zcode-builtin.json

$ node $Z --prompt ok --cwd . --json --no-color --bogus-flag        # 真实 HOME 同样
无法定位 CLI ZCode Built-in Provider Config：/Applications/ZCode.app/Contents/Resources/glm/provider/zcode-builtin.json, /config/provider/zcode-builtin.json

$ HOME=$H node $Z --prompt ok --cwd . --json --no-color --mode plan >out.txt 2>err.txt; echo $?
1          # stdout 0 字节，stderr 1 行（同上那句）
```

两条候选：`<入口目录>/provider/zcode-builtin.json` 与 `/config/provider/zcode-builtin.json`
（后者是 `<入口目录>/../../../../../config/provider/…` 归一后的结果，源码树布局）。应用包内都不存在。
**`--bogus-flag` 没有报 `Unknown option`**——参数解析没跑到。

## 2. 注入后参数解析恢复

```
$ HOME=$H ZCODE_BUILTIN_PROVIDER_CONFIG_FILE=$B ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=$P \
    node $Z --prompt ok --cwd . --json --no-color --bogus-flag
Unknown option '--bogus-flag'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- "--bogus-flag"

zcode 0.16.9

Usage:
…
```

## 3. 只给一个变量 / 指向不存在的文件

```
$ HOME=$H ZCODE_BUILTIN_PROVIDER_CONFIG_FILE=$B node $Z --prompt ok --cwd . --json --no-color --mode plan
Error: Model creation failed (traceId: aa4c722d-…)

$ HOME=$H ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=$P node $Z --prompt ok --cwd . --json --no-color --mode plan
无法定位 CLI ZCode Built-in Provider Config：…（同 §1）

$ HOME=$H ZCODE_BUILTIN_PROVIDER_CONFIG_FILE=$B ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=$H/nope.json \
    node $Z --prompt ok --cwd . --json --no-color --mode plan
Error: Model creation failed (traceId: a2b592f0-…)
```

结论：**内置那份是定位成败的关键**；个人那份缺失或指向不存在的文件不会更早失败，
只会以「Model creation failed」的面目出现——这就是适配层「文件不在就不给变量」的理由：
指向不存在的路径会把「文件丢了」伪装成「模型建不出来」。

## 4. P-30：两份都给 + 空 HOME → 真实模型调用

```
$ HOME=$H ZCODE_BUILTIN_PROVIDER_CONFIG_FILE=$B ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=$P \
    node $Z --prompt ok --cwd . --json --no-color --mode plan >out2.txt 2>err2.txt
# 进程 2 分 56 秒未退出，手工 kill 后：
exit=143  stdout=97 字节
$ cat err2.txt
AI SDK Warning (anthropic.messages / qwen3.8-max): The feature "cacheControl breakpoint limit" is not supported. Maximum 4 cache breakpoints exceeded (found 5). This breakpoint will be ignored.
Error: Turn was cancelled. (traceId: 3048d1f4-…)
```

空 HOME 下没有 `~/.zcode/cli/config.json`，但个人 provider 配置自带默认模型，CLI 照样起了一个 turn。
`lsof` 看到它在空 HOME 下建了 `.zcode/cli/db/db.sqlite`。
**这意味着 `probeReadonlyFlags` 的「空 HOME 停在配置解析、零配额」前提在两份都注入时失效。**

## 5. 只注入内置那份：停在模型创建、参数解析已完成、进程正常退出

```
$ HOME=$H ZCODE_BUILTIN_PROVIDER_CONFIG_FILE=$B node $Z --prompt ok --cwd . --json --no-color --mode plan >o.txt 2>e.txt
exit=1  stdout=0
Error: Model creation failed (traceId: b916fed6-…)

$ HOME=$H ZCODE_BUILTIN_PROVIDER_CONFIG_FILE=$B node $Z --prompt ok --cwd . --json --no-color --bogus >o2.txt 2>e2.txt
exit=1  stdout=0
Unknown option '--bogus'. To specify a positional argument starting with a '-', place it at the end of the command after …
```

两条都在数秒内退出（`perl -e 'alarm 45'` 的看门狗未触发）。`probeReadonlyFlags` 据此**只注入内置那份**。

## 6. P-29：被污染的探针结论（修前 `.trivium/config.local.yaml`，probed_at 2026-09-19T22:54:45Z，version 0.16.9）

```
readonly_flags:
  - --mode plan
  - --mode yolo
  - --disallowed-tools Write,Edit,MultiEdit,ApplyPatch,Bash
  - --allowed-tools Read,Grep,Glob
  - --max-turns 40
  - --permission-mode plan
  - --settings /nonexistent-probe-settings.json
```

七个候选全部记成「接受」，含 0.16.5 已证实被拒的四个（C-09）。原因即 §1：`Unknown option` 报不出来，
原判据「没报 Unknown 就是接受」整体失真。适配层 `readonlyArgsFromProbe` 只取 `--mode plan` 与
`--disallowed-tools` 两项，故实际 argv 未受污染；失真的是结论文件与 `doctor` 输出。

## 7. 进程归属核对

实验期间 `pgrep -fl zcode-cli` 列出的 69352 / 69353 / 69354 / 69405 四个进程 `HOME=/Users/chenzhenbo`
（真实目录），与桌面端 helper 进程 PID 相邻，属桌面端自身拉起的 CLI，**不是**本实验产物（本实验的子进程
HOME 均为 `/var/folders/…/tmp.*`）。唯一挂起的实验进程 80625（§4）已手工结束。
