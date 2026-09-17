import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../helpers/fixture.js';
import { scanSecrets } from '../../src/trivium/secrets.js';

/**
 * 仓库源码里**不得出现完整形态的凭据**——哪怕是编造的（代码双审 r2 CODEX-09 ≡ AGY-07）。
 *
 * 测试密钥扫描器需要与真凭据同形的夹具，但夹具写成静态字面量有两个后果：
 *
 * - 审查员逐字读到它、把其中一段摘进结论，那份审查文档就被归档闸拒绝落盘，整轮审查作废
 *   （本主题 code 阶段 r2 就是这么没的）；
 * - 它作为补丁的上下文行永久存在，而补丁按新增行扫，于是它对补丁闸**永久隐形**——
 *   「测试夹具必须拼接」这条约定反而失去了唯一的自动反馈。
 *
 * 约定是「运行时拼接、静态文本里不出现完整形态」；这条用例把它从人的记性换成会红的判据，
 * 与 `boolean-flags-parity`、`orchestrator-logs-parity` 同一手法（AGENTS.md 纪律 12）。
 *
 * **真出现命中时不要把文件加进豁免**：正确的修法是把那段夹具拆成 `[...].join('')`。
 */
const ROOTS = ['src', 'test', 'scripts'];
/** 不扫：不是源码，或本身就是被扫对象的产物 */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'fixtures']);
const EXTS = new Set(['.ts', '.js', '.mjs', '.cjs', '.json']);

async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) await walk(abs, out);
    else if (EXTS.has(path.extname(e.name))) out.push(abs);
  }
}

test('源码与测试里没有完整形态的凭据字面量（夹具一律运行时拼接）', async () => {
  const files: string[] = [];
  for (const r of ROOTS) await walk(path.join(REPO_ROOT, r), files);
  assert.ok(files.length > 100, `前提：确实扫到了源码，实得 ${files.length} 个文件`);

  const hits: string[] = [];
  for (const f of files) {
    const text = await fs.readFile(f, 'utf8');
    for (const h of scanSecrets(text)) {
      hits.push(`${path.relative(REPO_ROOT, f)}:${h.line} [${h.rule}] ${h.preview}`);
    }
  }
  assert.deepEqual(
    hits, [],
    '这些位置有完整形态的凭据。若是测试夹具，改成分段拼接（如 [\'sk-\', \'ant-…\'].join(\'\')）；' +
      `若是真凭据，立刻轮换并从历史里清除：\n${hits.join('\n')}`,
  );
});
