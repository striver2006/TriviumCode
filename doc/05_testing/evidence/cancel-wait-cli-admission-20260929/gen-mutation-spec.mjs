// 生成「取消与失联的凭据准入核CLI」（EV-157）的源码变异规格（计划 r2 §4.3；代码双审 r1 之后新增 M17 / M18）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 照搬 evidence/heartbeat-threshold-warning-20260929/gen-mutation-spec.mjs 的形态。
// 用法（在仓库根）：node gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const STATUS = 'src/trivium/status.ts';
const RET = 'src/trivium/retention.ts';
const PROTO = 'src/trivium/run-protocol.ts';
const S = {
  unit: 'dist/test/test/unit/scrub-admission.test.js',
  ret: 'dist/test/test/unit/retention.test.js',
};
const NEVER = "process.env['TRIVIUM_MUT_NEVER'] === '1'";
const ALWAYS = "process.env['TRIVIUM_MUT_NEVER'] !== '1'";
const UNV = "    } else if (v === 'unverifiable') {\n";
const MAL = '  const blockers: CliBlocker[] = malformed.map((side) => ({\n';

const cases = [
  { id: 'M1', desc: 'cancelRun 抹除改看 worker 一半（回到 EV-157 之前）⇒ U5 A / C / D', file: PROTO,
    find: '  if (adm.admit) {\n    const scrubbed', replace: '  if (adm.worker.gone) {\n    const scrubbed', expect: S.unit },
  { id: 'M2', desc: 'waitRun 抹除改看 worker 一半 ⇒ U6', file: PROTO,
    find: '      if (!adm.admit) {\n        scrubNote', replace: '      if (!adm.worker.gone) {\n        scrubNote', expect: S.unit },
  { id: 'M3', desc: '到期整删去掉 CLI 一问 ⇒ U4', file: RET,
    find: '      if ((await cliGroupsConfirmedGone(status)).gone) {\n',
    replace: `      if (${ALWAYS} || (await cliGroupsConfirmedGone(status)).gone) {\n`, expect: S.unit },
  { id: 'M4', desc: '到期整删被挡下后 continue（不计 kept、不走凭据准入）⇒ U4', file: RET,
    find: '        out.removed.push(dir);\n        continue;\n      }\n    }\n    out.kept++;\n',
    replace: '        out.removed.push(dir);\n        continue;\n      }\n      continue;\n    }\n    out.kept++;\n', expect: S.unit },
  { id: 'M5', desc: 'cancelRun 归档收尾改传 admit（D5）⇒ U5 归档断言', file: PROTO,
    find: '  const goneNow = adm.worker;\n', replace: '  const goneNow = { gone: adm.admit, why: adm.worker.why };\n', expect: S.unit },
  { id: 'M6', desc: 'scrubAdmission 在 worker 一半未过时也判 CLI ⇒ U2（cli 为 null）', file: STATUS,
    find: '  if (!worker.gone) return { admit: false, worker, cli: null };\n',
    replace: '  if (!worker.gone) return { admit: false, worker, cli: await cliGroupsConfirmedGone(status) };\n', expect: S.unit },
  { id: 'M7', desc: 'why 改为全部阻挡项连写 ⇒ U1 / U3（why 逐字）', file: STATUS,
    find: '      : blockers[0]!.detail;\n', replace: "      : blockers.map((b) => b.detail).join('；');\n", expect: S.unit },
  { id: 'M8', desc: 'scrubHoldWhy 只取第一条 ⇒ U2 / U5′（两侧都在告警里）', file: STATUS,
    find: "${a.cli.blockers.map((b) => b.detail).join('；')}", replace: '${a.cli.blockers[0]!.detail}', expect: S.unit },
  { id: 'M9', desc: 'unverifiable 不挡 ⇒ U1 / U3～U6 的 C 格', file: STATUS,
    find: UNV, replace: `    } else if (v === 'unverifiable' && ${NEVER}) {\n`, expect: S.unit },
  { id: 'M10', desc: '形状坏不挡 ⇒ U1 / U3～U6 的 D 格', file: STATUS,
    find: MAL, replace: `  const blockers: CliBlocker[] = malformed.filter(() => ${NEVER}).map((side) => ({\n`, expect: S.unit },
  { id: 'M11', desc: 'scrubHoldWhy 在 worker 一半未过时改写文字 ⇒ U2 / U7（逐字不变）', file: STATUS,
    find: '  if (!a.worker.gone || !a.cli || a.cli.gone) return a.worker.why;\n',
    replace: '  if (!a.worker.gone || !a.cli || a.cli.gone) return `准入未过：${a.worker.why}`;\n', expect: S.unit },
  { id: 'M12', desc: 'admitScrub 的 deferredCli.detail 改为逐侧连写 ⇒ U3（detail 逐字）', file: RET,
    find: '    out.deferredCli.push({ dir, detail: a.cli!.why });\n',
    replace: "    out.deferredCli.push({ dir, detail: a.cli!.blockers.map((b) => b.detail).join('；') });\n", expect: S.unit },
  { id: 'M13', desc: 'cancelRun 告警退回 worker.why（不带 CLI 事实）⇒ U5', file: PROTO,
    find: '    warn(`凭据副本未抹：${scrubHoldWhy(adm)}——留给会话启动清扫`);\n',
    replace: '    warn(`凭据副本未抹：${adm.worker.why}——留给会话启动清扫`);\n', expect: S.unit },
  { id: 'M14', desc: 'waitRun 说明退回 worker.why ⇒ U6', file: PROTO,
    find: '        scrubNote = `\\n  凭据副本未抹：${scrubHoldWhy(adm)}（${reading.reason}），留给会话启动清扫`;\n',
    replace: '        scrubNote = `\\n  凭据副本未抹：${adm.worker.why}（${reading.reason}），留给会话启动清扫`;\n', expect: S.unit },
  { id: 'M15', desc: '同 M9，期望既有 retention 套件（EV-154 U14）也咬住', file: STATUS,
    find: UNV, replace: `    } else if (v === 'unverifiable' && ${NEVER}) {\n`, expect: S.ret },
  { id: 'M16', desc: '同 M10，期望既有 retention 套件（EV-154 U14）也咬住', file: STATUS,
    find: MAL, replace: `  const blockers: CliBlocker[] = malformed.filter(() => ${NEVER}).map((side) => ({\n`, expect: S.ret },
  { id: 'M17', desc: '--wait 的 --cancel 出口句恒不出（代码双审 r1 CODEX-02）⇒ U6 A 格', file: PROTO,
    find: "        if (adm.cli?.blockers.some((b) => b.kind === 'alive')) {\n",
    replace: `        if (${NEVER} && adm.cli?.blockers.some((b) => b.kind === 'alive')) {\n`, expect: S.unit },
  { id: 'M18', desc: '--wait 的 --cancel 出口句对判不了 / 读不懂也出 ⇒ U6 C / D 格', file: PROTO,
    find: "        if (adm.cli?.blockers.some((b) => b.kind === 'alive')) {\n",
    replace: '        if (adm.cli?.blockers.some((b) => b.kind !== \'malformed\' || true)) {\n', expect: S.unit },
];

for (const c of cases) {
  const text = read(c.file);
  const n = text.split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里出现 ${n} 次（应为 1）`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
}
const spec = { targets: [STATUS, RET, PROTO], suites: Object.values(S), cases };
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，锚点全部唯一 → ${OUT}`);
