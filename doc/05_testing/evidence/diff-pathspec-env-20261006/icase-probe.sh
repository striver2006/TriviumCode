#!/bin/zsh
# 实测：在大小写不敏感的 APFS 上，排除前缀写 Docs、实际目录是 docs 时，GIT_ICASE_PATHSPECS=1 是否改变排除结果
#（用来判断「钉 ICASE=0」这一项能不能被用例观测到）。只在 scratchpad 的 mktemp 目录里。
SP=/private/tmp/claude-501/-Users-chenzhenbo-Work-TriviumCode/413e30f7-5dc8-4bba-b301-d383211ef7cb/scratchpad
D=$(mktemp -d $SP/ic.XXXX)
case "$D" in "$SP"/ic.*) ;; *) echo "bad tmp $D"; exit 1;; esac
IDX=$SP/idx-icase
cd $D && git init -q && git config user.email a@b && git config user.name a
echo "core.ignorecase=$(git config core.ignorecase)"
mkdir -p docs src && echo d > docs/f && echo a > src/a.ts && git add -A && git commit -qm init
echo d2 > docs/f
dd() { git diff --find-renames HEAD -- . ':(exclude)Docs/**' 2>&1 | grep '^diff --git' | tr '\n' ' '; echo; }
wh() { rm -f $IDX; GIT_INDEX_FILE=$IDX git read-tree HEAD; GIT_INDEX_FILE=$IDX git add -A -- . ':(exclude,literal)Docs'; GIT_INDEX_FILE=$IDX git write-tree; }
echo "diff  no env:   $(dd)"
echo "diff  ICASE=1:  $(GIT_ICASE_PATHSPECS=1 zsh -c "$(typeset -f dd); dd")"
echo "tree  no env:   $(wh)"
echo "tree  ICASE=1:  $(GIT_ICASE_PATHSPECS=1 IDX=$IDX zsh -c "$(typeset -f wh); wh")"
echo "HEAD tree:      $(git rev-parse 'HEAD^{tree}')"
cd /
rm -rf "$D"
rm -f $IDX
