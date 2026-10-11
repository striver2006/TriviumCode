/** 正式认领后只经archive.ts写第11次B原稿；静态范围脱敏取证。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeArtifact } from '../../../../dist/test/src/trivium/archive.js';
import { scanSecrets } from '../../../../dist/test/src/trivium/secrets.js';
const root = path.dirname(new URL(import.meta.url).pathname);
const topic = 'Agent双模式接入真实准入收口';
const historicalPath = `.reviews/${topic}/plan/2026-10-11-${topic}-r14-codex.md`;
const historical = fs.readFileSync(historicalPath, 'utf8');
const body = fs.readFileSync(path.join(root, 'plan-r15-body.md'), 'utf8');
const content = body + '\n\n不编号附录：r14历史全文（逐字保留；旧总10/旧bundle/旧矩阵仅为原采样，当前以r15正文为准）\n\n' + historical;
if (scanSecrets(content).length) throw Error('计划原稿含疑似凭据');
const receiptPath = path.join(root, 'plan-r15-archive.json');
const artifact = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath)) : await writeArtifact({ layout: { archiveRoot: path.resolve('.reviews'), topic }, stage: 'plan', role: 'codex', writer: 'driver', driver: 'codex', rerunIndex: 15, content, date: '2026-10-11' });
if (!fs.existsSync(receiptPath)) fs.writeFileSync(receiptPath, JSON.stringify(artifact, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
if (crypto.createHash('sha256').update(fs.readFileSync(artifact.absPath)).digest('hex') !== artifact.sha256) throw Error('原稿归档hash不符');
const cited = [
  'doc/05_testing/evidence/agent-access-20261011-closeout-r4/post-round10-guard-plan-proposal.md',
  'doc/05_testing/evidence/agent-access-20261011-closeout-r4/round10-grep-persisted-audit-v2.json',
  'doc/05_testing/evidence/agent-access-20261011-closeout-r4/round10-grep-read-exact-verify.json',
  'doc/05_testing/evidence/agent-access-20261011-closeout-r4/shared-entry-other-repos-root-audit.json',
  'doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v5.json',
  'doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authority.json',
  'doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v7.mjs',
  'doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard.mjs',
  'doc/05_testing/evidence/agent-access-20261011-closeout-r3/quiet-launch-v5.mjs',
  'scripts/agent-access-recipes.mjs', 'test/unit/agent-access-recovery.test.ts', historicalPath, artifact.absPath ];
const records = cited.map(file => {
  const bytes = fs.readFileSync(file);
  const findings = scanSecrets(bytes.toString());
  if (findings.length) throw Error('被审材料脱敏扫描失败：' + file);
  return { file, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, secrets: 0 };
});
for (const name of fs.readdirSync(root)) {
  const file = path.join(root, name);
  if (fs.statSync(file).isFile() && scanSecrets(fs.readFileSync(file, 'utf8')).length) throw Error('r5目录脱敏扫描失败：' + name);
}
fs.writeFileSync(path.join(root, 'static-audit-before-round11.json'), JSON.stringify({ recorded_at: new Date().toISOString(), artifact, cited: records, source_changes: [], criteria_adopted: false, vendor_cli_starts: 0,
  notes: ['第10次code拒绝原样保留', 'Grep首版审计错误原样保留，v2及Read严格校正', '其他仓库静态根目录扫描不能替代客户端实际发现'] }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ artifact, cited: records.length, secrets: 0 }));
