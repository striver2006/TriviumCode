// W4-S3 复测的 headless claude 会话驱动器（网关 env + CLAUDE_CODE_GIT_BASH_PATH 进程级注入）
// 用法：node w4s3_harness.js <cwd> <tools> <输出jsonl路径> <提示词>
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const [cwd, tools, outFile, prompt] = process.argv.slice(2);
const bashPath = path.join('D:', 'Program Files', 'Git', 'bin', 'bash.exe');
const settings = JSON.parse(fs.readFileSync('C:/Users/k_bo/.claude/settings.json', 'utf8'));
const env = { ...process.env, ...settings.env, CLAUDE_CODE_GIT_BASH_PATH: bashPath };

const r = spawnSync('C:/Users/k_bo/.local/bin/claude.exe', [
  '--print', '--output-format', 'stream-json', '--verbose',
  '--permission-mode', 'acceptEdits',
  '--tools', tools,
  '-p', prompt,
], { cwd, env, encoding: 'utf8', timeout: 240000, maxBuffer: 64 * 1024 * 1024 });

fs.writeFileSync(outFile, r.stdout || '');
fs.writeFileSync(outFile.replace(/\.jsonl$/, '') + '.exit.txt', `exit=${r.status}\n`);
console.log(`exit=${r.status} bytes=${(r.stdout || '').length} -> ${outFile}`);
