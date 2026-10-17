/** 零配额机械核对：本批四个复制件 = 10-12原件按登记的批次参数逐项替换后的逐字节结果；登记外任何差异都判不通过。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ORIGINAL_DIR = path.resolve(here, '../agent-access-convergence-20261012');
export const PLAN_RUN_ID = '20261017T085024Z';
export const TOPIC = 'M12-五组合受限准入判据';
export const AUTHORIZATION_INSTRUCTION = '允许任何次数的调用';
/** 原台账3条只预占未完成（M11 s12预检）；本批不补写、不删除，只核集合不变。 */
export const KNOWN_OPEN = Object.freeze(['reserved-0856.json', 'reserved-0857.json', 'reserved-0859.json']);
export const POOL_LIMIT = 1839;

/** 每项 [原件片段, 替换为, 原件中应出现的次数]；只许批次参数：来源注释、批次根与授权文件、claim字段、批次身份与台账基线。 */
export const SUBSTITUTIONS = Object.freeze({
  'mechanism-proof.mjs': [
    ['/** 本批来源与用户免审授权绑定；完整原件复算原r21机制，不消费pass声明。 */',
      '/** M12批次2来源与具名授权、计划双审run绑定；完整原件复算原r21机制，不消费pass声明。 */', 1],
    ["claim.plan_run_id!==null||claim.user_review_waiver!==true", `claim.plan_run_id!=='${PLAN_RUN_ID}'||claim.user_review_waiver!==false`, 1],
    ["root+'/mechanism-authorization.json'", "root+'/authorization.json'", 1],
  ],
  'controlled-fixture.mjs': [
    ['/** 本轮免双审的当前来源绑定；复用r21机制与生产invokeClaude，诊断不采用判据。 */',
      '/** M12批次2具名授权的当前来源绑定；复用r21机制与生产invokeClaude，诊断不采用判据。 */', 1],
    ["'/controlled-convergence-20261012'", "'/controlled-m12-20261017'", 1],
  ],
  'launch-mechanism.mjs': [
    ['/** 本批直接执行固定入口；预算包装器及侧车沿用，授权来源明确为用户免审指令。 */',
      '/** 本批直接执行固定入口；预算包装器及侧车沿用，授权来源为M12批次2具名授权与计划双审run。 */', 1],
    ["'doc/05_testing/evidence/agent-access-convergence-20261012/mechanism-authorization.json'",
      "'doc/05_testing/evidence/m12-restricted-admission-20261017/authorization.json'", 1],
    ["'doc/05_testing/evidence/agent-access-convergence-20261012/controlled-fixture.mjs'",
      "'doc/05_testing/evidence/m12-restricted-admission-20261017/controlled-fixture.mjs'", 1],
    ['plan_run_id:null,user_review_waiver:true', `plan_run_id:'${PLAN_RUN_ID}',user_review_waiver:false`, 1],
  ],
  'mechanism-launch-check.mjs': [
    ['/** 本批一次性检查；沿用户免审授权，不制造正式plan批准，不改变r21机制谓词。 */',
      '/** 本批一次性检查；绑定M12批次2具名授权与计划双审run，不改变r21机制谓词。 */', 1],
    ["b.schema!=='convergence-mechanism-batch.v1'", "b.schema!=='m12-mechanism-batch.v1'", 1],
    ['b.formal_plan_run_id!==null||b.review_waived!==true', `b.formal_plan_run_id!=='${PLAN_RUN_ID}'||b.review_waived!==false`, 1],
    ['if(b.before!==790||b.expected_starts!==10||b.hard_starts!==15||b.batch_stop!==805||b.pool_limit!==815)',
      `if(!Number.isSafeInteger(b.before)||b.expected_starts!==10||b.hard_starts!==15||b.batch_stop!==b.before+15||b.pool_limit!==${POOL_LIMIT})`, 1],
    ['c.used!==c.completed', `c.used!==c.completed+${KNOWN_OPEN.length}`, 1],
    ["authorization.user_instruction==='提交，推送，然后继续完成剩下的问题'&&authorization.review_waiver===true&&authorization.criteria_adoption_authorized===false&&authorization.formal_approval_record===null",
      `authorization.user_instruction==='${AUTHORIZATION_INSTRUCTION}'&&authorization.review_waiver===false&&authorization.criteria_adoption_authorized===false&&authorization.formal_approval_record?.plan_run_id==='${PLAN_RUN_ID}'`, 1],
    ["'mechanism-authorization.json'", "'authorization.json'", 1],
    ["root+'/mechanism-authorization.json'", "root+'/authorization.json'", 2],
    ["'execute-mechanism.mjs'", "'batch.mjs'", 1],
    ["g.topic==='Agent双模式接入真实准入收口'", `g.topic==='${TOPIC}'`, 1],
    ["root+'/batch-c-result.json'", "root+'/mechanism-result.json'", 1],
  ],
});

const occurrences = (text, needle) => text.split(needle).length - 1;

/** 按登记替换生成期望内容；原件里片段出现次数不符即抛（防止登记漂移成静默无效替换）。 */
export function expectedCopy(name) {
  let text = fs.readFileSync(path.join(ORIGINAL_DIR, name), 'utf8');
  for (const [from, to, count] of SUBSTITUTIONS[name]) {
    const seen = occurrences(text, from);
    if (seen !== count) throw Error(`${name}: 登记片段出现${seen}次，应为${count}次：${from.slice(0, 60)}`);
    text = text.split(from).join(to);
  }
  return text;
}

export function checkCopies() {
  const results = Object.keys(SUBSTITUTIONS).map(name => {
    try {
      const actual = fs.readFileSync(path.join(here, name), 'utf8'), expected = expectedCopy(name);
      if (actual === expected) return { name, ok: true };
      const a = actual.split('\n'), e = expected.split('\n');
      const line = a.findIndex((l, i) => l !== e[i]);
      return { name, ok: false, first_difference_line: (line < 0 ? Math.min(a.length, e.length) : line) + 1 };
    } catch (error) { return { name, ok: false, error: error.message }; }
  });
  return { ok: results.every(r => r.ok), results };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = checkCopies();
  console.log(JSON.stringify(report));
  if (!report.ok) process.exitCode = 1;
}
