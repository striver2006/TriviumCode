// 四个厂商进程的可控替身。每一阶段仅由安装态读端确认后才继续。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const id = process.argv[2];
const dir = process.env.TRIVIUM_E1_FIXTURE;
const info = file => path.join(dir, id + '-' + file);
const versionOnly = process.argv.slice(3).some(x => x === '--version' || x === 'version');
if (versionOnly) { console.log('9.9.9'); return; }

const marker = 'E1-' + id + '-' + crypto.randomUUID();
const secret = ['sk-', 'unitFixture0123456789', 'abcdefghijk'].join('');
const review = JSON.stringify({ schema: 'trivium.review.v2', summary: '可控替身返回的审查正文', verdict: 'pass',
  findings: [], agreed: [], not_covered: ['仅用于分批输出验收'], consulted: ['README.md'] });
const body = {
  codex: { type: 'item.completed', item: { type: 'agent_message', text: review } },
  claude: { type: 'result', subtype: 'success', result: review },
  gemini: { event: 'result', result: { status: 'SUCCESS', response: review } },
  glm: { response: review, eventCount: 1 },
};
async function latch(stage) {
  const deadline = Date.now() + 90000;
  while (!fs.existsSync(info('release-' + stage))) {
    if (Date.now() > deadline) throw new Error('未收到退出闩锁 ' + stage);
    await delay(25);
  }
}
async function write(bytes) { await new Promise(done => process.stdout.write(bytes, done)); }
async function main() {
  const sent = Date.now();
  const metadata = { marker, pid: process.pid, sent };
  fs.writeFileSync(info('producer.json'), JSON.stringify(metadata));
  // 拆在 UTF-8 中文字符内部、凭据中部；保留空行和最后的无换行 JSON。
  const prefix = Buffer.from('中文 ' + marker + '\n\n');
  await write(prefix.subarray(0, 1)); await delay(20);
  await write(Buffer.concat([prefix.subarray(1), Buffer.from(secret.slice(0, 11))]));
  await latch('first');
  await write(secret.slice(11) + '\nM3-' + marker + '\n');
  await latch('last');
  const tail = JSON.stringify(body[id]);
  await write(tail);
  const clean = prefix.toString() + secret.slice(0, 4) + '…' + secret.slice(-4) + '\nM3-' + marker + '\n' + tail;
  process.once('exit', code => fs.writeFileSync(info('exit.json'), JSON.stringify({ code, at: Date.now(),
    bytes: Buffer.byteLength(clean), sha256: crypto.createHash('sha256').update(clean).digest('hex') })));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
