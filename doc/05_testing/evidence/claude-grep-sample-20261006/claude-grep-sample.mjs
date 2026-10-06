// EV-78：在当前 claude 上采一份真实 Grep 样本（一次调用里四次 Grep：目录级 content、文件级 content、目录级 count、
// 目录级不指定 output_mode），与现有解析器 parseGrepResults 比对。花 1 次 claude 真实调用。
// 夹具建在本脚本自己的 mkdtemp 里，收尾只删 mkdtemp 的返回值（R1 / R2 / R5）。
// 存盘的只有：init 的 cwd / tools / model / claude_code_version、全部 tool_use、Grep 的 tool_result、result 摘要（不存 slash_commands 等本机清单）。
// 用法（在仓库根，dist/test 已构建）：node <本脚本> <输出目录>
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node claude-grep-sample.mjs <输出目录>');
const ROOT = process.cwd();
const trace = await import(pathToFileURL(path.join(ROOT, 'dist/test/src/trivium/adapters/claude-trace.js')).href);

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ev78grep-'));
const realTmp = await fs.realpath(tmp);
const MARK = 'NEEDLE_EV78';
await fs.mkdir(path.join(tmp, 'src'), { recursive: true });
await fs.writeFile(path.join(tmp, 'src', 'a.ts'), `export const a = 1;\n// ${MARK} one\nexport const b = 2; // ${MARK} two\n`);
await fs.writeFile(path.join(tmp, 'src', 'b.ts'), `// ${MARK} three\n`);
await fs.writeFile(path.join(tmp, 'src', 'c.ts'), 'export const c = 3;\n');
await fs.writeFile(path.join(tmp, 'README.md'), '# fixture\n');

const prompt = [
  '你是一个测试夹具。请严格按顺序调用 Grep 工具四次，参数逐字照抄，不要做别的事，全部调用完只回复 done：',
  `1) pattern="${MARK}", path="./src", output_mode="content"`,
  `2) pattern="${MARK}", path="./src/a.ts", output_mode="content"`,
  `3) pattern="${MARK}", path="./src", output_mode="count"`,
  `4) pattern="${MARK}", path="./src"（不要传 output_mode）`,
].join('\n');
const args = [
  '-p', prompt,
  '--output-format', 'stream-json', '--verbose',
  '--model', 'haiku',
  '--strict-mcp-config', '--tools', 'Grep',
  '--max-turns', '8',
];
const env = { ...process.env };
delete env.CLAUDECODE;
delete env.CLAUDE_CODE_ENTRYPOINT;

const t0 = Date.now();
let stdout = '';
let stderr = '';
let code;
try {
  code = await new Promise((resolve) => {
    const c = spawn('claude', args, { cwd: tmp, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => c.kill('SIGTERM'), 180_000);
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    c.on('close', (k) => { clearTimeout(timer); resolve(k); });
  });
} finally {
  const base = await fs.realpath(os.tmpdir());
  const real = await fs.realpath(tmp);
  if (!real.startsWith(base + path.sep) || !path.basename(real).startsWith('trivium-ev78grep-')) {
    throw new Error(`拒绝删除：${real}`);
  }
  await fs.rm(tmp, { recursive: true, force: true });
}

// 截取：只留比对需要的事件，根前缀逐字改写成 <ROOT>（与 test/fixtures/claude-events 的 Grep 两份同一做法）
const lines = stdout.split('\n').filter((l) => l.trim().startsWith('{'));
const kept = [];
const grepIds = new Set();
for (const l of lines) {
  let o;
  try { o = JSON.parse(l); } catch { continue; }
  if (o.type === 'system' && o.subtype === 'init') {
    kept.push({ type: 'system', subtype: 'init', cwd: o.cwd, tools: o.tools, mcp_servers: o.mcp_servers, model: o.model, claude_code_version: o.claude_code_version });
  } else if (o.type === 'assistant') {
    const uses = (o.message?.content ?? []).filter((x) => x.type === 'tool_use');
    for (const u of uses) if (u.name === 'Grep') grepIds.add(u.id);
    if (uses.length) kept.push({ type: 'assistant', message: { content: uses } });
  } else if (o.type === 'user') {
    const res = (o.message?.content ?? []).filter((x) => x.type === 'tool_result' && grepIds.has(x.tool_use_id));
    if (res.length) kept.push({ type: 'user', message: { content: res } });
  } else if (o.type === 'result') {
    kept.push({ type: 'result', subtype: o.subtype, is_error: o.is_error, num_turns: o.num_turns, total_cost_usd: o.total_cost_usd });
  }
}
const rewrite = (s) => s.split(realTmp).join('<ROOT>').split(tmp).join('<ROOT>');
const jsonl = kept.map((o) => rewrite(JSON.stringify(o))).join('\n') + '\n';
await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(path.join(OUT, 'grep-sample-2.1.288.jsonl'), jsonl);

// 比对：用现有解析器读截取件（<ROOT> 换回一个假根）
const FAKE = '/proj/ev78';
const t = trace.parseClaudeEvents(jsonl.split('<ROOT>').join(FAKE));
const g = trace.parseGrepResults(t, FAKE);
const perCall = [];
for (const u of t.toolUses) {
  if (u.name !== 'Grep') continue;
  perCall.push({ input: u.input, result: t.toolResults.get(u.id) ?? null });
}
const summary = {
  exit_code: code,
  elapsed_ms: Date.now() - t0,
  stderr_head: stderr.slice(0, 400),
  completed: t.completed,
  grep_calls: perCall.length,
  per_call: perCall,
  parsed: g,
  expected: {
    hits: [`${FAKE}/src/a.ts`, `${FAKE}/src/b.ts`],
    listed_includes: [`${FAKE}/src/a.ts`, `${FAKE}/src/b.ts`],
  },
};
await fs.writeFile(path.join(OUT, 'grep-sample-summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ exit_code: code, grep_calls: perCall.length, hits: g.hits, listed: g.listed, resultLines: g.resultLines }, null, 2));
