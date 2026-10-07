#!/usr/bin/env node
// 补跑 codex 非法 effort 一格，只抽错误原因行。用法：node 本文件 〈仓库根〉 〈证据目录〉 〈临时根〉
import { promises as fs } from 'node:fs';
import path from 'node:path';

const [root, outDir, tmpBase] = process.argv.slice(2).map((p) => path.resolve(p));
const D = (p) => path.join(root, 'dist/test/src/trivium', p);
const P = await import(D('probes/codex.js'));
const H = await import(D('adapters/codex-home.js'));
const A = await import(D('adapters/codex.js'));
const { bin } = await P.probeCodexBin(null);
// 凭据形态打码：sk- 开头的串、32 位以上的连续字母数字
const redact = (s) => s.replace(/sk-[A-Za-z0-9_-]+/g, 'sk-〈打码〉').replace(/[A-Za-z0-9_-]{32,}/g, '〈长串打码〉');
const tmp = await fs.mkdtemp(path.join(tmpBase, 'trivium-m11probe-'));
const workdir = path.join(tmp, 'work');
await fs.mkdir(workdir);
let rec;
try {
  const prep = await H.prepareCodexHome(tmp, { profile: 'kimi', projectRoot: workdir });
  const o = await A.invokeCodex({
    bin, cwd: workdir, prompt: 'Reply with exactly one word: OK.',
    profile: 'kimi', model: 'kimi-for-coding', effort: 'bogus',
    readonlyArgs: ['-s', 'read-only'], codexHome: prep.codexHome, fakeHome: prep.fakeHome, timeoutMs: 120_000,
  });
  const pickLines = (s) => s.split('\n').filter((l) => /effort|invalid|error|unknown|unsupported|variant/i.test(l)).map((l) => redact(l).slice(0, 240)).slice(0, 6);
  rec = { id: 'k3-rerun', exit_code: o.exitCode, stderr_reason: pickLines(o.stderr), stdout_reason: pickLines(o.stdout) };
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}
console.log(JSON.stringify(rec, null, 2));
await fs.writeFile(path.join(outDir, 'codex-bogus-effort-reason.json'), JSON.stringify(rec, null, 2) + '\n');
