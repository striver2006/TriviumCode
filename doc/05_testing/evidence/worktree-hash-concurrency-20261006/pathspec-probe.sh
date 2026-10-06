#!/bin/zsh
# 实验：git add -A 带 exclude pathspec 在临时索引上的行为（只在 scratchpad 的 mktemp 目录里）
SP=/private/tmp/claude-501/-Users-chenzhenbo-Work-TriviumCode/413e30f7-5dc8-4bba-b301-d383211ef7cb/scratchpad
D=$(mktemp -d $SP/ps.XXXX)
case "$D" in "$SP"/ps.*) ;; *) echo "bad tmp $D"; exit 1;; esac
cd $D && git init -q && git config user.email a@b && git config user.name a
mkdir -p src .reviews/t && echo a > src/a.ts && echo r > .reviews/t/x.md && git add -A && git commit -qm init
h() {
  rm -f $SP/idx-probe
  GIT_INDEX_FILE=$SP/idx-probe git read-tree HEAD
  GIT_INDEX_FILE=$SP/idx-probe git -c core.quotePath=false add -A -- . "$@" || echo ADDFAIL
  GIT_INDEX_FILE=$SP/idx-probe git write-tree
}
EX=(':(exclude,literal).reviews' ':(exclude,literal).trivium' ':(exclude,literal).git')
echo "base (HEAD tree $(git rev-parse 'HEAD^{tree}'))"; h $EX
echo r2 > .reviews/t/x.md; echo new > .reviews/t/y.json.tmp-1; mkdir .trivium; echo s > .trivium/state.json
echo "after archive + trivium change (excluded)"; h $EX
echo "same, no exclusion"; h
rm .reviews/t/x.md
echo "after deleting tracked archive file (excluded)"; h $EX
echo b > src/a.ts
echo "after business change (excluded)"; h $EX
echo "--- nonexistent excluded prefix"; h ':(exclude,literal)nonexist'
echo "--- exclude a file path exactly (literal)"; echo z > top.txt; h ':(exclude,literal)top.txt'
echo "--- glob chars literal"; mkdir -p 'a[1]' && echo q > 'a[1]/f'; h; h ':(exclude,literal)a[1]'; h ':(exclude)a[1]'
cd /
rm -rf "$D"
