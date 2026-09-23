/**
 * `subjectArtifactRelPath`：plan / bug 原稿登记路径的域约束（M10a 第 2 步 EV-55 §3.1.1）。
 *
 * 抽成纯函数单测的理由与本仓其余 `judge*` 一致：埋在 `executeRun` 里要真跑一次
 * 审查（拉起至少一侧 Agent）才走得到，等于没有断言守着。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { subjectArtifactRelPath, resolveSubjectArtifactRelPath } from '../../src/trivium/review.js';

test('归档内的原稿：返回相对归档根的路径，不是绝对路径', () => {
  const archiveRoot = '/proj/.reviews';
  const subjectPath = '/proj/.reviews/EV-1/plan/2026-01-01-EV-1-claude.md';
  assert.equal(subjectArtifactRelPath(archiveRoot, subjectPath), 'EV-1/plan/2026-01-01-EV-1-claude.md');
});

test('归档外的原稿（--plan-file doc/…）：返回 null，不登记', () => {
  const archiveRoot = '/proj/.reviews';
  const subjectPath = '/proj/doc/02_design/设计.md';
  assert.equal(subjectArtifactRelPath(archiveRoot, subjectPath), null);
});

test('原稿恰好落在归档根本身：返回 null——归档根不是可登记的工件路径（代码双审 r2 AGY-02 / GLM-06）', () => {
  // 上一版这里把空串钉成期望值：调用方会把 '' 登记进 artifacts[]，锚② 随后对归档根目录求哈希
  const archiveRoot = '/proj/.reviews';
  assert.equal(subjectArtifactRelPath(archiveRoot, archiveRoot), null);
  assert.equal(subjectArtifactRelPath(archiveRoot, `${archiveRoot}/`), null);
});

test('经软链写法给出的归档内原稿仍判归档内（代码双审 r2 CODEX-08）', async () => {
  // 真实目录 + 指向它的软链：纯词法比较会把软链写法判成「越出归档根」而静默不登记
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-subj-')));
  const realRoot = path.join(base, 'real');
  const archiveRoot = path.join(realRoot, '.reviews');
  await fs.mkdir(path.join(archiveRoot, 'EV-1', 'plan'), { recursive: true });
  const draft = path.join(archiveRoot, 'EV-1', 'plan', 'a.md');
  await fs.writeFile(draft, 'x\n');
  const link = path.join(base, 'link');
  await fs.symlink(realRoot, link);
  const viaLink = path.join(link, '.reviews', 'EV-1', 'plan', 'a.md');

  assert.equal(subjectArtifactRelPath(archiveRoot, viaLink), null, '前提：纯词法判据确实会误判');
  assert.equal(await resolveSubjectArtifactRelPath(archiveRoot, viaLink), path.join('EV-1', 'plan', 'a.md'));
  assert.equal(await resolveSubjectArtifactRelPath(path.join(link, '.reviews'), draft), path.join('EV-1', 'plan', 'a.md'));
});

test('返回的相对路径能经 path.join(archiveRoot, rel) 解析回真实位置——与 checkRecordedArtifacts 同一套还原口径', () => {
  const archiveRoot = '/proj/.reviews';
  const subjectPath = '/proj/.reviews/EV-1/plan/2026-01-01-EV-1-claude.md';
  const rel = subjectArtifactRelPath(archiveRoot, subjectPath);
  assert.equal(rel === null ? null : path.join(archiveRoot, rel), subjectPath);
});

test('相邻但不在归档内的兄弟目录不得被误判为归档内（前缀匹配陷阱）', () => {
  // archiveRoot 是 /proj/.reviews，而 /proj/.reviews-backup/x.md 只是字符串前缀相同，
  // path.relative 的结果必须以 '..' 开头，不能被 startsWith('..') 之外的检查放过
  const archiveRoot = '/proj/.reviews';
  const subjectPath = '/proj/.reviews-backup/x.md';
  assert.equal(subjectArtifactRelPath(archiveRoot, subjectPath), null);
});
