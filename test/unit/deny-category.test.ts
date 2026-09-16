/**
 * 禁读集的四类分档与具名放行（设计 §10.1.1，2026-09-16）。
 *
 * ## 这组用例守什么
 *
 * 分档之前，禁读集里四类性质完全不同的对象共用一个布尔位与一句「该侧结论作废」：
 * 对端审查件、运行根下的输出、编排器状态目录、凭据文件。
 * **四次实测命中全部落在编排器状态目录那一类**——审查员读了自己的护栏配置
 * 或列了目录，与背靠背独立性毫无关系，却按泄漏对端产物处置，
 * 其中两次审查员还专门写了披露说明自己不是有意的。
 *
 * 分档要同时作用在**两条判定通道**与**三个消费面**上，缺一即制造新的错位。
 * 本文件守判定侧；BRIEF 文案在 `brief.test.ts`，渲染面在 `render.test.ts`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  classifyDenyPath,
  isVoidingCategory,
  isOrchestratorReadable,
  ORCHESTRATOR_READABLE,
} from '../../src/trivium/freeze.js';

const ROOT = '/proj';
const TRIVIUM = path.join(ROOT, '.trivium');
const RUN_ROOT = '/home/me/.trivium/runs';
const CTX = {
  projectRoot: ROOT,
  triviumDir: TRIVIUM,
  runRoot: RUN_ROOT,
  critic: 'gemini' as const,
  sensitiveGlobs: ['.env*', '**/*.pem'],
};

test('分类：对端审查件属「会作废」的那一档', () => {
  const c = classifyDenyPath('.reviews/topic/plan/2026-01-01-topic-glm.md', CTX);
  assert.equal(c, 'peer-artifact');
  assert.equal(isVoidingCategory(c), true);
});

test('分类：编排器状态目录不作废——四次实测误伤全在这一类', () => {
  for (const p of ['.trivium/state.json', '.trivium/lock/x.lock']) {
    const c = classifyDenyPath(p, CTX);
    assert.equal(c, 'orchestrator-state', `${p} 应属编排器状态`);
    assert.equal(isVoidingCategory(c), false, `${p} 读了不该让审查作废`);
  }
});

test('分类：凭据文件不作废，但走安全告警线', () => {
  const c = classifyDenyPath('.env.local', CTX);
  assert.equal(c, 'sensitive');
  assert.equal(isVoidingCategory(c), false, '读凭据是安全问题，不是独立性问题——两者处置不同');
});

/*
 * ── 运行根是混合树，这是本组最要紧的一条 ──
 *
 * 那棵树里既有对端本轮的原始输出，也有审查员**自己**的 sandbox home、
 * 请求文件与工作日志。按整棵前缀匹配，「读自己的运行目录」会被判成泄漏对端产物
 * ——把误伤换个地方制造一次。2026-09-16 的计划双审里，一侧审查员以第一手证据
 * 指出这点：它自己的进程就跑在那棵被禁的树下。
 */
test('分类：运行根下**对端**的输出会作废', () => {
  const c = classifyDenyPath(`${RUN_ROOT}/proj-abc/20260101T000000Z/glm/out/stdout.json`, CTX);
  assert.equal(c, 'peer-run-output');
  assert.equal(isVoidingCategory(c), true);
});

test('分类：运行根下**己方**的运行时材料不作废（混合树的关键一格）', () => {
  for (const p of [
    `${RUN_ROOT}/proj-abc/20260101T000000Z/gemini/out/trace.json`,
    `${RUN_ROOT}/proj-abc/20260101T000000Z/gemini/home/.cache/x`,
  ]) {
    const c = classifyDenyPath(p, CTX);
    assert.equal(c, 'own-run-material', `${p} 是审查员自己的东西`);
    assert.equal(
      isVoidingCategory(c),
      false,
      '读自己的运行目录不损害任何独立性——判它作废就是把误伤换个地方制造一次',
    );
  }
});

test('分类：运行根下段数不足时按对端处置（保守方向）', () => {
  /*
   * 只读到 runId 那一层，分辨不出是谁的。宁可多判一次作废让人来纠，
   * 也不要放过真的读了对端输出——方向必须是保守的。
   */
  const c = classifyDenyPath(`${RUN_ROOT}/proj-abc/20260101T000000Z`, CTX);
  assert.equal(c, 'peer-run-output');
});

test('具名放行：共享配置与 wrapper 可读，同目录其余条目仍挡', () => {
  const opts = { projectRoot: ROOT, triviumDir: TRIVIUM };
  assert.equal(isOrchestratorReadable('.trivium/config.yaml', opts), true);
  assert.equal(isOrchestratorReadable('.trivium/bin/trivium', opts), true);

  assert.equal(
    isOrchestratorReadable('.trivium/config.local.yaml', opts),
    false,
    '本机覆盖不放行：探针结论在里面，含本机绝对路径与 provider 端点，' +
      '而默认 sensitive_globs 的形态挡不住它',
  );
  assert.equal(isOrchestratorReadable('.trivium/state.json', opts), false);
  assert.equal(isOrchestratorReadable('.trivium/lock/x.lock', opts), false);
});

test('具名放行：项目外与归档内的路径一律不放行', () => {
  const opts = { projectRoot: ROOT, triviumDir: TRIVIUM };
  assert.equal(isOrchestratorReadable('.reviews/t/plan/x-glm.md', opts), false);
  assert.equal(isOrchestratorReadable('/etc/passwd', opts), false);
  assert.equal(
    isOrchestratorReadable(`${RUN_ROOT}/proj/run/glm/out.json`, opts),
    false,
    '运行根不在编排器状态目录之下，放行清单管不到它',
  );
});

test('放行清单只有两项——变长就是又开了一个口子', () => {
  /*
   * 这条不是形式主义：放行清单每多一项，审查员能看到的编排器内部状态就多一分。
   * 要加项时请先回答：审查员为什么需要它、不给会让什么审查做不了。
   * 改这个断言的数字比改清单本身更该引起注意。
   */
  assert.deepEqual([...ORCHESTRATOR_READABLE].sort(), ['bin', 'config.yaml']);
});
