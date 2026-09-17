import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../helpers/fixture.js';
import { ORCHESTRATOR_LOG_FILES } from '../../src/trivium/scrub.js';

/**
 * 编排器日志脱敏清单与适配器写入点对账（EV-20；代码双审 r1 GLM-01）。
 *
 * `scrub.ts` 的 `ORCHESTRATOR_LOG_FILES` 是手抄的：哪几份原始日志会写进 `<侧>/out/`，
 * 写入点在各适配器里。手抄第一次就漏了 zcode 拷进去的 `rollout.jsonl`——同一份模型 I/O，
 * home/ 下的原件被处理、out/ 的副本原样躺 30 天。与 `run-files-parity` 同一形态的教训：
 * 写入点与判定点之间没有机器联系，改一漏二不会报错。
 *
 * 判据：`src/trivium/adapters/*.ts` 里每个 `path.join(req.out_dir, '<字面量>')` 的字面量
 * 都必须在清单里。桩适配器例外（它写的 result.json 是测试夹具，不进真实运行）。
 */
const ADAPTERS = path.join(REPO_ROOT, 'src/trivium/adapters');

/** 不是原始日志、刻意不进脱敏清单的写入物，逐条写理由 */
const EXEMPT: Record<string, string> = {
  'result.json': '桩适配器的测试产物，只在 selftest / 集成夹具里出现',
};

/**
 * 写入点的字面量：单引号、双引号、无插值模板串都认。
 * 只认一种写法的话，换个引号就静默退出论域（代码双审 r2 AGY-05）。
 */
const WRITE_TO_OUT_DIR = /path\.join\(\s*req\.out_dir\s*,\s*(?:'([^']+)'|"([^"]+)"|`([^`$]+)`)\s*\)/g;

test('适配器写进 out/ 的每份原始日志都在 ORCHESTRATOR_LOG_FILES 里', async () => {
  const files = (await fs.readdir(ADAPTERS)).filter((f) => f.endsWith('.ts'));
  const missing: string[] = [];
  for (const f of files) {
    const src = await fs.readFile(path.join(ADAPTERS, f), 'utf8');
    for (const m of src.matchAll(WRITE_TO_OUT_DIR)) {
      const name = (m[1] ?? m[2] ?? m[3])!;
      if (EXEMPT[name]) continue;
      if (!ORCHESTRATOR_LOG_FILES.includes(name)) missing.push(`${f}: ${name}`);
    }
  }
  assert.deepEqual(
    missing, [],
    `这些写入 out/ 的文件不在脱敏清单里，模型输出里的凭据会随它们躺到整删：\n${missing.join('\n')}`,
  );
});

test('补丁与 BRIEF 两个落点共用一套扫描判据（CODEX-07）', async () => {
  /*
   * BRIEF 把补丁节选逐字嵌在散文里。只给补丁放宽而不给 BRIEF，拒绝点只是从
   * `_meta/changes-*.diff` 搬到 `_meta/brief-*.md`——而且那时补丁已经落盘，留半套工件。
   * 判据只能扫源码：两处落盘都在 `executeRun` 里，起一次真实运行的代价太大。
   */
  const src = await fs.readFile(path.join(REPO_ROOT, 'src/trivium/review.ts'), 'utf8');
  const calls = [...src.matchAll(/writeMeta\(\s*ref\.layout,\s*stage,\s*([^,]+),\s*([^,)]+)(?:,\s*\{([^}]*)\})?\s*\)/g)];
  const briefCall = calls.find((m) => /b\.fileName/.test(m[1]!));
  assert.ok(briefCall, '没找到 BRIEF 的落盘调用——判据失效了，先修判据');
  assert.match(
    briefCall![3] ?? '', /scan:\s*'added-lines'/,
    'BRIEF 落盘必须与补丁同口径：否则动一下密钥夹具文件，拒绝点从补丁搬到 BRIEF',
  );
  const diffCalls = calls.filter((m) => /pendingDiff\.fileName|'changes\.diff'/.test(m[1]!));
  assert.equal(diffCalls.length, 2, '补丁与它的人读别名各一处');
  for (const c of diffCalls) assert.match(c[3] ?? '', /scan:\s*'added-lines'/);
});

test('清单里没有死条目：每一项都有适配器在写', async () => {
  const files = (await fs.readdir(ADAPTERS)).filter((f) => f.endsWith('.ts'));
  const written = new Set<string>();
  for (const f of files) {
    const src = await fs.readFile(path.join(ADAPTERS, f), 'utf8');
    for (const m of src.matchAll(WRITE_TO_OUT_DIR)) written.add((m[1] ?? m[2] ?? m[3])!);
  }
  const dead = ORCHESTRATOR_LOG_FILES.filter((n) => !written.has(n));
  assert.deepEqual(dead, [], `清单登记了却没人写：${dead.join('、')}`);
});
