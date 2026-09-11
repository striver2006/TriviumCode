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
import path from 'node:path';
import YAML from 'yaml';
import { defaultProbe, patchProbe } from './config.js';
import { EXIT } from './exit-codes.js';
import { probeEnv } from './probes/env.js';
import { probeVerifyCommands } from './probes/verify-commands.js';
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

  // 落盘契约保持 {build, test}：candidates 只活在内存里供 --suggest-verify 展示来源
  const sug = await probeVerifyCommands(opts.projectRoot);
  probe.verify_suggestion = { build: sug.build, test: sug.test };
  notes.push(
    `编译测试命令候选：build=${JSON.stringify(sug.build)} ` +
      `test=${JSON.stringify(sug.test)}（仅候选，需人确认后写入 verify 才会执行）`,
  );
  notes.push(...sug.notes.map((n) => `[verify-probe] ${n}`));
  if (sug.truncated) notes.push('[verify-probe] 候选数已达上限，可能有子项目未列出');

  /*
   * ── 分段落盘（审查意见 GLM-08）──
   *
   * 每探完一段就写一次，而不是攒到最后一次性写。
   *
   * agy 与 zcode 两段各要真实调用厂商模型若干次。若只在末尾落盘，一次 Ctrl+C、
   * 一次网络中断、或第二段抛异常，前面已经烧掉的配额就全白费——下次重跑还得再烧一遍。
   * 探针结论是**增量事实**，探到多少存多少才对。
   *
   * 用 patchProbe 而非 persistProbe：它在全局锁内重读再合并，
   * 不会把并发的另一次 doctor（比如 --only 另一侧）的结论覆盖掉。
   */
  /** 本次真正探过的段。没探过的段一个字节都不碰 */
  const probedSections = new Set<'env' | 'agy' | 'zcode'>();

  const checkpoint = async (label: 'env' | 'agy' | 'zcode'): Promise<void> => {
    probedSections.add(label);
    try {
      /*
       * patchProbe 的回调是**原地修改**、返回 void。写成
       * `(cur) => ({ ...cur, ...probe })` 的话返回值会被丢弃，实际一个字节都不写。
       *
       * 并且只写**探过的段**，不能 Object.assign 整个对象：`--only agy` 时
       * probe.zcode 还是调用方传进来的那份，整段覆盖会把盘上更新的 zcode 结论
       * 擦成旧值——这正是 GLM-08 当初修掉的问题，整段覆盖会把它带回来。
       */
      await patchProbe(opts.triviumDir, (cur) => {
        if (probedSections.has('env')) {
          if (probe.host) cur.host = probe.host;
          cur.verify_suggestion = probe.verify_suggestion;
        }
        if (probedSections.has('agy')) cur.agy = probe.agy;
        if (probedSections.has('zcode')) cur.zcode = probe.zcode;
        if (probe.auth) cur.auth = { ...cur.auth, ...probe.auth };
        if (probe.generated_at) cur.generated_at = probe.generated_at;
      });
    } catch (e) {
      // 中途落盘失败不该中断探测：结论仍在内存里，末尾还会再写一次（那一次失败才算真失败）
      notes.push(`[warn] ${label} 阶段的中途落盘失败（不影响继续探测）：${(e as Error).message}`);
    }
  };
  await checkpoint('env');

  // ── Antigravity ─────────────────────────────────────────────────────
  if (only === null || only === 'agy') {
    step('探测 Antigravity（agy）…');
    const r = await probeAgy(opts.config.critics.gemini.bin, opts.config.critics.gemini.agent, {
      skipModelCalls: opts.skipModelCalls ?? false,
      existing: probe.agy,
    });
    probe.agy = r.probe;
    notes.push(...r.notes.map((n) => `[agy] ${n}`));
    await checkpoint('agy'); // 这一段已经烧过配额，先存下来
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
    await checkpoint('zcode');
    if (!r.probe.entry) blockers.push('未找到 zcode.cjs 入口');
    else if (r.probe.response_field === null && !opts.skipModelCalls) {
      blockers.push(
        'ZCode headless 未跑通。注意：CLI 的模型 provider 配置独立于桌面端，' +
          '「已登录」不等于「可用」——请确认 ~/.zcode/cli/config.json 存在。',
      );
    }
  }

  probe.generated_at = new Date().toISOString();

  /*
   * 末尾再写一次，只为补上 generated_at 并确保前面每一段都落了盘。
   * 走 patchProbe（锁内读-改-写）而不是 persistProbe（整体替换）——
   * 后者会把并发的另一次 doctor（例如 `--only` 另一侧）的结论覆盖掉。
   */
  await checkpoint(only === null ? 'zcode' : only === 'agy' ? 'agy' : 'zcode');
  const written = path.join(opts.triviumDir, 'config.local.yaml');
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

/**
 * `doctor --suggest-verify`（设计 §14.1）。
 *
 * 只**展示**探测到的候选命令并给出可粘贴的 YAML，**绝不自行写入配置**。
 *
 * 这不是偷懒。`scripts.test` 完全可能耗时极长、依赖外部服务、或有副作用
 * （清库、发请求、改远端状态）。§14.1 的原话是「逐条展示给用户确认后才写入」——
 * 「确认」的意思是人点头，不是程序代人点头。
 */
export async function suggestVerify(projectRoot: string): Promise<number> {
  const s = await probeVerifyCommands(projectRoot);

  say('');
  say('编译测试命令候选（探测所得，**尚未**写入任何配置）');
  say('────────────────────────────────────────────────────────────');
  if (s.build.length === 0 && s.test.length === 0) {
    say('  未探测到任何候选。这不是错误——本项目可能用的是探测器不认识的工具链。');
    say('  请手工把命令写进 .trivium/config.yaml 的 verify.build / verify.test。');
  } else {
    // 对齐来源列：命令长度参差时右侧仍成列
    const w = Math.max(...s.candidates.map((c) => c.cmd.length));
    for (const c of s.candidates) {
      say(`  ${c.group.padEnd(5)}  ${c.cmd.padEnd(w)}  ← ${c.source}`);
    }
  }
  for (const n of s.notes) say(`  · ${n}`);
  if (s.truncated) say('  · 候选数已达上限，可能有子项目未列出');
  say('');
  say('逐条确认后，把下面这段写进 .trivium/config.yaml（删掉你不要的行）：');
  say('');
  /*
   * 用 YAML.stringify 而非手工拼 `'${c}'`：命令里只要出现单引号
   * （目录名含引号时 cd 前缀就会带上）手工拼法即产出非法 YAML，
   * 用户粘进 config.yaml 会解析失败。
   */
  say(YAML.stringify({ verify: { build: s.build, test: s.test } }, { lineWidth: 0 }).trimEnd());
  say('');
  warn(
    '这些命令会被 `trivium verify` **真实执行**。请先自己确认每一条：\n' +
      '  · 它耗时多久？\n' +
      '  · 它依赖外部服务或网络吗？\n' +
      '  · 它有副作用吗（清库、写远端、发通知）？\n' +
      '编排器绝不替你决定执行什么——未经你写入配置的候选永不执行（§14.1）。',
  );
  return EXIT.OK;
}
