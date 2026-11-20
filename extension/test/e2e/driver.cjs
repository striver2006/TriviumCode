// 入口 B 的交互 Driver 替身。只接受与测试表单逐字相同的两行，不执行输入文本。
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const rl = require('node:readline').createInterface({ input: process.stdin });
const { topic, focus } = JSON.parse(fs.readFileSync('.trivium/scenario.json'));
const command = '/dual-review-plan ' + focus + ' --driver claude --critics gemini,glm --topic ' + topic;
const wrapper = path.resolve('.trivium/bin/trivium');
let started = false;
let runId;
rl.on('line', async line => {
  if (line === command && !started) {
    started = true;
    const output = execFileSync(wrapper, ['review', '--start', '--entry', 'B', '--stage', 'plan',
      '--topic', topic, '--driver', 'claude', '--critics', 'gemini,glm', '--focus', focus, '--json'], { encoding: 'utf8' });
    runId = JSON.parse(output).run_id;
    fs.writeFileSync('.trivium/start.json', output);
  } else if (line === '核对续话 ' + topic && started) {
    // 等归档完成后，模拟 Driver 对照本轮意见写出完整定稿。闸门仍由真实 CLI 判定。
    const dir = path.join('.reviews', topic, 'plan');
    const deadline = Date.now() + 60000;
    while (true) {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, '_meta', 'run-' + runId + '.json'), 'utf8'));
      if (meta.status === 'success') break;
      if (meta.status === 'failed' || Date.now() > deadline) throw new Error('未能完成桩审查 ' + runId);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    fs.writeFileSync(path.join(dir, new Date().toISOString().slice(0, 10) + '-' + topic + '-r2-claude.md'),
      '# 验收计划定稿\n\n本轮无改动。AGY-01 与 GLM-01 指向夹具中不存在的实现。\n\n检查 README 的说明，记录运行结果。\n', { flag: 'wx' });
    fs.writeFileSync('.trivium/relay.txt', line);
  }
});
