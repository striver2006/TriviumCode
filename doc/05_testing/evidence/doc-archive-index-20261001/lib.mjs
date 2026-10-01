// 本目录证据脚本的共用前提与读法（EV-172，计划 `.reviews/测试报告索引补齐/plan/` r2 §3.0、§5）。
//
// 前提（缺一条就退 2 并报「环境前提不满足」，与判据失败的退 1 区分）：
//   ① 起点提交 466bb59 在本地对象库里（浅克隆 / 部分克隆 / git archive 导出的树都没有，此时退 2）；
//   ② 测试构建产物与源码同批：checkPrereqs 自己先跑一次 `node scripts/build.mjs --tests-only`，不靠 mtime 判新鲜度
//      （代码双审 CODEX-06）；
//   ③ 仓库根定位成功。
// git 调用一律带 -c core.quotePath=false（中文文件名，计划双审 CODEX-01）。
// 子进程一律带超时（代码双审 CODEX-07）：git 60 s、重编 120 s；超时按退 2 报，不让读回调把超时吞成「文件不存在」。
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BASE = '466bb59';
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../../../..');
export const HELPER = path.join(ROOT, 'dist/test/test/helpers/doc-archive-index.js');
export const TEST_JS = path.join(ROOT, 'dist/test/test/contract/doc-archive-index.test.js');

const GIT_TIMEOUT_MS = 60_000;
const BUILD_TIMEOUT_MS = 120_000;

/** 子进程因超时被结束 */
export function isTimeout(e) {
  return e?.code === 'ETIMEDOUT' || (e?.signal != null && e?.status == null);
}

/** 环境问题：报出来并退 2 */
export function fatalEnv(msg) {
  console.error(`环境前提不满足：${msg}`);
  process.exit(2);
}

export function git(args, opts = {}) {
  return execFileSync('git', ['-C', ROOT, '-c', 'core.quotePath=false', ...args], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: GIT_TIMEOUT_MS, ...opts });
}

export function checkPrereqs() {
  const missing = [];
  if (!existsSync(path.join(ROOT, 'package.json'))) missing.push(`仓库根定位失败：${ROOT}`);
  try {
    git(['cat-file', '-e', `${BASE}^{commit}`], { stdio: ['ignore', 'ignore', 'ignore'] });
  } catch (e) {
    missing.push(isTimeout(e) ? `git 超时（${GIT_TIMEOUT_MS} ms）` : `起点提交 ${BASE} 不在本地对象库（浅克隆或部分克隆？）`);
  }
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/build.mjs'), '--tests-only'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: BUILD_TIMEOUT_MS });
  } catch (e) {
    missing.push(isTimeout(e) ? `测试构建超时（${BUILD_TIMEOUT_MS} ms）` : `测试构建失败：${String(e.stderr ?? e.message).slice(0, 500)}`);
  }
  for (const js of [HELPER, TEST_JS]) {
    if (!existsSync(js)) missing.push(`测试构建产物缺失：${path.relative(ROOT, js)}`);
  }
  if (missing.length) fatalEnv(`\n  - ${missing.join('\n  - ')}`);
}

export async function loadHelper() {
  return import(pathToFileURL(HELPER).href);
}

/**
 * 某个提交上的 IndexIO（计划 r2 §3.0 的 git 实现）：`list` / `kind` 由不带 -r 的逐层 `ls-tree <提交>:<目录>` 求得，
 * 100644 / 100755 ⇒ file、040000 ⇒ dir、其余（120000 软链、160000 子模块）⇒ other。
 */
export function gitIO(ref) {
  const trees = new Map();
  const tree = (dir) => {
    if (!trees.has(dir)) {
      let m = null;
      try {
        const out = git(['ls-tree', '-z', `${ref}:${dir}`], { stdio: ['ignore', 'pipe', 'ignore'] });
        m = new Map();
        for (const rec of out.split('\0').filter(Boolean)) {
          const tab = rec.indexOf('\t');
          const mode = rec.slice(0, rec.indexOf(' '));
          m.set(rec.slice(tab + 1), mode === '100644' || mode === '100755' ? 'file' : mode === '040000' ? 'dir' : 'other');
        }
      } catch (e) {
        if (isTimeout(e)) fatalEnv(`git ls-tree ${ref}:${dir} 超时（${GIT_TIMEOUT_MS} ms）`);
        m = null;
      }
      trees.set(dir, m);
    }
    return trees.get(dir);
  };
  const reads = new Map();
  return {
    read(rel) {
      if (!reads.has(rel)) {
        try {
          reads.set(rel, git(['show', `${ref}:${rel}`], { stdio: ['ignore', 'pipe', 'ignore'] }));
        } catch (e) {
          if (isTimeout(e)) fatalEnv(`git show ${ref}:${rel} 超时（${GIT_TIMEOUT_MS} ms）`);
          reads.set(rel, null);
        }
      }
      return reads.get(rel);
    },
    list(rel) {
      const t = tree(rel);
      return t ? [...t.keys()] : null;
    },
    kind(rel) {
      if (rel === '' || rel === '.') return 'dir';
      if (rel.startsWith('../') || rel === '..') return null;
      const parent = path.posix.dirname(rel);
      const t = tree(parent === '.' ? '' : parent);
      return t?.get(path.posix.basename(rel)) ?? null;
    },
  };
}

/** 对一个 IndexIO 跑全套判定：论域、下限、各 README 的覆盖 / 悬空 / 顺序 */
export function runAll(h, io) {
  const domain = h.indexedReadmes(io);
  const perReadme = {};
  for (const r of domain) perReadme[r] = [...h.checkIndex(r, io), ...h.checkOrder(r, io)];
  return { domain, domainProblems: h.checkDomain(domain), perReadme };
}
