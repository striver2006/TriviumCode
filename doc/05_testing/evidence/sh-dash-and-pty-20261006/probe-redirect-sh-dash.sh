#!/bin/zsh
# EV-101 · 重定向拼写在 sh / dash 下的实测（补 EV-79 只测了 zsh 5.9 与 bash 3.2 的那一支）
#
# 判别法与 ev79-shell-redirect-20260922/probe-redirect-operators.sh 相同：每格一个独立空目录，
# 跑完看建出了什么文件——建出同名文件 ⇒ 文件目标；不建文件 ⇒ fd 操作或不可达（看 rc 与 stderr 首行）。
# 拼写清单逐行照抄该脚本的 zsh 段与 bash 对照段（同一组形态，换外壳跑）。
#
# 关注点（EV-101）：判据把「无强制覆盖后缀的 [n]>& + 纯数字或 -」判为 fd 操作、不取目标（矩阵里的 X 档）。
# 「并集」论证成立的前提是：这些拼写在任何被接受的外壳下要么也是 fd 操作，要么退非零（被 exit_code === 0 挡在判定层外）。
# 所以要看的是 X 档那几行在 sh / dash 下有没有「rc=0 且建出文件」。
#
# 用法：zsh probe-redirect-sh-dash.sh
# 全部实验在一个 mktemp -d 根下进行，退出时整棵清掉；不碰工作树。

set -u

PROBE_ROOT=$(mktemp -d) || exit 1
trap 'rm -rf "$PROBE_ROOT"' EXIT

echo "环境"
echo "  /bin/sh   : $(ls -l /private/var/select/sh 2>/dev/null | sed 's/.* -> //')（/bin/sh 经 /private/var/select/sh 选定）；$(/bin/sh -c 'echo $BASH_VERSION' 2>/dev/null)"
echo "  /bin/dash : $(ls -l /bin/dash | awk '{print $5, $6, $7, $8}')（dash 无 --version）"
echo "  uname     : $(uname -sr)"
echo "  仓库      : $(git -C "$(dirname "$0")" rev-parse --short HEAD 2>/dev/null || echo '（不在 git 工作树内）')"
echo

_case_dir() {
  mktemp -d "$PROBE_ROOT/case.XXXXXX"
}

# 用 $d 之前必须校验（同 EV-79 脚本的纪律：`cd ""` 是 no-op，mktemp 失败时会在调用者目录执行）
_case_dir_ok() {
  local d="$1"
  [ -n "$d" ] && [ -d "$d" ] && [ -z "$(ls -1A "$d" 2>/dev/null)" ]
}

readonly CD_FAIL=199

# rc、stderr 首行、建出文件一次执行同时取
probe() {
  local sh="$1" label="$2" cmd="$3"
  local d rc files err errfile
  d=$(_case_dir)
  if ! _case_dir_ok "$d"; then
    printf '  %-28s ERROR 临时目录不可用，本格未执行\n' "$label"
    return
  fi
  errfile="$PROBE_ROOT/err.$$"
  ( cd "$d" 2>/dev/null || exit "$CD_FAIL"; "$sh" -c "$cmd" >/dev/null 2>"$errfile" ); rc=$?
  if [ "$rc" = "$CD_FAIL" ]; then
    printf '  %-28s ERROR 切换到临时目录失败，本格未执行\n' "$label"
    rm -f "$errfile"
    return
  fi
  err=$(head -1 "$errfile" 2>/dev/null)
  rm -f "$errfile"
  files=$( cd "$d" && ls -1A 2>/dev/null | tr '\n' ' ' )
  printf '  %-28s rc=%s  建出文件: %-14s %s\n' "$label" "$rc" "${files:-（无）}" "${err}"
}

run_all() {
  local sh="$1"
  echo "── $sh：文件目标族 ──"
  probe "$sh" '> 2'              'echo X > 2'
  probe "$sh" '>> 2'             'echo X >> 2'
  probe "$sh" '&> 2'             'echo X &> 2'
  probe "$sh" '&>> 2'            'echo X &>> 2'
  probe "$sh" '>>& 2'            'echo X >>& 2'
  probe "$sh" '>>&2（紧贴）'      'echo GLUED >>&2'
  probe "$sh" '>&2foo（等值防线）' 'echo Y >&2foo'
  probe "$sh" '2>& t1.txt'       'echo ERRLINE 2>& t1.txt'
  probe "$sh" '2>&t2.txt（紧贴）' '{ echo A; echo B >&2; } 2>&t2.txt'
  probe "$sh" '>>& sep.txt'      'echo SEP >>& sep.txt'
  probe "$sh" '>>&glu.txt（紧贴）' 'echo GLU >>&glu.txt'
  probe "$sh" '2>>&1'            '{ echo OUT; echo ERR >&2; } 2>>&1'
  probe "$sh" '>>&-'             'echo X >>&-'
  probe "$sh" '>& bashsep.txt'   'echo X >& bashsep.txt'
  echo "── $sh：强制覆盖后缀族 ──"
  probe "$sh" '>&| t1.txt'       'echo P1 >&| t1.txt'
  probe "$sh" '>&! t2.txt'       'echo P2 >&! t2.txt'
  probe "$sh" '&>| t3.txt'       'echo P3 &>| t3.txt'
  probe "$sh" '&>! t4.txt'       'echo P4 &>! t4.txt'
  probe "$sh" '2>&| t5.txt'      'echo P5 2>&| t5.txt'
  probe "$sh" '2>&! t6.txt'      'echo P6 2>&! t6.txt'
  probe "$sh" '>&| 2'            'echo A >&| 2'
  probe "$sh" '>&!2（紧贴）'      'echo B >&!2'
  probe "$sh" '>&| -'            'echo C >&| -'
  probe "$sh" '2>&! 1'           'echo D 2>&! 1'
  echo "── $sh：普通强制覆盖后缀 ──"
  probe "$sh" '>| p1.txt'        'echo P >| p1.txt'
  probe "$sh" '>! p2.txt'        'echo Q >! p2.txt'
  probe "$sh" '>>| p3.txt'       'echo R >>| p3.txt'
  probe "$sh" '>>! p4.txt'       'echo S >>! p4.txt'
  echo "── $sh：判据判 fd 操作（X 档）的那一族——关注点 ──"
  probe "$sh" '>& 2（分离）'      'echo HELLO >& 2'
  probe "$sh" '>& -（分离）'      'echo X >& -'
  probe "$sh" '>&2（紧贴）'       'echo X >&2'
  probe "$sh" '2>&1（紧贴）'      'echo X 2>&1'
  probe "$sh" '1>&2（紧贴）'      'echo X 1>&2'
  probe "$sh" '>&-（紧贴）'       'echo X >&-'
  probe "$sh" '2>&-（紧贴）'      'echo X 2>&-'
  probe "$sh" '2>& 1（分离）'     'echo X 2>& 1'
  probe "$sh" '2>& -（分离）'     'echo X 2>& -'
  echo "── $sh：对照 ──"
  probe "$sh" '> -'              'echo X > -'
  probe "$sh" '{fd}> fdvar.txt'  'echo T {fd}> fdvar.txt'
  probe "$sh" '>>&&x'            'echo Z >>&&x'
  echo
}

run_all /bin/sh
run_all /bin/dash
