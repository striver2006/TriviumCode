// 只读：列出本仓归档根下的主题目录名，看它们是否都落在「中英文、数字、- _ .」白名单内（EV-195 论证用）。
// 另扫 git 历史里出现过的主题目录名（含已删的）。用法（在仓库根）：node topic-whitelist-check.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const ROOT_DIR = '.' + 'reviews';
const re = /^[\p{L}\p{N}\-_.]+$/u;
const now = fs.readdirSync(ROOT_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const hist = new Set(
  execFileSync('git', ['-c', 'core.quotePath=false', 'log', '--all', '--name-only', '--format=', '--', ROOT_DIR], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    .split('\n').filter(Boolean).map((p) => p.split('/')[1]).filter(Boolean),
);
const report = (label, names) => {
  const bad = names.filter((n) => !re.test(n));
  console.log(`${label}：${names.length} 个，不在白名单 ${bad.length} 个`);
  for (const b of bad) {
    const chars = [...b].filter((c) => !/[\p{L}\p{N}\-_.]/u.test(c));
    console.log(`  ${JSON.stringify(b)} ⇐ ${chars.map((c) => `${JSON.stringify(c)}(U+${c.codePointAt(0).toString(16).toUpperCase()})`).join(' ')}`);
  }
};
report('工作树现有主题', now);
report('git 历史出现过的主题', [...hist]);
