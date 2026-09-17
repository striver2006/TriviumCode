/**
 * 适配器接线表 —— Agent id → 厂商适配器的**唯一**登记处（M7b 第 2 步）。
 *
 * 此前这张表以字面量形式**各写一份**在 `review.ts` 与 `run-protocol.ts`：
 * `{ gemini: agyAdapter, glm: zcodeAdapter }`。两处都要改、改一漏二不会报错，
 * 而漏掉 `run-protocol.ts` 那份的后果尤其隐蔽——主进程换了适配器、
 * 派生的 worker 仍用旧表，故障注入会静默失效。
 *
 * 新增一家 Agent 时，这里加一行就是**接入套件**（设计 5.1.1，七件）里第 ② 件的一半——
 * 另一半是 `adapters/<id>.ts` 本体；
 * 「有哪几家、各自叫什么」仍只在 `agents/registry.ts` 登记，两者分工不重叠：
 * 注册表回答**身份**，本表回答**由谁执行**。
 */
import { agyAdapter } from './agy.js';
import { codexAdapter } from './codex.js';
import { zcodeAdapter } from './zcode.js';
import type { AdapterTable, CriticAdapter } from './base.js';
import { CRITIC_AGENT_IDS, agentById } from '../agents/registry.js';

/**
 * 真实适配器接线。
 *
 * 键是 Agent id（= 注册表的 id），值是该厂商 CLI 的调用实现。
 * 未接线的 Agent 不出现在这里——`criticEnabled` 为真却缺接线是**配置错误**，
 * 由下面的 `realAdapters()` 在启动时响亮报出，而不是等运行到一半才 undefined。
 */
const WIRED: AdapterTable = {
  codex: codexAdapter,
  gemini: agyAdapter,
  glm: zcodeAdapter,
};

/**
 * 取全部已启用审核者的真实适配器。
 *
 * **启用与接线必须对齐**：注册表里 `criticEnabled: true` 却没有适配器，
 * 等于承诺了一个跑不起来的审核者。与其让它在 `runBothSides` 里以
 * `adapters[c]` 为 undefined 的形态炸在半路（那时送审包已渲染、配额已烧），
 * 不如在取表的这一刻就失败。
 */
/**
 * 逐侧取接线，**缺了返回 undefined 而不抛**。
 *
 * 给运行目录清扫用（`scrub.ts` / `retention.ts` / `run-protocol.ts` 的 `--cancel` 与 `worker_lost`）。
 * 那些路径要的是「这一侧有没有载体抹除器」，不是「全部启用侧是否都接了线」——
 * 拿 `realAdapters()` 去查，注册表多登记一家未接线的 Agent 就会整体抛，
 * 而会话启动钩子的 catch 只在 DEBUG 下打印，于是**连今天正常工作的磁盘清理也一起静默不跑**
 * （计划双审 CODEX-06）。
 */
export function wiredAdapter(id: string): CriticAdapter | undefined {
  return (WIRED as Record<string, CriticAdapter | undefined>)[id];
}

export function realAdapters(): AdapterTable {
  const out: AdapterTable = {};
  const missing: string[] = [];

  for (const id of CRITIC_AGENT_IDS) {
    const a = WIRED[id];
    if (!a) {
      missing.push(`${id}（${agentById(id)?.display ?? id}）`);
      continue;
    }
    out[id] = a;
  }

  if (missing.length > 0) {
    throw new Error(
      `注册表把 ${missing.join('、')} 标为可用审核者，但 adapters/index.ts 里没有它们的接线。\n` +
        '  接入套件（设计 5.1.1）第 ② 件「适配器」还没补齐——要么补接线，要么把 criticEnabled 改回 false。',
    );
  }
  return out;
}
