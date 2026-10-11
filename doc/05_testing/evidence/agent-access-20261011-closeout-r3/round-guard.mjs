/** 任务级追加轮次约束；不修改编排器原生计数、失败状态或闸门。 */
import fs from 'node:fs';
import crypto from 'node:crypto';

/** 读取壳验证本轮唯一权威文件及其完整hash；缺失、未知或被替代均fail-closed。 */
export function readCurrentAuthorization(readBytes = fs.readFileSync) {
  const pointer = JSON.parse(readBytes(new URL('./formal-round-authority.json', import.meta.url)));
  if (!/^formal-round-authorization(?:-v\d+)?\.json$/.test(pointer.authorization ?? '') ||
      !/^[a-f0-9]{64}$/.test(pointer.sha256 ?? '')) throw Error('当前授权载体无效');
  const bytes = readBytes(new URL('./' + pointer.authorization, import.meta.url));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== pointer.sha256) throw Error('当前授权hash漂移');
  const authorization = JSON.parse(bytes);
  if (authorization.topic !== pointer.topic) throw Error('当前授权主题不符');
  return authorization;
}

export function assertFormalRound(authorization, task, runs, args) {
  return assertFormalRoundCore(authorization, task, runs, args, readCurrentAuthorization());
}

/** 纯核验：显式消费当前权威，不把superseded旧授权当作本轮有效声明。 */
export function assertFormalRoundCore(authorization, task, runs, args, current = authorization) {
  if (JSON.stringify(authorization) !== JSON.stringify(current)) throw Error('授权已被替代或不是当前权威');
  if (!task || !Array.isArray(task.runs) || !Array.isArray(runs) || runs.some(r => r.unreadable) ||
      new Set(runs.map(r => r.run_id)).size !== runs.length ||
      new Set(task.runs.map(r => r.run_id)).size !== task.runs.length ||
      JSON.stringify(runs.map(r => r.run_id).sort()) !== JSON.stringify(task.runs.map(r => r.run_id).sort()) ||
      authorization.historical_run_ids.some(id => !runs.some(r => r.run_id === id))) {
    throw Error('正式运行计数或原件缺失，不启动');
  }
  const flag = name => {
    if (args.filter(a => a === name).length !== 1) throw Error('正式运行参数缺失或重复');
    return args[args.indexOf(name) + 1];
  };
  // 已启动包含running及failed；历史ID以当前授权字段为准，只要求保留子集。
  const ordinal = task.runs.length + 1;
  const next = authorization.new_rounds.find(r => r.ordinal === ordinal);
  if (!next || task.runs.length >= authorization.new_limit || flag('--topic') !== authorization.topic ||
      flag('--driver') !== authorization.driver || flag('--critics') !== authorization.critics.join(',') ||
      flag('--entry') !== next.entry || flag('--stage') !== next.stage || args.includes('--allow-single')) {
    throw Error('超出已授权正式审查轮数/阶段/集合');
  }
  return ordinal;
}
