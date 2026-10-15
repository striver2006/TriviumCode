#!/bin/sh
# 由 `trivium init` 生成。node 路径写死是刻意的：
# GUI 进程（VS Code）不读 ~/.zshrc，依赖 PATH 会在插件里失效（设计 §10.5）。
exec "/opt/homebrew/opt/node/bin/node" "/Users/chenzhenbo/.claude/skills/dual-critic/scripts/trivium.cjs" "$@"
