/** M12批次2收尾（R6之后、零CLI）：按原字节导出便携证据副本并逐个核hash与脱敏扫描，落用户具名采用记录。
 * 用法：仓库根目录 node <本文件> <汇总文件名>；输出目录 raw-evidence/ 与两份清单均以wx落盘，不覆盖。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
import { hash } from '../../../../scripts/agent-access-selection.mjs';
import { scanSecrets } from '../../../../dist/test/src/trivium/secrets.js';
import { RESTRICTED_COMBINATIONS, RESTRICTED_CRITERION_ID } from '../../../../scripts/agent-access-restricted.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), file = n => path.join(here, n), read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const evidenceRoot = path.join(os.homedir(), '.trivium/evidence/agent-access-20261011-closeout-r3');
const summaryName = process.argv[2];
if (!/^summary-[0-9a-f-]{36}\.json$/.test(summaryName ?? '')) throw Error('用法：finalize.mjs <summary-uuid.json>');
const summaryPath = path.join(evidenceRoot, summaryName), summary = read(summaryPath);

// 1. 便携副本：本批全部外部原件（8个路线臂、两次受控批输出、汇总、m12调用记录），按原字节复制。
const batch = read(file('batch.json')), sources = [];
const walk = (dir, rel) => { for (const n of fs.readdirSync(dir).sort()) { const f = path.join(dir, n), s = fs.lstatSync(f);
  if (s.isSymbolicLink()) throw Error('原件含软链：' + f); if (s.isDirectory()) walk(f, path.join(rel, n)); else if (s.isFile()) sources.push([f, path.join(rel, n)]); } };
for (const j of batch.jobs) walk(path.join(evidenceRoot, 'routes', j.route_directory), j.route_directory);
for (const d of ['controlled-m12-20261017', 'controlled-m12-20261017-r5b']) walk(path.join(evidenceRoot, d), d);
for (const n of fs.readdirSync(path.join(evidenceRoot, 'calls')).filter(n => n.startsWith('m12-')).sort()) sources.push([path.join(evidenceRoot, 'calls', n), path.join('calls', n)]);
sources.push([summaryPath, summaryName]);
const out = file('raw-evidence'), entries = [];
fs.mkdirSync(out, { recursive: false });
for (const [original, rel] of sources) {
  const bytes = fs.readFileSync(original), findings = scanSecrets(bytes.toString('utf8'));
  if (findings.length) throw Error(`脱敏扫描命中，拒绝复制：${original}（${findings.length}处）`);
  const copy = path.join(out, rel); fs.mkdirSync(path.dirname(copy), { recursive: true });
  fs.writeFileSync(copy, bytes, { flag: 'wx', mode: 0o600 });
  if (hash(copy) !== hash(original)) throw Error('副本hash不符：' + rel);
  entries.push({ original, copy: path.join('raw-evidence', rel), sha256: hash(original) });
}
saveEvidence(file('portable-evidence-manifest.json'), { at: new Date().toISOString(), files: entries,
  source_unchanged: entries.every(e => hash(e.original) === e.sha256), secret_hits: 0 });

// 2. 采用记录：只在汇总事实与具名决定都齐备时落盘。
const rows = summary.rows.filter(r => r.agent === 'claude' && RESTRICTED_COMBINATIONS.includes(r.combination));
if (rows.length !== 5 || rows.some(r => r.restricted_admission !== true || r.write_criteria.real_write_attempt.value !== '不可取样') ||
  summary.counts.restricted_admission.admitted !== 5 || summary.restricted_criterion?.adoption !== null || summary.criteria_change_authorized !== false)
  throw Error('汇总事实与采用前提不符');
const refs = ['authorization.json', 'retry-authorization.json', 'retry-authorization-r3.json', 'retry-authorization-deepseek-r2.json',
  'resume-r5-authorization.json', 'precheck.json', 'batch.json', 'mechanism-result.json', 'mechanism-batch-r5b.json', 'mechanism-result-r5b.json',
  'selection.json', 'controlled.json', 'portable-evidence-manifest.json'];
saveEvidence(file('restricted-admission-acceptance.json'), {
  at: new Date().toISOString(), schema: 'm12-restricted-admission-acceptance.v1', criterion: RESTRICTED_CRITERION_ID,
  user_decision_verbatim: '采用 restricted-admission-v1：五组合（qwen-pro、kimi-pro、kimi、deepseek、deepseek-pro）在 CLI 2.1.302、构建 4e58048d、汇总 05e27d69… 快照下受限准入',
  decision: 'adopted', decided_by: '用户（2026-10-17 本会话具名答复）', combinations: [...RESTRICTED_COMBINATIONS],
  snapshot: { cli_version: [...new Set(rows.map(r => r.cli_version))], commit: batch.commit, inputs_sha256: batch.inputs_sha256,
    summary: { path: summaryPath, sha256: hash(summaryPath), portable_copy: path.join('raw-evidence', summaryName) } },
  counts: summary.counts, original_standard_reference: summary.original_standard_reference,
  scope: '只读审查用途下的工具面未注册与受控请求拒绝；绑定上列快照，触发集（CLI版本、native或包装器、profile env、~/.claude/settings.json）任一变化须重取后才能对外引用',
  does_not_prove: '真实模型不会主动越权、任意诱导输入、服务端身份、上游与未来版本行为；档2为本地注入，actual_provider_inference=false',
  supersedes: '10-12受限准入例外（CLI 2.1.296、A/C批冻结清单）因指纹变化不再适用，由本快照取代；10-12文件不改',
  exceptions_during_batch: ['CLI在R0前自动升级到2.1.302，用户定按新版本继续', 'kimi路线刷新第2、3次与deepseek第2次为用户逐次授权的重试',
    'R1后半段至R5改在用户终端执行（会话拉起的第三方路线间歇挂满180秒，根因未明）', 'R5首次因ps启动时间受locale影响被r21格式拒绝，用户授权换新批次名续跑并强制LC_ALL=C，r21规则不改'],
  references: Object.fromEntries(refs.map(n => [n, hash(file(n))])),
  original_status_unchanged: true, product_consumption: 'src/不读准入结论；assertProductionArm不改',
});
console.log(JSON.stringify({ copied: entries.length, secret_hits: 0, acceptance: 'restricted-admission-acceptance.json' }));
