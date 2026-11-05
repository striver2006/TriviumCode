/**
 * 入口命令组装（r2 计划 D1′）。
 *
 * 注入文本 = `<终端 CLI 调用模板> <正文单行化> <旗标串>`：
 * - 无 `--` 分隔符、无 shell 引号——这是**聊天输入**，不是 shell 命令（AGY-01）；
 * - 调用模板来自 carriers.ts（完整模板，非前缀；CLAUDE-01/CODEX-01）；
 * - 渲染产物（入口 SKILL.md）仅用于「旗标语法展示」，随 `npm run render` 演进。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { invocationFor, skillRootCandidates, type AgentId } from './carriers';
import { prepareBody } from '../util/injectText';

export type EntryKind = 'A' | 'B' | 'C' | 'D';

export const ENTRY_COMMAND: Record<EntryKind, string> = {
  A: 'dual-run',
  B: 'dual-review-plan',
  C: 'dual-review-code',
  D: 'dual-review-bug',
};

/** 入口 → 前置链的 resolve/preflight stage（A 用 all 校验全部三阶段） */
export const ENTRY_STAGE: Record<EntryKind, string> = {
  A: 'all',
  B: 'plan',
  C: 'code',
  D: 'bug',
};

/** 入口 → 插件预认领的阶段（A/B 在主题确认后 claim plan；C/D 不预认领，归会话） */
export const ENTRY_CLAIM_STAGE: Record<EntryKind, string | null> = {
  A: 'plan',
  B: 'plan',
  C: null,
  D: null,
};

export const ENTRY_LABEL: Record<EntryKind, string> = {
  A: 'A · 全流程（方案→双审→编码→双审→编译测试）',
  B: 'B · 计划双审',
  C: 'C · 代码双审',
  D: 'D · Bug 根因双审',
};

export interface AssembleInput {
  agentId: AgentId;
  entry: EntryKind;
  /** 任务目标（A）或审查焦点（B/C/D）原文，可为多行 */
  body: string;
  /** CLI 旗标串（已含 --driver 等），如 ['--driver','codex','--critics','claude,gemini'] */
  flags: string[];
}

export interface AssembleResult {
  /** 最终注入文本（单行） */
  text: string;
  warnings: string[];
}

export function assembleEntryCommand(input: AssembleInput): AssembleResult {
  const { text: body, warnings } = prepareBody(input.body);
  const invocation = invocationFor(input.agentId, ENTRY_COMMAND[input.entry]);
  const flagPart = input.flags.length > 0 ? ` ${input.flags.join(' ')}` : '';
  const text = body ? `${invocation} ${body}${flagPart}` : `${invocation}${flagPart}`;
  return { text: text.trim(), warnings };
}

// ── 渲染产物读取（旗标语法展示用） ──────────────────────────────────────────

export interface SkillDocInfo {
  /** 找到的 SKILL.md 绝对路径 */
  path: string;
  /** 旗标语法提示（claude 取 front-matter argument-hint；其余取正文「参数：」行） */
  argHint: string | null;
}

/** 在根候选里找 `<命令名>/SKILL.md`，读出旗标语法提示；找不到返回 null */
export async function findSkillDoc(
  agentId: AgentId,
  entry: EntryKind,
  repoRoot: string | null,
): Promise<SkillDocInfo | null> {
  const cmd = ENTRY_COMMAND[entry];
  for (const root of skillRootCandidates(agentId, repoRoot)) {
    const docPath = path.join(root, cmd, 'SKILL.md');
    try {
      const text = await fs.readFile(docPath, 'utf8');
      return { path: docPath, argHint: extractArgHint(text) };
    } catch {
      /* 下一个候选 */
    }
  }
  return null;
}

function extractArgHint(doc: string): string | null {
  const fm = /^---\n([\s\S]*?)\n---/.exec(doc);
  if (fm) {
    const hint = /^argument-hint:\s*(.+)$/m.exec(fm[1]!);
    if (hint) return hint[1]!.trim();
  }
  const bodyHint = /^参数：.*?参数写法：(.+)$/m.exec(doc);
  if (bodyHint) return bodyHint[1]!.trim();
  return null;
}
