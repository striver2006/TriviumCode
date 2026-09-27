// 补上一主题报告 §3.3 的判定缺口（派生后失败的孤儿worker计划 r2 §4.3）：变异装置只记 fail 数，
// 这里对指定几条变异（默认 M1、M2、M4）各跑一次期望套件，存下**失败用例名与首行断言文案**，
// 确认它们是因目标断言而红、不是因「预建窗口未命中」。
// 逐条：备份 → 变异（find 须唯一）→ 重建 → 跑期望套件 → 恢复并逐字节核对 → 最后重建一次。
// 用法（在仓库根，变异装置不在跑、全量检查不在跑）：node mutation-names.mjs <规格路径> [M1,M2,M4]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const want = new Set((process.argv[3] ?? 'M1,M2,M4').split(','));
const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const build = () => execFileSync(process.execPath, ['scripts/build.mjs', '--with-tests'], { stdio: 'ignore' });
// 第二版：第一版按 `error:` 截文案，与 node --test 缺省 spec 报告器的格式不符、一条都没截到；
// 改为截每个 ✖ 块之后第一行含 Error 的文字，并在整段输出里直接查「预建窗口未命中」。
// 可选第 4 个参数：--test-name-pattern，只跑相关用例省时间。
const PATTERN = process.argv[4] ?? null;
const runSuite = (suite) => {
  const args = ['--test', ...(PATTERN ? [`--test-name-pattern=${PATTERN}`] : []), suite];
  try {
    execFileSync(process.execPath, args, { stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
    return { fail: 0, red: [], firstLines: [], windowMiss: false };
  } catch (e) {
    const out = String(e.stdout);
    const names = [...new Set([...out.matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]))];
    const msgs = [...out.matchAll(/^✖ .+?\(\d[^\n]*\n(?:[^\n]*\n){0,3}?\s*([^\n]*Error[^\n]*)/gm)].map((m) => m[1].trim().slice(0, 200));
    return {
      fail: Number(/ℹ fail (\d+)/.exec(out)?.[1] ?? 1),
      red: names,
      firstLines: [...new Set(msgs)].slice(0, 8),
      windowMiss: out.includes('预建窗口未命中'),
    };
  }
};

const results = [];
for (const c of spec.cases.filter((x) => want.has(x.id))) {
  const original = fs.readFileSync(c.file, 'utf8');
  const baseHash = sha(c.file);
  if (original.split(c.find).length - 1 !== 1) throw new Error(`${c.id} 的 find 不唯一`);
  try {
    fs.writeFileSync(c.file, original.replace(c.find, c.replace));
    build();
    const r = runSuite(c.expect);
    results.push({ id: c.id, desc: c.desc, suite: c.expect, pattern: PATTERN, ...r });
  } finally {
    fs.writeFileSync(c.file, original);
    if (sha(c.file) !== baseHash) throw new Error(`恢复 ${c.file} 后哈希不符——停下来人工处理`);
  }
}
build();
console.log(JSON.stringify(results, null, 2));
