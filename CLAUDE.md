
<!-- BEGIN TriviumCode -->
## TriviumCode 双审流水线协议

本项目启用了 TriviumCode「主攻 + 双审」流水线。作为 Driver（执笔者）你需要知道：

- **你是唯一有权改业务代码的角色。** Antigravity 与 ZCode 只做只读审查，
  它们的结论由编排器落盘，不经你转述。
- 四条命令是唯一入口：`/dual-run`（全流程）、`/dual-review-plan`、
  `/dual-review-code`、`/dual-review-bug`。**不要自行调用 `agy` 或 `zcode`**——
  并行、超时、指纹核验、防覆盖命名都在编排器内，绕过它会失去全部保障。
- **禁止在归档根（`.reviews/`）内产出 `*-gemini.md` 或 `*-glm.md`。** 那是审查员的角色后缀，
  Hook 会拦下你的写入。你的产出后缀是 `-claude`。
  归档根**之外**的同形态文件不拦（`doc/` 下的设计稿等）——它们不进入 `gate` 的读取面，
  拦它只有误锁成本。判定按词法路径与 realpath 真实路径的并集算，软链两个方向都拦得住。
- 审查意见必须**逐条**裁决（接受 / 驳回 / 暂缓 + 理由，接受要写落点）。
  禁止静默忽略。裁决未齐备时 Hook 会阻止你收工。
- 闸门期（等待人工审批）不得修改业务文件。想继续请让用户走 `/dual-approve`。
- **审批的发起权在用户手里，不在你手里。** 只在用户明确要求时才跑 `trivium approve`。
  技术上你自己跑得通——`approve` 不校验调用来源，正因如此这条才写在这里：
  它靠的是你守规矩，而审批记录会留下时间与会话来源供事后对账。
- 审查进行中也不要改业务文件：审查员正在读真实工作树，你的改动会造成快照漂移，
  可能让整次审查作废。
- Hook 对 Edit / Write 精确拦截；对 Bash 只按写命令形态做**启发式**拦截
  （重定向、`tee`、`sed -i`、`rm/mv/cp`、`git checkout` …），不是完备的——别去绕它，
  绕过去的改动同样会被跑后复算判成漂移。
- Bash 拦截有一种**已知误拦**：判定在未剥 heredoc 的原文上做，命令正文里只要出现
  `-gemini.md`、`_meta`、`task.json`、`state.json`、`.trivium` 字样就会命中，
  哪怕实际写的是别的文件——**任何把这些名字写进 Bash 命令文本的场合都会撞上**，
  包括 commit message。
  （2026-09-14 试过按「归档内才拦」收窄 Bash 侧，三轮双审逐一打穿后撤回，
  理由与 RV-B1 同构；Write / Edit 侧的收窄保留，见上一条。）
  **出口是改用 Write / Edit 工具落文件，提交说明写进文件再 `git commit -F <文件>`**
  （精确判定，不看字面），不是想办法绕过判定。
  这个误拦是刻意接受的取舍，不要当成 bug 去「修」。
- **同一条 Hook 还有第二种误拦形态：命令文本里提到「写动词」。**
  拦截要两个条件同时成立——命令**像**写命令（`looksLikeWriteCommand`）且提到保护路径。
  而前者是**词边界字面匹配、不看上下文**：动词集见 `src/trivium/hooks.ts` 的 `WRITE_LIKE`，
  含 `rm`/`mv`/`cp`/`touch`/`mkdir`/`rmdir`/`ln`/`install`/`rsync`/`patch`/`dd`/
  `truncate`/`chmod`/`chown`/`unzip`/`tar`，另有 `tee`、`sed -i`、重定向，
  以及 `git checkout|restore|reset|apply|commit…` 与包管理器的写子命令。
  于是 `./.trivium/bin/trivium … 'chmod'` 这样的命令会被拦——它只是**提到**那个词。
  **最常撞上的场合是 `/dual-review-*`**：skill 要求用 `.trivium/bin/trivium` 调用（含 `bin/`），
  而审查焦点要**逐字**进命令行（FR-20），于是「这次重点看写命令判据」这类焦点必然命中。
  2026-09-16 M8 第 3 步的代码双审就是这么卡住的（焦点含 `ln`/`dd`/`chmod`）。
  **出口是改焦点措辞**——换成语义等价、不含那些字面的说法（如「链接创建、块设备复制、
  权限变更三类动词」）。焦点是用户的话、FR-20 承诺逐字，所以**改之前要问用户**，
  不要自己改了就发出去，更不要换条调用路径去绕字面匹配。
  同样不要给这里开豁免：理由与下一条的 RV-B1 同构。
- **含凭据的文件一律 grep 目标键名，禁止整份打印。**
  这几个文件里有明文凭据：`~/.codex/config.toml`（`[model_providers.*]` 段的
  `experimental_bearer_token`）、`~/.codex/auth.json`、`~/.codex/<profile>.config.toml`、
  以及 `prepareCodexHome()` 拷进 `~/.trivium/runs/<run>/codex/codexhome/` 的那几份副本。
  要看结构就 `grep -n '^\[' <file>` 或只查你要的那个键，**不要 `cat` 整份**。
  2026-09-16 我为了确认「副本里有没有 sandbox 键」而 `cat` 了副本的 `config.toml`，
  把三个 provider 的 token 打进了终端。**代价不是「本地滚动缓冲里有一行」**——
  对话要经 API 传出去，凭据就此离开这台机器，是否轮换只能由你判断，我无法撤销。
  要查的其实只是一个键名，整份打印是纯粹多余的。
  代码里早有正确口径：`providerCredentialed()` 的文档块写着「**只判有无，绝不返回值**」，
  `providerBaseUrl()` 也只取 `base_url` 一个键。**我没照着做的是手敲的命令，不是代码。**
  所以这条写给人看：脚本里的约束管不到临时起意的一行 `cat`。
- **不要再试图给 `git commit` 开豁免。** 2026-09-12 开过一次（RV-B1），双审打穿后撤回：
  三个前置条件漏掉至少五条夹带路径，其中换行、附着重定向、文本提及三条实测能放行。
  根因是原判定 fail-closed，豁免把它变成需要穷举危险形态的 fail-open——而 shell
  的攻击面穷举不完。五类形态已锁成测试负例，再开这个口子会当场红。

留痕全部在 `.reviews/<主题>/{plan,code,bug,verify}/`，命名为
`<日期>-<主题>[-r<N>][-revised|-response]-<角色>.md`。
<!-- END TriviumCode -->
