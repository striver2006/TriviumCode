#!/bin/zsh
# 新发现实测（另登 EV-222）：用户环境带 GIT_LITERAL_PATHSPECS=1 时，code 阶段补丁（diffAgainst）的
# `:(exclude)<前缀>/**` pathspec 被当成字面路径——已跟踪的归档根改动会不会进补丁。
# 写法照抄 util/git.ts 的 diffAgainst：git diff --find-renames <base> -- . ':(exclude)<p>/**'
SP=/private/tmp/claude-501/-Users-chenzhenbo-Work-TriviumCode/413e30f7-5dc8-4bba-b301-d383211ef7cb/scratchpad
D=$(mktemp -d $SP/dl.XXXX)
case "$D" in "$SP"/dl.*) ;; *) echo "bad tmp $D"; exit 1;; esac
cd $D && git init -q && git config user.email a@b && git config user.name a
mkdir -p src .reviews/t && echo a > src/a.ts && echo r > .reviews/t/x.md && git add -A && git commit -qm init
echo b > src/a.ts && echo r2 > .reviews/t/x.md
d() { git -c core.quotePath=false diff --find-renames HEAD -- . ':(exclude).reviews/**' ':(exclude).trivium/**' 2>&1; echo "diff exit=$?"; }
echo "== no env (files in patch):"; d | grep -E '^diff --git|exit='
echo "== GIT_LITERAL_PATHSPECS=1 (files in patch):"; GIT_LITERAL_PATHSPECS=1 d | grep -E '^diff --git|exit=|fatal'
cd /
rm -rf "$D"
