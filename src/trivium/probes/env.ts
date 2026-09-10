/**
 * 环境探针：node / git / 平台事实 / 编译测试命令候选。
 */
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { run, tryRun } from '../util/exec.js';
import { gitVersion } from '../util/git.js';
import { exists } from '../util/fsx.js';

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
  // 首选当前进程自己的解释器：它一定可执行，且与编排器同版本
  if (process.execPath && (await exists(process.execPath))) return process.execPath;
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

/**
 * 探测编译测试命令候选（设计 §14.1）。
 *
 * **只探测，绝不执行**——探到的 `scripts.test` 可能耗时极长、依赖外部服务或有副作用。
 * 候选写进 `probe.verify_suggestion`，由 `trivium init` 逐条展示给用户确认后才落到 `verify.build/test`。
 */
export async function probeVerifyCommands(
  projectRoot: string,
): Promise<{ build: string[]; test: string[] }> {
  const build: string[] = [];
  const test: string[] = [];

  const pkgPath = path.join(projectRoot, 'package.json');
  if (await exists(pkgPath)) {
    try {
      const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')) as {
        scripts?: Record<string, string>;
      };
      const scripts = pkg.scripts ?? {};
      if (scripts['build']) build.push('npm run build');
      if (scripts['typecheck']) build.push('npm run typecheck');
      if (scripts['test']) test.push('npm test');
    } catch {
      /* package.json 损坏不是 doctor 的职责 */
    }
  }

  if (await exists(path.join(projectRoot, 'Makefile'))) {
    const mk = await fs.readFile(path.join(projectRoot, 'Makefile'), 'utf8');
    if (/^build:/m.test(mk)) build.push('make build');
    if (/^test:/m.test(mk)) test.push('make test');
  }
  if (await exists(path.join(projectRoot, 'pubspec.yaml'))) {
    build.push('flutter build');
    test.push('flutter test');
  }
  if (await exists(path.join(projectRoot, 'Cargo.toml'))) {
    build.push('cargo build');
    test.push('cargo test');
  }

  return { build, test };
}
