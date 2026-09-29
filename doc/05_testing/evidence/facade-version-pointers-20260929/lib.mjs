// 本目录证据脚本的共用前提与读回调（EV-167，计划 r2 §5.4「前提」段）。
//
// 前提（缺一条就退 2 并报「环境前提不满足」，与判据问题区分）：
//   ① 起点提交 79d2ed4 在本地对象库里（浅克隆 / 部分克隆 / git archive 导出的树都没有）；
//   ② 测试构建产物 dist/test/test/helpers/facade-pointers.js 已存在（先 node scripts/build.mjs --tests-only）。
// git 调用一律带 -c core.quotePath=false（中文路径）。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BASE = '79d2ed4';
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../../../..');
export const HELPER = path.join(ROOT, 'dist/test/test/helpers/facade-pointers.js');
export const TEST_JS = path.join(ROOT, 'dist/test/test/contract/facade-version-pointers.test.js');

export function git(args, opts = {}) {
  return execFileSync('git', ['-C', ROOT, '-c', 'core.quotePath=false', ...args], { encoding: 'utf8', maxBuffer: 64 << 20, ...opts });
}

export function checkPrereqs() {
  const missing = [];
  try {
    git(['cat-file', '-e', `${BASE}^{commit}`], { stdio: ['ignore', 'ignore', 'ignore'] });
  } catch {
    missing.push(`起点提交 ${BASE} 不在本地对象库`);
  }
  if (!existsSync(path.join(ROOT, 'package.json'))) missing.push(`仓库根定位失败：${ROOT}`);
  if (!existsSync(HELPER)) missing.push(`测试构建产物缺失：${path.relative(ROOT, HELPER)}（先 node scripts/build.mjs --tests-only）`);
  if (missing.length) {
    console.error(`环境前提不满足：\n  - ${missing.join('\n  - ')}`);
    process.exit(2);
  }
}

export async function loadHelper() {
  return import(pathToFileURL(HELPER).href);
}

/** 读起点提交里的文件；不存在返回 null */
export function baseRead() {
  const cache = new Map();
  return (rel) => {
    if (!cache.has(rel)) {
      try {
        cache.set(rel, git(['show', `${BASE}:${rel}`], { stdio: ['ignore', 'pipe', 'ignore'] }));
      } catch {
        cache.set(rel, null);
      }
    }
    return cache.get(rel);
  };
}

/** 起点提交的候选路径：全部已跟踪文件 */
export function baseCandidates() {
  return git(['ls-tree', '-r', '--name-only', BASE]).split('\n').filter(Boolean);
}

/** 读工作树文件；不存在返回 null */
export function worktreeRead(rel) {
  try {
    return readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    return null;
  }
}

/** 工作树的候选路径：直接调助手的 facadeCandidates，与契约测试同一份实现（代码双审 r1 CODEX-05） */
export function worktreeCandidates(helper) {
  return helper.facadeCandidates({
    exists: (rel) => existsSync(path.join(ROOT, rel)),
    readdir: (rel) => readdirSync(path.join(ROOT, rel), { withFileTypes: true }),
  });
}
