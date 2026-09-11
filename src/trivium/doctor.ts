/**
 * `trivium doctor`：本机能力探针总编排（设计 §3.5 / 里程碑 M0）。
 *
 * 设计原则 P7「能力靠探针，不靠记忆」：三家 CLI 的参数与行为随版本漂移，
 * 实现代码一律读这里回填的结论，**不得把设计文档里的命令行硬编码进适配层**。
 *
 * 输出两份：
 *   - 机读：`.trivium/config.local.yaml` 的 `probe:` 段；
 *   - 人读：stdout 的分项报告（`--json` 时改为结构化输出）。
 */
import { defaultProbe, persistProbe } from './config.js';
import { probeEnv, probeVerifyCommands } from './probes/env.js';
import { probeAgy } from './probes/agy.js';
import { probeZcode } from './probes/zcode.js';
import type { Config, ProbeSection } from './types.js';
import { say, step, warn } from './util/log.js';

export interface DoctorOptions {
  projectRoot: string;
  triviumDir: string;
  config: Config;
  /** 跳过一切消耗厂商配额的模型调用，只做静态探测 */
  skipModelCalls?: boolean;
  /** 只跑某一侧：agy | zcode | env */
  only?: 'agy' | 'zcode' | 'env' | null;
}

export interface DoctorReport {
  probe: ProbeSection;
  notes: string[];
  /** 阻断级问题：非空则 preflight 必然失败 */
  blockers: string[];
}

export async function runDoctor(opts: DoctorOptions): Promise<DoctorReport> {
  // 以**已落盘的探针结论**为基线，只覆盖本次真正探测过的段落。
  // 否则 `--only zcode` 会把上一轮的 agy 结论一并清空（探针结论是增量积累的）。
  const probe: ProbeSection = {
    ...defaultProbe(),
    ...structuredClone(opts.config.probe ?? {}),
  } as ProbeSection;
  const notes: string[] = [];
  const blockers: string[] = [];
  const only = opts.only ?? null;

  // ── 环境 ────────────────────────────────────────────────────────────
  step('探测运行环境…');
  const env = await probeEnv();
  probe.host = {
    platform: env.platform,
    arch: env.arch,
    has_timeout_bin: env.hasTimeoutBin,
    git_version: env.gitVersion,
  };
  notes.push(`node=${env.nodePath ?? '未找到'} ${env.nodeVersion ?? ''}`.trim());
  notes.push(`git=${env.gitVersion ?? '未找到'}`);
  if (!env.nodeOk) blockers.push('Node.js 不可用或版本低于 18');
  if (!env.gitOk) blockers.push('git 不可用或版本过低');
  if (!env.hasTimeoutBin) {
    notes.push(
      '本机无 GNU coreutils 的 timeout/gtimeout —— 编排器的超时全部在 Node 内实现，' +
        '不依赖外部命令（这是预期行为，非问题）',
    );
  }

  probe.verify_suggestion = await probeVerifyCommands(opts.projectRoot);
  notes.push(
    `编译测试命令候选：build=${JSON.stringify(probe.verify_suggestion.build)} ` +
      `test=${JSON.stringify(probe.verify_suggestion.test)}（仅候选，需 init 逐条确认后才会执行）`,
  );

  // ── Antigravity ─────────────────────────────────────────────────────
  if (only === null || only === 'agy') {
    step('探测 Antigravity（agy）…');
    const r = await probeAgy(opts.config.critics.gemini.bin, opts.config.critics.gemini.agent, {
      skipModelCalls: opts.skipModelCalls ?? false,
      existing: probe.agy,
    });
    probe.agy = r.probe;
    notes.push(...r.notes.map((n) => `[agy] ${n}`));
    if (!r.probe.bin) blockers.push('未找到 agy 可执行文件');
    else if (r.probe.headless_read_ok === false) {
      blockers.push(
        'agy headless 无法读取文件（issue #548）。请确认只读审查 Agent 已安装到 ' +
          '~/.gemini/config/agents/trivium-critic/agent.md',
      );
    }
  }

  // ── ZCode ───────────────────────────────────────────────────────────
  if (only === null || only === 'zcode') {
    step('探测 ZCode（zcode.cjs）…');
    const r = await probeZcode(opts.config.critics.glm.entry, env.nodePath ?? process.execPath, {
      skipModelCalls: opts.skipModelCalls ?? false,
      existing: probe.zcode,
    });
    probe.zcode = r.probe;
    notes.push(...r.notes.map((n) => `[zcode] ${n}`));
    if (!r.probe.entry) blockers.push('未找到 zcode.cjs 入口');
    else if (r.probe.response_field === null && !opts.skipModelCalls) {
      blockers.push(
        'ZCode headless 未跑通。注意：CLI 的模型 provider 配置独立于桌面端，' +
          '「已登录」不等于「可用」——请确认 ~/.zcode/cli/config.json 存在。',
      );
    }
  }

  probe.generated_at = new Date().toISOString();

  // runtime.node 是 wrapper 与 ZCode 共用的绝对路径，必须落盘
  const written = await persistProbe(opts.triviumDir, probe);
  notes.push(`探针结论已写入 ${written}`);

  return { probe, notes, blockers };
}

/** 人读渲染 */
export function renderDoctorReport(report: DoctorReport): void {
  say('');
  say('TriviumCode 本机能力探测');
  say('─'.repeat(60));
  for (const n of report.notes) say(`  ${n}`);
  say('');
  if (report.blockers.length === 0) {
    say('✓ 未发现阻断级问题');
  } else {
    say(`✗ 发现 ${report.blockers.length} 项阻断级问题：`);
    for (const b of report.blockers) warn(b);
  }
  say('');
}
