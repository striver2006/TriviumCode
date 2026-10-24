/**
 * 运行清单登记路径的跨平台形态（双平台统一，2026-10-24）。
 *
 * Windows 线早先把 `run.json.artifacts[].path` 按原生分隔符登记（`主题\plan\_meta\…`）。同一份归档拿到
 * macOS 上读，`path.join` 把反斜杠当文件名的一部分，提交锚把在场的工件全报「已丢失」并拦下提交——
 * 合并两条平台线时实测撞上。本文件钉住：写入端一律落 `/` 形态；读取端（readRunMeta、listRecordedRuns）
 * 把盘上的反斜杠形态读成 `/`，盘上原件不改；提交锚据此认得出在场的工件。两个平台都跑。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { newRunMeta, readRunMeta, writeRunMeta } from '../../src/trivium/meta.js';
import {
  artifactRelPosix,
  checkRecordedArtifacts,
  checkStageArtifacts,
  listRecordedRuns,
  metaDir,
  normalizeArtifactPaths,
  writeArtifact,
  type ArchiveLayout,
} from '../../src/trivium/archive.js';
import { sha256 } from '../../src/trivium/util/fsx.js';
import { CRITICS, type RunMeta } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';

const TOPIC = '跨平台登记';
const RUN_ID = '20261020T074334Z';

async function tmpLayout(): Promise<ArchiveLayout> {
  const root = await scratchDir('trivium-artposix-');
  return { archiveRoot: path.join(root, '.reviews'), topic: TOPIC };
}

const skeleton = (): RunMeta =>
  newRunMeta({
    runId: RUN_ID, topic: TOPIC, stage: 'plan', rerunIndex: 1, command: 'x',
    promptHint: null, taskGoal: null, criticsSelected: CRITICS,
    treeHash: 'h', gitHead: null, dirty: false, subjectSha256: 's',
    denyPaths: [], driftPolicy: 'warn',
  });

/** 在归档里放一份真实工件，返回它的 `/` 形态与 Windows 形态登记路径及哈希 */
async function placeArtifact(layout: ArchiveLayout): Promise<{ posix: string; win: string; sha: string }> {
  const dir = metaDir(layout, 'plan');
  await fs.mkdir(dir, { recursive: true });
  const body = '# brief\n';
  await fs.writeFile(path.join(dir, `brief-codex-${RUN_ID}.md`), body, 'utf8');
  const posix = path.relative(layout.archiveRoot, path.join(dir, `brief-codex-${RUN_ID}.md`)).split(path.sep).join('/');
  return { posix, win: posix.split('/').join('\\'), sha: sha256(body) };
}

/** 绕过 writeRunMeta，按 Windows 线旧版的样子直接落一份反斜杠登记的 run.json */
async function writeLegacyWinRunJson(layout: ArchiveLayout, win: string, sha: string): Promise<string> {
  const meta = { ...skeleton(), artifacts: [{ path: win, sha256: sha }], status: 'success' as const };
  const p = path.join(metaDir(layout, 'plan'), `run-${RUN_ID}.json`);
  const text = JSON.stringify(meta, null, 2) + '\n';
  await fs.writeFile(p, text, 'utf8');
  return text;
}

test('artifactRelPosix：反斜杠一律换成 /，已是 / 形态的原样返回', () => {
  assert.equal(artifactRelPosix('主题\\code\\_meta\\a.diff'), '主题/code/_meta/a.diff');
  assert.equal(artifactRelPosix('主题/code/a.md'), '主题/code/a.md');
  const same = { path: '主题/plan/a.md', sha256: 'x' };
  assert.equal(normalizeArtifactPaths([same])[0], same, '无需归一的条目不复制');
  assert.deepEqual(normalizeArtifactPaths([{ path: 'a\\b', sha256: 'y' }]), [{ path: 'a/b', sha256: 'y' }]);
});

test('writeRunMeta：内存里是反斜杠登记也落成 / 形态，且不改调用方手里的对象', async () => {
  const layout = await tmpLayout();
  const { posix, win, sha } = await placeArtifact(layout);
  const meta = { ...skeleton(), artifacts: [{ path: win, sha256: sha }] };
  const abs = await writeRunMeta(layout, 'plan', meta);
  const onDisk = JSON.parse(await fs.readFile(abs, 'utf8')) as RunMeta;
  assert.deepEqual(onDisk.artifacts, [{ path: posix, sha256: sha }]);
  assert.equal(meta.artifacts[0]!.path, win, '调用方的内存对象原样');
});

test('读取端：Windows 线旧登记读成 / 形态，盘上原件不改；提交锚认得出在场的工件', async () => {
  const layout = await tmpLayout();
  const { posix, win, sha } = await placeArtifact(layout);
  const original = await writeLegacyWinRunJson(layout, win, sha);

  const meta = await readRunMeta(layout, 'plan', RUN_ID);
  assert.ok(meta, '旧登记照样读得出');
  assert.deepEqual(meta!.artifacts, [{ path: posix, sha256: sha }]);

  const runs = await listRecordedRuns(layout);
  const run = runs.find((r) => r.run_id === RUN_ID);
  assert.ok(run && !run.unreadable, '归档列表里这一轮可读');
  assert.deepEqual(run!.artifacts, [{ path: posix, sha256: sha }]);

  assert.deepEqual(await checkRecordedArtifacts(layout, [run!]), [], '工件在场且未改，不报丢失');
  assert.equal(
    await fs.readFile(path.join(metaDir(layout, 'plan'), `run-${RUN_ID}.json`), 'utf8'),
    original,
    '盘上的 run.json 是不可变工件，读取不回写',
  );
});

test('checkStageArtifacts：Windows 旧登记的审查件不被当成「未登记」（比对两侧同为 `/` 形态）', async () => {
  const layout = await tmpLayout();
  const doc = await writeArtifact({ layout, stage: 'plan', role: 'gemini', writer: 'gemini', rerunIndex: 1, content: 'b', date: '2026-10-20' });
  const posix = doc.relPath.split(path.sep).join('/');
  await fs.mkdir(metaDir(layout, 'plan'), { recursive: true });
  await writeLegacyWinRunJson(layout, posix.split('/').join('\\'), doc.sha256);
  const recorded = new Set<string>();
  for (const r of await listRecordedRuns(layout)) for (const a of r.artifacts) recorded.add(a.path);
  const c = await checkStageArtifacts(layout, 'plan', 1, ['gemini'], undefined, recorded);
  assert.ok(!c.missing.some((m) => m.includes('未登记的审查件')), `已登记的不该报未登记：${c.missing.join(', ')}`);
});

test('负对照：工件真的删了，反斜杠登记照样报「已丢失」——归一不吞违例', async () => {
  const layout = await tmpLayout();
  const { posix, win, sha } = await placeArtifact(layout);
  await writeLegacyWinRunJson(layout, win, sha);
  await fs.rm(path.join(layout.archiveRoot, posix));
  const run = (await listRecordedRuns(layout)).find((r) => r.run_id === RUN_ID)!;
  const t = await checkRecordedArtifacts(layout, [run]);
  assert.equal(t.length, 1);
  assert.equal(t[0]!.kind, 'missing');
  assert.equal(t[0]!.relPath, posix);
});
