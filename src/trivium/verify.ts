/**
 * 编译测试出口（设计 §14，FR-21 / AC-10）。
 *
 * ## 只执行显式配置，不猜测执行
 *
 * 本模块**只**执行 `.trivium/config.yaml` 里 `verify.build` / `verify.test` 明写的命令。
 * 探测到的候选（`probe.verify_suggestion`）一律只展示、不执行——`scripts.test`
 * 完全可能耗时极长、依赖外部服务、或有副作用（清库、发请求、改远端状态）。
 * 「猜一条命令跑跑看」在别人的仓库里是不可接受的。
 *
 * ## 失败不许粉饰
 *
 * 任一命令非零退出即整体 `failed`，且**不得**宣称成功；已产生的计划/审查/应答
 * 工件全部保留（§14.2）。这条是 P5「不可伪装」在出口处的落点：
 * 一次跑不过的验证，不能因为「前面都做完了」就记成通过。
 */
import path from 'node:path';
import { run } from './util/exec.js';
import { sha256 } from './util/fsx.js';
import { writeMeta, writeVerifyRecord, type ArchiveLayout } from './archive.js';
import { localDate } from './naming.js';
import { EXIT, usageError } from './exit-codes.js';
import type { Config, Ctx } from './types.js';

/** 单条命令的执行记录 */
export interface VerifyCommandRecord {
  /** 命令原文，与配置逐字一致 */
  cmd: string;
  /** 命令原文的 sha256：归档里的「实际执行命令」要能与配置对账（AC-10） */
  cmd_sha256: string;
  group: 'build' | 'test';
  exit_code: number | null;
  duration_s: number;
  timed_out: boolean;
  /** stdout 尾部摘要 */
  stdout_tail: string;
  stderr_tail: string;
}

export interface VerifyRecord {
  schema: 'trivium.verify.v1';
  run_id: string;
  topic: string;
  started_at: string;
  finished_at: string;
  /** 执行时的项目根，便于事后判断记录来自哪个工作树 */
  project_root: string;
  commands: VerifyCommandRecord[];
  status: 'success' | 'failed';
  /** 配置里两组命令都为空时为 true——此时既不算通过也不算失败，属配置缺失 */
  unconfigured: boolean;
}

/** 取输出尾部若干行。默认 200 行，对齐 §14.2 */
export function tailLines(text: string, maxLines = 200): string {
  const lines = text.replace(/\s+$/, '').split('\n');
  if (lines.length <= maxLines) return lines.join('\n');
  return [`…（已省略前 ${lines.length - maxLines} 行）`, ...lines.slice(-maxLines)].join('\n');
}

export interface VerifyOptions {
  ctx: Ctx;
  layout: ArchiveLayout;
  runId: string;
  /** 单条命令的墙钟上限。0 表示不限时 */
  timeoutS?: number;
  tailLineCount?: number;
  rerunIndex?: number;
  /** 只执行其中一组，用于调试 */
  only?: 'build' | 'test' | null;
  onProgress?: (line: string) => void;
}

export interface VerifyOutcome {
  record: VerifyRecord;
  exitCode: number;
  artifactPath: string;
  metaPath: string;
}

/** 取配置里声明的命令，按 build → test 排序（构建不过就没必要跑测试） */
export function collectCommands(
  cfg: Config,
  only: 'build' | 'test' | null = null,
): { cmd: string; group: 'build' | 'test' }[] {
  const out: { cmd: string; group: 'build' | 'test' }[] = [];
  if (only !== 'test') for (const c of cfg.verify.build) out.push({ cmd: c, group: 'build' });
  if (only !== 'build') for (const c of cfg.verify.test) out.push({ cmd: c, group: 'test' });
  return out;
}

/**
 * 执行验证并落盘。
 *
 * 返回的 `exitCode` 语义：0 通过；1 有命令失败；64 两组命令都没配。
 * 未配置刻意**不**返回 0——「什么都没跑」不是「通过」。
 */
export async function runVerify(opts: VerifyOptions): Promise<VerifyOutcome> {
  const { ctx, layout, runId } = opts;
  const cfg = ctx.config;
  const tail = opts.tailLineCount ?? 200;
  const commands = collectCommands(cfg, opts.only ?? null);
  const startedAt = new Date().toISOString();

  const records: VerifyCommandRecord[] = [];
  let failed = false;

  for (const { cmd, group } of commands) {
    opts.onProgress?.(`· [${group}] ${cmd}`);
    const t0 = Date.now();
    /*
     * 经 shell 执行：配置里写的是给人看的命令行（含管道、&&、环境变量前缀），
     * 拆成 argv 会改变语义。这不是注入面——命令来自本项目配置文件，
     * 且已经过 init 的逐条确认。
     */
    const r = await run('/bin/sh', ['-c', cmd], {
      cwd: ctx.projectRoot,
      ...(opts.timeoutS && opts.timeoutS > 0 ? { timeoutMs: opts.timeoutS * 1000 } : {}),
      maxBufferBytes: 4 * 1024 * 1024,
    });
    const durationS = (Date.now() - t0) / 1000;

    const rec: VerifyCommandRecord = {
      cmd,
      cmd_sha256: sha256(cmd),
      group,
      exit_code: r.code,
      duration_s: Math.round(durationS * 10) / 10,
      timed_out: r.timedOut,
      stdout_tail: tailLines(r.stdout, tail),
      stderr_tail: tailLines(r.stderr, tail),
    };
    records.push(rec);

    if (r.code !== 0) {
      failed = true;
      opts.onProgress?.(`  ✗ 退出码 ${r.code}${rec.timed_out ? '（超时）' : ''}`);
      /*
       * 构建失败就不跑测试：测试几乎必然连带失败，只会把真正的根因埋在噪声里。
       * 但仍然把已跑的记录完整落盘——半套记录也是记录。
       */
      if (group === 'build') break;
    } else {
      opts.onProgress?.(`  ✓ ${rec.duration_s}s`);
    }
  }

  const record: VerifyRecord = {
    schema: 'trivium.verify.v1',
    run_id: runId,
    topic: layout.topic,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    project_root: ctx.projectRoot,
    commands: records,
    status: failed ? 'failed' : 'success',
    unconfigured: commands.length === 0,
  };

  const written = await writeVerifyRecord(layout, renderVerifyDoc(record), {
    ...(opts.rerunIndex !== undefined ? { rerunIndex: opts.rerunIndex } : {}),
    date: localDate(),
  });
  const meta = await writeMeta(
    layout,
    'verify',
    `verify-${runId}.json`,
    JSON.stringify(record, null, 2) + '\n',
  );

  const exitCode = record.unconfigured ? EXIT.USAGE : failed ? EXIT.FAIL : EXIT.OK;
  return { record, exitCode, artifactPath: written.absPath, metaPath: meta.absPath };
}

/** 人读记录。表格在前、输出摘要在后，失败项排最前面 */
export function renderVerifyDoc(r: VerifyRecord): string {
  const lines: string[] = [
    `# 编译测试记录 · ${r.topic}`,
    '',
    `- **运行**：\`${r.run_id}\``,
    `- **结论**：${r.status === 'success' ? '✅ 通过' : '❌ 失败'}`,
    `- **起止**：${r.started_at} → ${r.finished_at}`,
    `- **项目根**：\`${r.project_root}\``,
    '',
  ];

  if (r.unconfigured) {
    lines.push(
      '> ⚠️ `.trivium/config.yaml` 的 `verify.build` 与 `verify.test` **均为空**，本次什么也没执行。',
      '> 这**不等于通过**。请运行 `trivium init` 或 `trivium doctor --suggest-verify`，',
      '> 逐条确认候选命令后写入配置——编排器只执行显式声明的命令，绝不猜测执行（设计 §14.1）。',
      '',
    );
    return lines.join('\n') + '\n';
  }

  lines.push(
    '## 一、执行的命令',
    '',
    '| # | 组 | 命令 | 退出码 | 耗时 | 命令 sha256 |',
    '| :--- | :--- | :--- | :--- | :--- | :--- |',
  );
  r.commands.forEach((c, i) => {
    const code = c.timed_out ? `${c.exit_code ?? '—'}（超时）` : `${c.exit_code ?? '—'}`;
    lines.push(
      `| ${i + 1} | ${c.group} | \`${c.cmd.replace(/\|/g, '\\|')}\` | ${code} | ${c.duration_s}s | \`${c.cmd_sha256.slice(0, 12)}\` |`,
    );
  });
  lines.push('', '> `命令 sha256` 取命令原文，用于与配置对账（AC-10）。', '');

  // 失败项排在前面：看记录的人首先要找的是「哪条挂了、为什么」
  const ordered = [...r.commands].sort((a, b) => Number(b.exit_code !== 0) - Number(a.exit_code !== 0));
  lines.push('## 二、输出摘要', '');
  for (const c of ordered) {
    lines.push(`### \`${c.cmd}\`（${c.group}，退出码 ${c.exit_code ?? '—'}）`, '');
    if (c.stdout_tail.trim()) lines.push('**stdout（尾部）**', '', '```text', c.stdout_tail, '```', '');
    if (c.stderr_tail.trim()) lines.push('**stderr（尾部）**', '', '```text', c.stderr_tail, '```', '');
    if (!c.stdout_tail.trim() && !c.stderr_tail.trim()) lines.push('（无输出）', '');
  }

  if (r.status === 'failed') {
    lines.push(
      '---',
      '',
      '> ❌ 有命令非零退出，全流程状态为 `failed`。已产生的计划 / 审查 / 应答工件全部保留，',
      '> 不因本次失败而删改（设计 §14.2）。修复后重跑会另起一份记录，本文件不被覆盖。',
    );
  }
  return lines.join('\n') + '\n';
}

/** 校验配置：两组皆空时 `preflight --stage all` 与命令 A 都应拒绝启动（§14.1） */
export function assertVerifyConfigured(cfg: Config): void {
  if (cfg.verify.build.length === 0 && cfg.verify.test.length === 0) {
    throw usageError(
      '`verify.build` 与 `verify.test` 均未配置，命令 A 拒绝启动。\n' +
        '  跑完全流程却无法收口没有意义——请先运行 `trivium init` 或\n' +
        '  `trivium doctor --suggest-verify`，逐条确认候选命令后写入 .trivium/config.yaml。',
    );
  }
}

/** 供 report 引用：某主题最近一次验证记录的摘要 */
export function summarizeVerify(r: VerifyRecord): string {
  if (r.unconfigured) return '未配置编译测试命令（既非通过也非失败）';
  const failedCmds = r.commands.filter((c) => c.exit_code !== 0);
  const total = r.commands.reduce((a, c) => a + c.duration_s, 0);
  return (
    `${r.status === 'success' ? '通过' : '失败'} ｜ ${r.commands.length} 条命令 ｜ ` +
    `${Math.round(total)}s` +
    (failedCmds.length > 0 ? ` ｜ 失败：${failedCmds.map((c) => c.cmd).join('、')}` : '')
  );
}

export const verifyDirName = (layout: ArchiveLayout): string =>
  path.join(layout.archiveRoot, layout.topic, 'verify');
