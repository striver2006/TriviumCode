/**
 * wrapper 定位与执行。
 *
 * 一律经 `<工作区>/.trivium/bin/trivium` wrapper 调用编排器（wrapper 内嵌 node
 * 绝对路径，GUI 进程安全；设计 §10.5 / 计划裁决 C1）。插件不解析 PATH、不读登录
 * Shell 环境；子进程一律 `shell: false` + 绝对路径。
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** 解析 wrapper 脚本内嵌的 node 与 trivium.cjs 绝对路径（兼容 POSIX sh 与 Windows .cmd） */
export function parseWrapperCommand(content: string): { nodePath: string; cliPath: string } | null {
  const m = /^\s*exec\s+"([^"]+)"\s+"([^"]+)"/m.exec(content)
    ?? /^\s*"([^"]+)"\s+"([^"]+)"\s+%\*\s*$/m.exec(content);
  if (!m?.[1] || !m[2]) return null;
  return { nodePath: m[1], cliPath: m[2] };
}

/**
 * 解析最终 spawn 的可执行文件与参数：
 * - 非 Windows 直接执行 wrapperPath；
 * - Windows 无法直接 spawn 无后缀 POSIX sh 脚本，也应避免 `shell: false` 调 `.cmd`（Node 24 EINVAL），
 *   故解析 wrapper / `.cmd` 内嵌的 node 与 cli 脚本路径（或识别 `#!/usr/bin/env node`），改由 node 直接拉起。
 */
export async function resolveWrapperSpawn(
  wrapperPath: string,
  args: string[],
  readText: (p: string) => Promise<string | null>,
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath,
): Promise<{ command: string; args: string[] }> {
  if (platform !== 'win32') return { command: wrapperPath, args };
  for (const candidate of [wrapperPath, `${wrapperPath}.cmd`]) {
    const text = await readText(candidate);
    if (text === null) continue;
    const parsed = parseWrapperCommand(text);
    if (parsed) return { command: parsed.nodePath, args: [parsed.cliPath, ...args] };
    if (candidate === wrapperPath) {
      const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
      if (/^#!.*(?:\/env\s+node|\bnode(?:\.exe)?)\b/.test(firstLine)) {
        return { command: execPath, args: [wrapperPath, ...args] };
      }
    }
  }
  return { command: wrapperPath, args };
}

export interface CliResult {
  /** 进程退出码；被超时杀死时为 null */
  code: number | null;
  stdout: string;
  stderr: string;
  /** 超时（毫秒），默认 60s */
  timedOut: boolean;
}

export class TriviumCli {
  constructor(private readonly workspaceRoot: string) {}

  /** wrapper 绝对路径；不存在返回 null（调用方据此走「未 init 引导」） */
  wrapperPath(): string {
    return path.join(this.workspaceRoot, '.trivium', 'bin', 'trivium');
  }

  async wrapperExists(): Promise<boolean> {
    try {
      await fs.access(this.wrapperPath());
      return true;
    } catch {
      if (process.platform === 'win32') {
        try {
          await fs.access(`${this.wrapperPath()}.cmd`);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }

  /** 执行 wrapper 子命令。参数数组逐个透传，不做任何 shell 拼接。 */
  async run(args: string[], timeoutMs = 60_000): Promise<CliResult> {
    const wrapper = this.wrapperPath();
    const { command, args: spawnArgs } = await resolveWrapperSpawn(
      wrapper,
      args,
      (p) => fs.readFile(p, 'utf8').catch(() => null),
    );
    return new Promise<CliResult>((resolve) => {
      const child = spawn(command, spawnArgs, {
        shell: false,
        cwd: this.workspaceRoot,
        env: process.env,
        windowsHide: true,
      });
      // 分块收集 Buffer、收尾整体解码（CODEX-08）：逐块 toString 会把跨块的多字节
      // 中文字符拆成替换符，topic 之类字段会悄悄变字
      const outChunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 2_000);
      }, timeoutMs);
      child.stdout.on('data', (d: Buffer) => outChunks.push(d));
      child.stderr.on('data', (d: Buffer) => errChunks.push(d));
      child.on('error', (e) => {
        clearTimeout(timer);
        resolve({
          code: null,
          stdout: Buffer.concat(outChunks).toString('utf8'),
          stderr: `${Buffer.concat(errChunks).toString('utf8')}\n${String(e)}`,
          timedOut,
        });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          code,
          stdout: Buffer.concat(outChunks).toString('utf8'),
          stderr: Buffer.concat(errChunks).toString('utf8'),
          timedOut,
        });
      });
    });
  }

  /** 执行并抽取 stdout 中的 JSON 对象（doctor 等会在 JSON 前打进度行） */
  async runJson<T>(args: string[], timeoutMs = 60_000): Promise<CliResult & { json: T | null }> {
    const r = await this.run(args, timeoutMs);
    return { ...r, json: extractJson<T>(r.stdout) };
  }
}

/**
 * 从混合文本中抽出 JSON 对象：优先整体解析，否则从每个候选 `{` 起试解析到结尾。
 * 解析失败返回 null（调用方按「读不到数据」降级，不抛异常）。
 */
export function extractJson<T>(text: string): T | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    /* 整体不是 JSON，继续找候选起点 */
  }
  let idx = trimmed.indexOf('{');
  let attempts = 0;
  while (idx >= 0 && attempts < 8) {
    const candidate = trimmed.slice(idx);
    try {
      return JSON.parse(candidate) as T;
    } catch {
      /* 下一个候选 */
    }
    idx = trimmed.indexOf('{', idx + 1);
    attempts += 1;
  }
  return null;
}
