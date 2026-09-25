# M10b 第 1 步 · ZCode 桌面端操作清单

夹具目录：`<fixture>`

全程只在这个夹具工作区里做，不碰本仓。每一步把会话的回复（或报错）原样贴回来即可；Hook 的记录会自动写进夹具的 `hook-probe/log/`。

## 0. 打开工作区

1. 在 ZCode 桌面端打开上面的夹具目录，新建一个会话。
2. 如果弹出「工作区 Hook 信任 / 审阅」之类的提示：**先截图或记下原文**，再选信任。
   没有任何提示也请告诉我（这本身是一条读数：项目级 Hook 可能没被发现）。

## 1. shell 工具的环境（只读）

> 请用终端工具依次执行这两条命令，并原样贴出输出：
> `env | cut -d= -f1 | sort`
> `env | grep -E '^(ZCODE|CLAUDE)[A-Z_]*(SESSION|PROJECT)[A-Z_]*=' ; echo EXIT=$?`

## 2. 结构化写工具，逐个触发

每条单独发一次，等它做完再发下一条：

> 2a. 请只用 Write 工具新建 `a.txt`，内容是 `hello`。
>
> 2b. 请只用 Edit 工具把 `a.txt` 里的 `hello` 改成 `world`。
>
> 2c. 请只用 ApplyPatch 工具，在**同一个补丁**里做两件事：把 `a.txt` 的内容改成 `patched-a`，并新建 `b.txt`，内容 `patched-b`。

## 3. 拒写（Hook 对文件名含 DENYME 的调用退出码 2）

> 3a. 请只用 Write 工具新建 `DENYME-write.txt`，内容 `x`。
>
> 3b. 请只用 ApplyPatch 工具新建 `DENYME-patch.txt`，内容 `x`。
>
> 3c. 请用终端工具执行：`echo x > DENYME-bash.txt`

每条如果被拦，请把会话里显示的拒绝原文贴回来；如果它换别的办法绕过去，也照实告诉我。

## 4. 超时（Hook 对含 SLOWME 的调用挂 20 秒，Hook 超时设为 5 秒）

> 4. 请只用 Write 工具新建 `SLOWME.txt`，内容 `x`。

请记下大约等了多久、最后是写成了还是报错，报错原文贴回来。

## 5. 角色工件（不指定工具，看它自己选哪个）

> 5a. 请在 `.reviews-demo/` 目录下新建文件 `2026-09-25-demo-glm.md`，内容写一行 `# 原稿`。
>
> 5b. 请把 `.reviews-demo/2026-09-25-demo-glm.md` 的第一行改成 `# 已修改`。

## 6. 做完之后

告诉我「做完了」。我会**立刻**把 `~/.zcode/cli/rollout/` 里这次会话的文件拷进证据目录（rollout 只保留最近 3 个会话，拖久了会被挤掉），
再收 `hook-probe/log/`，核对夹具里各文件最后的状态。在我拷完之前，请不要再用 zcode 跑别的会话。
