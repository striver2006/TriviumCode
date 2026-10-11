/** 审查前冻结全部已完成静态材料、业务及原22B工件；审查中不写本目录。 */
import fs from 'node:fs';
import path from 'node:path';
import { hash } from '../../../../scripts/agent-access-selection.mjs';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
const root = path.dirname(new URL(import.meta.url).pathname), staticHashes = {}, business = {};
const walk = (dir, put) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, put); else if (e.isFile()) put(p); } };
walk(root, p => { staticHashes[path.relative(root, p)] = hash(p); });
for (const dir of ['src', 'scripts', 'test', 'skills', 'skills-src']) walk(dir, p => { if (!p.endsWith('trivium.cjs')) business[p] = hash(p); });
for (const p of ['AGENTS.md', 'package.json', 'package-lock.json', 'tsconfig.json']) business[p] = hash(p);
for (const dir of fs.readdirSync('doc', { withFileTypes: true }).filter(e => e.isDirectory())) for (const e of fs.readdirSync('doc/' + dir.name, { withFileTypes: true })) if (e.isFile() && e.name.endsWith('.md')) { const p = 'doc/' + dir.name + '/' + e.name; business[p] = hash(p); }
const origin = JSON.parse(fs.readFileSync(root + '/plan22-disposition-origin.json'));
const observed = JSON.parse(fs.readFileSync(root + '/config-after23-preflight-observation.json'));
if (!observed.only_auth_cache_checked_at_changed || !observed.private_snapshot_removed || hash('.trivium/config.local.yaml') !== observed.current_sha256) throw Error('预检配置核对未完成');
const latestPlan = origin.final;
const planPath = latestPlan.absPath ?? latestPlan.path;
if (!planPath || hash(planPath) !== latestPlan.sha256) throw Error('获批定稿hash不符');
const staticAudits = fs.readdirSync(root).filter(p => /^static-audit-before23-\d+\.json$/.test(p));
const auth = 'doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v12.json';
saveEvidence(root + '/frozen-before-round23.json', { at: new Date().toISOString(), hashes: staticHashes, business_hashes: business,
  plan: { path: planPath, sha256: hash(planPath) }, disposition: origin.disposition,
  configs: { shared: hash('.trivium/config.yaml'), local: hash('.trivium/config.local.yaml') },
  current_authority_sha256: hash('doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authority.json'),
  authorization_sha256: hash(auth), launcher_sha256: hash('doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v16.mjs'),
  bundle: hash('skills/dual-critic/scripts/trivium.cjs'), static_audits: staticAudits, formal_before: 22, allowed_next: 23,
  criteria_changed: false, business_implemented_after_plan_approval: true, new_vendor_starts: 0 });
console.log(JSON.stringify({ static_files: Object.keys(staticHashes).length, business_files: Object.keys(business).length, formal: '22/23', new_vendor_starts: 0 }));
