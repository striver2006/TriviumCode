import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../helpers/fixture.js';
import { STDOUT_FILES, STDOUT_INFO } from '../../src/trivium/live-stdout.js';
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
  [STDOUT_INFO]: '仅含身份、计数和受限状态字段，不含厂商正文',
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
  // 不写「躺到整删」：整删只在该仓库自己的会话启动时跑，不再回去就永远不来（BACKLOG EV-166，清扫帮助主句失实计划 r2 §2.4 C6）
  assert.deepEqual(
    missing, [],
    `这些写入 out/ 的文件不在脱敏清单里，模型输出里的凭据会原样留在盘上、不会被脱敏：\n${missing.join('\n')}`,
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

test('独立写入器的 stdout 文件名与适配器、脱敏清单对账', async () => {
  const src = await fs.readFile(path.join(ADAPTERS, '../live-stdout.ts'), 'utf8');
  const names = [...src.matchAll(/['"`]([a-z0-9.-]+\.jsonl?)['"`]/g)].map(m => m[1]!);
  assert.deepEqual([...new Set(names)].sort(), [...STDOUT_FILES, STDOUT_INFO].sort());
  assert.deepEqual(ORCHESTRATOR_LOG_FILES.filter(f => f.startsWith('stdout.')).sort(), [...STDOUT_FILES].sort());
  assert.ok(EXEMPT[STDOUT_INFO]);
});

test('E1 普通重试及作废重跑的历史 stdout 都进入侧层或运行层脱敏计数', async t => {
  const { scratchDir } = await import('../helpers/scratch.js');
  const { ALL_AGENT_IDS } = await import('../../src/trivium/agents/registry.js');
  const { scrubRunDir } = await import('../../src/trivium/scrub.js');
  const dir = await scratchDir('trivium-e1-scrub-');
  t.after(() => fs.rm(dir, { force:true, recursive:true }));
  const id = ALL_AGENT_IDS[0]!;
  const normal = path.join(id, 'out','attempt-1','stdout.jsonl');
  const moved = path.join('voided', id, 'attempt-2','attempt-1','stdout.jsonl');
  const marker = ['sk-', 'SyntheticMarkerOnly', 'abcdefg'].join('');
  for (const rel of [normal, moved]) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive:true });
    await fs.writeFile(path.join(dir, rel), marker);
  }
  const result = await scrubRunDir(dir, () => undefined);
  assert.equal(result.sides[id]?.logs_redacted[path.relative(id, normal)], 1);
  assert.equal(result.runDir.redacted[moved], 1);
  for (const rel of [normal,moved]) assert.equal((await fs.readFile(path.join(dir,rel),'utf8')).includes(marker), false);
});
