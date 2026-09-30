// 生成「锁回收误判已删锁文件」（EV-173 / EV-149）的源码变异规格（计划 r2 §6.4）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 照搬 evidence/critical-lock-floor-20260929/gen-mutation-spec.mjs 的形态。
// 用法（在仓库根）：node doc/05_testing/evidence/lock-reclaim-enoent-20260930/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const LOCK = 'src/trivium/lock.ts';
const RP = 'src/trivium/run-protocol.ts';
const S = {
  unitLock: 'dist/test/test/unit/lock.test.js',
  intLock: 'dist/test/test/integration/lock-cross-process.test.js',
  intRun: 'dist/test/test/integration/run-protocol.test.js',
};

/** 从源码截锚点：取包含 needle 的那一整行（含换行），并要求该行在文件里唯一 */
function lineOf(file, needle) {
  const lines = read(file).split('\n');
  const hits = lines.filter((l) => l.includes(needle));
  if (hits.length !== 1) throw new Error(`${file} 里含「${needle}」的行有 ${hits.length} 行（应为 1）`);
  return hits[0] + '\n';
}
/** 从源码截多行锚点：从含 startNeedle 的行到含 endNeedle 的行（含两端），两个 needle 各自唯一 */
function blockOf(file, startNeedle, endNeedle) {
  const lines = read(file).split('\n');
  const i = lines.findIndex((l) => l.includes(startNeedle));
  const j = lines.findIndex((l, k) => k >= i && l.includes(endNeedle));
  if (i < 0 || j < 0) throw new Error(`${file} 里找不到「${startNeedle}」…「${endNeedle}」`);
  if (lines.filter((l) => l.includes(startNeedle)).length !== 1) throw new Error(`「${startNeedle}」不唯一`);
  return lines.slice(i, j + 1).join('\n') + '\n';
}
const sub = (s, a, b) => {
  if (!s.includes(a)) throw new Error(`锚点里没有「${a}」`);
  return s.replace(a, b);
};

const MISSING = lineOf(LOCK, "if (seen.state === 'missing') continue;");
const AGE = lineOf(LOCK, 'const age = seen.mtimeMs !== null ? Date.now() - seen.mtimeMs : await fileAgeMs(p);');
const IDENT = lineOf(LOCK, 'got.identity = `${st.dev}:${st.ino}:${st.mtimeNs}`;');
const PRED = lineOf(LOCK, 'return r.content !== null && r.content.pid === expected.pid && r.content.acquired_at === expected.acquired_at;');
// acquireLock 里也有一处同形的 link：从放回那段注释截到它下面第一处 link
const PUTBACK = blockOf(LOCK, '救不回来，只能留痕', 'await fs.link(tmp, p);');
const RMTMP = blockOf(LOCK, '// 无论相符、放回成功还是放不回', 'await fs.rm(tmp, { force: true }).catch(() => undefined);');
const WARN = blockOf(LOCK, 'if (await reclaimStaleLock(p, existing, seen.identity ?? undefined)) {', '      }');
// 代码双审 r1 修订（CODEX-02 / CODEX-04 / GLM-02）的三处
const BACKOFF = blockOf(LOCK, '不隔就是每轮两次 ps 派生的空转', 'await new Promise((r) => setTimeout(r, delay));');
const TMPCATCH = lineOf(LOCK, 'await fs.rm(tmp, { force: true }).catch(() => undefined);');
const CLAIMWARN = lineOf(LOCK, '的遗留锁时认领失败（');
const TMPNAME = lineOf(LOCK, 'const tmp = `${p}.stale-${process.pid}-${randomUUID()}`;');
const AGEFN = lineOf(LOCK, "return (e as NodeJS.ErrnoException).code === 'ENOENT' ? null : Number.POSITIVE_INFINITY;");
const PARSEFAIL = lineOf(LOCK, '// 读不了或解析失败：不可解析，已取到的身份与修改时刻照给');
const JUDGEBLOCK = blockOf(LOCK, 'const seen = await readLockFile(p);', '预算与间隔取值不变，只在这一路补上间隔');
const CLAIM = lineOf(LOCK, 'const claim = id === null ? null : `${p}.reclaim-${createHash');
const RECHECK = lineOf(LOCK, 'if (!isJudged(again) || again.state !== \'present\' || again.identity !== id) return false;');
const CANCEL = blockOf(RP, 'if (await reclaimStaleLock(lockPathFor(ctx.triviumDir, topic), existing)) {', "step('主题锁在回收时已被别的进程动过，未回收');");

const warnLine = "        warn(`回收主题「${opts.topic}」的遗留锁（原因 ${stale}，原持有者 pid ${existing?.pid ?? '?'}）`);\n";
if (!WARN.includes(warnLine)) throw new Error('告警行形态变了，改 gen 脚本');
/** D5 撤销：告警挪回回收之前、回收结果不看 */
const WARN_BEFORE =
  "      warn(`回收主题「${opts.topic}」的遗留锁（原因 ${stale}，原持有者 pid ${existing?.pid ?? '?'}）`);\n" +
  '      await reclaimStaleLock(p, existing, seen.identity ?? undefined);\n';
/** acquireLock 一侧整段退回 3e38d29 的判定（readLock、按路径年龄、先告警后回收）；回收函数里的 D3 / D4 保留 */
const OLD_JUDGE = [
  '    const existing = await readLock(p);',
  '    const terminal = opts.runTerminal ? await opts.runTerminal(existing?.run_id ?? null) : false;',
  '    let stale = await judgeStale(existing, {',
  '      heartbeatStaleMs: opts.heartbeatStaleMs,',
  '      runTerminal: terminal,',
  '    });',
  '    if (stale === \'unparsable\' && ((await fileAgeMs(p)) ?? Number.POSITIVE_INFINITY) < 2_000) stale = null;',
  '    if (stale !== null) {',
  "      warn(`回收主题「${opts.topic}」的遗留锁（原因 ${stale}，原持有者 pid ${existing?.pid ?? '?'}）`);",
  '      await reclaimStaleLock(p, existing);',
  '      continue; // 立刻重试创建',
  '',
].join('\n');
// 锚点截到「补上间隔」那行注释为止：原文随后的 sleep 与 continue 留在 if 里成为不可达代码，由原文的 `}` 收住 if

// desc 的「⇒」后是计划期预测的红集；实测红集以 mutation-names 的输出为准
const cases = [
  { id: 'M1', desc: 'D1 撤销：missing 不再直接重试（落进判定）⇒ U1（runTerminal 被调用）', file: LOCK,
    find: MISSING, replace: '', expect: S.unitLock },
  { id: 'M2', desc: 'D2 撤销：不可解析锁的年龄改回按路径 stat ⇒ U3', file: LOCK,
    find: AGE, replace: sub(AGE, 'seen.mtimeMs !== null ? Date.now() - seen.mtimeMs : await fileAgeMs(p)', 'await fileAgeMs(p)'), expect: S.unitLock },
  // M3（只删 rename 之前的预检）自 D8 起是等价变异：认领之后的复查用同一谓词再核一次，结局相同，只多建删一次认领文件；
  // 「rename 之前不核」由 M14（删复查）覆盖——预检仍在时，迟到的回收者正是靠复查挡住的（U12③）
  { id: 'M4', desc: 'D3 身份只比 dev:ino（去掉修改时刻）⇒ U4′（就地改写的活锁被回收）', file: LOCK,
    find: IDENT, replace: sub(IDENT, ':${st.mtimeNs}', ''), expect: S.unitLock },
  { id: 'M5', desc: 'D3 谓词退回容忍「此刻读不出」⇒ U4b', file: LOCK,
    find: PRED, replace: sub(PRED, 'r.content !== null && r.content.pid', 'r.content === null || r.content.pid'), expect: S.unitLock },
  { id: 'M6', desc: 'D4 撤销：放回改回会覆盖的 rename ⇒ U6（C 的锁被盖掉）', file: LOCK,
    find: PUTBACK, replace: sub(PUTBACK, 'fs.link(tmp, p)', 'fs.rename(tmp, p)'), expect: S.unitLock },
  { id: 'M7', desc: 'D4 放回之后不删 tmp ⇒ U6（.stale- 残留）', file: LOCK,
    find: RMTMP, replace: RMTMP.split('\n')[0] + '\n', expect: S.unitLock },
  { id: 'M8', desc: 'D5 撤销：告警挪回回收之前 ⇒ U5 / U7', file: LOCK,
    find: WARN, replace: WARN_BEFORE, expect: S.unitLock },
  { id: 'M8x', desc: '同 M8，跨进程 ⇒ EV-149 用例断言④（多个判定者各告警一条 pid_gone；概率性）', file: LOCK,
    find: WARN, replace: WARN_BEFORE, expect: S.intLock },
  { id: 'M9', desc: 'D6 撤销：tmp 名去掉随机段 ⇒ U8', file: LOCK,
    find: TMPNAME, replace: sub(TMPNAME, '${randomUUID()}', '${Date.now()}'), expect: S.unitLock },
  { id: 'M10', desc: 'D7 撤销：--cancel 收尾无条件播报「已回收」⇒ U11', file: RP,
    // 锚点截到 step 那一行，原文随后的 `}` 留在原位，正好收住这里开的裸块
    find: CANCEL, replace: "      await reclaimStaleLock(lockPathFor(ctx.triviumDir, topic), existing);\n      {\n        say(`已回收主题「${topic}」的锁`);\n", expect: S.intRun },
  { id: 'M11', desc: 'fileAgeMs 对不存在的文件改回 +∞ ⇒ U9（进了回收的预检读）', file: LOCK,
    find: AGEFN, replace: '    return Number.POSITIVE_INFINITY;\n', expect: S.unitLock },
  { id: 'M12', desc: '解析失败时丢掉同一描述符的修改时刻（退回按路径 stat）⇒ U3', file: LOCK,
    find: PARSEFAIL, replace: PARSEFAIL + '    got.mtimeMs = null;\n', expect: S.unitLock },
  { id: 'M13', desc: 'D8 撤销：不认领（同一份遗留锁的回收者不再互斥）⇒ U12①', file: LOCK,
    find: CLAIM, replace: '  const claim: string | null = null;\n', expect: S.unitLock },
  { id: 'M14', desc: 'D8 认领之后不复查 ⇒ U12③（迟到的回收者挪走新锁）', file: LOCK,
    find: RECHECK, replace: '', expect: S.unitLock },
  { id: 'M15', desc: 'CODEX-02 撤销：回收没成时不隔间隔（空转）⇒ U14', file: LOCK,
    find: BACKOFF, replace: BACKOFF.split('\n').slice(0, -2).join('\n') + '\n', expect: S.unitLock },
  { id: 'M16', desc: 'CODEX-04 撤销：tmp 清理失败抛给调用方 ⇒ U13（目录占位）', file: LOCK,
    find: TMPCATCH, replace: sub(TMPCATCH, '.catch(() => undefined);', ';'), expect: S.unitLock },
  { id: 'M17', desc: 'GLM-02 撤销：认领失败不留痕 ⇒ U13', file: LOCK,
    find: CLAIMWARN, replace: '', expect: S.unitLock },
  { id: 'M0x', desc: 'acquireLock 一侧整段退回 3e38d29 的判定（保留 D3 / D4）⇒ EV-149 断言③④、X3（概率性）', file: LOCK,
    find: JUDGEBLOCK, replace: OLD_JUDGE, expect: S.intLock },
];

// 同一锚点被多条 case 共用（装置逐条恢复），但在文件里必须恰好一处
for (const c of cases) {
  const n = read(c.file).split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里出现 ${n} 次（应为 1）`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
}
const spec = { targets: [LOCK, RP], suites: Object.values(S), cases };
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，锚点全部唯一 → ${OUT}`);
