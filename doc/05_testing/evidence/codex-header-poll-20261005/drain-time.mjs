// 实测「调用返回后多久进程能自然退出」，不设上限（新旧构建各跑一次，给报告用；零配额）。
// 用法：node drain-time.mjs <构建产物 codex.js 的路径> <私有目录>
// 私有目录里写一个不打 header、退 2 的假 codex；本脚本只在该目录里写文件、不删任何东西。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const codexJs = path.resolve(process.argv[2]);
const dir = path.resolve(process.argv[3]);
fs.mkdirSync(dir, { recursive: true });
const fake = path.join(dir, 'codex');
fs.writeFileSync(
  fake,
  `#!${process.execPath}\nrequire('node:fs').writeSync(2, 'error: unknown profile\\n');\nprocess.exit(2);\n`,
  { mode: 0o755 },
);
const drain = path.join(dir, 'drain.mjs');
fs.writeFileSync(
  drain,
  [
    "import fs from 'node:fs';",
    'const { probeCodexHeader } = await import(process.env.CODEX_JS_URL);',
    'const r = await probeCodexHeader(process.env.FAKE_BIN, [], process.env.PROBE_CWD);',
    "fs.writeSync(1, 'RETURNED ' + JSON.stringify({ exitCode: r.exitCode, gotHeader: r.gotHeader }) + '\\n');",
  ].join('\n'),
);
const env = { ...process.env, FAKE_BIN: fake, PROBE_CWD: dir, CODEX_JS_URL: pathToFileURL(codexJs).href };
delete env.NODE_TEST_CONTEXT;
const t0 = Date.now();
let t1 = null;
const child = spawn(process.execPath, [drain], { cwd: dir, env, stdio: ['ignore', 'pipe', 'inherit'] });
child.stdout.setEncoding('utf8');
child.stdout.on('data', (d) => {
  if (t1 === null && d.includes('RETURNED')) t1 = Date.now();
  process.stdout.write(d);
});
child.on('exit', (code) => {
  const t2 = Date.now();
  console.log(JSON.stringify({ codexJs, callMs: t1 - t0, drainMs: t2 - t1, childExit: code }));
});
