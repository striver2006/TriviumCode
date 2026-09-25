# 薄冒烟参数保真核对（r10 §2.5）

| 项 | 读数 | 一致 |
| :--- | :--- | :--- |
| 用户消息原文（rollout） | `/dual-review-plan 看 it's 这一处的 $HOME 与 "双引号" --topic 冒烟主题` | ✓ |
| task.json 主题 ⇔ 用户输入主题 | `冒烟主题` | ✓ |
| task.json drivers.plan.driver | `glm` | ✓ |
| run 20260925T053103Z：status / driver / driver_enabled / topic | `running / glm / True / 冒烟主题` | ✓ |
| run 20260925T053433Z：status / driver / driver_enabled / topic | `success / glm / True / 冒烟主题` | ✓ |
| run 20260925T053433Z codex 侧 BRIEF 第 2 段 ⇔ 用户输入焦点 | `看 it's 这一处的 $HOME 与 "双引号"` | ✓ |
| run 20260925T053433Z gemini 侧 BRIEF 第 2 段 ⇔ 用户输入焦点 | `看 it's 这一处的 $HOME 与 "双引号"` | ✓ |
| 原稿里记下的焦点（逐字出现？） | `False` | ✗ |

Skill 工具入参（rollout）：`{"skill": "dual-review-plan", "args": "看 it's 这一处的 $HOME 与 \"双引号\" --topic 冒烟主题"}`
