/**
 * `command-trace` 族的写命令判据（设计 §10.3 / §11.1，M8 第 3 步）。
 *
 * 本文件守的是**误报方向**——计划双审 GLM-02 指出：原测试计划四条变异
 * 没有一条守这个方向，而 §3.3 自己写了「误判成写 ⇒ 整侧作废」，
 * 代价更高的那一侧反而零覆盖。
 *
 * 误报的后果不是一条断言失败，是审查员被扣上「只读失守」并整侧作废，
 * 所以这里的负断言与正断言同等重要。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WRITE_VERBS_FOR_PARITY,
  WRITE_TARGET_VERBS_FOR_PARITY,
  classifyWriteCommands,
  extractPathTokens,
} from '../../src/trivium/adapters/base.js';

import { IS_WIN } from '../helpers/platform.js';

// Windows 移植：win32 的 path.isAbsolute 不认 '/proj' 这类盘相对形态；引号串里的 POSIX 绝对路径统一补 ${ABS} 盘符根（macOS 上为空串，字面不变）
const ABS = IS_WIN ? 'D:' : '';

const ROOT = `${ABS}/proj`;

function classify(...cmds: string[]) {
  return classifyWriteCommands(cmds, ROOT);
}

// ───────────────────────── 两张表的对账 ─────────────────────────

test('对账：cd / pushd 在参数位表里，但绝不在写动词集里', () => {
  /*
   * 这条用例是 M8 第 3 步计划双审那个 blocker 的守卫。
   *
   * `WRITE_VERB_TARGET` 回答「这个参数位算不算读证据」——`cd` 必须在其中，
   * 它的参数是目录、不是被读的文件；`WRITE_VERBS` 回答「这是不是写操作」——
   * `cd` 绝不能在其中，它不发生任何写系统调用。
   *
   * 两张表键集相似而语义不同，曾被计划稿以「防漂移」为由主张合并。
   * 真要合并，这条用例会当场红。
   */
  for (const verb of ['cd', 'pushd']) {
    assert.ok(
      WRITE_TARGET_VERBS_FOR_PARITY.includes(verb),
      `${verb} 应当在 WRITE_VERB_TARGET 里（它的参数是目录，不算读证据）`,
    );
    assert.ok(
      !WRITE_VERBS_FOR_PARITY.includes(verb),
      `${verb} 不得在写动词集里——它不发生写系统调用，判它为写会让正常审查整侧作废`,
    );
  }
});

// ───────────────────────── 误报方向（负断言） ─────────────────────────

test('负断言：cd 不产生写事件——这是真机实测录到的第二条命令', () => {
  // 本步隔离实测里模型实跑的形态，exit_code: 0、status: completed
  const r = classify("/bin/zsh -lc 'cd . && echo ok; echo \"exit=$?\"'");
  assert.deepEqual(r.writes, [], 'cd 被判成写事件 ⇒ 整侧以「只读失守」作废');
  assert.deepEqual(r.suspected, []);
});

test('负断言：审查员开头 cd 再 grep 的常见形态完全干净', () => {
  const r = classify('cd src/trivium && grep -rn foo .');
  assert.deepEqual(r.writes, []);
  assert.deepEqual(r.suspected, []);
});

test('负断言：读命令与设备重定向不进任何一档', () => {
  const r = classify(
    "/bin/zsh -lc 'ls -la; head -n 1 sample.txt'", // 实测录到的第一条命令
    'find . 2>/dev/null',
    `grep -rn x src > /dev/null`,
    'git log -p --stat',
  );
  assert.deepEqual(r.writes, []);
  assert.deepEqual(r.suspected, []);
});

test('疑似档：幂等空操作不判失守', () => {
  const r = classify('mkdir -p src/existing', 'rm -f src/gone.ts');
  assert.deepEqual(r.writes, [], '幂等形态成功退出不等于发生了写入');
  assert.equal(r.suspected.length, 2);
  assert.ok(r.suspected.every((s) => s.why.includes('幂等')));
});

test('疑似档：掩码结构让整条退出码与写段成功脱钩', () => {
  const r = classify('touch src/x.ts || true');
  assert.deepEqual(r.writes, []);
  assert.equal(r.suspected.length, 1);
  assert.ok(r.suspected[0]!.why.includes('掩码'));
});

test('疑似档：项目外写入留痕但不判失守', () => {
  /*
   * 裁决依据是自洽性：codex 每次运行都往 $CODEX_HOME/sessions/ 写会话文件，
   * 而生效模型的回读正是靠读它。项目外写入若算失守，这条流水线赖以工作的
   * 那次写入自己就会把每一轮判成失守。
   */
  const r = classify(`cp src/a.ts ${ABS}/tmp/leak.ts`);
  assert.deepEqual(r.writes, []);
  assert.equal(r.suspected.length, 1);
  assert.ok(r.suspected[0]!.why.includes('项目外'));
});

test('疑似档：命中写动词但目标提不出来', () => {
  const r = classify('cp $SRC $DST');
  assert.deepEqual(r.writes, []);
  assert.equal(r.suspected.length, 1);
  assert.ok(r.suspected[0]!.why.includes('提不出'));
});

// ───────────────────────── 漏报方向（正断言） ─────────────────────────

test('正断言：项目内的真实写入必须判失守', () => {
  const cases = [
    'echo BREACH > src/x.ts',
    "/bin/zsh -lc 'echo more >> src/a.ts'",
    `cp ${ABS}/tmp/payload src/b.ts`,
    'tee src/out.txt',
    'rm src/a.ts',
    'mv src/a.ts src/b.ts',
    'chmod +x scripts/build.sh',
    'dd if=/dev/zero of=src/blob.bin',
  ];
  for (const c of cases) {
    const r = classify(c);
    assert.deepEqual(r.writes, [c], `这条应当判为写事件：${c}`);
  }
});

test('正断言：ln 只把链接名当写入点，不把源当写入点', () => {
  // `ln -s src/a.ts /tmp/link` 创建的是 /tmp/link，源在项目内不构成写入
  const outward = classify(`ln -s src/a.ts ${ABS}/tmp/link`);
  assert.deepEqual(outward.writes, []);
  assert.ok(outward.suspected[0]!.why.includes('项目外'));

  const inward = classify(`ln -s ${ABS}/tmp/payload src/link.ts`);
  assert.deepEqual(inward.writes, [`ln -s ${ABS}/tmp/payload src/link.ts`]);
});

test('同一条命令重复出现时不重复计数', () => {
  const r = classify('echo x > src/a.ts', 'echo x > src/a.ts');
  assert.equal(r.writes.length, 1);
});

// ───────────── 掩码判据（r9 双审 AGY-02 ≡ GLM-01，blocker 的锁例） ─────────────

/*
 * 这一组每一条都对应 r9 实跑复现过的一个失效形态。
 *
 * 原实现 `/\|\||;|&(?!&)/` 的负向前瞻只看后一个字符：`&&` 的第二个 `&` 后面是空格，
 * 断言通过 ⇒ 命中。于是凡带 `&&` 链或 `2>&1` 后缀的真实写入全部降档为疑似，
 * 而 `guard.ts` 以 write_events 非空为只读失守的唯一判据——**加个 2>&1 就能绕过**。
 *
 * 代码注释当时已经写着「&& 不算掩码」，却没有任何用例断言它。本组就是那些断言。
 */

test('掩码：&& 链里的真实写入必须判失守（注释一直这么写，此前无用例守）', () => {
  const c = 'cd . && echo x > src/a.ts';
  assert.deepEqual(classify(c).writes, [c], 'a && b 退 0 意味着两段都成功，不是掩码');
});

test('掩码：fd 重定向不是掩码（2>&1 / >&2 / &>）', () => {
  for (const c of [
    'echo x > src/a.ts 2>&1',
    `cp ${ABS}/tmp/a src/b.ts 2>&1`,
    'echo x > src/a.ts >&2', // 标题一直写着 >&2，cases 里却没有（EV-79 计划 §4 承诺补齐）
    `echo x > src/a.ts &> /dev/null`,
  ]) {
    assert.deepEqual(classify(c).writes, [c], `这不是掩码结构，是重定向：${c}`);
  }
});

test('掩码：|| 与 ; 仍判掩码（既有行为不得变）', () => {
  for (const c of ['touch src/x.ts || true', 'touch src/x.ts ; true']) {
    const r = classify(c);
    assert.deepEqual(r.writes, [], `整条退出码不代表写段成功：${c}`);
    assert.ok(r.suspected[0]!.why.includes('掩码'));
  }
});

test('掩码：管道与后台也让整条退出码与写段脱钩', () => {
  for (const c of ['touch src/x.ts | true', 'touch src/x.ts & echo done']) {
    const r = classify(c);
    assert.deepEqual(r.writes, [], `无 pipefail / 后台执行时整条退出码不反映写段：${c}`);
  }
});

// ───────────── 写入位与过滤面（r9 双审 AGY-01/03/05 ≡ GLM-02/03/04） ─────────────

test('目标面：无扩展名的裸文件名也是路径（Makefile / LICENSE / build）', () => {
  /*
   * 上一版用「含 / 或带扩展名」当路径判据，把这一族整个滤掉：
   * `echo bad > Makefile` **两档都不进**（重定向目标被滤空，echo 又不在写动词表），
   * 其余降级成「提不出目标」。而 codex 的 cwd 就是项目根，裸相对名是模型的自然写法。
   */
  for (const c of ['echo bad > Makefile', 'rm Makefile', 'mkdir build', 'touch LICENSE']) {
    assert.deepEqual(classify(c).writes, [c], `项目内的真实写入：${c}`);
  }
});

test('目标面：解析不了的 token 仍归疑似（变量、命令替换、通配）', () => {
  for (const c of ['cp $SRC $DST', 'rm src/*.ts']) {
    const r = classify(c);
    assert.deepEqual(r.writes, [], `静态解析不出目标就不下判决：${c}`);
    assert.ok(r.suspected[0]!.why.includes('提不出'));
  }
});

test('写入位：chmod / chown 的第一个操作数是 mode / owner，不是目标', () => {
  // chown 的 owner 含点时会被旧判据当成路径（user.name → /proj/user.name）而误报失守
  const r = classify(`chown user.name ${ABS}/tmp/target.ts`);
  assert.deepEqual(r.writes, [], 'owner 不是写入目标，真实目标在项目外');
  assert.ok(r.suspected[0]!.why.includes('项目外'));

  assert.deepEqual(classify('chmod 644 src/a.ts').writes, ['chmod 644 src/a.ts']);
  assert.deepEqual(classify('chmod +x scripts/b.sh').writes, ['chmod +x scripts/b.sh']);
});

test('写入位：重定向记号不得混进写动词的操作数', () => {
  // `cp a b 2>&1` 的 last 操作数曾被取成 `2>&1`，于是真实写入落到「提不出目标」
  const c = `cp ${ABS}/tmp/a src/b.ts 2>&1`;
  assert.deepEqual(classify(c).writes, [c]);
});

test('写入位：ln 单操作数形态的目标是 cwd 下的 basename', () => {
  // POSIX：`ln -s /etc/passwd` 创建的是 ./passwd——在项目内
  const c = `ln -s ${ABS}/etc/passwd`;
  assert.deepEqual(classify(c).writes, [c], '取源路径会把项目内的写入误判成项目外');
});

test('写入位：-t / --target-directory 指定的目录才是目标', () => {
  const outward = classify('ln -s -t /tmp src/a.ts');
  assert.deepEqual(outward.writes, [], '真实写入在 /tmp，项目内的源不是写入点');

  const inward = `cp -t src ${ABS}/tmp/a.ts ${ABS}/tmp/b.ts`;
  assert.deepEqual(classify(inward).writes, [inward], '真实目标 src/ 在项目内');

  const inline = `cp --target-directory=src ${ABS}/tmp/a.ts`;
  assert.deepEqual(classify(inline).writes, [inline]);
});

test('幂等：长旗标 --parents / --force 也要认出来', () => {
  // 判不出幂等 ⇒ 把没有实际写入的成功命令判成失守 ⇒ 整侧作废（误杀方向）
  for (const c of ['mkdir --parents src/existing', 'rm --force src/gone.ts']) {
    const r = classify(c);
    assert.deepEqual(r.writes, [], `幂等空操作不判失守：${c}`);
    assert.ok(r.suspected[0]!.why.includes('幂等'));
  }
});

// ───────────── 幂等的边界：递归 + 强制（EV-79 缺口一） ─────────────

test('幂等：递归 + 强制不算幂等形态，四种写法都进 writes', () => {
  /*
   * 单调性违背：`rm -r X` 今天判 writes，加上 `-f` 反而降级到疑似——
   * 给命令增加破坏性旗标却让判定变轻。
   *
   * 后两条是**分类器直调的合成输入**：本机 BSD rm 不接受长旗标（实测退 64），
   * 它们不会作为真实轨迹出现。但判据是纯文本分类、与外壳无关，
   * 用例仍有效，**不得因「本机不可达」被删**。
   */
  for (const c of [
    'rm -rf src/existing-dir',
    'rm -r --force src/existing-dir',
    'rm -R -f src/existing-dir',
    'rm --recursive --force src/existing-dir',
  ]) {
    assert.deepEqual(classify(c).writes, [c], `递归 + 强制是破坏性写入，不是幂等空操作：${c}`);
  }
});

test('幂等：簇合形态的递归旗标也要认出来（-fr / -vrf）', () => {
  // 与 `-\w*f` 同款用 `/^-\w*[rR]/`，别漏掉旗标挤在一起的写法
  for (const c of ['rm -fr src/existing-dir', 'rm -vrf src/existing-dir']) {
    assert.deepEqual(classify(c).writes, [c], `簇合旗标里的 r/R 同样是递归：${c}`);
  }
});

test('幂等：单调性基线——无 -f 的递归删除本来就判 writes', () => {
  /*
   * 这是 D1 单调性论证的另一半：没有它，「加 -f 反而变轻」这句话在用例里无从对照。
   * 目标存在时 `rm -r` 退 0、完全可达，判 writes 正是这条判据今天的**正确检出**。
   */
  const c = 'rm -r src/existing-dir';
  assert.deepEqual(classify(c).writes, [c], '真实发生的递归删除就该判失守');
});

test('幂等：收紧不得溢出——无 -r 的 -f 与 mkdir -p 仍判幂等', () => {
  // r9 GLM-03 挣来的行为；改 idempotent 一处要守住另一半
  for (const c of ['rm -f src/gone.ts', 'rm --force src/gone.ts', 'mkdir --parents src/existing']) {
    const r = classify(c);
    assert.deepEqual(r.writes, [], `非递归的幂等形态不得被本次收紧误伤：${c}`);
    assert.ok(r.suspected[0]!.why.includes('幂等'));
  }
});

// ═══════════ 重定向运算符族（EV-79 缺口二） ═══════════
//
// 判别轴是**运算符形态**，不是残留：同一残留 `&2`，在 `>&2` 是 fd 复制、
// 在 `>>&2` 是往名为 2 的文件写。四条规则见 EV-79 r6 计划 §3.1。
//
// 本组用例的每一格都对应 r6 §1.4.2 的一行外壳实测（zsh 5.9 / bash 3.2.57），
// 判别法是「跑完看目录里建出了什么文件」。

test('重定向：前置 & 的双流写入进 writes（&> / &>>，紧贴与分离）', () => {
  for (const c of [
    'echo secret &> src/leak.txt',
    'echo secret &>src/leak.txt',
    'echo secret &>> src/leak.txt',
    'echo secret &>>src/leak.txt',
  ]) {
    assert.deepEqual(classify(c).writes, [c], `&> 是双流文件重定向，目标就是写入点：${c}`);
  }
});

test('重定向：后置 & 的双流写入进 writes（>& / 2>&，紧贴与分离）', () => {
  /*
   * 收进写面在两个外壳下都不亏（r6 D6）：某拼写若在别的外壳下退非零，
   * `succeededCommands` 的 `exit_code === 0` 契约已把它挡在判定层外。
   *
   * **不要写「bash 下这些形态退非零」**——分离写法的 `>& 文件` 在 bash 3.2 下
   * rc=0 且真建文件（r6 §1.4.2 bash 对照表末行）；退非零的只有带数字前缀的 `2>&文件`。
   */
  for (const c of [
    'echo secret >& src/leak.txt',
    'echo secret >&src/leak.txt',
    'echo secret 2>& src/leak.txt',
    'echo secret 2>&src/leak.txt',
  ]) {
    assert.deepEqual(classify(c).writes, [c], `>& 后跟非数字目标是文件重定向：${c}`);
  }
});

test('重定向：双流追加进 writes（>>& / 2>>&）', () => {
  for (const c of [
    'echo secret >>& src/leak.txt',
    'echo secret >>&src/leak.txt',
    'echo x 2>>&1',
    'echo x >>&-',
  ]) {
    assert.equal(classify(c).writes.length, 1, `>>& 含 >& 却是双流追加文件重定向：${c}`);
  }
});

test('重定向：普通数字/减号目标是文件名，不是 fd（r4 回归面）', () => {
  /*
   * r4 曾在「非 fd 族」那一格加过「下一 token 是纯数字或 - 就排除」的分流，
   * 把今天判 writes 的 `echo x > 2` 降成双空——静默漏检。
   * 实测：`> 2` / `>> 2` / `&> 2` / `>>& 2` 全部建出名为 2 的文件。
   */
  for (const c of [
    'echo x > 2',
    'echo x >> 2',
    'echo x &> 2',
    'echo x >>& 2',
    'echo x > -',
  ]) {
    assert.deepEqual(classify(c).writes, [c], `这些运算符没有 fd 语义，目标位是文件名：${c}`);
  }
});

test('重定向：clobber 后缀消去 fd 语义，数字目标仍是文件（r5 回归面）', () => {
  /*
   * r5 的 isFdOp 写成 `/^[0-9]*>&[|!]?$/`，把 `>&|` / `>&!` 划进了 fd 族，
   * 于是这一族配纯数字目标时被当 fd 操作排除——与 r4 同类的静默漏检，只是换了格子。
   * 实测：`>&| 2` 建出文件 2、`>&!2` 建出 2、`>&| -` 建出 -、`2>&! 1` 建出 1。
   *
   * **isFdOp 不得带 `[|!]?`。**
   */
  for (const c of [
    'echo x >&| 2',
    'echo x >&|2',
    'echo x >&!2',
    'echo x >&| -',
    'echo x 2>&! 1',
  ]) {
    assert.deepEqual(classify(c).writes, [c], `clobber 后缀下目标位恒为文件：${c}`);
  }
});

test('重定向：普通强制覆盖后缀的目标不带前导符号（>| / >! / >>| / >>!）', () => {
  // 今天旧正则只吞掉 `>`，残留 `|p1.txt` 被当成目标——目标被错记
  for (const c of [
    'echo P >| src/p1.txt',
    'echo P >|src/p1.txt',
    'echo Q >! src/p2.txt',
    'echo R >>| src/p3.txt',
    'echo S >>! src/p4.txt',
  ]) {
    assert.deepEqual(classify(c).writes, [c], `强制覆盖仍是文件重定向：${c}`);
  }
});

test('重定向：等值防线——>&2foo 是文件，不是 fd 复制', () => {
  // 实测 `echo Y >&2foo` 建出名为 2foo 的文件。判据按前缀实现会把它误排除（静默漏检方向）
  const c = 'echo Y >&2foo';
  assert.deepEqual(classify(c).writes, [c], '& 后必须“恰为”纯数字才是 fd 操作');
});

test('重定向：真正的 fd 操作一档都不进（紧贴）', () => {
  for (const c of ['echo x >&2', 'echo x 2>&1', 'echo x 1>&2', 'echo x >&-', 'echo x 2>&-']) {
    const r = classify(c);
    assert.deepEqual(r.writes, [], `fd 复制/关闭不是文件写入：${c}`);
    assert.deepEqual(r.suspected, [], `也不该留疑似：${c}`);
  }
});

test('重定向：分离形态的 fd 操作一档都不进（>& 2 / >& -）', () => {
  /*
   * r4 的分界表没给分离形态分流，会把 `2` / `-` 当写入目标、归一成 /proj/2 ⇒ 假失守。
   * 实测这两条 rc=0 且不产生任何文件。
   */
  for (const c of ['echo x >& 2', 'echo x >& -']) {
    const r = classify(c);
    assert.deepEqual(r.writes, [], `分离写法的 fd 操作同样不是文件写入：${c}`);
    assert.deepEqual(r.suspected, [], `也不该留疑似：${c}`);
  }
});

test('重定向：被排除的 fd 目标仍须消费，不得混进写动词操作数', () => {
  /*
   * 写动词操作数靠 `!consumed.has(i)` 过滤。分离形态排除 fd 目标时若不 consume，
   * 那个数字会留在 args 里，mode === 'last' 的动词把它当最后一个操作数——
   * 写目标被篡改成 `2`。与既有用例「写入位：重定向记号不得混进写动词的操作数」同族。
   */
  const c = `cp ${ABS}/tmp/a src/b.ts >& 2`;
  const r = classify(c);
  assert.deepEqual(r.writes, [c], 'cp 的写目标是 src/b.ts，命令仍判失守');
  assert.deepEqual(r.suspected, [], '目标在项目内且可解析，不该进疑似档');
});

test('重定向：作废面——项目内的双流日志重定向按正确失守处理', () => {
  // r6 D5：与 `> build.log` 同权，不设豁免。动词 make 不在写动词表里，靠重定向取到目标
  const c = 'make -j4 &> build.log';
  assert.deepEqual(classify(c).writes, [c], '把构建日志写进项目根同样违反只读承诺');
});

// ───────────── 读面：修掉假读取与垃圾 token ─────────────

test('读面：双流重定向的目标不再算读取路径（负断言）', () => {
  /*
   * 危害不在措施 a——它只吃真实读取事实、不吃回填
   * （锚：base.ts 里 `effectiveReadPaths` 上方「**消费方只有三处**」那段文档注释；
   *   guard.ts 里「措施 a **只吃真实读取事实**」那段）。
   * 回填喂的是 checkEvidence 的 projectReads 与 judgeSide 的 consulted 交叉核对，
   * 所以污染读面 = 让审查员能借一条从未读过的路径坐实虚假的 consulted 声明（证据自证）。
   */
  for (const c of [
    'echo secret &> src/leak.txt',
    'echo secret >& src/leak.txt',
    'echo secret 2>& src/leak.txt',
    'echo secret >>& src/leak.txt',
  ]) {
    assert.ok(
      !extractPathTokens(c).includes('src/leak.txt'),
      `重定向目标是写入点、不是读取证据：${c}`,
    );
  }
});

test('读面：紧贴 &> 的整条 token 不再进读面（垃圾 token）', () => {
  // 今天 `&>src/leak.txt` 认不出是重定向，整串因含 / 被「像路径」判据收走、还计入 projectReads
  const c = 'echo secret &>src/leak.txt';
  const reads = extractPathTokens(c);
  assert.ok(!reads.includes('&>src/leak.txt'), '运算符与目标粘在一起的串不是路径');
  assert.ok(!reads.includes('src/leak.txt'), '剥出来的目标也是写入点，不是读取');
});

test('读面：普通读命令仍算读取（正断言）', () => {
  assert.ok(extractPathTokens('cat src/a.ts').includes('src/a.ts'), '别把读面一起修没了');
  const mixed = extractPathTokens(`grep foo src/a.ts &> /dev/null`);
  assert.ok(mixed.includes('src/a.ts'), '被 grep 的文件是真实读取');
  assert.ok(!mixed.includes(`/dev/null`), '重定向目标不是读取');
});

test('读面：引号内的 &> 字面量不受影响（免疫锁例）', () => {
  /*
   * 免疫不是本族判据给的，而是引号剥离给的
   * （锚：base.ts 里两处 `const dequoted = cmd.replace(/(['"`])…`——
   *   `extractPathTokens` 与 `classifyWriteCommands` 各一份）：
   * 含 & 的引号段整体换成空格，`&>` 根本不成为 token。改引号口径会踢翻它。
   */
  const c = "grep -n '&>' src/a.ts";
  assert.deepEqual(classify(c).writes, [], '搜索模式里的 &> 不是重定向');
  assert.ok(extractPathTokens(c).includes('src/a.ts'), '被搜索的文件仍是真实读取');
});

// ───────────── 目标钉死：writes 只给命令原文，靠项目内外之差反推目标 ─────────────
//
// `WriteCommandClassification.writes` 是 string[]、只有命令行原文，
// 所以「目标取对了没有」无法直接断言。这两条用**项目外目标**构造可分辨的落点：
// 取对了 ⇒ 项目外 ⇒ 进疑似档；取错了 ⇒ 错目标归一到项目内 ⇒ 进 writes。
// 变异验证里「去掉 [|!]?」与「去掉 consumed.add」两项，正是靠这两条才杀得死。

test('目标钉死：强制覆盖后缀必须被运算符吞掉，不得留进目标', () => {
  /*
   * 若 REDIRECT_RE 不认 `[|!]`，`>&|` 只吞掉 `>&`，残留 `|/tmp/out.txt` 被当目标，
   * 归一成 /proj/|/tmp/out.txt ⇒ 落在项目内 ⇒ 误判失守。
   */
  const r = classify(`echo x >&| ${ABS}/tmp/out.txt`);
  assert.deepEqual(r.writes, [], `真实目标 ${ABS}/tmp/out.txt 在项目外，不构成失守`);
  assert.equal(r.suspected.length, 1);
  assert.ok(r.suspected[0]!.why.includes('项目外'), `目标应是 /tmp/out.txt：${r.suspected[0]?.why}`);
});

test('目标钉死：普通强制覆盖同理（>| 的 | 不是目标的一部分）', () => {
  const r = classify(`echo x >| ${ABS}/tmp/out.txt`);
  assert.deepEqual(r.writes, []);
  assert.ok(r.suspected[0]!.why.includes('项目外'));
});

test('目标钉死：被排除的 fd 编号不得顶替写动词的真实目标', () => {
  /*
   * `cp src/a.ts /tmp/out.ts >& 2`：真实写入点是 /tmp/out.ts（项目外）。
   * 若分离支漏了 consumed.add，`2` 会留在 args 里，mode === 'last' 取到它，
   * 归一成 /proj/2 ⇒ 落在项目内 ⇒ 把一次项目外写入误判成只读失守。
   */
  const r = classify(`cp src/a.ts ${ABS}/tmp/out.ts >& 2`);
  assert.deepEqual(r.writes, [], `cp 的目标是 ${ABS}/tmp/out.ts，在项目外`);
  assert.equal(r.suspected.length, 1);
  assert.ok(r.suspected[0]!.why.includes('项目外'), `目标被 fd 编号顶替了：${r.suspected[0]?.why}`);
});

// ───────────── 强制覆盖族在读面的锁（代码双审 CODEX-02 ≡ GLM-01） ─────────────
//
// 消费点① 的条件是「整个运算符被吞掉、残留为空才 skip 下一 token」，
// 它的成立**前提**是 REDIRECT_RE 的 `[|!]?` 把强制覆盖后缀也吞进 op。
// 这个前提此前只被**写面**的目标钉死用例经同一常量间接守住，读面零断言。
//
// 实测（把文法的 `[|!]?` 去掉后）：
//   `>&! f` / `>>! f` ⇒ 目标**重新漏进读面**  ← 真漏点
//   `>&| f` / `>| f`  ⇒ 读面仍空，但那是**另一条正则碰巧挡住的**，见下一条用例

test('读面：! 后缀族的分离目标不算读取（真漏点，靠本族文法挡住）', () => {
  /*
   * **只放 `!` 族**（代码双审 GLM-07）：`!` 不参与读面的段切分，
   * 挡住它的确实是本族文法把 `[|!]?` 整体吞进运算符。
   * `|` 族另有机制、归下一条对照用例——两条各守一个机制，
   * 谁红就知道根因在哪条正则；混在一起会同时红而线索指错方向。
   */
  for (const c of ['echo x >&! src/leak.txt', 'echo x >>! src/leak.txt']) {
    assert.deepEqual(
      extractPathTokens(c),
      [],
      `强制覆盖仍是重定向，目标是写入点不是读取证据：${c}`,
    );
  }
});

test('读面：| 后缀族靠另外两条规则挡住，是耦合不是设计（对照用例）', () => {
  /*
   * `>&|` / `>|` 即便文法少吞一段也不漏，原因不在本族判据，而是**两条规则合起来**
   * （代码双审 CODEX-06 更正了我原先只归给前者的说法）：
   *   ① 读面的段分隔正则 /\|\||&&|[|;()]/ **没有 lookbehind**，把运算符尾部的 `|`
   *      当成段分隔符切走；
   *   ② 切出的第二段里，目标落在**段首**，被 extractFromSegment 的 `skip.add(0)`
   *      当动词位吞掉。
   * 改①或改②中任何一条，`|` 族都会退化成和 `!` 族一样的漏点——这条用例是那时唯一的线索。
   *
   * **切分不是无害的**：实测 `echo x >| src/leak.txt src/other.ts` ⇒ ["src/other.ts"]，
   * 目标被段首规则吞掉后，**同段其后的 token 反而以读取身份出现**。
   * 这一格已登记进 EV-100 一族（读面写目标位扫描的残留）。
   */
  assert.deepEqual(extractPathTokens('echo x >&| src/leak.txt'), []);
  assert.deepEqual(extractPathTokens('echo x >| src/leak.txt'), []);
  assert.deepEqual(
    extractPathTokens('echo x >| src/leak.txt src/other.ts'),
    ['src/other.ts'],
    '切分的副作用：目标被段首吞掉，其后的 token 冒充读取（EV-100 一族）',
  );
});

test('目标钉死：紧贴形态的后置 & 必须被运算符吞掉（GLM-01 补的剩余格）', () => {
  /*
   * 「去掉 &?」这项变异此前只在读面被杀。写面紧贴形态分辨不出：
   * 目标错取成 `&/tmp/out.txt` 后归一进项目内，命令照样判 writes。
   * 改用项目外目标即可分辨——取对了落疑似档，取错了落 writes。
   */
  const r = classify('echo x >&/tmp/out.txt');
  assert.deepEqual(r.writes, [], `真实目标 ${ABS}/tmp/out.txt 在项目外，不构成失守`);
  assert.equal(r.suspected.length, 1);
  assert.ok(r.suspected[0]!.why.includes('项目外'), `目标应是 /tmp/out.txt：${r.suspected[0]?.why}`);
});

test('重定向：目标本身以重定向记号开头时不得被二次解析（AGY-02）', () => {
  /*
   * `echo x > '>/tmp/out'` 的目标 token 是 `>/tmp/out`（引号剥离不改它，内层无空白无分隔符）。
   * 循环若不先看 consumed，下一轮会把它当新运算符、紧贴支再推一个 `/tmp/out` 进 sinks。
   *
   * **目标必须放在项目外才有判别力**（代码双审 CODEX-01 ≡ GLM-01）：
   * 若两个目标都在项目内（原先写的 `'>foo'`），二次解析产生的重复 sink 会被
   * `writes: [...new Set(writes)]` 去重，`writes.length` 与 `suspected` 在
   * 变异前后完全同形——断言分辨不出，那条用例是**空枪**（实测：删掉防御后 48 条全绿）。
   * 换成这个构造后两种实现的观测**确实不同**（已实测）：
   *   防御在   ⇒ sinks = ['>/tmp/out']          ——不以 `/` 打头、归一进 /proj/ 之下
   *                ⇒ writes 一条、**suspected 空**
   *   防御去掉 ⇒ sinks = ['>/tmp/out', '/tmp/out'] ——二次解析剥出的那个是绝对路径
   *                ⇒ writes 仍一条（去重），但**多出一条「写入目标在项目外」疑似**
   * 判别点就在 suspected：它从空变成 1 条。
   */
  const c = "echo x > '>/tmp/out'";
  const r = classify(c);
  assert.deepEqual(r.writes, [c], '目标 >/tmp/out 归一后落在项目内');
  assert.deepEqual(
    r.suspected,
    [],
    `二次解析会把 ${ABS}/tmp/out 剥成第二个 sink 并落「项目外」疑似——出现即说明防御失效`,
  );
});
