// EV-156 真实 CLI 验证（花少量 agy 配额，用户 2026-10-06 授权）：同一条极短提示，用仓库构建的 invokeAgy 各跑一次
// pty: false 与 pty: true，比对退出码、解析出的回复、stdout 首行能否按 JSON 解析、是否残留 ^D 回显或 \r。
// 用法：node real-agy-pty.mjs 〈仓库根〉 〈agy 入口〉 〈工作目录（须已存在、为空）〉
import path from 'node:path';
import fs from 'node:fs';

const [repo, bin, cwd] = process.argv.slice(2);
if (!fs.existsSync(cwd) || fs.readdirSync(cwd).length !== 0) throw new Error('工作目录须已存在且为空');
const { invokeAgy } = await import(path.join(repo, 'dist/test/src/trivium/adapters/agy.js'));
const prompt = '只回复两个大写字母 OK，不要调用任何工具，不要输出别的内容。';
const out = {};
for (const pty of [false, true]) {
  const t0 = Date.now();
  const r = await invokeAgy({ bin, cwd, prompt, agent: 'trivium-critic', pty, timeoutMs: 180_000 });
  const lines = r.stdout.split('\n').filter((l) => l.trim());
  let firstJson = null;
  try { JSON.parse(lines[0] ?? ''); firstJson = true; } catch { firstJson = false; }
  out[pty ? 'pty' : 'pipe'] = {
    exitCode: r.exitCode,
    timedOut: r.timedOut,
    ms: Date.now() - t0,
    response: String(r.parsed.response ?? '').slice(0, 80),
    stdoutLines: lines.length,
    firstLineIsJson: firstJson,
    hasEofEcho: r.stdout.includes('^D\b\b'),
    hasCR: r.stdout.includes('\r'),
    stderrHead: r.stderr.split('\n')[0].slice(0, 160),
    commandLine: r.commandLine.slice(0, 160),
  };
}
console.log(JSON.stringify(out, null, 2));
