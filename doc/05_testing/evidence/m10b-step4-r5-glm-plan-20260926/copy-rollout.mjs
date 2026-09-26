#!/usr/bin/env node
/**
 * 3-5 轮 J4 载体证据的节点拷贝（r10 §4.1 第 2 条）：只读 `~/.zcode/cli/rollout/`，只写本目录。
 *
 *   node copy-rollout.mjs <节点标签>        # 标签：1-draft / 2-started / 3-disposition / 4-session-end / 0-baseline
 *
 * 做两件事：
 *   · 把目录里**全部** `model-io-sess_*.jsonl`（含 `model-io-sess_subagent_*`）原样拷进 `rollout-raw/<标签>/`——
 *     原件**不入仓**（r10 §4.1 第 5 条只收摘录），只作本机留底，摘录另由 extract 生成；
 *   · 在 `05-rollout-nodes.json` 追加一条：每份文件的名字、字节数、sha256、修改时间，以及是否晚于夹具搭建时刻。
 *
 * 不跑任何 zcode 调用；不删除任何东西（R1 / R8）。rollout 目录只留最近 3 个会话（第 1 步报告 §3.4 3′），所以要在节点当场拷。
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2];
if (!label) {
  console.error('用法：node copy-rollout.mjs <节点标签>');
  process.exit(64);
}
const SRC = path.join(os.homedir(), '.zcode/cli/rollout');
const setupAt = JSON.parse(await fs.readFile(path.join(HERE, '01-setup-readout.json'), 'utf8')).at;

const names = (await fs.readdir(SRC)).filter((n) => /^model-io-sess_.*\.jsonl$/.test(n)).sort();
const dst = path.join(HERE, 'rollout-raw', label);
await fs.mkdir(dst, { recursive: true });
const files = [];
for (const n of names) {
  const p = path.join(SRC, n);
  const buf = await fs.readFile(p);
  const st = await fs.stat(p);
  await fs.writeFile(path.join(dst, n), buf);
  files.push({
    name: n,
    subagent: n.startsWith('model-io-sess_subagent_'),
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
    mtime: st.mtime.toISOString(),
    after_setup: st.mtime.toISOString() > setupAt,
  });
}

const logPath = path.join(HERE, '05-rollout-nodes.json');
let nodes = [];
try {
  nodes = JSON.parse(await fs.readFile(logPath, 'utf8'));
} catch {
  nodes = [];
}
nodes.push({ label, at: new Date().toISOString(), setup_at: setupAt, files });
await fs.writeFile(logPath, JSON.stringify(nodes, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ label, files: files.map((f) => `${f.name} ${f.bytes}B after_setup=${f.after_setup}`) }, null, 2));
