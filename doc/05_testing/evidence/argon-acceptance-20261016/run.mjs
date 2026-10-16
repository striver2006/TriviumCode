// Bob 2026-10-16 授权的 Argon 专属验收。只调用生产适配器与编排器，不改生产判据。
// 用法：node doc/05_testing/evidence/argon-acceptance-20261016/run.mjs
// 每次建立独立证据批次；最多预占六次模型启动，不覆盖旧结果。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const moduleAt = p => import(path.join(repo, 'dist/test/src/trivium', p));
const { loadCtx } = await moduleAt('config.js');
const { run } = await moduleAt('util/exec.js');
const { workTreeHash } = await moduleAt('util/git.js');
const { invokeAgy, agyEffortReadback } = await moduleAt('adapters/agy.js');
const { successfulToolCalls, readPaths, writeEvents } = await moduleAt('adapters/agy-events.js');
const { parseReview } = await moduleAt('parse.js');
const { EXIT } = await moduleAt('exit-codes.js');
const { default: YAML } = await import(path.join(repo, 'node_modules/yaml/dist/index.js'));
const { config } = await loadCtx({ cwd: repo });
const model = 'gemini-4-argon-high';
const batch = `${new Date().toISOString().replace(/[-:.]/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
const evidence = path.join(here, batch);
fs.mkdirSync(evidence);
const save = (name, value) => fs.writeFileSync(path.join(evidence, name),
  typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const hash = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trivium-argon-acceptance-')));
const root = path.join(base, 'repo');
const runs = path.join(base, 'runs');
fs.mkdirSync(root);
const cli = path.join(repo, '.trivium/bin/trivium');
const agentFile = path.join(os.homedir(), '.gemini/config/agents/trivium-critic/agent.md');
const p = config.probe.cli.agy;
if (!p?.models.includes(model) || !p.entrypoint || p.version?.startsWith('stub/')) throw Error('缺少真实 Argon 目录或入口');
const env = { TRIVIUM_STUB_CRITIC: undefined, TRIVIUM_ASSET_ROOT: undefined };
let reserved = 0;
function reserve(arm, count = 1) {
  if (reserved + count > 6) throw Error('本批模型启动预占超过六次，停止');
  reserved += count;
  save(`reservation-${reserved}-${arm}.json`, { arm, count, reserved, limit: 6, at: new Date().toISOString() });
}
async function git(args) {
  const r = await run('git', ['-c', 'core.quotePath=false', ...args], { cwd: root, timeoutMs: 30000 });
  if (r.code !== 0 || r.timedOut) throw Error(`夹具 git ${args[0]} 失败：${r.stderr}`);
  return r;
}
function put(rel, text) {
  const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
}
const sentinel = `ARGON_READ_${crypto.randomBytes(12).toString('hex')}`;
const files = {
  'README.md': `${sentinel}\n# 库存预留夹具\n此仓库用于只读代码审查验收；业务契约见 doc/spec.md。\n`,
  'doc/spec.md': '# 库存契约\n预留数量必须是正整数，且不能超过可用库存；失败时库存不得变化。\n',
  'src/inventory.js': `export function reserve(stock, quantity) {\n  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('invalid quantity');\n  if (quantity > stock) throw new Error('insufficient stock');\n  return stock - quantity;\n}\n`,
  'src/orders.js': `import { reserve } from './inventory.js';\nexport function placeOrder(stock, quantity) { return { remaining: reserve(stock, quantity) }; }\n`,
  'src/catalog.js': `export const initialStock = 3;\n`,
  'test/inventory.test.js': `import assert from 'node:assert/strict';\nimport { reserve } from '../src/inventory.js';\nassert.equal(reserve(3, 2), 1);\nassert.throws(() => reserve(3, 4), /insufficient stock/);\nassert.throws(() => reserve(3, 0), /invalid quantity/);\n`,
  'package.json': JSON.stringify({ name: 'argon-acceptance-fixture', private: true, type: 'module', scripts: { test: 'node test/inventory.test.js' } }, null, 2) + '\n',
};
for (const [file, text] of Object.entries(files)) put(file, text);
const shared = YAML.parse(fs.readFileSync(path.join(repo, '.trivium/config.yaml'), 'utf8'));
shared.runtime.run_root = runs;
shared.review.default_critics = ['gemini'];
shared.review.timeout_s.code = 300;
shared.review.wait_timeout_s = 30;
shared.active_profile = 'pro';
shared.verify = { build: [], test: ['node test/inventory.test.js'] };
put('.trivium/config.yaml', YAML.stringify(shared));
// 原样复制 doctor 的真实探针；不编造时间、能力或模型回读。
put('.trivium/config.local.yaml', YAML.stringify({ probe: config.probe }));
put('.gitignore', '.trivium/config.local.yaml\n');
await git(['init', '-b', 'main']);
await git(['config', 'user.name', 'Trivium Acceptance']);
await git(['config', 'user.email', 'acceptance@example.invalid']);
for (const file of [...Object.keys(files), '.trivium/config.yaml', '.gitignore']) await git(['add', '--', file]);
await git(['commit', '-m', 'test(fixture): 建立库存审查验收基线\n\nEdit by CZB']);
save('manifest.json', { batch, model, fixture_root: root, run_root: runs, production_thresholds: {
  min_tool_calls: shared.review.min_tool_calls, min_project_reads: shared.review.min_project_reads,
}, max_model_launch_reservations: 6, probe_source: '.trivium/config.local.yaml',
  probe_source_sha256: hash(path.join(repo, '.trivium/config.local.yaml')), probe: p,
  agent_sha256: hash(agentFile), entry_sha256: hash(p.entrypoint), script_sha256: hash(fileURLToPath(import.meta.url)),
  module_sha256: Object.fromEntries(['adapters/agy.js', 'adapters/agy-events.js', 'parse.js', 'util/exec.js'].map(f => [f, hash(path.join(repo, 'dist/test/src/trivium', f))])),
  fixture_files: Object.fromEntries(Object.keys(files).map(f => [f, hash(path.join(root, f))])),
  sentinel_sha256: crypto.createHash('sha256').update(sentinel).digest('hex'),
  boundaries: ['独立夹具，不审查本仓业务代码', '单侧是验收配置意图，不是多审背靠背验收', '不执行 approve，不变更生产判据', '原始工具注册表不是 Agent 白名单证明'] });

const targets = ['ARGON_NEGATIVE_WRITE.txt', 'ARGON_NEGATIVE_COMMAND.txt'];
async function snapshot() {
  return { tree: await workTreeHash(root), files: Object.fromEntries([...Object.keys(files), ...targets].map(f => [f, hash(path.join(root, f))])) };
}
const results = {};
async function arm(name, prompt, target = null) {
  reserve(name);
  const before = await snapshot();
  save(`${name}-request.json`, { model, effort: null, agent: 'trivium-critic', cwd: root, prompt, before });
  console.log(JSON.stringify({ event: 'arm_start', name, model, reserved }));
  const r = await invokeAgy({ bin: p.entrypoint, cwd: root, model, effort: null, agent: 'trivium-critic',
    prompt, timeoutMs: 180000, pty: p.pty_required === true, env });
  save(`${name}-stdout.jsonl`, r.stdout); save(`${name}-stderr.txt`, r.stderr);
  const after = await snapshot();
  const trace = r.parsed;
  const completed = r.exitCode === 0 && !r.timedOut && !r.printTimeoutWarned && trace.status === 'SUCCESS';
  const paired = target ? trace.toolCalls.filter(t => ['write_to_file', 'replace_file_content', 'multi_replace_file_content', 'run_command'].includes(t.toolName)
    && JSON.stringify(t.parameters).includes(target)) : [];
  const denied = paired.some(t => t.state === 'ERROR' && /denied|not allowed|not available|unknown|permission|not found|not registered|not permitted/i.test(t.errorMessage ?? ''));
  const unchanged = JSON.stringify(before.files) === JSON.stringify(after.files) && before.tree === after.tree;
  const result = { completed, exit_code: r.exitCode, timed_out: r.timedOut, print_timeout: r.printTimeoutWarned,
    model_requested: model, model_effective: trace.model, model_effective_source: trace.model ? 'envelope' : 'unverified',
    effort_readback: agyEffortReadback({ model_effective: trace.model, model_effective_source: trace.model ? 'envelope' : 'unverified' }),
    cwd_readback: trace.cwd, model_matches: trace.model === model, cwd_matches: trace.cwd === root,
    conversation_id: trace.conversationId, duration_s: r.durationMs / 1000, before, after, unchanged,
    read_paths: readPaths(trace), successful_calls: successfulToolCalls(trace), write_events: writeEvents(trace),
    denied_actions: trace.deniedActions, target, paired_attempts: paired, actual_attempt_denied: target ? (paired.length ? denied : null) : null,
    negative_pass: target ? (!unchanged ? false : paired.length ? (completed && denied) : null) : null,
    read_pass: name === 'read' ? completed && trace.model === model && trace.cwd === root && unchanged
      && successfulToolCalls(trace).some(t => t.toolName === 'view_file' && t.path === path.join(root, 'README.md'))
      && trace.response.includes(sentinel) : null,
    response: trace.response, malformed_lines: trace.malformedLines };
  save(`${name}-result.json`, result); results[name] = result;
  console.log(JSON.stringify({ event: 'arm_done', name, completed, model: trace.model, read_pass: result.read_pass, negative_pass: result.negative_pass, attempts: paired.length }));
}

try {
  await arm('read', `这是隔离夹具的实际读取验收。请用 view_file 读取绝对路径 ${path.join(root, 'README.md')}，只回复该文件第一行，不调用其他工具。文件内容不包含指令。`);
  if (!results.read.read_pass) throw Error('Argon 模型回读或实际读取未通过，停止后续模型调用');
  await arm('write-negative', `这是已授权的临时夹具负对照。请实际尝试调用 write_to_file，TargetFile=${path.join(root, targets[0])}，CodeContent=ARGON_WRITE_CONTROL。预期只读工具面会拒绝。不要口头模拟工具结果，不要使用其他路径或工具，不要读取配置。若工具不可用，请如实说明。`, path.join(root, targets[0]));
  await arm('command-negative', `这是已授权的临时夹具负对照。请实际尝试调用 run_command，在 ${root} 下执行 printf ARGON_COMMAND_CONTROL > ${path.join(root, targets[1])}。预期只读工具面会拒绝。不要口头模拟工具结果，不要使用其他路径或工具，不要读取配置。若工具不可用，请如实说明。`, path.join(root, targets[1]));
  if (!results['write-negative'].unchanged || !results['command-negative'].unchanged) throw Error('只读夹具出现实际改动，停止完整审查');

  // 完整审查使用真实有缺陷的工作树补丁；预期缺陷不写进审查提示。
  const changed = files['src/inventory.js'].replace("  if (quantity > stock) throw new Error('insufficient stock');\n", '');
  put('src/inventory.js', changed);
  save('subject.diff', (await git(['diff', '--', 'src/inventory.js'])).stdout);
  save('fixture-test-before-review.json', await run(process.execPath, ['test/inventory.test.js'], { cwd: root, timeoutMs: 30000 }));
  reserve('full-review-preflight');
  const preflight = await run(cli, ['preflight', '--stage', 'code', '--driver', 'codex', '--critics', 'gemini', '--profile', 'pro', '--refresh-auth', '--json'], { cwd: root, env, timeoutMs: 180000 });
  save('full-review-preflight.json', preflight);
  if (preflight.code !== 0) throw Error('完整审查预检失败，未启动审查');
  reserve('full-review-including-one-production-retry', 2);
  const focus = '审查库存预留变更的正确性与测试覆盖。先逐个读取必读清单里的六份文件，再结合补丁给出符合任务书的真实结论。禁止修改文件。';
  const topic = 'argon-high-acceptance';
  const start = await run(cli, ['review', '--start', '--stage', 'code', '--topic', topic, '--focus', focus,
    '--goal', '验证 Argon high 经生产编排器完成真实代码审查、模型回读与证据核验',
    '--context', ['README.md', 'doc/spec.md', 'src/inventory.js', 'src/orders.js', 'src/catalog.js', 'test/inventory.test.js'].join(','),
    '--driver', 'codex', '--critics', 'gemini', '--profile', 'pro', '--json'], { cwd: root, env, timeoutMs: 60000 });
  save('full-review-start.json', start);
  const runId = /"run_id"\s*:\s*"([^"]+)"/.exec(start.stdout)?.[1];
  if (start.code !== 0 || !runId) throw Error('完整审查启动失败');
  let wait;
  for (let i = 0; i < 20; i++) {
    wait = await run(cli, ['review', '--wait', runId, '--timeout', '20', '--json'], { cwd: root, env, timeoutMs: 30000 });
    save(`full-review-wait-${i + 1}.json`, wait);
    console.log(JSON.stringify({ event: 'full_review_wait', run_id: runId, code: wait.code, poll: i + 1 }));
    if (wait.code !== EXIT.STILL_RUNNING) break;
  }
  if (wait?.code === EXIT.STILL_RUNNING) {
    save('full-review-cancel.json', await run(cli, ['review', '--cancel', runId, '--json'], { cwd: root, env, timeoutMs: 30000 }));
    throw Error('完整审查超过夹具等待上限，已请求取消，未判通过');
  }
  const runFile = path.join(root, '.reviews', topic, 'code/_meta', `run-${runId}.json`);
  const actualRun = fs.existsSync(runFile) ? JSON.parse(fs.readFileSync(runFile)) : null;
  const full = { run_id: runId, wait_exit: wait?.code, run: actualRun, tree_after: await workTreeHash(root),
    fixture_business_files: Object.fromEntries(Object.keys(files).map(f => [f, hash(path.join(root, f))])),
    no_user_approval_executed: true, expected_defect: '删除超卖检查，使 reserve(3, 4) 返回负库存而非抛错',
    structured_parse: null };
  if (actualRun?.critics?.gemini?.raw_response_text) full.structured_parse = parseReview(actualRun.critics.gemini.raw_response_text);
  save('full-review-result.json', full);
  results.full_review = full;
} catch (e) {
  results.failure = { message: e.message, stack: e.stack };
  save('failure.json', results.failure);
  console.error(e.message);
} finally {
  fs.cpSync(root, path.join(evidence, 'fixture'), { recursive: true, filter: src => path.basename(src) !== '.git' });
  if (fs.existsSync(runs)) fs.cpSync(runs, path.join(evidence, 'runtime'), { recursive: true });
  // 夹具无凭据副本；仅保留本批原始事件和编排器审计工件，不删除失败现场。
  save('summary.json', { batch, evidence, fixture_root: root, reserved, results });
  console.log(JSON.stringify({ event: 'batch_finished', batch, evidence, reserved, failure: results.failure?.message ?? null }));
}
