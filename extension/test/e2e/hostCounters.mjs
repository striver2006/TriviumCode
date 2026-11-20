// 仅在本轮隔离 Extension Host 的本地 Inspector 观察 E1 的文件、监听和定时器活动。
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
// macOS SDK sys/resource.h：rusage_info_v2 最后的两个 uint64 保存物理 I/O 字节。
const disk = `import ctypes, struct, sys
b=ctypes.create_string_buffer(16+18*8)
rc=ctypes.CDLL('/usr/lib/libproc.dylib').proc_pid_rusage(int(sys.argv[1]),2,ctypes.byref(b))
if rc: raise OSError(rc)
print(*struct.unpack_from('=QQ',b,16+16*8))`;
import { once } from 'node:events';
import { until } from './workbench.mjs';
export async function portForHost() {
  const server = net.createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(ok => server.close(ok));
  return port;
}
export async function hostCounters(port) {
  const target = await until('本轮扩展宿主计量接口', async () => {
    try { return (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json())[0]; }
    catch { return null; }
  });
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let seq = 0;
  const waiting = new Map();
  ws.onmessage = ({ data }) => {
    const reply = JSON.parse(data);
    if (reply.id) { waiting.get(reply.id)?.(reply); waiting.delete(reply.id); }
  };
  const evaluate = async expression => {
    const id = ++seq;
    const reply = new Promise(ok => waiting.set(id, ok));
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    const { result } = await reply;
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await evaluate('(' + function install() {
    const fs = process.getBuiltinModule('fs');
    const counter = globalThis.e1Activity = { opens: 0, watches: 0, live: 0, timers: 0 };
    const isOutput = p => /[/\\]out[/\\]stdout(?:[-.]live)?\.jsonl?$/.test(String(p));
    const open = fs.promises.open;
    fs.promises.open = function(p, ...args) {
      if (isOutput(p)) counter.opens++;
      return open.call(this, p, ...args);
    };
    const watch = fs.watch;
    fs.watch = function(p, ...args) {
      const w = watch.call(this, p, ...args);
      if (isOutput(p)) {
        counter.watches++;
        counter.live++;
        w.once('close', () => counter.live--);
      }
      return w;
    };
    const timer = globalThis.setTimeout;
    globalThis.setTimeout = function(fn, ms, ...args) {
      // 巡检按剩余期限调度，纳入整个区间再按调用栈辨识。
      if (ms >= 0 && ms <= 400 && /\.schedule \(|StdoutTail/.test(new Error().stack)) counter.timers++;
      return timer.call(this, fn, ms, ...args);
    };
  }.toString() + ')()');
  return {
    traceReads: () => evaluate('(' + function installReadTrace() {
      const io = process.getBuiltinModule('fs').promises;
      const log = globalThis.e1CompletedReads = [];
      const open = io.open;
      io.open = async function(p, ...args) {
        const handle = await open.call(this,p,...args);
        if (!/[/\\]out[/\\]stdout\.jsonl?$/.test(String(p))) return handle;
        const original = handle.read;
        handle.read = async function(buf, offset, length, position) {
          const result = await original.call(this,buf,offset,length,position);
          log.push({file:String(p),start:position,end:position+result.bytesRead,at:Date.now()});
          return result;
        };
        return handle;
      };
    }.toString() + ')()'),
    reads: () => evaluate('e1CompletedReads'),
    sample: async () => {
      const r = await evaluate('({ ...e1Activity, pid: process.pid, at: Date.now(), cpu: process.cpuUsage(), rss: process.memoryUsage.rss() })');
      const { stdout } = await exec('python3', ['-c', disk, String(r.pid)]);
      [r.osReadBytes, r.osWrittenBytes] = stdout.trim().split(/\s+/).map(Number);
      return r;
    },
    close: () => ws.close(),
  };
}
