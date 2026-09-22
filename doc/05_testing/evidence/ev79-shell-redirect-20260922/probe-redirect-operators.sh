#!/bin/zsh
# EV-79 · 重定向运算符的外壳语义实测（计划 r6 §1.4.2 的地基）
#
# 为什么要有这份脚本：本主题在同一组外壳事实上烧掉过两轮三侧审查配额——
# r3 两侧给出互相矛盾的实测结论，r4 一侧声称「双外壳实测」而其命令执行计数为 0
# （BACKLOG EV-95）。根因是**审查侧建不了文件**，而判别法需要建文件。
# 把结论连同命令原文与外壳版本落成证据件，后续轮次读结论即可，不必重测。
#
# 判别法：跑完看目录里建出了什么文件。
#   建出同名文件 ⇒ 该 token 是**文件目标**；不建文件且输出改道 ⇒ **fd 操作**。
#
# 只读环境下的替代判别法（给建不了文件的审查侧用，见计划 §1.4.3）：
#   把目标指向不存在的目录，从报错文本区分——
#   `no such file or directory: <路径>` / `operation not permitted: <名>` ⇒ 文件目标
#   `ambiguous redirect` ⇒ 该拼写在本外壳下不合法（不可达）
#   `syntax error near unexpected token` ⇒ 语法不支持（不可达）
#   无报错、rc=0、无文件 ⇒ fd 操作
#
# 用法：zsh probe-redirect-operators.sh
# 全部实验在 mktemp -d 返回的临时目录内进行，不碰工作树。
#
# ── 证据件约定（本目录通用，r3 CODEX-r3-02 ≡ GLM-01 起立）────────────────
# **改了 .sh 的结论段就必须同轮复跑刷新 .out.txt，两者的结论段要逐字一致。**
# 起因：r2 按 CODEX-09 把本目录 probe-delete-exit-codes.sh 的结论 3 从「drift 恒 false，
# 据此分档」改成单向口径，却没重跑——于是 .out.txt 里留着已被裁决为危险的旧句子，
# 而抬头第 7 行恰恰承诺「后续轮次读结论即可，不必重测」。**承诺读哪份，就必须刷哪份。**
# 复跑零副作用（只在临时目录活动），没有不刷的理由。
# ────────────────────────────────────────────────────────────────

set -u

# 全部实验落在**一个**临时根下，退出时整棵清掉（代码双审 CODEX-12）。
# 此前每个 probe 各自 mktemp -d 且无清理，跑一次留下 30+ 个装着被建文件的目录。
PROBE_ROOT=$(mktemp -d) || exit 1
trap 'rm -rf "$PROBE_ROOT"' EXIT

echo "环境"
echo "  zsh    : $(/bin/zsh --version)"
echo "  bash   : $(/bin/bash --version | head -1)"
echo "  uname  : $(uname -sr)"
echo "  仓库    : $(git -C "$(dirname "$0")" rev-parse --short HEAD 2>/dev/null || echo '（不在 git 工作树内）')"
echo

# 每个 case 一个**独立空目录**。
# 不要用「父 shell 计数器 + 命令替换」的写法：`$(...)` 在子 shell 里跑，
# 计数器加不回父 shell，所有 case 会共用同一个目录、建出的文件层层累积，
# 于是每一行都报上前面所有 case 的产物——这份表就废了。
_case_dir() {
  mktemp -d "$PROBE_ROOT/case.XXXXXX"
}

# 用 $d 之前必须校验（代码双审 CODEX-02）。
# 理由：zsh / bash 的 `cd ""` **不是错误而是 no-op**（实测 rc=0 且 cwd 不变）。
# 于是 mktemp 一失败（TMPDIR 不可写 / 已满 / 只读沙箱里复跑），命令就会在
# **调用者的当前目录**执行——通常正是仓库根，往工作树建出 `2`、`t1.txt`、`-` 这些文件；
# 紧接着 `ls -1A` 会把**整棵仓库的文件名**当成「该形态建出的文件」印进表里。
# 两种失真都不报错、不留痕，比子壳计数器那个坑更隐蔽（那个坏在表全错而看得见，
# 这个坏在表看着自洽）。
#
# **纪律：本脚本里任何用到 $d 的地方都必须先过 _case_dir_ok，包括以后新加的内联段。**
# 这条写成纪律而不是靠自觉，是因为姊妹脚本 probe-delete-exit-codes.sh 恰好犯过：
# 函数里加了校验，末尾的内联对照段没复用，于是同一个坑在同一份补丁里留了半边
# （代码双审 r3 CODEX-r3-04 ≡ AGY-02）。
_case_dir_ok() {
  local d="$1"
  [ -n "$d" ] && [ -d "$d" ] && [ -z "$(ls -1A "$d" 2>/dev/null)" ]
}

# cd 失败要与命令自身的退出码**分开取**（代码双审 r2 CODEX-02 落点后半句，r3 GLM-03）。
# 不分开时 cd 失败记成 rc=1、stderr 空、无建出文件，与「>>&&x 那格语法错」的行形状
# 完全相同且不可分辨。前置校验已把 cd 失败压到近零，但「压到近零」不等于「可分辨」。
# 哨兵取 199：本批命令的退出码只出现 0/1/2/64，信号态 128+N 也到不了这里。
#
# **哨兵不能替代 _case_dir_ok，两者各管一头**（实测：`d=""; cd "$d"` ⇒ rc=0）：
#   · 空串 —— `cd ""` 是 no-op、返回 0，哨兵**抓不到**，只有「非空」那条校验能抓；
#   · 真失败（目录不存在 / 无权限）—— 校验通过后才可能发生，由哨兵抓。
# 谁也别指望另一个兜底。
readonly CD_FAIL=199

probe_zsh() {
  local label="$1" cmd="$2"
  local d rc files
  d=$(_case_dir)
  if ! _case_dir_ok "$d"; then
    printf '  %-34s ERROR 临时目录不可用，本格未执行（mktemp 失败或目录非空）\n' "$label"
    return
  fi
  rc=$( cd "$d" 2>/dev/null || { echo "$CD_FAIL"; exit 0; }; /bin/zsh -c "$cmd" >/dev/null 2>&1; echo $? )
  if [ "$rc" = "$CD_FAIL" ]; then
    printf '  %-34s ERROR 切换到临时目录失败，本格未执行\n' "$label"
    return
  fi
  files=$( cd "$d" && ls -1A 2>/dev/null | tr '\n' ' ' )
  printf '  %-34s rc=%s  建出文件: %s\n' "$label" "$rc" "${files:-（无）}"
}

# err 与 rc **一次执行同时取**（代码双审 CODEX-03 ≡ AGY-02 ≡ GLM-02）。
# 此前分两次跑同一条命令：第一次取 stderr、第二次取 rc，`files` 是两遍的并集。
# 本批形态恰好无状态所以数据没失真，但结构埋雷——只要有人加一格带状态的形态
# （追加写、noclobber、目标已存在），报错文本来自第一轮、退出码来自第二轮，
# 表会**看起来完全正常地错**。stderr 先落到 PROBE_ROOT 下（不进 case 目录，
# 否则它自己会被当成「建出文件」），取完 rc 再读。
probe_bash() {
  local label="$1" cmd="$2" extra_flag="${3:-}"
  local d rc files err errfile
  d=$(_case_dir)
  if ! _case_dir_ok "$d"; then
    printf '  %-34s ERROR 临时目录不可用，本格未执行（mktemp 失败或目录非空）\n' "$label"
    return
  fi
  errfile="$PROBE_ROOT/err.$$"
  if [ -n "$extra_flag" ]; then
    ( cd "$d" 2>/dev/null || exit "$CD_FAIL"; /bin/bash "$extra_flag" -c "$cmd" >/dev/null 2>"$errfile" ); rc=$?
  else
    ( cd "$d" 2>/dev/null || exit "$CD_FAIL"; /bin/bash -c "$cmd" >/dev/null 2>"$errfile" ); rc=$?
  fi
  if [ "$rc" = "$CD_FAIL" ]; then
    printf '  %-34s ERROR 切换到临时目录失败，本格未执行\n' "$label"
    rm -f "$errfile"
    return
  fi
  err=$(head -1 "$errfile" 2>/dev/null)   # 与 probe_delete 口径一致：只取首行，
  rm -f "$errfile"                        # 多行 stderr 会打断表格行结构（GLM-05）
  files=$( cd "$d" && ls -1A 2>/dev/null | tr '\n' ' ' )
  printf '  %-34s rc=%s  建出文件: %-12s %s\n' "$label" "$rc" "${files:-（无）}" "${err}"
}

echo "── zsh：文件目标族（建出同名文件即为文件重定向）──"
probe_zsh '> 2'              'echo X > 2'
probe_zsh '>> 2'             'echo X >> 2'
probe_zsh '&> 2'             'echo X &> 2'
probe_zsh '&>> 2'            'echo X &>> 2'
probe_zsh '>>& 2'            'echo X >>& 2'
probe_zsh '>>&2（紧贴）'      'echo GLUED >>&2'
probe_zsh '>&2foo（等值防线）' 'echo Y >&2foo'
probe_zsh '2>& t1.txt'       'echo ERRLINE 2>& t1.txt'
probe_zsh '2>&t2.txt（紧贴）' '{ echo A; echo B >&2; } 2>&t2.txt'
probe_zsh '>>& sep.txt'      'echo SEP >>& sep.txt'
probe_zsh '>>&glu.txt（紧贴）' 'echo GLU >>&glu.txt'
probe_zsh '2>>&1'            '{ echo OUT; echo ERR >&2; } 2>>&1'
probe_zsh '>>&-'             'echo X >>&-'
echo
echo "── zsh：强制覆盖后缀族（后缀消去 fd 语义）──"
probe_zsh '>&| t1.txt'       'echo P1 >&| t1.txt'
probe_zsh '>&! t2.txt'       'echo P2 >&! t2.txt'
probe_zsh '&>| t3.txt'       'echo P3 &>| t3.txt'
probe_zsh '&>! t4.txt'       'echo P4 &>! t4.txt'
probe_zsh '2>&| t5.txt'      'echo P5 2>&| t5.txt'
probe_zsh '2>&! t6.txt'      'echo P6 2>&! t6.txt'
echo "  ↓ 同族配纯数字/减号目标 —— r5 的 isFdOp 误把它们当 fd 操作排除（三侧同时命中）"
probe_zsh '>&| 2'            'echo A >&| 2'
probe_zsh '>&!2（紧贴）'      'echo B >&!2'
probe_zsh '>&| -'            'echo C >&| -'
probe_zsh '2>&! 1'           'echo D 2>&! 1'
echo
echo "── zsh：普通强制覆盖后缀 ──"
probe_zsh '>| p1.txt'        'echo P >| p1.txt'
probe_zsh '>! p2.txt'        'echo Q >! p2.txt'
probe_zsh '>>| p3.txt'       'echo R >>| p3.txt'
probe_zsh '>>! p4.txt'       'echo S >>! p4.txt'
echo
echo "── zsh：真正的 fd 操作（不建文件）──"
probe_zsh '>& 2（分离）'      'echo HELLO >& 2'
probe_zsh '>& -（分离）'      'echo X >& -'
# 紧贴形态补测（代码双审 CODEX-05）：判据最常走的就是「被排除」这一侧，
# 此前只测了分离形态，紧贴族靠 POSIX 常识采信而用例组头却声称每格都有实测行。
probe_zsh '>&2（紧贴）'       'echo X >&2'
probe_zsh '2>&1（紧贴）'      'echo X 2>&1'
probe_zsh '1>&2（紧贴）'      'echo X 1>&2'
probe_zsh '>&-（紧贴）'       'echo X >&-'
probe_zsh '2>&-（紧贴）'      'echo X 2>&-'
echo
echo "── zsh：纯减号目标是文件名（与上组对照）──"
probe_zsh '> -'              'echo X > -'
echo
echo "── zsh：文法之外（已知残余，本主题不修）──"
probe_zsh '{fd}> fdvar.txt'  'echo T {fd}> fdvar.txt'
probe_zsh '>>&&x（应语法错）'  'echo Z >>&&x'
echo
echo "── bash 3.2 对照：同形态未必可达 ──"
probe_bash '2>&b1.txt'          '{ echo A; echo B >&2; } 2>&b1.txt'
probe_bash '2>&b2.txt(--posix)' '{ echo A; echo B >&2; } 2>&b2.txt' '--posix'
probe_bash '>>& f'              'echo X >>& f'
probe_bash '>& bashsep.txt'     'echo X >& bashsep.txt'
echo
echo "结论（计划 r6 §1.4.2 三条）："
echo "  1. fd 语义只属于**无强制覆盖后缀**的 [n]>& 一族；"
echo "     >>& / &> / >&| / >&! 含 & 却都是文件重定向。"
echo "  2. 同一 fd 族内，目标**恰为**纯数字或 - 才是 fd 操作；"
echo "     >&2foo 建出文件，故判据须等值、不可前缀。"
echo "  3. 文本判据外壳无关，取各外壳拼写的并集——"
echo "     某拼写在别的外壳下退非零时，exit_code === 0 的契约已把它挡在判定层外。"
