/** 任务级追加轮次约束；不修改编排器原生计数、失败状态或闸门。 */
export function assertFormalRound(authorization, task, runs, args) {
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
  // 已启动包含running及failed；原四ID是保留子集，不是永远恰好四条。
  const ordinal = task.runs.length + 1;
  const next = authorization.new_rounds.find(r => r.ordinal === ordinal);
  if (!next || task.runs.length >= authorization.new_limit || flag('--topic') !== authorization.topic ||
      flag('--driver') !== authorization.driver || flag('--critics') !== authorization.critics.join(',') ||
      flag('--entry') !== next.entry || flag('--stage') !== next.stage || args.includes('--allow-single')) {
    throw Error('超出已授权正式审查轮数/阶段/集合');
  }
  return ordinal;
}
