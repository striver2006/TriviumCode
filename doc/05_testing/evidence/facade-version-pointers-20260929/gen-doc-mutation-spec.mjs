// 生成文档与清单的变异规格（计划 r2 §5.4 ③）。锚点与 find 串一律从文件截取，不手抄：
//   · 每条清单项的锚点：在起点 79d2ed4 与改后工作树上各恰好出现一次，且锚点自身不含版本号形态（CODEX-01）；
//   · 每条变异的 find：在目标文件（改后工作树）里恰好出现一次；
// 任一不满足即在生成期报错退 1，不留到执行期。产出 doc-mutation-spec.json。
// 用法：node scripts/build.mjs --tests-only && node doc/05_testing/evidence/facade-version-pointers-20260929/gen-doc-mutation-spec.mjs
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { BASE, HERE, baseRead, checkPrereqs, loadHelper, worktreeRead } from './lib.mjs';

checkPrereqs();
const h = await loadHelper();
const bRead = baseRead();
const errors = [];
const count = (text, s) => (text === null ? -1 : text.split(s).length - 1);

// ── 锚点核对 ──
const anchors = [];
for (const e of h.POINTERS) {
  const nb = count(bRead(e.file), e.anchor);
  const nw = count(worktreeRead(e.file), e.anchor);
  const selfVersion = h.VERSION_RE.test(e.anchor);
  anchors.push({ id: e.id, file: e.file, anchor: e.anchor, base_count: nb, worktree_count: nw, anchor_has_version: selfVersion });
  if (nb !== 1) errors.push(`${e.id} 锚点在 ${BASE} 出现 ${nb} 次`);
  if (nw !== 1) errors.push(`${e.id} 锚点在工作树出现 ${nw} 次`);
  if (selfVersion) errors.push(`${e.id} 锚点自身含版本号`);
}

/** 取包含 needle 的那一整行，并核它在文件里唯一 */
function lineWith(file, needle) {
  const text = worktreeRead(file);
  if (text === null) throw new Error(`读不到 ${file}`);
  const hits = text.split('\n').filter((l) => l.includes(needle));
  if (hits.length !== 1) throw new Error(`${file} 里含「${needle}」的行有 ${hits.length} 行`);
  return hits[0];
}

const HELPER_SRC = 'test/helpers/facade-pointers.ts';
const PRD = 'doc/01_requirements/PRD_driver_dual_critic.md';
const IDX = 'doc/02_design/README.md';
const MIDX = 'doc/07_manuals/README.md';
const LLD = 'doc/02_design/LLD_orchestrator.md';

const muts = [];
const add = (id, family, file, find, replace, expect, why, rebuild = false) => muts.push({ id, family, file, find, replace, expect, why, rebuild });

// DV：往每条清单项的行里写回版本号（紧跟锚点插入）
for (const e of h.POINTERS) {
  add(`DV-${e.id}`, 'DV', e.file, e.anchor, `${e.anchor}（v1.3.43）`, 'red', '清单项所在行写回版本号 ⇒ T1 forbidden');
}

// DG：全局规则各站点写回
add('DG-self', 'DG', PRD, '截至 v1.4.8：AC-20 已达成', '截至本版（v1.4.8）：AC-20 已达成', 'red', 'P10 写回自指 ⇒ T5 self_version（T3 样本同时失位）');
add('DG-idx-modules', 'DG', IDX, '各模块的分层地图', '50 个模块 / 16437 行代码的分层地图', 'red', '设计索引写回模块数与行数 ⇒ T5 stat_count');
add('DG-idx-flows', 'DG', IDX, '主要执行流的调用链', '六条执行流的调用链', 'red', '汉字数字「六条执行流」⇒ T5 stat_count');
add('DG-idx-gaps', 'DG', IDX, '第七章如实记录的现状缺口', '第七章如实记录的七条现状缺口', 'red', '汉字数字「七条现状缺口」⇒ T5 stat_count');
add('DG-midx-limits', 'DG', MIDX, '如实列出的已知限制', '如实列出的九条已知限制', 'red', '汉字数字「九条已知限制」⇒ T5 stat_count');
add('DG-midx-scenes', 'DG', MIDX, '、日常场景、', '、七个日常场景、', 'red', '「七个日常场景」⇒ T5 stat_count');
add('DG-lld', 'DG', LLD, '模块数与行数随代码变，本文不写死（不含测试，以 `src/` 为准）', '**50 个模块 / 16437 行 TypeScript**（不含测试）', 'red', 'LLD 写回规模基准 ⇒ T5 stat_count');

// DL：从清单删掉每一项（改 helper 源码，要重编测试）
for (const e of h.POINTERS) {
  let line;
  try {
    line = lineWith(HELPER_SRC, `{ id: '${e.id}', `);
  } catch (err) {
    errors.push(String(err.message));
    continue;
  }
  add(`DL-${e.id}`, 'DL', HELPER_SRC, `${line}\n`, '', 'red', '清单删项 ⇒ T2 unlisted_marker（该行仍带标记短语）', true);
}

// DA / DD / DF / DK / DU / DH / DC
const p4 = h.POINTERS.find((e) => e.id === 'P4');
add('DA-P4', 'DA', p4.file, p4.anchor, p4.anchor.replace('章与', '章以及'), 'red', '锚点改到找不到 ⇒ T1 anchor_missing（T2 同时见带标记短语的行不在清单）');
const p2 = h.POINTERS.find((e) => e.id === 'P2');
const tmplHeading = lineWith(IDX, '### 模板');
add('DD-P2', 'DD', IDX, tmplHeading, `${tmplHeading}\n\n另见上方 ${p2.anchor}。`, 'red', '同文件复制出第二个锚点 ⇒ T1 anchor_ambiguous');
const p5Line = lineWith(HELPER_SRC, "{ id: 'P5', ");
add('DF-P5', 'DF', HELPER_SRC, p5Line, p5Line.replace("QUICKSTART.md'", "QUICKSTART_.md'"), 'red', '清单里文件路径改错 ⇒ T1 file_missing、T2 not_in_corpus', true);
const p6 = h.POINTERS.find((e) => e.id === 'P6');
const p6Line = lineWith(p6.file, p6.anchor);
const p6Tail = p6Line.slice(p6Line.indexOf(p6.anchor));
add('DK-P6', 'DK', p6.file, p6Tail, p6Tail.replace(`，${h.MARKER}`, ''), 'red', '删掉标记短语 ⇒ T1 marker_missing');
const depHeading = (worktreeRead('doc/06_deployment/README.md') ?? '').split('\n')[0];
add('DU-deploy', 'DU', 'doc/06_deployment/README.md', depHeading, `${depHeading}\n\n使用手册见 [MANUAL](../07_manuals/MANUAL_user.md)（${h.MARKER}）。`, 'red', '论域文件新增带标记短语、且链接会升版文档的行而不进清单 ⇒ T2 unlisted_marker');
add('DN-narrative', 'DN', 'doc/06_deployment/README.md', depHeading, `${depHeading}\n\n运行手册见 [RUNBOOK](./RUNBOOK_pipeline_ops.md)（${h.MARKER}）。`, 'green', '标记短语只与不升版文档的链接同行，属叙述句，不算指针用法 ⇒ 仍全绿（代码双审 r1 CODEX-06）');
add('DH-lld157', 'DH', LLD, '设计依据见[设计 v1.3.6]', '设计依据见[设计]', 'red', '历史样本的版本号被「顺手修掉」，该样本锚点含版本号 ⇒ T3 anchor_missing');
const d50 = h.HISTORICAL_SAMPLES.find((s) => s.id === 'H-design-50');
const d50Line = lineWith(d50.file, d50.anchor);
const d50Ver = d50Line.match(h.VERSION_RE)?.[0] ?? '';
add('DH-design50', 'DH', d50.file, d50Line, d50Line.replace(` ${d50Ver}`, ''), 'red', '历史样本的版本号被「顺手修掉」，锚点不含版本号 ⇒ T3 forbidden');
const reLine = lineWith(HELPER_SRC, 'export const NON_FACADE_DOC_RE');
add('DC-manuals', 'DC', HELPER_SRC, reLine, reLine.replace('08_project\\/|', '08_project\\/|07_manuals\\/|'), 'red', '论域规则把 doc/07_manuals/ 排除 ⇒ T2 not_in_corpus（P3、P5、P6）', true);

// DN：负对照——变更记录形态里出现标记短语与计数，期望仍全绿
const prdChangelog = lineWith(PRD, '> - **变更说明**：v1.4.17');
add('DN-changelog', 'DN', PRD, prdChangelog, `${prdChangelog}\n> - **变更说明**：v0.0.0 负对照：${h.MARKER}；50 个模块；七条现状缺口；截至本版（v0.0.0）。`, 'green', '变更记录形态不参与标记绑定与全局规则 ⇒ 仍全绿');

// 核 find 唯一
for (const m of muts) {
  const n = count(worktreeRead(m.file), m.find);
  if (n !== 1) errors.push(`${m.id} 的 find 在 ${m.file} 出现 ${n} 次`);
  if (m.find === m.replace) errors.push(`${m.id} 的 find 与 replace 相同`);
}

const spec = { base: BASE, generated_at: new Date().toISOString(), anchors, mutations: muts };
writeFileSync(path.join(HERE, 'doc-mutation-spec.json'), `${JSON.stringify(spec, null, 2)}\n`);
if (errors.length) {
  console.error(`生成期核对失败：\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log(`锚点 ${anchors.length} 条（${BASE} 与工作树各唯一、不含版本号）；变异 ${muts.length} 条（find 均唯一），写出 doc-mutation-spec.json`);
