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
} from '../../src/trivium/adapters/base.js';

const ROOT = '/proj';

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
    'grep -rn x src > /dev/null',
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
  const r = classify('cp src/a.ts /tmp/leak.ts');
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
    'cp /tmp/payload src/b.ts',
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
  const outward = classify('ln -s src/a.ts /tmp/link');
  assert.deepEqual(outward.writes, []);
  assert.ok(outward.suspected[0]!.why.includes('项目外'));

  const inward = classify('ln -s /tmp/payload src/link.ts');
  assert.deepEqual(inward.writes, ['ln -s /tmp/payload src/link.ts']);
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
  for (const c of ['echo x > src/a.ts 2>&1', 'cp /tmp/a src/b.ts 2>&1', 'echo x > src/a.ts &> /dev/null']) {
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
  const r = classify('chown user.name /tmp/target.ts');
  assert.deepEqual(r.writes, [], 'owner 不是写入目标，真实目标在项目外');
  assert.ok(r.suspected[0]!.why.includes('项目外'));

  assert.deepEqual(classify('chmod 644 src/a.ts').writes, ['chmod 644 src/a.ts']);
  assert.deepEqual(classify('chmod +x scripts/b.sh').writes, ['chmod +x scripts/b.sh']);
});

test('写入位：重定向记号不得混进写动词的操作数', () => {
  // `cp a b 2>&1` 的 last 操作数曾被取成 `2>&1`，于是真实写入落到「提不出目标」
  const c = 'cp /tmp/a src/b.ts 2>&1';
  assert.deepEqual(classify(c).writes, [c]);
});

test('写入位：ln 单操作数形态的目标是 cwd 下的 basename', () => {
  // POSIX：`ln -s /etc/passwd` 创建的是 ./passwd——在项目内
  const c = 'ln -s /etc/passwd';
  assert.deepEqual(classify(c).writes, [c], '取源路径会把项目内的写入误判成项目外');
});

test('写入位：-t / --target-directory 指定的目录才是目标', () => {
  const outward = classify('ln -s -t /tmp src/a.ts');
  assert.deepEqual(outward.writes, [], '真实写入在 /tmp，项目内的源不是写入点');

  const inward = 'cp -t src /tmp/a.ts /tmp/b.ts';
  assert.deepEqual(classify(inward).writes, [inward], '真实目标 src/ 在项目内');

  const inline = 'cp --target-directory=src /tmp/a.ts';
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
