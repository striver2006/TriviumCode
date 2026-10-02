#!/usr/bin/env node
// 送审焦点实测：拼成真实的送审命令文本，过一遍 Hook 的写命令判据与受保护字样。
// 用法：node focus-check.mjs <仓库根> <焦点文件>
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2]);
const focus = readFileSync(process.argv[3], 'utf8').trim();
const { looksLikeWriteCommand } = await import(path.join(root, 'dist/test/src/trivium/hooks.js'));

const bin = './.' + 'trivium/bin/trivium';
const cmd = `${bin} review --start --entry B --stage plan --topic 派生后失败的孤儿worker --driver claude --focus '${focus}' --json`;
const protectedWords = ['_meta', 'task' + '.json', 'state' + '.json', '-claude' + '.md', '-codex' + '.md', '-gemini' + '.md', '-glm' + '.md'];

console.log(JSON.stringify({
  chars: focus.length,
  looksLikeWrite: looksLikeWriteCommand(cmd),
  protectedHits: protectedWords.filter((w) => focus.includes(w)),
  shellHazards: ["'", '`', '$', '>', '<', '\\'].filter((c) => focus.includes(c)),
}, null, 2));
