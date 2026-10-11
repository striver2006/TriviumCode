/** 已批准第8次裁决的文档收敛；不写审查工件，不改产品判据。 */
import fs from 'node:fs';
import path from 'node:path';
const main = 'doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md';
const skill = 'skills/dual-critic/SKILL.md';
const old = fs.readFileSync(skill, 'utf8').split('\n').find(l => l.startsWith('当前plan-r5/run20261010T232715Z获批r12契约：'));
if (!old) throw Error('原当前契约不存在，拒绝重复修改');
const prefix = '**v1.3.148 · 敏感扫描深度补充计划获批（实施及真机采样未完成）**：';
let text = fs.readFileSync(main, 'utf8');
if (text.split(prefix + old).length !== 6) throw Error('设计副本数量不符');
const canonical = `<a id="agent-access-directory-contract"></a>

**v1.3.148 · 当前目录事实与敏感枚举规范**：敏感路径扫描以 \`freeze.ts\` 导出的 \`SENSITIVE_SCAN_MAX_PARENT_DEPTH=7\` 为父目录上限（项目根为0）；父深度8不枚举，归档同行扫描没有该上限。保留 \`.git\`/\`node_modules\` 排除、目录软链不跟随后代，匹配软链项自身沿原glob判定；未列出的深层匹配凭据不构成阅读授权，但现有轨迹检测不能报告枚举集之外的命中。目录消费须有真实项目 \`sensitive_globs\` 排序去重JSON/SHA256、\`ascii-root1-5-depth0-2-v2\` 实测事实及有效时间/路线/版本/入口/native绑定；根为1—5段、后代为0—2级ASCII目录段，特殊文件名不外推特殊目录。事实缺失或失配逐文件回退，无可消费声明先避免二进制读取，同一精确路径仅本次调用复用hash，性能收益未实测。探针使用五根、30文件/5目录/4正对照和每臂180秒；预期外部失败保留主probe、清空目录事实、脱敏留痕并清理，未知内部错误继续抛。生产写原判据不变，分项守卫不作为独立模型能力证明。任务级正式代码启动前须核最终安装/输入hash、生产完整枚举、新事实实际消费及settings≤131072、skipped=0。正式授权、实施/审查/审批、真机证据及未测项只以[恢复报告](../05_testing/REPORT_2026-10-11_agent_access_recovery.md)按采样时刻记录。`;
text = text.replace(prefix + old, canonical).replaceAll(prefix + old,
  '**v1.3.148 · 当前规范引用**：目录事实与敏感扫描边界统一见[§3.5规范](#agent-access-directory-contract)，进展见[恢复报告](../05_testing/REPORT_2026-10-11_agent_access_recovery.md)。本节不复制计划时点的实施状态。');
const predicate = "归属判据为`P===D || P.startsWith(D+'/')`";
if (!text.includes(predicate)) throw Error('旧谓词句不存在');
text = text.replace(predicate, '坐标归属只是必要条件；实际投影同时受`CLAUDE_DIRECTORY_SHAPE`和`projectClaudeDenyPaths`的covered谓词约束：根1—5段且逐段ASCII，文件之上的后代目录0—2级且为ASCII；超域路径仍逐文件注入');
text = text.replace('未知工具仍使用全部逐文件规则；',
  '宽祖先glob与深后代glob共存时，根候选会去掉嵌套根；若祖先形态盖不住深后代文件，该文件保守回退逐文件，settings可能回涨并被启动前软线检查拒绝，不宣称压缩性能稳定。未知工具仍使用全部逐文件规则；');
const prototype = text.split('\n').find(l => l.startsWith('8. **禁读与禁止事项**：'));
if (!prototype) throw Error('第8段原型不存在');
text = text.replace(prototype, prototype + '\n\n> 这是设计§9.4的任务书原型边界声明；当前`brief.ts`运行模板未显式渲染父深度上限。不能报告为真实任务书已披露，也不能把未列出的深层匹配凭据视为获准读取。运行模板披露留作独立后续事项，本次不改变枚举或guard判据。');
const lines = text.split('\n');
const rows = lines.filter(l => /^\| \*\*v1\.3\.(146|147|148)\*\*/.test(l));
if (rows.length !== 3) throw Error('版本行数量不符');
const indices = rows.map(l => lines.indexOf(l));
if (indices.some((n,i) => n !== indices[0] + i)) throw Error('版本行不相邻');
rows.sort((a,b) => Number(/v1\.3\.(\d+)/.exec(b)[1]) - Number(/v1\.3\.(\d+)/.exec(a)[1]));
rows.forEach((row,i) => { lines[indices[i]] = row.includes('**v1.3.148**') ? row.replaceAll('BRIEF第8段', '设计§9.4第8段原型') : row; });
fs.writeFileSync(main, lines.join('\n'));
const documents = [];
function walk(dir) { for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
  const p = path.join(dir,e.name); if(e.isDirectory()) walk(p); else if(p.endsWith('.md')) documents.push(p);
} }
walk('doc'); documents.push(skill);
const changed = [main];
for(const file of documents) {
  if(file === main) continue;
  const source = fs.readFileSync(file,'utf8'); if(!source.includes(old)) continue;
  const design = path.relative(path.dirname(file),main);
  const report = path.relative(path.dirname(file),'doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md');
  const replacement = `当前目录事实与敏感枚举规范统一见[设计§3.5](${design}#agent-access-directory-contract)：消费仅限受测ASCII形态、绑定实际项目及入口，失配回退逐文件。正式授权、实施、真实取证和未测状态见[恢复报告](${report})，不以本节历史计划采样替代当前验收。`;
  fs.writeFileSync(file, source.replaceAll(old,replacement)); changed.push(file);
}
console.log(JSON.stringify({changed,guard_changed:false,brief_runtime_changed:false}));
