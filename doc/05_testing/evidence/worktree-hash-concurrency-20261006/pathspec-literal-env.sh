#!/bin/zsh
# 实验：用户环境带 GIT_LITERAL_PATHSPECS=1 时，exclude 魔法 pathspec 在 git add 上的行为
SP=/private/tmp/claude-501/-Users-chenzhenbo-Work-TriviumCode/413e30f7-5dc8-4bba-b301-d383211ef7cb/scratchpad
D=$(mktemp -d $SP/pl.XXXX)
case "$D" in "$SP"/pl.*) ;; *) echo "bad tmp $D"; exit 1;; esac
IDX=$SP/idx-literal
cd $D && git init -q && git config user.email a@b && git config user.name a
mkdir -p src .reviews && echo a > src/a.ts && echo r > .reviews/x.md && git add -A && git commit -qm init
echo r2 > .reviews/x.md
h() {
  rm -f $IDX
  GIT_INDEX_FILE=$IDX git read-tree HEAD
  GIT_INDEX_FILE=$IDX git add -A -- . ':(exclude,literal).reviews' 2>&1 || echo "ADDFAIL code=$?"
  GIT_INDEX_FILE=$IDX git write-tree
}
echo "HEAD tree $(git rev-parse 'HEAD^{tree}')"
echo "no env:"; h
echo "GIT_LITERAL_PATHSPECS=1:"; GIT_LITERAL_PATHSPECS=1 h
echo "GIT_LITERAL_PATHSPECS=0:"; GIT_LITERAL_PATHSPECS=0 h
echo "GIT_ICASE_PATHSPECS=1:"; GIT_ICASE_PATHSPECS=1 h
echo "GIT_GLOB_PATHSPECS=1:"; GIT_GLOB_PATHSPECS=1 h
echo "GIT_NOGLOB_PATHSPECS=1:"; GIT_NOGLOB_PATHSPECS=1 h
cd /
rm -rf "$D"
rm -f $IDX
