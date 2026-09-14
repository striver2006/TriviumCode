/**
 * `trivium init`：在目标项目内布置运行时（设计 §5.3 / 交付物 #8）。
 *
 * 产出：
 *   `.trivium/bin/trivium`  wrapper，内含 doctor 探测到的 **node 绝对路径**
 *   `.trivium/config.yaml`  团队共享策略（进 Git）
 *   `.claude/settings.json` 合并 Hook（按事件名追加，不替换用户既有 hooks）
 *   `.gitignore`            幂等追加 `.trivium/` 规则，并修正整体忽略 `.claude/` 的写法
 *   `CLAUDE.md` / `AGENTS.md` 幂等追加协议片段
 *
 * 全部操作**幂等**：重复运行不重复追加、不覆盖用户内容。
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import YAML from 'yaml';
import type { Ctx } from './types.js';
import { CONFIG_SCHEMA_ID, CONFIG_SCHEMA_ID_V1, defaultConfig, migrateConfigV1 } from './config.js';
import { createExclusive, ensureDir, exists, writeAtomic } from './util/fsx.js';
import { say, step, warn } from './util/log.js';

const MARKER_BEGIN = '<!-- BEGIN TriviumCode -->';
const MARKER_END = '<!-- END TriviumCode -->';
const GITIGNORE_MARKER = '# TriviumCode 编排器运行时目录 (.trivium/)';

export interface InitOptions {
  ctx: Ctx;
  /** skill 资产根，默认用户级安装位置 */
  assetRoot?: string;
  /** node 绝对路径。省略时取当前进程的 */
  nodePath?: string;
  /** 只报告将要做什么，不落盘 */
  dryRun?: boolean;
  /** 已确认的编译测试命令。未确认时不写入 verify（§14.1：未经确认的候选永不执行） */
  verify?: { build: string[]; test: string[] };
}

export interface InitReport {
  created: string[];
  updated: string[];
  skipped: string[];
  notes: string[];
}

function assetRootDefault(): string {
  return process.env['TRIVIUM_ASSET_ROOT'] ?? path.join(os.homedir(), '.claude/skills/dual-critic');
}

/** 幂等追加带标记的片段。已存在标记则跳过 */
async function appendSnippet(
  target: string,
  snippetPath: string,
  report: InitReport,
  dryRun: boolean,
): Promise<void> {
  if (!(await exists(snippetPath))) {
    report.notes.push(`缺少片段文件 ${snippetPath}，跳过`);
    return;
  }
  const snippet = await fs.readFile(snippetPath, 'utf8');
  const existing = (await exists(target)) ? await fs.readFile(target, 'utf8') : '';

  if (existing.includes(MARKER_BEGIN)) {
    report.skipped.push(`${target}（已含 TriviumCode 片段）`);
    return;
  }
  const block = `\n${MARKER_BEGIN}\n${snippet.trim()}\n${MARKER_END}\n`;
  if (!dryRun) await writeAtomic(target, existing + block);
  (existing.length > 0 ? report.updated : report.created).push(target);
}

/**
 * 修正 `.gitignore`。
 *
 * 两件事：追加 `.trivium/` 规则；把整体忽略 `.claude/` 改为白名单写法——
 * 否则随仓库分发的 Hook `settings.json` 会被一并忽略（审核意见 RV-06）。
 */
export async function fixGitignore(
  projectRoot: string,
  snippetPath: string,
  report: InitReport,
  dryRun: boolean,
): Promise<void> {
  const p = path.join(projectRoot, '.gitignore');
  let content = (await exists(p)) ? await fs.readFile(p, 'utf8') : '';
  let changed = false;

  // ① 整体忽略 .claude/ → 白名单
  const lines = content.split('\n');
  const bad = lines.findIndex((l) => l.trim() === '.claude/' || l.trim() === '/.claude/');
  if (bad !== -1) {
    lines.splice(
      bad,
      1,
      '# Claude Code：忽略个人状态，但保留随仓库分发的 Hook 配置（TriviumCode 需要）',
      '.claude/*',
      '!.claude/settings.json',
      '.claude/settings.local.json',
    );
    content = lines.join('\n');
    changed = true;
    report.notes.push(
      '已把整体忽略 `.claude/` 改为白名单写法——否则随仓库分发的 Hook settings.json 会被忽略',
    );
  }

  // ② 追加 .trivium/ 规则（幂等）
  if (!content.includes(GITIGNORE_MARKER)) {
    if (await exists(snippetPath)) {
      content = content.replace(/\n*$/, '\n') + (await fs.readFile(snippetPath, 'utf8'));
      changed = true;
    }
  }

  if (!changed) {
    report.skipped.push(`${p}（无需修改）`);
    return;
  }
  if (!dryRun) await writeAtomic(p, content);
  report.updated.push(p);
}

/**
 * 合并 Hook 进 `.claude/settings.json`。
 *
 * **按事件名追加而非替换**（风险 R-D）：用户可能已有自己的 hooks。
 * 写前备份；已存在同一条 TriviumCode 命令时跳过（幂等）。
 */
export async function mergeHooks(
  projectRoot: string,
  hooksJsonPath: string,
  report: InitReport,
  dryRun: boolean,
): Promise<void> {
  if (!(await exists(hooksJsonPath))) {
    report.notes.push(`缺少 ${hooksJsonPath}，跳过 Hook 合并`);
    return;
  }
  const incoming = JSON.parse(await fs.readFile(hooksJsonPath, 'utf8')) as {
    hooks: Record<string, unknown[]>;
  };

  const target = path.join(projectRoot, '.claude/settings.json');
  let settings: Record<string, unknown> = {};
  const had = await exists(target);
  if (had) {
    const raw = await fs.readFile(target, 'utf8');
    try {
      settings = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      warn(`${target} 不是合法 JSON，为避免破坏内容，跳过 Hook 合并。请手工合并。`);
      report.notes.push(`${target} 解析失败，未合并 Hook`);
      return;
    }
    if (!dryRun) await fs.writeFile(`${target}.trivium-backup`, raw, 'utf8');
  }

  const existingHooks = (settings['hooks'] ?? {}) as Record<string, unknown[]>;
  let added = 0;
  let replaced = 0;
  for (const [event, entries] of Object.entries(incoming.hooks)) {
    const cur = Array.isArray(existingHooks[event]) ? existingHooks[event] : [];
    for (const entry of entries) {
      const sig = JSON.stringify(entry);
      const mine = hookNamesOf(entry);
      /*
       * 同一条 TriviumCode Hook 的识别依据是它调用的 `gate hook-<name>`，不是命令全文。
       * 原先的正则 /trivium['"]? (gate )?hook-/ 要求 `trivium` 后紧跟空格，而真实命令是
       * `…/bin/trivium"; test -x "$W" || exit 0; exec "$W" gate hook-…`——永远匹配不上，
       * 去重只剩 JSON 全等：命令文本或 timeout 一变，重跑 init 就在同一事件下叠加第二条，
       * 每次工具调用双倍执行。升级时应当**替换**旧条目，而不是跳过或叠加。
       */
      const at = cur.findIndex((c) => [...hookNamesOf(c)].some((n) => mine.has(n)));
      if (at === -1) {
        cur.push(entry);
        added++;
      } else if (JSON.stringify(cur[at]) !== sig) {
        cur[at] = entry;
        replaced++;
      }
    }
    existingHooks[event] = cur;
  }
  settings['hooks'] = existingHooks;

  if (added === 0 && replaced === 0) {
    report.skipped.push(`${target}（Hook 已就位）`);
    return;
  }
  await ensureDir(path.dirname(target));
  if (!dryRun) await writeAtomic(target, JSON.stringify(settings, null, 2) + '\n');
  (had ? report.updated : report.created).push(target);
  if (replaced > 0) report.notes.push(`已把 ${replaced} 条旧版 TriviumCode Hook 替换为当前版本`);
  if (had) report.notes.push(`已备份原 settings.json 到 ${path.basename(target)}.trivium-backup`);
}

/** 一条 hooks 条目里调用了哪些 `gate hook-<name>`（TriviumCode 的 Hook 身份） */
export function hookNamesOf(entry: unknown): Set<string> {
  const out = new Set<string>();
  for (const m of JSON.stringify(entry).matchAll(/gate hook-([a-z-]+)/g)) out.add(m[1]!);
  return out;
}

/**
 * 把 Homebrew Cellar 的版本化路径换成稳定入口。
 *
 * `process.execPath` 在 Homebrew 下解析为 `/opt/homebrew/Cellar/node/25.2.1/bin/node`，
 * `brew upgrade node` 后该路径消失；hooks.json 的守卫只检查 wrapper 自身可执行，
 * 于是每次 Edit / Write / Bash / Stop 都报一次 127。`<prefix>/opt/node[@N]/bin/node`
 * 是 Homebrew 维护的稳定符号链接，升级后仍然有效。
 */
export async function stableNodePath(
  execPath: string,
  existsFn: (p: string) => Promise<boolean> = exists,
): Promise<string> {
  const m = /^(.*)\/Cellar\/(node(?:@\d+)?)\/[^/]+\/bin\/node$/.exec(execPath);
  if (!m) return execPath;
  const stable = `${m[1]}/opt/${m[2]}/bin/node`;
  return (await existsFn(stable)) ? stable : execPath;
}

/**
 * 校验 wrapper 指向的 node 与 bundle 是否仍然存在（供 doctor / init 报告）。
 * wrapper 自身在、里面写死的路径却失效，是 `brew upgrade node` 或重装 skill 之后的常见形态。
 */
export async function checkWrapper(triviumDir: string): Promise<string[]> {
  const p = path.join(triviumDir, 'bin/trivium');
  if (!(await exists(p))) return [];
  const script = await fs.readFile(p, 'utf8');
  const m = /^exec "([^"]+)" "([^"]+)"/m.exec(script);
  if (!m) return [`${p} 不是 trivium init 生成的 wrapper 形态，请重跑 trivium init`];
  const problems: string[] = [];
  if (!(await exists(m[1]!))) problems.push(`wrapper 写死的 node 已不存在：${m[1]}（brew upgrade node 之后常见）。请重跑 trivium init`);
  if (!(await exists(m[2]!))) problems.push(`wrapper 指向的 bundle 已不存在：${m[2]}。请重新安装 skill 后重跑 trivium init`);
  return problems;
}

/** wrapper 内写死 node 绝对路径：GUI 进程不读 ~/.zshrc（设计 §10.5） */
export async function writeWrapper(
  triviumDir: string,
  nodePath: string,
  assetRoot: string,
  report: InitReport,
  dryRun: boolean,
): Promise<void> {
  const p = path.join(triviumDir, 'bin/trivium');
  const script =
    `#!/bin/sh\n` +
    `# 由 \`trivium init\` 生成。node 路径写死是刻意的：\n` +
    `# GUI 进程（VS Code）不读 ~/.zshrc，依赖 PATH 会在插件里失效（设计 §10.5）。\n` +
    `exec "${nodePath}" "${path.join(assetRoot, 'scripts/trivium.cjs')}" "$@"\n`;
  const had = await exists(p);
  await ensureDir(path.dirname(p));
  if (!dryRun) {
    await writeAtomic(p, script);
    await fs.chmod(p, 0o755);
  }
  (had ? report.updated : report.created).push(p);
}

/**
 * `config.yaml` 的 v1 → v2 一次性磁盘改写（设计 §13.1.1，M7b 第 4 步）。
 *
 * 返回是否真的改写了。**这是可选优化，不是必要步骤**：`loadCtx` 的内存迁移
 * 已经让旧配置照常可用，所以这里的每一条失败路径都选择「放弃改写并说明」，
 * 而不是让 `init` 整个失败——为一个锦上添花的动作打断初始化不划算。
 *
 * 失败路径纪律（计划 §3.2 逐条钉死）：
 *   · 备份用 `O_CREAT|O_EXCL`，已存在即放弃——与归档的防覆盖铁律同纪律，
 *     决不覆盖一份可能是上一次改写留下的、唯一的原文；
 *   · 已是 v2 则幂等 no-op；
 *   · 新文件走临时文件 + `rename` 原子替换（`writeAtomic`），不留半份。
 *
 * **注释保留是尽力项，不是验收项**：YAML 往返会丢掉原文件里的解释性注释。
 * 原文完整保留在备份里，这一点会在报告里对用户说明。
 */
async function rewriteConfigToV2(
  cfgPath: string,
  report: InitReport,
  dryRun: boolean,
): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(cfgPath, 'utf8');
  } catch (e) {
    report.notes.push(`${cfgPath} 读取失败，跳过 v2 改写：${(e as Error).message}`);
    return false;
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (e) {
    report.notes.push(`${cfgPath} 不是合法 YAML，跳过 v2 改写（内存迁移不受影响）：${(e as Error).message}`);
    return false;
  }

  const { config: migrated, note } = migrateConfigV1(parsed);
  if (!note) return false; // 已是 v2，或没有任何可迁移的东西：幂等 no-op

  const backup = `${cfgPath}.trivium-backup`;
  if (!dryRun) {
    try {
      // O_EXCL：备份已存在就放弃。宁可不改，也不覆盖唯一的原文
      await createExclusive(backup, raw);
    } catch (e) {
      const why = (e as NodeJS.ErrnoException).code === 'EEXIST'
        ? `${path.basename(backup)} 已存在`
        : (e as Error).message;
      report.notes.push(
        `跳过 config.yaml 的 v2 改写：备份写不成（${why}）。\n` +
          '  旧配置仍可用——每次运行会在内存里迁移，只是每次都会打一行提示。',
      );
      return false;
    }
    const header =
      '# TriviumCode 项目配置（进 Git，团队共享）\n' +
      '# 本机绝对路径与探针结论在 config.local.yaml（不进 Git）\n' +
      '# verify.build / verify.test 只执行此处显式声明的命令——编排器不猜测执行（§14.1）\n' +
      `# 本文件由 trivium init 从 ${CONFIG_SCHEMA_ID_V1} 改写而来，原文见 ` +
      `${path.basename(backup)}（YAML 往返会丢失注释，原注释在备份里）\n\n`;
    await writeAtomic(cfgPath, header + YAML.stringify(migrated, { lineWidth: 0 }));
  }

  report.updated.push(cfgPath);
  /*
   * dry-run 用将来时（审查意见 GLM-08）：那条路径不写备份也不写新文件，
   * 用完成时态点名一个**不存在的备份文件**会误导，而该陈述还会进 `--json` 机读输出。
   */
  report.notes.push(
    dryRun
      ? `将把 ${cfgPath} 改写为 ${CONFIG_SCHEMA_ID}，原文将备份到 ${path.basename(backup)}。\n` +
          '  注意：YAML 往返会丢掉原文件里的注释，原注释将完整保留在备份中。'
      : `已把 ${cfgPath} 改写为 ${CONFIG_SCHEMA_ID}，原文备份到 ${path.basename(backup)}。\n` +
          '  注意：YAML 往返会丢掉原文件里的注释，原注释完整保留在备份中。',
  );
  return true;
}

export async function runInit(opts: InitOptions): Promise<InitReport> {
  const { ctx } = opts;
  const assetRoot = opts.assetRoot ?? assetRootDefault();
  const nodePath = opts.nodePath ?? ctx.config.runtime.node ?? (await stableNodePath(process.execPath));
  const dryRun = opts.dryRun ?? false;
  const report: InitReport = { created: [], updated: [], skipped: [], notes: [] };

  if (!(await exists(path.join(assetRoot, 'scripts/trivium.cjs')))) {
    report.notes.push(
      `⚠️ 找不到 ${path.join(assetRoot, 'scripts/trivium.cjs')}。` +
        `请先在 TriviumCode 仓库执行 \`npm run build && node dist/install.cjs\`。`,
    );
  }

  await ensureDir(ctx.triviumDir);

  // ── config.yaml（团队共享策略，进 Git）──
  const cfgPath = path.join(ctx.triviumDir, 'config.yaml');
  if (await exists(cfgPath)) {
    const rewritten = await rewriteConfigToV2(cfgPath, report, dryRun);
    if (!rewritten) report.skipped.push(`${cfgPath}（已存在，不覆盖）`);
  } else {
    const base = defaultConfig();
    // probe 段属本机结论，落在 config.local.yaml，不进这份
    const { probe: _probe, ...shared } = base;
    const shareable = {
      ...shared,
      verify: opts.verify ?? { build: [], test: [] },
    };
    const header =
      '# TriviumCode 项目配置（进 Git，团队共享）\n' +
      '# 本机绝对路径与探针结论在 config.local.yaml（不进 Git）\n' +
      '# verify.build / verify.test 只执行此处显式声明的命令——编排器不猜测执行（§14.1）\n\n';
    if (!dryRun) await writeAtomic(cfgPath, header + YAML.stringify(shareable, { lineWidth: 0 }));
    report.created.push(cfgPath);
  }

  await writeWrapper(ctx.triviumDir, nodePath, assetRoot, report, dryRun);
  await mergeHooks(ctx.projectRoot, path.join(assetRoot, 'hooks/hooks.json'), report, dryRun);
  await fixGitignore(
    ctx.projectRoot,
    path.join(assetRoot, 'protocol/gitignore.snippet'),
    report,
    dryRun,
  );
  await appendSnippet(
    path.join(ctx.projectRoot, 'CLAUDE.md'),
    path.join(assetRoot, 'protocol/CLAUDE.md.snippet'),
    report,
    dryRun,
  );
  await appendSnippet(
    path.join(ctx.projectRoot, 'AGENTS.md'),
    path.join(assetRoot, 'protocol/AGENTS.md.snippet'),
    report,
    dryRun,
  );

  // 归档根与 README
  const reviewsReadme = path.join(ctx.archiveRoot, 'README.md');
  if (!(await exists(reviewsReadme))) {
    await ensureDir(ctx.archiveRoot);
    if (!dryRun) {
      await writeAtomic(
        reviewsReadme,
        '# 多智能体协同审计与留痕目录 (.reviews)\n\n' +
          '本目录由 TriviumCode 编排器写入，是双审流水线对外的事实来源。\n' +
          '命名规范见 `<日期>-<主题>[-r<N>][-revised|-response]-<角色>.md`。\n',
      );
    }
    report.created.push(reviewsReadme);
  }

  /*
   * 判据取磁盘上的**实际配置**（ctx.config 已由 loadCtx 合并 config.yaml
   * 与 config.local.yaml），而非本次入参：config.yaml 已存在时 init 不覆盖它，
   * 若只看 opts.verify，重跑 init 会对一份配好的项目误报「留空」。
   * opts.verify 仍优先——它代表本次刚确认并写入的候选（§14.1）。
   */
  const effectiveVerify = opts.verify ?? ctx.config.verify;
  if (effectiveVerify.build.length === 0 && effectiveVerify.test.length === 0) {
    report.notes.push(
      'verify.build / verify.test 留空：编排器**只执行**显式配置的命令，不猜测执行（§14.1）。' +
        '请把 `trivium doctor` 探测到的候选逐条确认后写入 .trivium/config.yaml。' +
        '命令 A（/dual-run）在两者皆空时会拒绝启动。',
    );
  }

  return report;
}

export function renderInitReport(r: InitReport, dryRun: boolean): void {
  say('');
  say(dryRun ? 'TriviumCode 初始化（预演，未落盘）' : 'TriviumCode 初始化完成');
  say('─'.repeat(60));
  for (const c of r.created) say(`  + ${c}`);
  for (const u of r.updated) say(`  ~ ${u}`);
  for (const s of r.skipped) step(`  = ${s}`);
  if (r.notes.length > 0) {
    say('');
    for (const n of r.notes) warn(n);
  }
  say('');
}
