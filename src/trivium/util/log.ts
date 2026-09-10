/**
 * 人读输出与 --json 机读输出的统一出口。
 *
 * 铁律：机读模式下 stdout **只能**出现一个 JSON 文档，任何进度/告警一律走 stderr，
 * 否则 skill 侧的 `TV ... --json` 解析会被日志污染。
 */
let jsonMode = false;
let quiet = false;

export function setOutputMode(opts: { json?: boolean; quiet?: boolean }): void {
  jsonMode = opts.json ?? false;
  quiet = opts.quiet ?? false;
}

export const isJsonMode = (): boolean => jsonMode;

/** 人读正文。--json 模式下降级到 stderr，避免污染机读输出 */
export function say(msg: string): void {
  if (quiet) return;
  if (jsonMode) process.stderr.write(msg + '\n');
  else process.stdout.write(msg + '\n');
}

export function warn(msg: string): void {
  process.stderr.write(`⚠️  ${msg}\n`);
}

export function fail(msg: string): void {
  process.stderr.write(`✗ ${msg}\n`);
}

export function step(msg: string): void {
  if (!quiet) process.stderr.write(`· ${msg}\n`);
}

/** 机读输出：整个进程生命周期内只应调用一次 */
export function emitJson(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}
