/**
 * 环境探针：node / git / 平台事实。
 *
 * 编译测试命令候选的探测在 probes/verify-commands.ts。
 */
import os from 'node:os';
import { run, tryRun } from '../util/exec.js';
import { gitVersion } from '../util/git.js';
import { exists } from '../util/fsx.js';
import { stableNodePath } from '../init.js';

export interface EnvProbeResult {
  nodePath: string | null;
  nodeVersion: string | null;
  nodeOk: boolean;
  gitVersion: string | null;
  gitOk: boolean;
  platform: string;
  arch: string;
  /** 本机是否有 GNU coreutils 的 timeout（M0 实测坑 P-01：macOS 默认没有） */
  hasTimeoutBin: boolean;
}

/** 找到 node 的**绝对路径**——wrapper 与 ZCode 都要用它，GUI 进程不读 .zshrc（设计 §10.5） */
async function resolveNodePath(): Promise<string | null> {
  // 首选当前进程自己的解释器：它一定可执行，且与编排器同版本；
  // Homebrew 下换成 opt/ 稳定入口，免得 brew upgrade 后 wrapper 里的路径失效
  if (process.execPath && (await exists(process.execPath))) return stableNodePath(process.execPath);
  const which = await tryRun('/usr/bin/which', ['node']);
  return which.ok ? which.stdout.trim() : null;
}

export async function probeEnv(): Promise<EnvProbeResult> {
  const nodePath = await resolveNodePath();
  let nodeVersion: string | null = null;
  if (nodePath) {
    const r = await run(nodePath, ['-v'], { timeoutMs: 15_000 });
    if (r.code === 0) nodeVersion = r.stdout.trim();
  }
  const major = nodeVersion ? Number.parseInt(nodeVersion.replace(/^v/, ''), 10) : NaN;

  const gv = await gitVersion();
  const gitMajorMinor = gv ? gv.split('.').slice(0, 2).map(Number) : [];
  const gitOk =
    gitMajorMinor.length === 2 &&
    (gitMajorMinor[0]! > 2 || (gitMajorMinor[0] === 2 && gitMajorMinor[1]! >= 20));

  const timeoutBin = await tryRun('/usr/bin/which', ['timeout']);
  const gtimeoutBin = await tryRun('/usr/bin/which', ['gtimeout']);

  return {
    nodePath,
    nodeVersion,
    nodeOk: Number.isFinite(major) && major >= 18,
    gitVersion: gv,
    gitOk,
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    hasTimeoutBin: timeoutBin.ok || gtimeoutBin.ok,
  };
}
