/**
 * `topic`：主题解析与阶段目录（设计 §5.1 / §6.1）。
 *
 * 主题名的合法性规则在 naming.ts（纯函数、可单测），这里负责与文件系统交互的部分：
 * 定位被审对象、创建阶段目录、给出候选清单。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { DEFAULT_DRIVER, type AgentId } from './agents/registry.js';
import type { Ctx, Stage } from './types.js';
import { validateTopic, parseArtifactName } from './naming.js';
import { missingArtifact, usageError } from './exit-codes.js';
import { ensureDir, exists } from './util/fsx.js';
import { stageDir, topicDir, type ArchiveLayout } from './archive.js';

export interface TopicRef {
  topic: string;
  layout: ArchiveLayout;
  stage: Stage;
  stageDirAbs: string;
}

/** 校验并规范化主题名，非法即抛 64（设计 §7.3） */
export function resolveTopicName(ctx: Ctx, raw: string): string {
  const v = validateTopic(raw, ctx.config.topic.max_len);
  if (!v.ok) {
    const hint = v.suggestion ? `\n  建议改为：${v.suggestion}` : '';
    throw usageError(`主题名不合法：${v.reason}${hint}`);
  }
  return v.normalized;
}

/**
 * 解析主题引用，**不创建**任何目录。
 *
 * 零工件保证要求目录创建推迟到「确定要落盘」的那一刻（审查意见 GLM-04）：
 * 在此之前若 locateSubject 抛 65 或 routeModel 抛 69，就会留下孤立空目录。
 */
export async function resolveTopicReadOnly(
  ctx: Ctx,
  rawTopic: string,
  stage: Stage,
): Promise<TopicRef> {
  const topic = resolveTopicName(ctx, rawTopic);
  const layout: ArchiveLayout = { archiveRoot: ctx.archiveRoot, topic };
  return { topic, layout, stage, stageDirAbs: stageDir(layout, stage) };
}

/** 解析主题引用并**创建**阶段目录。只在确定要落盘时调用 */
export async function resolveTopic(ctx: Ctx, rawTopic: string, stage: Stage): Promise<TopicRef> {
  const ref = await resolveTopicReadOnly(ctx, rawTopic, stage);
  await ensureDir(ref.stageDirAbs);
  return ref;
}

/** 已存在的主题清单（供 status / report / 候选提示） */
export async function listTopics(ctx: Ctx): Promise<string[]> {
  try {
    const entries = await fs.readdir(ctx.archiveRoot, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * 定位被审对象（设计 §8.3）。
 *
 * plan / bug 阶段：`--plan-file` / `--rca-file` 显式指定，
 * 否则取该阶段下**最新的、非 revised/response 的当轮 Driver 后缀文件**。
 * 找不到即抛 65 并列出候选——不得静默新建空原稿。
 */
export async function locateSubject(
  ref: TopicRef,
  explicitPath: string | null,
  projectRoot: string,
  driver: AgentId = DEFAULT_DRIVER,
): Promise<string> {
  if (explicitPath) {
    const abs = path.isAbsolute(explicitPath) ? explicitPath : path.join(projectRoot, explicitPath);
    if (!(await exists(abs))) {
      throw missingArtifact(`指定的被审对象不存在：${explicitPath}`);
    }
    return abs;
  }

  let entries: string[];
  try {
    entries = await fs.readdir(ref.stageDirAbs);
  } catch {
    entries = [];
  }

  const candidates = entries
    .map((fileName) => ({ fileName, parsed: parseArtifactName(fileName) }))
    .filter(
      (c) =>
        c.parsed !== null &&
        c.parsed.topic === ref.topic &&
        // 原稿由当轮 Driver 产出；写死 'claude' 会让非 Claude Driver
        // 在第一步就找不到被审对象并退 65（计划 §2.1 / B-1）
        c.parsed.role === driver &&
        c.parsed.kind === null,
    )
    // 同主题同阶段可能有多轮原稿，取轮次最大者
    .sort((a, b) => b.parsed!.rerunIndex - a.parsed!.rerunIndex || b.fileName.localeCompare(a.fileName));

  if (candidates.length === 0) {
    const all = entries.length > 0 ? `\n  该目录下现有文件：${entries.join(', ')}` : '';
    throw missingArtifact(
      `在 ${ref.stageDirAbs} 下找不到主题「${ref.topic}」的原稿` +
        `（形如 <日期>-${ref.topic}-${driver}.md）。请先落盘原稿，或用 --plan-file / --rca-file 显式指定。${all}`,
    );
  }
  return path.join(ref.stageDirAbs, candidates[0]!.fileName);
}

/** 主题目录是否已存在（预检用：失败时不得创建主题目录，AC-16） */
export async function topicExists(ctx: Ctx, topic: string): Promise<boolean> {
  return exists(topicDir({ archiveRoot: ctx.archiveRoot, topic }));
}
