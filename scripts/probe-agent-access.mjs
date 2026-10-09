#!/usr/bin/env node
/** 已批准的 M11 前置真实准入：单批最多12次，输出脱敏证据，不修改全局配置。先构建含测试模块。 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadCtx, patchProbe } from '../dist/test/src/trivium/config.js';
import { runDoctor } from '../dist/test/src/trivium/doctor.js';
import { resolveClaudeRoute } from '../dist/test/src/trivium/adapters/claude-route.js';
import { claudeAdapter } from '../dist/test/src/trivium/adapters/claude.js';
import { codexAdapter } from '../dist/test/src/trivium/adapters/codex.js';
import { withLaunchBudget, LaunchBudgetExceeded } from '../dist/test/src/trivium/util/exec.js';
import { redactSecrets, scanSecrets } from '../dist/test/src/trivium/secrets.js';

// 已保存的实际探针证据可在零 CLI 启动下回填本机；拒绝陈旧路线或不完整批次。
if (process.argv[2] === '--apply-claude-evidence') {
  const audit = path.resolve('doc/05_testing/evidence/agent-access-20261009/model-flag-recompute.json');
  try { await fs.access(audit); throw Error('本轮证据已经回填，拒绝重复回填'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const ctx = await loadCtx();
  const routes = {};
  const corrections = [];
  let selected;
  for (const batch of [1, 2, 3]) {
    const root = path.resolve('doc/05_testing/evidence/agent-access-20261009', `batch-${batch}`);
    const summary = JSON.parse(await fs.readFile(path.join(root, 'summary.json'), 'utf8'));
    const observed = summary.results.find(r => r.report);
    const auth = summary.results.find(r => r.auth)?.auth;
    if (summary.used !== 12 || !observed?.availability.ok || !auth?.ok || observed.report.blockers.length) {
      throw Error(`批次 ${batch} 未达到已保存证据的准入判据`);
    }
    const probe = structuredClone(observed.report.probe.cli.claude);
    const cfg = structuredClone(ctx.config);
    cfg.probe.cli.claude = probe;
    const route = resolveClaudeRoute(cfg, observed.profile);
    const key = `profile:${observed.profile}`;
    if (route.fingerprint !== probe.routes[key]?.fingerprint) throw Error(`路线 ${observed.profile} 指纹已变，请重新探针`);
    // 旧探针错误地比较固定官方模型；用该批读文件臂的原始 argv 与 init 事件重新计算。
    const raw = JSON.parse(await fs.readFile(path.join(root, 'launch-3.json'), 'utf8'));
    const init = raw.stdout.split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } })
      .find(event => event?.type === 'system' && event.subtype === 'init');
    if (!raw.commandLine.includes(`--model ${observed.model}`) || !init || init.model !== observed.model) {
      throw Error(`路线 ${observed.profile} 的模型覆盖证据不成立`);
    }
    probe.model_flag = true;
    probe.routes[key].probe.model_flag = true;
    routes[key] = probe.routes[key];
    corrections.push({ batch, profile: observed.profile, requested: observed.model, readback: init.model,
      model_flag: true, source: `batch-${batch}/launch-3.json`, reason: '比较本轮实际请求模型，原始文件保持不变' });
    if (observed.profile === 'qwen') selected = probe;
  }
  await patchProbe(ctx.triviumDir, current => {
    current.cli.claude = { ...selected, routes: { ...current.cli.claude?.routes, ...routes } };
  });
  await fs.writeFile(audit, JSON.stringify(corrections, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log('已回填三条 Claude 路线；新增 CLI 启动为 0，原始证据未改动');
  process.exit(0);
}

const batch = Number(process.argv[2]);
if (![1, 2, 3, 4].includes(batch)) throw Error('用法：node scripts/probe-agent-access.mjs 1|2|3|4');
const evidence = path.resolve('doc/05_testing/evidence/agent-access-20261009', `batch-${batch}`);
await fs.mkdir(evidence, { recursive: true });
// 已有启动证据即拒绝重跑，不能靠换进程重置额度。
if ((await fs.readdir(evidence)).some(n => /^(?:launch|reserved)-\d+\.json$/.test(n))) throw Error('本批已运行，禁止重置启动预算');
const ctx = await loadCtx();
const cfg = structuredClone(ctx.config);
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-access-probe-'));
const results = [];
const scriptSha256 = createHash('sha256').update(await fs.readFile(new URL(import.meta.url))).digest('hex');
const budget = { limit: 12, used: 0, launches: [], exhausted: false,
  onStart: (index, bin, args) => writeFileSync(path.join(evidence, `reserved-${index}.json`),
    redactSecrets(JSON.stringify({ index, bin, args, scriptSha256,
      kind: args.includes('--version') ? 'version' : args.includes('--help') ? 'help' : 'capability-or-auth' })).content + '\n', { flag: 'wx', mode: 0o600 }),
  onComplete: async (index, bin, result) => {
    const output = redactSecrets(JSON.stringify({ bin, ...result })).content;
    if (scanSecrets(output).length) throw Error('输出仍有凭据形态，拒绝保存');
    await fs.writeFile(path.join(evidence, `launch-${index}.json`), output + '\n', { flag: 'wx', mode: 0o600 });
    console.log(`启动 ${index}/12 已完成：退出 ${result.code}，超时 ${result.timedOut}`);
  },
};
try {
  await withLaunchBudget(budget, bin => /(?:^|\/)(?:cld|claude|codex)$/.test(bin), async () => {
    if (batch < 4) {
      const profile = ['qwen', 'kimi', 'deepseek'][batch - 1];
      const route = resolveClaudeRoute(cfg, profile);
      const model = route.modelsDeclared[0] ?? null;
      if (!model) throw Error('profile 无可核实的默认模型声明');
      const report = await runDoctor({ config: cfg, projectRoot: ctx.projectRoot, triviumDir: path.join(scratch, '.trivium'),
        only: 'claude', tierFlags: { claude: { vendorProfile: profile } }, modelOverrides: { claude: model } });
      cfg.probe = report.probe;
      const ready = claudeAdapter.availability({ cfg, nodePath: process.execPath }, { vendorProfiles: [profile] });
      results.push({ profile, model, report, availability: ready });
      if (ready.ok) {
        const auth = claudeAdapter.authProbe({ cfg, nodePath: process.execPath }, ctx.projectRoot, { vendorProfile: profile, model, effort: null });
        results.push({ profile, model, auth: await auth.probe() });
      }
    } else {
      // 先逐组合验证四条路线。后续整套能力探针仍受本批剩余额度限制。
      for (const [profile, model] of [[null, 'gpt-6.1-sol'], ['qwen', 'qwen3.8-flash'], ['kimi', 'kimi-for-coding'], ['deepseek', 'deepseek-flash']]) {
        const auth = codexAdapter.authProbe({ cfg, nodePath: process.execPath }, ctx.projectRoot, { vendorProfile: profile, model, effort: null });
        results.push({ profile, model, auth: await auth.probe() });
      }
      const report = await runDoctor({ config: cfg, projectRoot: ctx.projectRoot, triviumDir: path.join(scratch, '.trivium'),
        only: 'codex', tierFlags: { codex: { vendorProfile: null } }, modelOverrides: { codex: 'gpt-6.1-sol' } });
      results.push({ report });
    }
  });
} catch (e) {
  results.push({ error: e instanceof LaunchBudgetExceeded ? e.message : '探测中断，详情只保存脱敏结果，不自动重试', untested: true });
} finally {
  const summary = redactSecrets(JSON.stringify({ batch, used: budget.used, limit: budget.limit, exhausted: budget.exhausted,
    scratch, results }, null, 2)).content;
  await fs.writeFile(path.join(evidence, 'summary.json'), summary + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`批次 ${batch}：${budget.used}/12 次；结果 ${path.join(evidence, 'summary.json')}`);
}
