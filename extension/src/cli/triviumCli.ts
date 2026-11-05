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
      return false;
    }
  }

  /** 执行 wrapper 子命令。参数数组逐个透传，不做任何 shell 拼接。 */
  async run(args: string[], timeoutMs = 60_000): Promise<CliResult> {
    const wrapper = this.wrapperPath();
    return new Promise<CliResult>((resolve) => {
      const child = spawn(wrapper, args, {
        shell: false,
        cwd: this.workspaceRoot,
        env: process.env,
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
