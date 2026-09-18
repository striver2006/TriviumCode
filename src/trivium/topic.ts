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
import { isReviewArtifact, stageDir, topicDir, type ArchiveLayout } from './archive.js';

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
    /*
     * 显式指定也要挡审查件——**这里是硬拒，不是过滤**。
     *
     * 自动候选那条路可以「剔掉再选下一个」，显式路径没有下一个：用户点名了这一份，
     * 静默换成别的就是那族「解析成功、随后被悄悄替换」的缺口。而把一份审查意见
     * 当原稿送审，产出的是「对意见的意见」，留痕上看不出审错了东西。
     *
     * 判据只认 `trivium.review.v1`（见 `isReviewArtifact`）：没有 front-matter 的
     * 手写原稿、以及 Driver 的裁决件，一律放行。后者是有意的——用户显式指定裁决件
     * 属明确意图，而自动候选按 `kind === null` 过滤，裁决件本就选不上。
     */
    if (await isReviewArtifact(abs)) {
      throw missingArtifact(
        `指定的被审对象是一份**审查件**，不是原稿：${explicitPath}\n` +
          '  它的 front-matter 是 schema: trivium.review.v1，由编排器从审查员的结构化输出渲染而成。\n' +
          '  拿它当被审对象会让这一轮审的是「对意见的意见」。请指向原稿。',
      );
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

  /*
   * **剔掉审查件，而不是一律硬拒**（计划双审 r1 D4 / R-1）。
   *
   * 换过 Driver 的主题里，上一轮别家当 Driver 时产出的审查件恰好顶着这一家的后缀，
   * 且日期更晚——按上面的排序它会排在真原稿前面。一律硬拒会把一条合法工作流
   * 永久锁死（改名就破坏文件名解析，用户没有自救手段）；剔掉它再往下取就没事。
   */
  const kept: typeof candidates = [];
  const dropped: string[] = [];
  for (const c of candidates) {
    if (await isReviewArtifact(path.join(ref.stageDirAbs, c.fileName))) dropped.push(c.fileName);
    else kept.push(c);
  }

  if (kept.length === 0) {
    const all = entries.length > 0 ? `\n  该目录下现有文件：${entries.join(', ')}` : '';
    // 被剔掉的要点名：否则「明明有一份同名文件却说找不到」会把人引去查文件名规则
    const why = dropped.length > 0
      ? `\n  已排除（是审查件而非原稿）：${dropped.join(', ')}`
      : '';
    throw missingArtifact(
      `在 ${ref.stageDirAbs} 下找不到主题「${ref.topic}」的原稿` +
        `（形如 <日期>-${ref.topic}-${driver}.md）。请先落盘原稿，或用 --plan-file / --rca-file 显式指定。${why}${all}`,
    );
  }
  return path.join(ref.stageDirAbs, kept[0]!.fileName);
}

/** 主题目录是否已存在（预检用：失败时不得创建主题目录，AC-16） */
export async function topicExists(ctx: Ctx, topic: string): Promise<boolean> {
  return exists(topicDir({ archiveRoot: ctx.archiveRoot, topic }));
}
