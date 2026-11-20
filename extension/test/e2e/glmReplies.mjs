import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const relayQuestion = '请回复 P4NEXT 后紧接 63 乘 17 的结果，不加空格。';

// 仅验收时读取本夹具登记的 ZCode 会话。保留标记、时间和正文匹配结果，
// 原生日志中的请求头、模型推理和其它会话内容均不进入矩阵。
export async function verifyGlmReplies(r, gate) {
  const id = gate?.session_id;
  if (!/^sess_[\w-]+$/.test(id ?? '')) throw new Error('缺少原生会话编号');
  const file = path.join(homedir(), '.zcode/cli/rollout', 'model-io-' + id + '.jsonl');
  const records = (await fs.readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    .filter(row => row.sessionId === id && row.querySource === 'main_turn');
  const entry = records.find(row => /P4ACK\s*475(?!\d)/.test(row.response.text ?? ''));
  const reply = records.find(row => row.response.text?.includes('P4NEXT1071'));
  const inputs = reply?.request.messages.filter(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('P4NEXT'));
  const clicked = Date.parse(r.clickedAt);
  if (!entry || !reply || entry.turnId === reply.turnId || inputs.length !== 1 || inputs[0].content !== relayQuestion ||
      Date.parse(reply.startedAt) < Date.parse(entry.completedAt) ||
      (r.timing === 'busy' ? clicked >= Date.parse(entry.completedAt) : clicked < Date.parse(entry.completedAt))) {
    throw new Error('入口与续话的原生轮次、点击时机或续话正文不符');
  }
  return { sessionId: id, file, model: reply.model.modelId, entryTurn: entry.turnId, entryCompleted: entry.completedAt,
    entryAnswer: entry.response.text.match(/P4ACK\s*475(?!\d)/)[0], relayTurn: reply.turnId, relayStarted: reply.startedAt, relayCompleted: reply.completedAt, exactBody: inputs[0].content };
}
