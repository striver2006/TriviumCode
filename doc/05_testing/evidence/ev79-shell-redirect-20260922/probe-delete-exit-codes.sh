#!/bin/zsh
# EV-79 · 缺口一的可达性地基：递归删除动词各形态在目标不存在时的退出码
#
# **文件名刻意避开那个两字母动词**：`probe-rm-exit-codes` 里的 `rm` 两侧都是 `-`，
# 正好命中 hooks.ts 写命令判据的 `\brm\b` 词边界；而但凡命令行里同时出现
# `.trivium/bin/`（保护路径），整条就会被 Bash 侧 Hook 拦下。
# 把它写进 --context 的那一刻起，每次双审都会撞。已实测撞过一次，故改名。
#
# 为什么要有这份脚本（代码双审 CODEX-06 ≡ GLM-02）：
# 缺口一的收紧论证压在三个退出码上——
#   · `rm -rf <不存在>` 退 0  ⇒ 穿过「只喂成功命令」的调用契约 ⇒ 误杀面**可达**
#   · `rm -r  <不存在>` 退 1  ⇒ 进不了判定层 ⇒ 同形态不可达
#   · 长旗标一律退 64        ⇒ 本机 BSD rm 不接受，判据维持等值匹配不改前缀
# 而 base.ts 的注释、用例注释与设计 v1.3.34 都按**既成实测**引用它们。
# 纪律 1：取值靠实测的必须留探针结论，不能只活在计划稿里。
#
# 判别法：在空的临时目录里对**不存在**的目标跑一次，记退出码。
# 全部实验落在一个临时根下，退出时整棵清掉；不碰工作树。
#
# 用法：zsh probe-delete-exit-codes.sh
#
# **证据件约定**：改了下方结论段就必须同轮复跑刷新 .out.txt，两者逐字一致。
# 本件正是那条约定的起因——r2 改了结论 3 的措辞却没重跑，落盘件里留着旧的危险口径
# （r3 CODEX-r3-02 ≡ GLM-01）。完整约定见 probe-redirect-operators.sh 抬头。

set -u

PROBE_ROOT=$(mktemp -d) || exit 1
trap 'rm -rf "$PROBE_ROOT"' EXIT

echo "环境"
echo "  zsh    : $(/bin/zsh --version)"
echo "  rm     : $(/bin/rm --version 2>&1 | head -1)"
echo "  uname  : $(uname -sr)"
echo "  仓库    : $(git -C "$(dirname "$0")" rev-parse --short HEAD 2>/dev/null || echo '（不在 git 工作树内）')"
echo

# err 与 rc **一次执行同时取**（代码双审 GLM-02 ≡ CODEX-03 ≡ AGY-02）。
# 对删除类命令这两次**不幂等**：第一次（取 err）若目标存在即已删除，
# 第二次（取 rc）测到的是「目标已不存在」的退出码——`rm -r <存在>` 会从真实的
# rc=0 记成 rc=1，**方向恰是「把可达形态记成不可达」**，而那正是缺口一论证的关键格。
# 当前六格全是「不存在目标 / 长旗标」所以旧写法没失真，但下一个人加一格存在目标就会中招
# （下面「对照：目标存在」段当初只能单独写、不能复用本函数，就是这个坑的证据）。
#
# 另：`$d` 用前必须校验——`cd ""` 是 no-op 而非错误，mktemp 一失败命令会在仓库根执行。
#
# **纪律：本脚本里任何用到 $d 的地方都必须先过 _case_dir_ok，包括末尾的内联对照段。**
# 这条是补写的：上一轮只给本函数加了校验，末尾「对照：目标存在时」那段照旧裸用 $d，
# 于是同一个坑在同一份补丁里留了半边——而那一段跑的恰是递归删除
# （代码双审 r3 CODEX-r3-04 ≡ AGY-02）。
_case_dir_ok() {
  local d="$1"
  [ -n "$d" ] && [ -d "$d" ] && [ -z "$(ls -1A "$d" 2>/dev/null)" ]
}

# cd 失败要与命令自身的退出码**分开取**（r2 CODEX-02 落点后半句，r3 GLM-03）。
# 不分开时 cd 失败记成 rc=1、stderr 空，与「不带 -f 的递归删除目标不存在」那格
# （本脚本论证的关键格，rc 也是 1）**行形状完全相同**——在这份脚本里尤其危险。
# 哨兵取 199：本批命令的退出码只出现 0/1/64。
#
# **哨兵不能替代 _case_dir_ok，两者各管一头**（实测：`d=""; cd "$d"` ⇒ rc=0）：
#   · 空串 —— `cd ""` 是 no-op、返回 0，哨兵**抓不到**，只有「非空」那条校验能抓；
#   · 真失败（目录不存在 / 无权限）—— 校验通过后才可能发生，由哨兵抓。
readonly CD_FAIL=199

probe_rm() {
  local label="$1" cmd="$2" note="$3"
  local d rc err errfile
  d=$(mktemp -d "$PROBE_ROOT/case.XXXXXX")
  if ! _case_dir_ok "$d"; then
    printf '  %-34s ERROR 临时目录不可用，本格未执行\n' "$label"
    return
  fi
  errfile="$PROBE_ROOT/err.$$"
  ( cd "$d" 2>/dev/null || exit "$CD_FAIL"; /bin/zsh -c "$cmd" >/dev/null 2>"$errfile" ); rc=$?
  if [ "$rc" = "$CD_FAIL" ]; then
    printf '  %-34s ERROR 切换到临时目录失败，本格未执行\n' "$label"
    rm -f "$errfile"
    return
  fi
  err=$(head -1 "$errfile" 2>/dev/null)
  rm -f "$errfile"
  printf '  %-34s rc=%-3s %-42s %s\n' "$label" "$rc" "${err:-（无输出）}" "$note"
}

echo "── 目标不存在时的退出码（决定误杀面可不可达）──"
probe_rm 'rm -r nope_dir'    'rm -r nope_dir'    '进不了判定层：契约只喂 exit_code===0'
probe_rm 'rm -rf nope_dir'   'rm -rf nope_dir'   '**可达** —— 本次收紧新引入的误杀路径'
probe_rm 'rm -f nope.txt'    'rm -f nope.txt'    '今天已走幂等档，本次不变'
echo
echo "── 长旗标（决定判据用等值还是前缀）──"
probe_rm 'rm --recursive --force'  'rm --recursive --force nope_dir'  'BSD rm 不接受长旗标 ⇒ 形态不可达'
probe_rm 'rm --recur --forc'       'rm --recur --forc nope_dir'       'GNU 风格缩写同样不可达'
echo
echo "── 对照：目标存在时（正确检出的那一半）──"
# 本段与 probe_rm 走同一条纪律：$d 先过校验再用。
# 顺序要紧——先在**空**目录上校验，再 mkdir 造出目标，否则「且为空」那条必然失败。
d=$(mktemp -d "$PROBE_ROOT/case.XXXXXX")
if ! _case_dir_ok "$d"; then
  printf '  %-34s ERROR 临时目录不可用，本格未执行\n' 'rm -r <存在目录>'
else
  mkdir -p "$d/existing-dir"
  rc=$( cd "$d" 2>/dev/null || { echo "$CD_FAIL"; exit 0; }; /bin/zsh -c 'rm -r existing-dir' >/dev/null 2>&1; echo $? )
  if [ "$rc" = "$CD_FAIL" ]; then
    printf '  %-34s ERROR 切换到临时目录失败，本格未执行\n' 'rm -r <存在目录>'
  else
    left=$( cd "$d" && ls -1A 2>/dev/null | tr '\n' ' ' )
    printf '  %-34s rc=%-3s 目录残留: %-28s %s\n' 'rm -r <存在目录>' "$rc" "${left:-（已删除）}" '退 0 且真删 ⇒ 可达，判 writes 是正确检出'
  fi
fi
echo
echo "结论："
echo "  1. -f 让「目标不存在」也退 0，误杀面因此**可达**；不带 -f 的同形态退 1，进不到判定层。"
echo "  2. 本机 BSD rm 拒收一切长旗标（含 GNU 风格缩写），故递归旗标判据用等值匹配、不改前缀——"
echo "     前缀匹配只会平白扩大误判面。"
echo "  3. 误杀形态「目标不存在」没有工作树改动 ⇒ snapshot.drift 为 false。"
echo "     **但该指纹只能单向用**：drift 是 git 树比对、只看已跟踪文件，"
echo "     被 ignore 的目录（如 dist/）被真实递归删除同样 drift=false，"
echo "     直接据此判「误报」会把真失守降级（代码双审 CODEX-09）。"
