#!/bin/zsh
# EV-221 加压装置：每轮同时 4 份 ev221-i2-once.mjs（每份两主题对齐同秒），逐轮跑。
# 用法：ev221-load.sh <标签> <最多轮数> <撞上即停：1|0>
# 每份输出写 <SP>/ev221/<标签>-<轮>-<份>.json；末尾打汇总。
SP=/private/tmp/claude-501/-Users-chenzhenbo-Work-TriviumCode/413e30f7-5dc8-4bba-b301-d383211ef7cb/scratchpad
OUT=$SP/ev221
mkdir -p $OUT
TAG=$1
MAX=$2
STOP=$3
total=0; fail=0; stat=0; other=0
for r in $(seq 1 $MAX); do
  pids=()
  for k in 1 2 3 4; do
    node $SP/ev221-i2-once.mjs > $OUT/$TAG-$r-$k.json 2> $OUT/$TAG-$r-$k.stderr.txt &
    pids+=$!
  done
  for p in $pids; do wait $p; done
  hit=0
  for k in 1 2 3 4; do
    total=$((total+1))
    f=$OUT/$TAG-$r-$k.json
    if grep -q '"ok":true' $f; then :; else
      if grep -q '"status":\[' $f; then fail=$((fail+1)); else other=$((other+1)); fi
      if grep -q '"unableToStat":true' $f; then stat=$((stat+1)); hit=1; fi
    fi
  done
  echo "round=$r total=$total failed=$fail unable_to_stat=$stat other=$other"
  if [[ $STOP == 1 && $hit == 1 ]]; then break; fi
done
echo "SUMMARY tag=$TAG rounds=$r total=$total failed=$fail unable_to_stat=$stat other=$other"
