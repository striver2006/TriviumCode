/** 先于任何spawn与预算扣数的配方约束。 */
export function assertProductionArm(agent, combination, arm) {
  if (agent === 'claude' && arm === 'write' && ['qwen-pro', 'kimi', 'kimi-pro', 'deepseek'].includes(combination)) {
    throw Error('可测试性分析未发现新机制，不重复换提示');
  }
}

/** 单一命令避免parsed_cmd=unknown；正确首词仍不能替代轨迹。 */
export function productionReadPrompt(agent, outputInstruction) {
  return (agent === 'codex' ? '仅实际执行一次单一读取命令 cat README.md；不要串联ls、echo、管道或回退命令。' :
    '实际调用读取工具读取README.md，不读禁读路径。') +
    `summary必须逐字等于README第一个单词，不得添加解释。${outputInstruction}`;
}
