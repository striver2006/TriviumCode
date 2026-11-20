import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { StdoutTail, type StdoutPatch } from '../../src/monitor/stdoutTail';

test('按实际 UTF-8 字节续读，隐藏后补尾，尝试轮转及终态打开均核对文件身份', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'e1-tail-')));
  t.after(() => fs.rm(root,{ force:true, recursive:true }));
  const dir = path.join(root, 'example', 'out');
  await fs.mkdir(dir,{ recursive:true });
  const file = path.join(dir,'stdout.jsonl');
  const meta = path.join(dir,'stdout-live.json');
  const patches: StdoutPatch[] = [];
  const tail = new StdoutTail(root, 12, async m => { patches.push(m); return true; });
  t.after(() => tail.dispose());
  const side = { critic:'example', state:'running', model:null, attempt:1, elapsedS:0 };
  const sync = (terminal = false) => tail.update([side], terminal ? 'success' : 'running', terminal);
  async function wait(f: () => boolean) {
    for (let i = 0; i < 300; i++) { if (f()) return; await delay(10); }
    assert.fail('实时尾部等待超时');
  }
  const identity = randomUUID();
  async function info(state: string, ino?: string) {
    const stat = await fs.stat(file,{ bigint:true });
    await fs.writeFile(meta, JSON.stringify({ schema:'trivium.stdout.v1',file:'stdout.jsonl',identity,
      attempt:side.attempt,dev:String(stat.dev),ino:ino ?? String(stat.ino),state,reason:null,bytes:Number(stat.size) }));
  }
  tail.show(true); sync();
  await wait(() => patches.some(p => p.note.includes('未提供')));
  await fs.writeFile(file,Buffer.from('文').subarray(0,1));
  await info('streaming'); sync();
  await wait(() => patches.at(-1)?.end === 1);
  await fs.appendFile(file,Buffer.from('文').subarray(1));
  await wait(() => patches.at(-1)?.text === '文');
  tail.show(false);
  const before = patches.length;
  await fs.appendFile(file,'1234567890中文');
  await delay(160);
  assert.equal(patches.length,before);
  tail.show(true);
  await wait(() => patches.at(-1)?.clipped === true);
  assert.equal(patches.at(-1)?.text,'567890中文');
  const previous = path.join(dir,'attempt-1');
  await info('complete');
  await fs.mkdir(previous);
  await fs.rename(meta,path.join(previous,'stdout-live.json'));
  await fs.rename(file,path.join(previous,'stdout.jsonl'));
  side.attempt = 2; sync();
  await wait(() => patches.at(-1)?.attempt === 2 && patches.at(-1)?.reset === true);
  assert.equal(await tail.completePath('example',1),path.join(previous,'stdout.jsonl'));
  await fs.writeFile(file,'最后一行'); await info('complete','0'); sync(true);
  await wait(() => patches.at(-1)?.note.includes('不可读') === true);
  assert.equal(await tail.completePath('example',2),undefined);
  await info('complete'); sync(true);
  await wait(() => patches.at(-1)?.canOpen === true);
  assert.equal(await tail.completePath('example',2),file);
  const moved = path.join(root,'voided','example','attempt-2');
  await fs.mkdir(path.dirname(moved),{recursive:true});
  await fs.rename(dir,moved);
  assert.equal(await tail.completePath('example',1),path.join(moved,'attempt-1','stdout.jsonl'));
  const missing = new StdoutTail(path.join(root,'已清理'),12,async () => true);
  missing.update([side],'success',true);
  assert.equal(await missing.completePath('example',2), undefined);
  missing.dispose();
});
