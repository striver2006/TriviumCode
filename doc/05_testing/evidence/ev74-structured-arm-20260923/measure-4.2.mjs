/**
 * EV-74 §4.2 实测装置：结构化臂单次实测成本与耗时。
 *
 * import 生产的 probeArgs / run / parseClaudeEvents / readSchemaJson / judgeJsonSchema，
 * 不自建配方——与探针实际会构造的调用逐字同形，唯一差别是本脚本手工拼装调用序列
 * 而不是走完整的 probeClaude（省去无关的读/breach/deny/memory 各臂）。
 *
 * 用法：node measure-4.2.mjs <run编号>，改 dist/test 路径为本机实际路径后可复跑。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { probeArgs, judgeJsonSchema } from '/Users/chenzhenbo/Work/TriviumCode/dist/test/src/trivium/probes/claude.js';
import { run } from '/Users/chenzhenbo/Work/TriviumCode/dist/test/src/trivium/util/exec.js';
import { parseClaudeEvents } from '/Users/chenzhenbo/Work/TriviumCode/dist/test/src/trivium/adapters/claude-trace.js';
import { readSchemaJson } from '/Users/chenzhenbo/Work/TriviumCode/dist/test/src/trivium/adapters/claude.js';

const bin = '/Users/chenzhenbo/.local/bin/claude';
const schemaPath = '/Users/chenzhenbo/.claude/skills/dual-critic/schema/review.v1.json';
const schema = await readSchemaJson(schemaPath); // 经同一份变换：剥壳

const runIndex = Number(process.argv[2] ?? '1');
const work = await fs.mkdtemp('/tmp/ev74-42-');
await fs.writeFile(path.join(work, 'README.md'), '# EV-74 fixture\n\n这是用于结构化输出实测的最小夹具文件。\n');

// 正对照：同轮读探针是否真的跑通
const readArgs = probeArgs({ prompt: `读取 ${work}/README.md 并只回显它的第一行，不要做别的事。` });
const readR = await run(bin, readArgs, { timeoutMs: 60_000, cwd: work, stdin: '', killTree: true });
const readTrace = parseClaudeEvents(readR.stdout);

const args = probeArgs({
  prompt: `对 ${work}/README.md 做一次最小审查：schema 字段固定为 "trivium.review.v1"、` +
    'verdict 给 "approve"、summary 用一句话概括文件内容，findings 留空数组即可。',
  jsonSchema: schema,
});

const t0 = Date.now();
const r = await run(bin, args, { timeoutMs: 180_000, cwd: work, stdin: '', killTree: true });
const durationS = (Date.now() - t0) / 1000;
const trace = parseClaudeEvents(r.stdout);

const judged = judgeJsonSchema({
  timedOut: r.timedOut,
  exitCode: r.code,
  stderr: r.stderr,
  eventCount: trace.eventCount,
  completed: trace.completed && !r.timedOut,
  positiveControlOk: readTrace.completed && !readR.timedOut,
  finalText: trace.finalText,
  requiredKey: 'summary',
});

console.log(JSON.stringify({
  run: runIndex,
  exit_code: r.code,
  duration_s: Number(durationS.toFixed(3)),
  timedOut: r.timedOut,
  event_count: trace.eventCount,
  cost_usd: trace.costUsd,
  final_text: trace.finalText,
  json_schema_ok: judged.value,
  cause: judged.cause,
}, null, 2));

await fs.rm(work, { recursive: true, force: true });
