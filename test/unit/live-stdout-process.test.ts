/** 两个独立 Node 进程以真实文件协议交接。磁盘故障复用安装态桩 worker 的探针。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { scratchDir } from '../helpers/scratch.js';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { REPO_ROOT } from '../helpers/fixture.js';
import { runReviewProcess, stdoutAudit, STDOUT_INFO, type StdoutAudit } from '../../src/trivium/live-stdout.js';

test('真实输出文件、收尾核对及打开恢复', async t => {
  const root = await scratchDir('trivium-e1-process-');
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  for (const kind of ['timeout','cap','occupied','rewrite','pending','transient','no-process']) {
    const dir = path.join(root,kind,'out');
    await fs.mkdir(dir,{recursive:true});
    const file = path.join(dir,'stdout.jsonl');
    if (kind === 'occupied') await fs.writeFile(file,'保留上次尝试');
    if (kind === 'transient') {
      const original = fs.open.bind(fs);
      t.mock.method(fs,'open', (...args: Parameters<typeof fs.open>) => {
        if (args[0] === file) {
          t.mock.restoreAll();
          return Promise.reject(Object.assign(new Error('打开暂时失败'), {code:'EAGAIN'}));
        }
        return original(...args);
      });
    }
    const audit: StdoutAudit = { redacted:{} };
    const script = kind === 'timeout' ? 'process.stdout.write("hello\\n"); setInterval(()=>{},1000)'
      : kind === 'pending' ? 'console.log("ok"); setTimeout(()=>process.stdout.write("a".repeat(300000)),180)'
      : 'process.stdout.write("hello world")';
    const r = await stdoutAudit.run(audit, () => runReviewProcess({path:file,attempt:1},
      kind === 'no-process' ? path.join(root,'absent') : process.execPath,['-e',script],
      { timeoutMs:kind === 'timeout' ? 500 : 8000, maxBufferBytes:kind === 'cap' ? 5 : 600000 }));
    const actual = audit.actualPath!;
    assert.equal(await fs.readFile(actual,'utf8'),r.stdout);
    if (kind === 'rewrite') {
      await fs.writeFile(actual + '.new','已清扫');
      await fs.rename(actual + '.new',actual);
    }
    await audit.seal!(true,kind === 'rewrite');
    const info = JSON.parse(await fs.readFile(path.join(path.dirname(actual),STDOUT_INFO),'utf8'));
    assert.equal(info.bytes, (await fs.stat(actual)).size);
    assert.equal(info.ino,String((await fs.stat(actual,{bigint:true})).ino));
    if (kind === 'timeout' || kind === 'cap' || kind === 'rewrite' || kind === 'no-process') {
      assert.equal(info.state,'incomplete');
      assert.equal(info.reason,{timeout:'timeout',cap:'capture_limit',rewrite:'scrub_rewritten','no-process':'not_started'}[kind]);
    } else assert.equal(info.state,'recovered');
    if (kind === 'occupied') {
      assert.equal(await fs.readFile(file,'utf8'),'保留上次尝试');
      assert.equal(actual,path.join(dir,'attempt-1','stdout.jsonl'));
    }
  }
});

test('桩 worker 跨进程发送，插件读取器消费真实输出，短写、慢写和永久失败各自封口', async t => {
  const root = await fs.realpath(await scratchDir('trivium-e1-contract-'));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  const bundle = path.join(root,'reader.cjs');
  await build({entryPoints:[path.join(REPO_ROOT,'extension/src/monitor/stdoutTail.ts')],outfile:bundle,
    bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  const {StdoutTail} = createRequire(import.meta.url)(bundle);
  const stub = pathToFileURL(path.join(REPO_ROOT,'dist/test/src/trivium/adapters/stub-stdout.js')).href;
  const probe = path.join(REPO_ROOT,'extension/test/e2e/workerMetrics.cjs');
  await fs.writeFile(path.join(root,'fault.json'), JSON.stringify({short:'short',slow:'slow',failed:'permanent'}));
  for (const critic of ['short','slow','failed']) {
    const dir = path.join(root,critic,'out');
    const source = 'import {stubStdout} from ' + JSON.stringify(stub) +
      ';await stubStdout(' + JSON.stringify(dir) + ',"contract",1,"latch")';
    const child = spawn(process.execPath,['--require',probe,'--input-type=module','-e',source,'--',probe,'--worker'],
      {stdio:['ignore','ignore','pipe'],env:{...process.env,TRIVIUM_STUB_CRITIC:'{}',TRIVIUM_E1_METRICS:root}});
    let diagnostics = '';
    child.stderr.on('data',chunk => { diagnostics += chunk; });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    const exited = new Promise((resolve,reject) => { child.once('error',reject); child.once('exit',resolve); });
    const patches: {text:string;note:string}[] = [];
    const reader = new StdoutTail(root,4096,async (m: typeof patches[number]) => { patches.push(m); return true; });
    const side = {critic,attempt:1,state:'running',model:null,elapsedS:0};
    reader.show(true); reader.update([side],'running',false);
    try {
      for (let i=0; i<500; i++) {
        const ready = critic === 'short' ? patches.some(p => p.text.includes('E1-contract-0'))
          : patches.some(p => p.note.includes('暂缓'));
        if (ready) break;
        assert.ok(i<499,critic + ' 未看到运行中状态');
        await delay(20);
      }
      assert.equal(child.exitCode,null);
      for (const n of [0,1]) await fs.writeFile(path.join(dir,'release-' + n),'');
      assert.equal(await exited,0,diagnostics);
      const info = JSON.parse(await fs.readFile(path.join(dir,STDOUT_INFO),'utf8'));
      assert.equal(info.state,{short:'complete',slow:'recovered',failed:'incomplete'}[critic]);
      const expected = [0,1].map(n => ('E1-contract-' + n).padEnd(255,'.') + '\n').join('');
      assert.equal(await fs.readFile(path.join(dir,info.file),'utf8'), critic === 'failed' ? '' : expected);
      assert.equal(info.bytes, critic === 'failed' ? 0 : Buffer.byteLength(expected));
    } finally { reader.dispose(); }
  }
});

test('取消期间写调用未返回也能发布中断记录', async t => {
  const { interruptStdout } = await import('../../src/trivium/live-stdout.js');
  const root = await scratchDir('trivium-e1-interrupt-');
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  const file = path.join(root,'stdout.jsonl');
  const open = fs.open.bind(fs);
  let writing!: () => void;
  const started = new Promise<void>(resolve => { writing = resolve; });
  let unblock!: () => void;
  const held = new Promise<void>(resolve => { unblock = resolve; });
  t.mock.method(fs,'open',async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args);
    if (args[0] === file && args[1] === 'wx') {
      const original = handle.write.bind(handle);
      t.mock.method(handle,'write',async (data: Buffer, offset: number, length: number, pos: number | null) => {
        writing();
        await held;
        return original(data,offset,length,pos);
      });
    }
    return handle;
  });
  let stop!: () => void;
  const complete = runReviewProcess({path:file,attempt:1},process.execPath,
    ['-e','console.log("started"); setInterval(()=>{},10000)'],{timeoutMs:8000,stopEarly:fn => { stop = fn; }});
  try {
    await started;
    const when = Date.now();
    await interruptStdout();
    assert.ok(Date.now() - when < 1600,'取消被在途写阻塞');
    const info = JSON.parse(await fs.readFile(path.join(root,STDOUT_INFO),'utf8'));
    assert.equal(info.state,'incomplete');
    assert.equal(info.reason,'interrupted');
  } finally {
    unblock(); stop();
    await complete;
  }
});
