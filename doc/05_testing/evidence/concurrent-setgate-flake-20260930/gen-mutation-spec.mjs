// 生成「并发写闸门偶发红」（EV-153）的源码变异规格（计划 r2 §5.5）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 照搬 evidence/lock-reclaim-enoent-20260930/gen-mutation-spec.mjs 的形态。
// 用法（在仓库根）：node doc/05_testing/evidence/concurrent-setgate-flake-20260930/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const LOCK = 'src/trivium/lock.ts';
const S = {
  unitLock: 'dist/test/test/unit/lock.test.js',
};

/** 从源码截锚点：取包含 needle 的那一整行（含换行），并要求该行在文件里唯一 */
function lineOf(file, needle) {
  const lines = read(file).split('\n');
  const hits = lines.filter((l) => l.includes(needle));
  if (hits.length !== 1) throw new Error(`${file} 里含「${needle}」的行有 ${hits.length} 行（应为 1）`);
  return hits[0] + '\n';
}
const sub = (s, a, b) => {
  if (!s.includes(a)) throw new Error(`锚点里没有「${a}」`);
  return s.replace(a, b);
};

const REUSED = lineOf(LOCK, "if (!live.sameProcess && live.startedAt !== null) return 'pid_reused';");

// desc 的「⇒」后是计划期预测的红集；实测红集以 mutation-names 的输出为准
const cases = [
  { id: 'M1', desc: 'D1 撤销：取不到启动时刻也判 pid_reused ⇒ U1a / U1b / U1c·d / U2 / U3', file: LOCK,
    find: REUSED, replace: sub(REUSED, ' && live.startedAt !== null', ''), expect: S.unitLock },
  { id: 'M2', desc: 'D1 条件取反：只有取不到才判复用 ⇒ U1a / U1b / U1c·d / U2 / U3（取不到即回收）与 U1e、判据 2（真复用不再判）', file: LOCK,
    find: REUSED, replace: sub(REUSED, 'live.startedAt !== null', 'live.startedAt === null'), expect: S.unitLock },
  { id: 'M3', desc: 'pid_reused 判据整行删掉 ⇒ U1e、判据 2、EV-161 U5、EV-158 相关格', file: LOCK,
    find: REUSED, replace: '', expect: S.unitLock },
];

for (const c of cases) {
  const n = read(c.file).split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里出现 ${n} 次（应为 1）`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
}
const spec = { targets: [LOCK], suites: Object.values(S), cases };
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，锚点全部唯一 → ${OUT}`);
