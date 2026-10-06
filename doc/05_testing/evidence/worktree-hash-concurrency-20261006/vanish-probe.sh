#!/bin/zsh
# 实验：用 clean 过滤器在 git add -A 期间删掉一个已被列入的未跟踪文件，能否稳定造出「unable to stat … No such file or directory」
SP=/private/tmp/claude-501/-Users-chenzhenbo-Work-TriviumCode/413e30f7-5dc8-4bba-b301-d383211ef7cb/scratchpad
D=$(mktemp -d $SP/vp.XXXX)
case "$D" in "$SP"/vp.*) ;; *) echo "bad tmp $D"; exit 1;; esac
IDX=$D/idx
R=$D/repo
mkdir -p $R/src && cd $R && git init -q && git config user.email a@b && git config user.name a
echo a > src/a.ts && echo x > src/x.ts && git add -A && git commit -qm init
# 过滤器：每调一次计数 +1；删掉目录里现有的 victim-*，persist=1 时再造下一个 victim（不在本次 add 的列表里）
cat > $D/zap.sh <<'EOF'
n=$(cat "$ZAP_COUNTER" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$ZAP_COUNTER"
rm -f "$ZAP_DIR"/victim-*
if [ "$ZAP_PERSIST" = 1 ]; then : > "$ZAP_DIR/victim-$n"; fi
cat
EOF
mkdir -p .git/info && echo 'src/x.ts filter=zap' > .git/info/attributes
git config filter.zap.clean "sh '$D/zap.sh'"
export ZAP_DIR=$R/src ZAP_COUNTER=$D/counter
try() {
  rm -f $IDX
  GIT_INDEX_FILE=$IDX git read-tree HEAD
  GIT_INDEX_FILE=$IDX git -c core.quotePath=false add -A -- . 2>&1; echo "add exit=$?"
}
echo "== once (persist=0)"; : > src/victim-0; rm -f $D/counter; export ZAP_PERSIST=0
try; try; echo "counter=$(cat $D/counter)"; ls src
echo "== persist=1"; : > src/victim-0; rm -f $D/counter; export ZAP_PERSIST=1
try; try; try; echo "counter=$(cat $D/counter)"; ls src
cd /
rm -rf "$D"
