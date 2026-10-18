import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { runDoctor } from '../../src/trivium/doctor.js';
import { TRIVIUM_DIR, defaultConfig } from '../../src/trivium/config.js';
import { AGENTS } from '../../src/trivium/agents/registry.js';
import { SHARED_ROOT_EXIT_HINT, type EntryScanEnv } from '../../src/trivium/entry-collisions.js';
import { scratchDir } from '../helpers/scratch.js';
import { isolateEntryScanHome } from '../helpers/entry-scan-home.js';

// 本文件每个用例都显式注入夹具家目录；进程级再钉一次，防止漏传时读到真实家目录
isolateEntryScanHome();

/*
 * doctor 全量列出共享读取面里的同名入口（EV-240 方案 A，用户 D-11；计划 r2 §2.2 / §4 U5）：
 * 只进 warnings、不进 blockers，与 --only 无关，扫描出错也只记一条告警。
 */

const SHARED_REL = AGENTS.find((a) => a.entrySkillExtraReadRoots.length > 0)!.entrySkillExtraReadRoots[0]!;

async function doctorWith(se: EntryScanEnv) {
  const root = await scratchDir('trivium-doc-shared-');
  const triviumDir = path.join(root, TRIVIUM_DIR);
  await fs.mkdir(triviumDir, { recursive: true });
  return runDoctor({ config: defaultConfig(), projectRoot: root, triviumDir, only: 'env', skipModelCalls: true, entryScanEnv: se });
}

const isShared = (w: string): boolean => w.startsWith('共享读取面');

test('U5 无同名入口 ⇒ 不出告警；有 ⇒ warnings 恰多一条、按路径归并、~ 折叠、带出口，blockers 不变', async () => {
  const clean = await scratchDir('trivium-doc-home-');
  const base = await doctorWith({ home: clean, env: {} });
  assert.equal(base.warnings.filter(isShared).length, 0);

  const dirty = await scratchDir('trivium-doc-home-');
  const shared = path.join(dirty, SHARED_REL);
  await fs.mkdir(path.join(shared, 'dual-run'), { recursive: true });
  await fs.writeFile(path.join(shared, 'dual-run/SKILL.md'), '---\nname: dual-run\n---\n别家的\n');
  await fs.mkdir(path.join(shared, 'dual-status'), { recursive: true });
  await fs.writeFile(path.join(shared, 'dual-status/SKILL.md'), '---\nname: dual-status\n---\n./.trivium/bin/trivium\n');
  const r = await doctorWith({ home: dirty, env: {} });
  const hits = r.warnings.filter(isShared);
  assert.equal(hits.length, 1, JSON.stringify(r.warnings));
  assert.equal(r.warnings.length, base.warnings.length + 1, '只多这一条');
  const w = hits[0]!;
  assert.match(w, /^共享读取面里有 2 个同名入口/);
  assert.ok(w.includes(`~/${SHARED_REL}/dual-run`) && w.includes(`~/${SHARED_REL}/dual-status`), w);
  assert.ok(!w.includes(dirty), `不得露出夹具绝对路径：${w}`);
  assert.ok(w.includes(SHARED_ROOT_EXIT_HINT), w);
  assert.deepEqual(r.blockers, base.blockers, '告警不得进入阻断项');
});

test('U5 扫描出错 ⇒ 退化为一条告警，doctor 不失败、阻断不变', async () => {
  const clean = await scratchDir('trivium-doc-home-');
  const base = await doctorWith({ home: clean, env: {} });
  // 家目录取值不是字符串：path.join 抛错，模拟扫描内部失败
  const r = await doctorWith({ home: null as unknown as string, env: {} });
  assert.ok(r.warnings.some((w) => w.startsWith('共享读取面检查没做成：')), JSON.stringify(r.warnings));
  assert.deepEqual(r.blockers, base.blockers);
});

// ─────────────── 共享根残留（主题 M12-共享根残留检测，计划 r2 §4 U7） ───────────────

async function plantResidue(home: string): Promise<void> {
  const d = path.join(home, SHARED_REL, 'dual-critic');
  await fs.mkdir(path.join(d, 'schema'), { recursive: true });
  await fs.mkdir(path.join(d, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(d, 'SKILL.md'), '---\nname: dual-critic\ndescription: 过时的拷贝\n---\n');
}

test('U7 共享根只有残留 ⇒ warnings 恰多一条（残留段），残留加同名入口 ⇒ 仍只多一条（两段）；blockers 不变', async () => {
  const clean = await scratchDir('trivium-doc-home-');
  const base = await doctorWith({ home: clean, env: {} });

  const home = await scratchDir('trivium-doc-home-');
  await plantResidue(home);
  const r = await doctorWith({ home, env: {} });
  const hits = r.warnings.filter(isShared);
  assert.equal(hits.length, 1, JSON.stringify(r.warnings));
  assert.equal(r.warnings.length, base.warnings.length + 1);
  assert.match(hits[0]!, /^共享读取面里有 1 份本产品的历史拷贝/);
  assert.ok(hits[0]!.includes(`~/${SHARED_REL}/dual-critic`), hits[0]);
  assert.ok(hits[0]!.endsWith(SHARED_ROOT_EXIT_HINT), hits[0]);
  assert.deepEqual(r.blockers, base.blockers);

  await fs.mkdir(path.join(home, SHARED_REL, 'dual-run'), { recursive: true });
  await fs.writeFile(path.join(home, SHARED_REL, 'dual-run/SKILL.md'), '---\nname: dual-run\n---\n别家的\n');
  const both = await doctorWith({ home, env: {} });
  const w = both.warnings.filter(isShared);
  assert.equal(w.length, 1);
  assert.match(w[0]!, /^共享读取面里有 1 个同名入口/);
  assert.ok(w[0]!.includes('\n共享读取面里有 1 份本产品的历史拷贝'), w[0]);
  assert.deepEqual(both.blockers, base.blockers);
});
