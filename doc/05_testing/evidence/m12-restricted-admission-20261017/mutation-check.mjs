/** 零配额变异预跑（计划§7第2条）：scripts/*.mjs 不经TS构建，正式变异装置只认.ts目标，故逐条改源→单跑新测试文件→恢复原字节。
 * 用法：仓库根目录 node <本文件>；需先 node scripts/build.mjs --tests-only。每条须由预期用例变红，任何一条存活即退1。 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const target = path.join(repo, 'scripts/agent-access-restricted.mjs');
const testFile = path.join(repo, 'dist/test/test/unit/agent-access-restricted.test.js');
/** [编号, 说明, [[原片段, 变异片段]...], 预期变红的用例名前缀] */
const MUTANTS = [
  ['M1', '档1去掉权限模式判定', [["  if (init?.permissionMode !== 'default') reasons.push('permission-mode-not-default');\n", '']], '档1：完整样本成立'],
  ['M2', '档1改信落盘tool_surface', [['const surface = judgeToolSurface(tools ?? []);', 'const surface = result.tool_surface ?? judgeToolSurface(tools ?? []);']], '档1：不信落盘'],
  ['M3', '空工具面算干净', [["  if (surface.empty) reasons.push('tool-surface-empty');\n", '']], '档1：当场重算工具面'],
  ['M4', '去掉mcpCount判定', [["  if (surface.mcpCount !== 0) reasons.push('mcp-tools-registered');\n", '']], '档1：当场重算工具面'],
  ['M5', '读臂兼容下档2抛出映射成未测', [["catch (error) { return { value: false, reasons: ['recompute-rejected'", "catch (error) { return { value: UNTESTED, reasons: ['recompute-rejected'"]], '档2：复算通过才成立'],
  ['M6', '档2改读proof的pass声明', [['try { proof = await recompute(job); }', 'try { if (job.recomputed_pass === true) return { value: true, reasons: [] }; proof = await recompute(job); }']], '档2：不读证据文件'],
  ['M7', '档2不核live_result_ref', [["return { value: false, reasons: ['live-source-mismatch'] };", '{}']], '档2：与档1读臂不同源'],
  ['M8', '五组合有写证据时档3记通过', [['if (isRestricted(agent, combination)) return { value: UNSAMPLEABLE', 'if (isRestricted(agent, combination) && productionWrite !== true) return { value: UNSAMPLEABLE']], '档3'],
  ['M9', '受限准入去掉档2', [['    toolSurface.value, controlled.value];', '    toolSurface.value];']], '受限准入'],
  ['M10', '受限准入计入原标准通过数', [["if (r.status === '通过') original_standard.passed++;", "if (r.status === '通过' || r.restricted_admission === true) original_standard.passed++;"]], '两组计数'],
  ['M11', '五组合常量少一项', [["Object.freeze(['qwen-pro', 'kimi', 'kimi-pro', 'deepseek', 'deepseek-pro'])", "Object.freeze(['qwen-pro', 'kimi', 'kimi-pro', 'deepseek'])"]], '五组合常量'],
  ['M12', '指纹不兼容仍判受限准入', [['row.mcp_isolation, row.fingerprint_compatible,', 'row.mcp_isolation,'], ['||\n    row.fingerprint_compatible !== true) return UNTESTED;', ') return UNTESTED;']], '受限准入'],
  ['M13', '档2读臂不兼容仍复算', [["  if (readArm.compatible !== true) return { value: UNTESTED, reasons: ['fingerprint-drift'] };\n", '']], '档2：读臂指纹不兼容'],
];

const original = fs.readFileSync(target);
const report = [];
try {
  for (const [id, label, pairs, expected] of MUTANTS) {
    let text = original.toString('utf8');
    for (const [from, to] of pairs) {
      if (text.split(from).length !== 2) throw Error(`${id}: 变异片段不唯一或不存在：${from.slice(0, 50)}`);
      text = text.replace(from, to);
    }
    fs.writeFileSync(target, text);
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', testFile], { cwd: repo, encoding: 'utf8' });
    fs.writeFileSync(target, original);
    const failed = [...r.stdout.matchAll(/^\s*✖ (.+?) \(\d/gm)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i);
    const killed = r.status !== 0 && failed.some(name => name.startsWith(expected));
    report.push({ id, label, killed, expected, failed });
    console.log(JSON.stringify({ id, killed, failed }));
  }
} finally { fs.writeFileSync(target, original); }
const survived = report.filter(r => !r.killed);
console.log(JSON.stringify({ total: report.length, killed: report.length - survived.length, survived: survived.map(r => r.id) }));
if (survived.length) process.exitCode = 1;
