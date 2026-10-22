**预检退 69 时先看能不能自动校准**（EV-251）。预检失败时 JSON 里有 `recalibration`：

- 退出码不是 69、`recalibration` 键缺席、或 `recalibration.eligible` 不为 `true`：**原样转述**错误（连同 `recalibration.why`）并停止，
  不要自行猜测修复。预检失败时不会产生任何工件，可以放心重试。
- 退出码 69 且 `recalibration.eligible` 为 `true`：**不向用户确认**，按下面三步自动校准一轮。哪些失败项能修、该跑哪几家、
  带什么旗标，全由预检给出——你只照抄，不自行判断、不增删。

1. 先发一行文本：「预检退 69，以下失败项可由 doctor 重新校准：〈失败项名称〉；将依次在前台跑 N 次 doctor
   （每次至多 `deadline_s` 秒），会消耗少量配额」。
2. 逐条执行 `recalibration.invocations`：命令是 `TV` 后接该条 `args` 的各项（逐个照抄，不改、不增删）。
   **前台调用**，Bash 工具超时设为该条的 `bash_timeout_ms`；不要放到后台，也不要拆成发起与等待两步。
   每条结束后先发一行播报（`only`、退出码、`blockers` 条数；`deadline.hit` 为真时点名 `deadline.sections` 里没探完的段），
   再发下一条。任何退出码（0 / 69 / 76 / 64 / 1，或被工具超时打断）都**继续下一条**——修好没有由重跑预检判。
3. 全部跑完后，用**逐字相同**的旗标重跑同一条预检命令**一次**：
   - 通过：照常往下走（`warnings` 照常念），并在同一条消息里说明「预检首次退 69，已自动校准后通过」；
   - 仍失败（任何退出码）：**停止**，一并转述：第一次预检的失败项；每次 doctor 的退出码、`blockers`、`warnings`，
     以及 `deadline.sections` 里各段的 `state`、`notes` 与 `rerun`（没探完的段连同 `note` 原文）；第二次预检的失败项。
     请用户在终端跑仍失败那几家对应的 `rerun`。第二次预检的 `recalibration` 即使可校准也**不再**自动校准——每次预检至多一轮。
