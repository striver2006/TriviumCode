// 安装态入口 A。真实 GLM 主攻，临时仓内的计划审核使用桩。原生确认由操作者完成。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { makeWorkspace, extensionRoot } from '../test/e2e/workspace.mjs';
import { command, installVsix, openWorkspace, until } from '../test/e2e/workbench.mjs';

const [program, node] = process.argv.slice(2);
const code = process.env.VSCODE_EXECUTABLE_PATH;
const vsix = process.env.TRIVIUM_TEST_VSIX;
assert.ok(code && vsix && path.isAbsolute(program), '需要 VS Code、最终 VSIX 和绝对交互入口');
const base = await fs.mkdtemp(path.join(tmpdir(), 'trivium-glm-entry-'));
const children = [];
const topic = '入口实测' + path.basename(base).slice(-6);
const marker = path.basename(base).slice(-6).toUpperCase();
const initial = '本次为隔离工作区的入口 A 点火验收。使用已认领的现有计划和本工作区的 .trivium/bin/trivium 发起入口 A 的计划审查，审核者是桩。得到本次运行号后请回复 ' + marker + 'A 后紧接 31 乘 17 的结果。本次采样到这里等待续话，勿审批。';
const questions = [
  { mode:'busy', text:'请只回复 ' + marker + 'B 后紧接 47 乘 13 的结果。', answer:marker + 'B611' },
  { mode:'idle', text:'请只回复 ' + marker + 'C 后紧接 29 乘 19 的结果。', answer:marker + 'C551' },
];
const digest = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const summary = {base, topic, program, node, vsix, vsixSha256:await digest(vsix), programSha256:await digest(program), sends:[]};
const save = async () => fs.writeFile(path.join(base,'result.json'), JSON.stringify(summary,null,2));
const rows = file => fs.readFile(file, 'utf8').then(t => t.split('\n').flatMap(l => {
  try { return [JSON.parse(l)]; } catch { return []; }
}), () => []);
async function logDirectory(root) {
  const items = await fs.readdir(root, {recursive:true});
  const names = items.filter(file => /^zcode-\d{4}-\d\d-\d\d\.jsonl$/.test(path.basename(file)));
  const dirs = [...new Set(names.map(file => path.dirname(file)).filter(dir => path.basename(dir).startsWith('zcode-')))];
  assert.ok(dirs.length <= 1, '此新窗口应只有一个 GLM 协同终端');
  return dirs[0] && path.join(root, dirs[0]);
}
async function events(dir) {
  const names = (await fs.readdir(dir)).filter(n=>/^zcode-\d{4}-\d\d-\d\d\.jsonl$/.test(n)).sort();
  return (await Promise.all(names.map(name=>rows(path.join(dir,name))))).flat();
}
// 原生权限的等待时间由操作者决定。超时仅计入 CLI 自身运行的部分。
async function waitForReply(check, terminalText) {
  let remaining = 600_000;
  let previous = Date.now();
  let waiting = false;
  while (remaining > 0) {
    const reply = await check();
    if (reply) return reply;
    const now = Date.now();
    const prompt = /Approval required|需要批准|Select a model before|Do you trust|Sign in to/i.test(await terminalText());
    if (!prompt) remaining -= now - previous;
    if (prompt && !waiting) console.log('等待操作者核对 ZCode 原生确认',topic);
    waiting = prompt;
    previous = now;
    await new Promise(r=>setTimeout(r,500));
  }
  throw new Error('原生会话等待回答超时');
}

try {
  await installVsix({code,base,vsix});
  const local = YAML.parse(await fs.readFile(path.resolve(extensionRoot,'../.trivium/config.local.yaml'),'utf8'));
  const {entrypoint, version, version_probe, probed_at} = local.probe.cli.zcode;
  const fx = await makeWorkspace(base,'repo',topic,{id:'glm',probe:{entrypoint,version,version_probe,probed_at}});
  const settings = { 'trivium.launch.glmInteractivePath':program };
  if (node) settings['trivium.launch.glmNodePath'] = node;
  await fs.mkdir(path.join(fx.root,'.vscode'),{recursive:true});
  await fs.writeFile(path.join(fx.root,'.vscode/settings.json'), JSON.stringify(settings));
  const config = path.join(fx.root,'.trivium/config.yaml');
  const cfg = YAML.parse(await fs.readFile(config,'utf8'));
  cfg.verify = {build:['node --version'],test:['git status --short']};
  await fs.writeFile(config,YAML.stringify(cfg));
  const shared = path.join(fx.root,'.trivium/config.local.yaml');
  const before = await digest(shared);
  const w = await openWorkspace(fx,{base,code,vsix,children,terminalAccess:true});
  Object.assign(summary,{workspace:fx.root, profile:w.profile, extensions:path.join(base,'extensions'), probeEntrypoint:entrypoint});
  await save();
  const f = w.frame;
  await f.locator('#driver').selectOption('glm');
  await f.locator('#entry').selectOption('A');
  const others = f.locator('#critics .chip.on').filter({hasNotText:'Antigravity'});
  while (await others.count()) await others.first().click();
  await f.locator('#topic').fill(topic);
  await f.locator('#body').fill(initial);
  await f.locator('#btnPrechain').click();
  await until('前置链',async () => {
    const errors = await f.locator('#steps .fail').allTextContents();
    assert.equal(errors.length,0,errors.join(' '));
    return f.locator('#btnIgnite').isEnabled();
  });
  await f.locator('#btnIgnite').click();
  console.log('真实 GLM 窗口：',fx.root,'；若原生客户端请求信任、选模或权限，须由 Bob 在此窗口确认。',base);
  const logs = path.join(w.profile,'logs');
  const dir = await until('独占 ZCode 日志',() => logDirectory(logs),300);
  const started = await until('主会话开始',async () => (await events(dir)).find(r => r.module === 'core.runtime' && r.event === 'turn.started'),1200);
  summary.sessionId = started.sessionId;
  summary.logDirectory = dir;
  await f.locator('#modeBadge.m1').waitFor();
  const modelFile = path.join(homedir(),'.zcode/cli/rollout','model-io-' + started.sessionId + '.jsonl');
  const readModel = async () => (await rows(modelFile)).filter(r => r.sessionId === started.sessionId && r.querySource === 'main_turn');
  const terminalText = async () => (await w.page.locator('.xterm-accessibility-tree').allTextContents()).join('\n');
  summary.banner = await f.locator('#banner').innerText();
  summary.entryCommand = await f.locator('#cmdText').innerText();
  assert.ok(summary.entryCommand.startsWith('/skill dual-run ') && summary.entryCommand.includes(topic));
  for (const q of questions) {
    if (q.mode === 'idle') await until('原生空闲输入提示',async () => {
      const s = await terminalText();
      return /Type a prompt|输入提示词/i.test(s) && !/esc to interrupt/i.test(s);
    },120);
    await f.locator('#relayInput').fill(q.text);
    if (q.mode === 'busy') {
      const turn = (await events(dir)).filter(r=>r.module === 'core.runtime' && r.turnId === started.turnId);
      assert.ok(!turn.some(r=>['turn.completed','turn.failed'].includes(r.event)), '忙时采样窗口已错过');
    }
    const clicked = Date.now();
    await f.locator('#btnRelay').click();
    summary.sends.push({mode:q.mode,clicked,exactInput:q.text});
    await save();
    const reply = await waitForReply(async () =>
      (await readModel()).find(r => r.response?.text?.includes(q.answer)), terminalText);
    const inputs = reply.request.messages.filter(m => m.role === 'user' && m.content === q.text);
    assert.equal(inputs.length,1);
    Object.assign(summary.sends.at(-1),{turnId:reply.turnId, answer:q.answer, startedAt:reply.startedAt, completedAt:reply.completedAt});
    await until('主轮次结束', async () => (await events(dir)).some(r => r.sessionId === started.sessionId &&
      r.turnId === reply.turnId && r.event === 'turn.completed'),60);
    await save();
  }
  const model = await readModel();
  const opening = model.find(r => r.response?.text?.includes(marker + 'A527'));
  assert.ok(opening);
  const entryTurn = model.filter(r => r.turnId === opening.turnId);
  assert.ok(entryTurn.some(r => r.request.messages.some(m => m.role === 'user' && JSON.stringify(m.content).includes(topic))));
  // ZCode 会把斜杠入口解析成 Skill 调用，终端视口的历史文字也会滚走。
  const skill = entryTurn.flatMap(r => r.response?.toolCalls ?? []).find(c =>
    c.name === 'Skill' && c.input?.skill === 'dual-run' && c.input.args?.includes(topic));
  assert.ok(skill, '首轮应调用带本次主题的原生 dual-run 技能');
  summary.nativeSkill = skill.input;
  assert.ok(summary.sends[0].clicked < Date.parse(opening.completedAt));
  assert.ok(summary.sends[1].clicked >= Date.parse(summary.sends[0].completedAt));
  assert.equal(new Set([opening.turnId,...summary.sends.map(s=>s.turnId)]).size,3);
  for (const q of questions) {
    const turns = model.filter(r => {
      const users = r.request.messages.filter(m=>m.role === 'user');
      return users.at(-1)?.content === q.text;
    });
    assert.equal(new Set(turns.map(r=>r.turnId)).size,1);
  }
  const state = JSON.parse(await fs.readFile(path.join(fx.root,'.trivium/state.json'),'utf8'));
  const gate = state.gates[topic + '/plan'];
  assert.equal(gate.session_id,started.sessionId);
  const run = JSON.parse(await fs.readFile(path.join(fx.root,'.reviews',topic,'plan/_meta','run-'+gate.run_id+'.json'),'utf8'));
  assert.equal(run.driver,'glm');
  assert.equal(run.topic,topic);
  assert.equal(run.entry,'A');
  assert.deepEqual(Object.keys(run.critics),['gemini']);
  assert.equal(run.critics.gemini.cli_version,'stub/0.0.0');
  const card = f.locator('#runs .card').filter({hasText:topic}).filter({hasText:gate.run_id});
  await card.first().waitFor();
  summary.cardBeforeClose = await card.first().locator('.head').innerText();
  Object.assign(summary,{runId:gate.run_id,entry:run.entry,entryTurn:opening.turnId,model:opening.model.modelId,
    entryAnswer:marker+'A527', critic:run.critics.gemini.cli_version, sharedProbeUnchanged:before === await digest(shared)});
  assert.ok(summary.sharedProbeUnchanged);
  await command(w.page,'Terminal: Kill the Active Terminal Instance');
  await f.locator('#modeBadge.m3').waitFor();
  await card.first().waitFor();
  summary.cardAfterClose = await card.first().locator('.head').innerText();
  summary.m3 = true;
  console.log('安装态入口 A、续话与 M3 通过', summary.runId);
} catch (e) {
  summary.error = e.message;
  process.exitCode = 1;
  console.error(summary.error);
} finally {
  await save();
  for (const child of children) child.kill();
}
