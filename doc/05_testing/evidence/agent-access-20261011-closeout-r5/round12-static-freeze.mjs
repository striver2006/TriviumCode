/** 第12次C/code送审前一次性静态文件/hash/脱敏扫描；审查中不再新增被审文件。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { scanSecrets } from '../../../../dist/test/src/trivium/secrets.js';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
const repo = process.cwd();
const root = path.join(repo, 'doc/05_testing/evidence/agent-access-20261011-closeout-r5');
const named = [
  'scripts/agent-access-recipes.mjs', 'test/unit/agent-access-recovery.test.ts',
  'doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard-v2.mjs',
  'doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v8.mjs',
  'doc/05_testing/evidence/agent-access-20261011-closeout-r3/quiet-launch-v6.mjs',
  'doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v5.json',
  'doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authority.json',
  'doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authority-v4-preserved.json',
  'doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v7.mjs',
  'doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md', 'doc/05_testing/README.md',
  'doc/05_testing/CASE_manual_acceptance.md', 'doc/04_development/GUIDE_local_pitfalls.md',
  'doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md',
  'doc/02_design/ADR_003_agent_access.md', 'doc/03_api/PROTOCOL_dual_critic_relay.md',
  'doc/07_manuals/QUICKSTART.md', 'doc/06_deployment/RUNBOOK_pipeline_ops.md',
  'skills/dual-critic/SKILL.md',
  '.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r16-codex.md'
];
for (const name of fs.readdirSync(root)) if (fs.statSync(path.join(root, name)).isFile() && name !== 'round12-static-freeze.json')
  named.push(path.relative(repo, path.join(root, name)));
const records = [...new Set(named)].map(file => {
  const bytes = fs.readFileSync(path.join(repo, file));
  const findings = scanSecrets(bytes.toString());
  if (findings.length) throw Error('送审静态文件疑似凭据：' + file);
  return { file, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, secrets: 0 };
});
saveEvidence(path.join(root, 'round12-static-freeze.json'), { at: new Date().toISOString(), base: '39ed20530d64a72f81f183095c6d9516632d0228',
  code_scope: '完整工作区diff含已提交/已暂存/未暂存/未跟踪', files: records, vendor_cli_starts: 0,
  criteria_adopted: false, business_frozen_after_start: true });
console.log(JSON.stringify({ files: records.length, secrets: 0, vendor_cli_starts: 0 }));
