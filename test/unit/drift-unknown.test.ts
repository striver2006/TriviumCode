/**
 * EV-139「漂移比不了不放行」：`unknown` 结论在人读面上的落点与桩的自缚（计划 r2 §5.1 G1～G3、S1）。
 *
 * 判定本身（`judgeDrift` / `classifyCompareFailure` / `driftAction`）在 `freeze-drift.test.ts`；
 * schema 契约在 `run-meta-strict.test.ts`；跨进程端到端在 `fault-injection.test.ts`。
 * 这里只钉「比不了」被说出来、说清楚、不与「无漂移」或「漂移 0 个文件」同形。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { renderGuardWarnings, type RunVerdict } from '../../src/trivium/guard.js';
import { renderReviewDoc, parseFrontMatter, type RenderInput } from '../../src/trivium/render.js';
import { newRunMeta, summarizeRun } from '../../src/trivium/meta.js';
import { makeStubAdapter } from '../../src/trivium/adapters/stub.js';
import type { AdapterContext } from '../../src/trivium/adapters/base.js';
import {
  CRITICS, DRIFT_UNKNOWN_CAUSES, DRIFT_UNKNOWN_LABEL, describeDriftUnknown,
  type CriticRequest, type CriticResult, type DriftUnknownReason,
} from '../../src/trivium/types.js';

function verdict(u: DriftUnknownReason, action: 'warn' | 'fail'): RunVerdict {
  return {
    sides: {},
    drift: { kind: 'unknown', ...u },
    driftAction: action,
    fingerprintChangedFiles: [],
    unattributedDriftFiles: [],
    readonlyBreach: false,
    breachedFiles: [],
    peerArtifactRead: false,
  };
}

const GONE: DriftUnknownReason = { cause: 'object_gone', detail: '送审快照的 tree 0123456789ab 在审查期间被清理' };

test('EV-139 G1：比不了 + fail ⇒ 告警说清原因、策略与出口（含改 warn 的连带影响），不冒充相关或无关漂移', () => {
  const w = renderGuardWarnings(verdict(GONE, 'fail')).join('\n');
  assert.match(w, /审查期间工作树有变动，但比不了改了哪些文件/);
  assert.ok(w.includes(describeDriftUnknown(GONE)), w);
  assert.match(w, /按 on_drift_related 处置（策略 fail）/);
  assert.match(w, /本轮不能当作有效审查/);
  assert.match(w, /重跑本阶段审查/);
  assert.match(w, /git prune、git gc --prune=now/);
  assert.match(w, /放宽真实的相关漂移/);
  assert.doesNotMatch(w, /无关文件被修改|与被审范围相关的文件在审查期间被修改/);
});

test('EV-139 G2：比不了 + warn ⇒ 照常结束但请人工核对，不说「不能当作有效审查」', () => {
  const w = renderGuardWarnings(verdict(GONE, 'warn')).join('\n');
  assert.match(w, /按 on_drift_related 处置（策略 warn）/);
  assert.match(w, /本轮照常结束，但漂移是否涉及被审范围无从判断，请人工核对/);
  assert.doesNotMatch(w, /不能当作有效审查/);
});

test('EV-139 G3：三种原因的标签各不相同、来自同一张表；排版里同一短语不出现两次', () => {
  const labels = DRIFT_UNKNOWN_CAUSES.map((c) => DRIFT_UNKNOWN_LABEL[c]);
  assert.equal(new Set(labels).size, DRIFT_UNKNOWN_CAUSES.length, `标签重复：${labels.join(' / ')}`);
  const samples: DriftUnknownReason[] = [
    GONE,
    { cause: 'git_error', detail: 'git diff-tree 失败（退出码 128）：fatal: bad object deadbeef' },
    { cause: 'timeout', detail: 'git diff-tree 未在 120 s 内结束' },
  ];
  for (const u of samples) {
    const s = describeDriftUnknown(u);
    assert.equal(s, `${DRIFT_UNKNOWN_LABEL[u.cause]}：${u.detail}`);
    // 标签只写类别、detail 只写事实：标签整体不该再在 detail 里出现一次（AGY-03 的套叠）
    assert.ok(!u.detail.includes(DRIFT_UNKNOWN_LABEL[u.cause]), `套叠：${s}`);
    const w = renderGuardWarnings(verdict(u, 'fail')).join('\n');
    assert.ok(w.includes(s), `${u.cause} 的告警没带排版好的原因：${w}`);
  }
  // 读侧守单行（代码双审 CODEX-03）：人工改过的 run.json 带多行 detail，排版只出首行
  assert.equal(
    describeDriftUnknown({ cause: 'git_error', detail: '首行事实\n第二行不该出现' }),
    `${DRIFT_UNKNOWN_LABEL.git_error}：首行事实`,
  );
});

const RESULT: CriticResult = {
  critic: 'gemini', status: 'ok', exit_code: 0, duration_s: 10,
  raw_stdout_path: '/runs/out', trace_path: '/runs/trace', review_json: null,
  raw_response_text: '{}', model_effective: 'gemini-x',
  model_effective_source: 'envelope', model_provider: null, profile_requested: null,
  tool_calls: { read: 9 },
  read_paths: [], search_hit_paths: null, write_events: [], command_texts: [], evidence_ok: true, fail_reason: null,
  session_id: 's', cli_version: '1.0', peer_deny_applied: false,
  deny_skipped: 0, deny_rule_count: 0, deny_bytes: 0,
  command_line: 'agy -p …',
};

function renderInput(over: Partial<RenderInput> = {}): RenderInput {
  return {
    critic: 'gemini', stage: 'plan', topic: '漂移', runId: '20261001T000000Z',
    rerunIndex: 1, review: null, rawText: '{}', result: RESULT,
    modelRequested: 'gemini-x', effort: 'high',
    snapshotHash: 'sha256:00', startedAt: '2026-10-01T00:00:00Z',
    finishedAt: '2026-10-01T00:10:00Z', evidenceOk: true, projectReads: 5,
    selectedCritics: CRITICS,
    degraded: false, drift: true, peerDeny: true, consultedUnverified: false,
    heterogeneous: true, ...over,
  };
}

test('EV-139 R1：审查文档旗标换成「漂移无法判定」并带原因；front-matter 仍只写 drift: true、不加新键', () => {
  const plain = renderReviewDoc(renderInput());
  const unknown = renderReviewDoc(renderInput({ driftUnknown: GONE }));
  assert.match(unknown, /审查期间的工作树漂移无法判定/);
  assert.ok(unknown.includes(describeDriftUnknown(GONE)));
  assert.doesNotMatch(unknown, /审查期间工作树发生漂移/, '比不了不能说成「发生漂移」');
  assert.match(plain, /审查期间工作树发生漂移/, '对照：没给 driftUnknown 时原句不变');
  const fmPlain = parseFrontMatter(plain)!;
  const fmUnknown = parseFrontMatter(unknown)!;
  assert.equal(fmUnknown['drift'], true);
  assert.deepEqual(Object.keys(fmUnknown).sort(), Object.keys(fmPlain).sort(), 'front-matter 不得因比不了多出键');
});

test('EV-139 R2：summarizeRun 对比不了打「漂移无法判定」，不打「漂移：0 个文件」', () => {
  const meta = newRunMeta({
    runId: '20261001T000000Z', topic: 't', stage: 'plan', rerunIndex: 1, command: 'test', promptHint: null, taskGoal: null,
    criticsSelected: ['gemini'], treeHash: 'T', gitHead: null, dirty: false, subjectSha256: 'S', denyPaths: [], driftPolicy: 'warn',
  });
  meta.snapshot.drift = { changed: true, files: [], policy: 'fail', unknown_reason: GONE };
  const s = summarizeRun(meta);
  assert.ok(s.includes(`⚠️ 漂移无法判定：${describeDriftUnknown(GONE)}（策略 fail）`), s);
  assert.doesNotMatch(s, /漂移：0 个文件/);

  // 对照：旧形（无 unknown_reason）原样
  meta.snapshot.drift = { changed: true, files: ['x.ts'], policy: 'warn' };
  assert.match(summarizeRun(meta), /⚠️ 漂移：1 个文件（策略 warn）/);
});

test('EV-139 S1：prune_objects 桩自缚——项目根不在系统临时目录之下就不动手，按失败返回并写明原因', async () => {
  /*
   * 只用一个**不存在**的根目录下的路径：若自缚被拿掉（变异 M14），桩会在这里跑 git prune——
   * 用真实仓库作对照会真的清掉它的不可达对象，所以不那样写。
   */
  const root = path.join(path.parse(os.tmpdir()).root, 'trivium-ev139-no-such-root', 'proj');
  const req = { project_root: root } as CriticRequest;
  const r = await makeStubAdapter('gemini', { mode: 'prune_objects' }).run({} as AdapterContext, req);
  assert.equal(r.status, 'failed');
  assert.match(r.fail_reason ?? '', /prune_objects 只在临时夹具内执行/);
});
