#!/bin/zsh
# EV-222 现状实测：四个 pathspec 环境变量（LITERAL / NOGLOB / GLOB / ICASE）各自设 1 时，
# code 阶段补丁 diffAgainst 的已跟踪部分排除得住吗。写法照抄 util/git.ts 的 diffAgainst：
#   git -c core.quotePath=false diff --find-renames <base> -- . ':(exclude)<前缀>/**' ':(exclude,glob)<glob>'
# 夹具：已跟踪的 src/a.ts（业务）、.reviews/t/x.md（归档根）、.trivium/config.yaml、.env（命中缺省敏感 glob）、
# 以及大小写不同的业务目录 .Reviews/y.md，全部改一行。只在 scratchpad 的 mktemp 目录里。
SP=/private/tmp/claude-501/-Users-chenzhenbo-Work-TriviumCode/413e30f7-5dc8-4bba-b301-d383211ef7cb/scratchpad
D=$(mktemp -d $SP/pe.XXXX)
case "$D" in "$SP"/pe.*) ;; *) echo "bad tmp $D"; exit 1;; esac
cd $D && git init -q && git config user.email a@b && git config user.name a
mkdir -p src .reviews/t .trivium .Reviews
echo a > src/a.ts; echo r > .reviews/t/x.md; echo c > .trivium/config.yaml; echo E=1 > .env; echo y > .Reviews/y.md
git add -A && git commit -qm init
echo a2 > src/a.ts; echo r2 > .reviews/t/x.md; echo c2 > .trivium/config.yaml; echo E=2 > .env; echo y2 > .Reviews/y.md
d() {
  git -c core.quotePath=false diff --find-renames HEAD -- . ':(exclude).reviews/**' ':(exclude).trivium/**' ':(exclude).git/**' ':(exclude,glob)**/.env*' 2>&1 \
    | grep -E '^diff --git|fatal|error' | sed -e 's/^diff --git a\/\([^ ]*\) .*/\1/' | tr '\n' ' '
  echo
}
echo "no env:                      $(d)"
for v in GIT_LITERAL_PATHSPECS GIT_NOGLOB_PATHSPECS GIT_GLOB_PATHSPECS GIT_ICASE_PATHSPECS; do
  printf '%-28s %s\n' "$v=1:" "$(env $v=1 zsh -c "$(typeset -f d); d")"
done
echo "--- 四个都钉 0 时，用户环境再设 1 不影响（env 后者覆盖前者）："
for v in GIT_LITERAL_PATHSPECS GIT_NOGLOB_PATHSPECS GIT_GLOB_PATHSPECS GIT_ICASE_PATHSPECS; do
  printf '%-28s %s\n' "$v=1 → 0:" "$(env $v=1 GIT_LITERAL_PATHSPECS=0 GIT_NOGLOB_PATHSPECS=0 GIT_GLOB_PATHSPECS=0 GIT_ICASE_PATHSPECS=0 zsh -c "$(typeset -f d); d")"
done
echo "--- 不带魔法、不带通配的普通前缀（status --porcelain -- src .trivium；diff --name-status HEAD -- .reviews）："
p() {
  echo "status: $(git status --porcelain -- src .trivium 2>&1 | tr '\n' ' ')| diff: $(git diff --name-status --no-renames HEAD -- .reviews 2>&1 | tr '\t\n' '  ')"
}
echo "no env:                      $(p)"
for v in GIT_LITERAL_PATHSPECS GIT_NOGLOB_PATHSPECS GIT_GLOB_PATHSPECS GIT_ICASE_PATHSPECS; do
  printf '%-28s %s\n' "$v=1:" "$(env $v=1 zsh -c "$(typeset -f p); p")"
done
cd /
rm -rf "$D"
