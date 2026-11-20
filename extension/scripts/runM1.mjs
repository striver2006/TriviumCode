// 在真实交互 CLI 中发送入口 B 和一条续话。只记录独立回读，保留授权界面给用户处理。
import * as fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { extensionRoot, makeWorkspace, preparePlan } from '../test/e2e/workspace.mjs';
import { command, openWorkspace, until, installVsix } from '../test/e2e/workbench.mjs';

const code = process.env.VSCODE_EXECUTABLE_PATH || await downloadAndUnzipVSCode('stable');
const base = await fs.mkdtemp('/tmp/trivium-m1-');
const vsix = process.env.TRIVIUM_TEST_VSIX;
if (vsix) await installVsix({ code, base, vsix });
const delaySetting = process.env.TRIVIUM_M1_READY_DELAY_MS;
const readyDelayMs = delaySetting === undefined ? undefined : Number(delaySetting);
if (readyDelayMs !== undefined && (!Number.isSafeInteger(readyDelayMs) || readyDelayMs < 0)) throw new Error('就绪延迟须为非负整数');
const probes = YAML.parse(await fs.readFile(path.resolve(extensionRoot, '../.trivium/config.local.yaml'), 'utf8')).probe.cli;
const ids = { codex: 'codex', claude: 'claude', glm: 'zcode', gemini: 'agy' };
const summary = [];
const sendMode = process.env.TRIVIUM_M1_SEND_MODE;
const waitForEntryReply = process.env.TRIVIUM_M1_WAIT_FOR_ENTRY_REPLY === '1';
if (sendMode && !['execute', 'split'].includes(sendMode)) throw new Error('显式模式仅支持 execute 或 split');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const textOf = w => w.page.locator('.xterm-accessibility-tree').allTextContents().then(a => a.join('\n'));
function promptOf(text) {
  const prompts = [/trust (?:the |this |these |files in this )?(?:folder|directory|project|workspace|files)/i,
    /do you trust/i, /信任此|是否信任/, /sign in to|log in to|please (?:log|sign) in/i,
    /select (?:a |the )?login method|choose (?:the |a )?text style/i,
    /按.*登录|请.*登录|需要登录/, /allow .* to access/i];
  return prompts.find(p => p.test(text))?.exec(text)?.[0] || null;
}
async function run(id, probe, r) {
  const children = [];
  try {
    const { entrypoint, version, probed_at, version_probe, provider_config } = probe;
    // 允许 Bob 在同一夹具确认原生客户端权限后继续；每次 VS Code profile 仍隔离。
    const root = process.env.TRIVIUM_M1_FIXTURES && path.join(process.env.TRIVIUM_M1_FIXTURES, id);
    const fx = root
      ? { root, ...JSON.parse(await fs.readFile(path.join(root, '.trivium/scenario.json'), 'utf8')) }
      : await makeWorkspace(base, id, '终端验收' + id, { id, probe: { entrypoint, version, probed_at, version_probe, ...(provider_config && { provider_config }) } });
    const fixtureProbe = YAML.parse(await fs.readFile(path.join(fx.root, '.trivium/config.local.yaml'), 'utf8')).probe.cli[ids[id]];
    r.version = fixtureProbe.version;
    r.entrypoint = fixtureProbe.entrypoint;
    const gates = JSON.parse(await fs.readFile(path.join(fx.root, '.trivium/state.json'), 'utf8')).gates;
    if (Object.values(gates).some(g => g.state === 'running')) throw new Error('夹具有在审运行，请待本轮结束再采样');
    if (root) {
      fx.topic += '-' + path.basename(base).slice(-6);
      await preparePlan(root, fx.topic, id);
    }
    r.root = fx.root;
    r.topic = fx.topic;
    r.sendMode = sendMode || 'manifest-default';
    r.readyDelayMs = readyDelayMs ?? 'manifest-default';
    r.waitForEntryReply = waitForEntryReply;
    r.vsix = vsix ? path.resolve(vsix) : null;
    const w = await openWorkspace(fx, { base, code, children, terminalAccess: true, sendMode, readyDelayMs, vsix });
    const f = w.frame;
    await f.locator('#driver').selectOption(id);
    await f.locator('#entry').selectOption('B');
    // 仅选夹具中已配好的桩审核者。
    const others = f.locator('#critics .chip.on').filter({ hasNotText: /Antigravity|ZCode/ });
    while (await others.count()) await others.first().click();
    await f.locator('#topic').fill(w.topic);
    const planDir = path.join(w.root, '.reviews', w.topic, 'plan');
    const plans = (await fs.readdir(planDir)).filter(name => name.endsWith('-' + id + '.md'));
    if (plans.length !== 1) throw new Error('入口 B 夹具应只有一份 Driver 计划原稿');
    const critics = (await f.locator('#critics .chip.on').allTextContents()).map(label => {
      if (label.includes('ZCode')) return 'glm';
      if (label.includes('Antigravity')) return 'gemini';
      throw new Error('未识别的夹具审核者：' + label);
    }).join(',');
    await f.locator('#body').fill('核对 README 计划。原稿已认领：' + path.relative(w.root, path.join(planDir, plans[0])) +
      '。请用本夹具 .trivium/bin/trivium 按表单参数启动计划审查，审核者均为桩。收到运行号后回复 P4ACK 后紧接 437 加 38 的结果，等待续话。勿审批。');
    await f.locator('#btnPrechain').click();
    await until('前置链', async () => {
      const errors = await f.locator('#steps .fail').allTextContents();
      if (errors.length) throw new Error(errors.join(' '));
      return f.locator('#btnIgnite').isEnabled();
    });
    await f.locator('#btnIgnite').click();
    r.ignitions = 1;
    const start = Date.now();
    const state = async () => {
      const snap = JSON.parse(await fs.readFile(path.join(w.root, '.trivium/state.json'), 'utf8'));
      return snap.gates[w.topic + '/plan']?.run_id ?? null;
    };
    // 原生 Agent 会先读取入口技能并执行前置链，预留冷启动与模型响应时间。
    while (Date.now() - start < 480000) {
      const text = await textOf(w);
      r.terminalRowsObserved ||= text.trim().length > 0;
      r.permissionPrompt = promptOf(text);
      if (r.permissionPrompt) break;
      r.entrySent ||= await f.locator('#modeBadge.m1').count() > 0;
      r.runId ||= await state();
      r.entryReplySeen ||= /P4ACK[^\d]{0,40}(?:437[^\d]+38[^\d]+)?475(?!\d)/.test(text);
      r.entryAck ||= r.entryReplySeen || Boolean(r.runId);
      if (r.runId && (!waitForEntryReply || r.entryReplySeen)) break;
      if (await f.locator('#banner').innerText().then(t => t.includes('协同终端已关闭'))) {
        r.terminalExitedBeforeAck = true;
        break;
      }
      await delay(300);
    }
    if (r.entrySent && !r.permissionPrompt && (!waitForEntryReply || r.entryReplySeen)) {
      await f.locator('#relayInput').fill('请回复 P4NEXT 后紧接 63 乘 17 的结果，不加空格。');
      await f.locator('#btnRelay').click();
      r.relayAttempts = 1;
      const deadline = Date.now() + (r.entryAck ? 150000 : 35000);
      while (Date.now() < deadline) {
        const t = await textOf(w);
        r.relayAck ||= t.includes('P4NEXT1071');
        r.runId ||= await state();
        if (r.relayAck || promptOf(t)) break;
        await delay(350);
      }
    }
    r.runId ||= await state();
    r.m1BeforeClose = await f.locator('#modeBadge.m1').count() === 1;
    const hasRun = async () => Boolean(r.runId) && (await f.locator('#runs .card').allTextContents()).some(t => t.includes(r.runId));
    if (r.runId) await until('原运行卡', hasRun, 30);
    r.cardBeforeClose = await hasRun();
    if (r.m1BeforeClose) {
      await command(w.page, 'Terminal: Kill the Active Terminal Instance');
      await f.locator('#modeBadge.m3').waitFor();
      r.closed = true;
      r.m3AfterClose = r.m1BeforeClose;
      r.cardAfterClose = await hasRun();
    }
    if (r.runId) {
      const metaPath = path.join(planDir, '_meta', 'run-' + r.runId + '.json');
      const meta = await until('桩归档', async () => {
        const m = await fs.readFile(metaPath, 'utf8').then(JSON.parse).catch(() => null);
        return m && ['success', 'failed', 'cancelled'].includes(m.status) && m;
      });
      r.fingerprints = Object.fromEntries(Object.entries(meta.critics).map(([key, c]) => [key, c.cli_version]));
      if (meta.driver !== id || meta.run_id !== r.runId || meta.status !== 'success' ||
          Object.keys(r.fingerprints).sort().join(',') !== critics.split(',').sort().join(',') ||
          !Object.values(r.fingerprints).every(v => v === 'stub/0.0.0')) {
        throw new Error('运行、Driver、归档终态或入选桩指纹不匹配');
      }
    }
  } finally {
    for (const child of children) child.kill();
  }
}
for (const [id, key] of Object.entries(ids)) {
  if (process.argv.length > 2 && !process.argv.slice(2).includes(id)) continue;
  const r = { id, ignitions: 0, entrySent: false, entryAck: false, relayAttempts: 0, relayAck: false,
    runId: null, closed: false, m3AfterClose: false, cardAfterClose: false };
  try { await run(id, probes[key], r); } catch (e) { r.error = e.message.slice(0, 700); }
  summary.push(r);
  await fs.writeFile(path.join(base, 'matrix.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(r));
}
console.log('真机矩阵', base);
if (summary.some(r => r.error || !(r.entryAck && r.relayAck && r.m3AfterClose && r.cardBeforeClose && r.cardAfterClose))) process.exitCode = 1;
