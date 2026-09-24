/**
 * 构建标识（EV-82 小主题第一段 r2 §2）：本仓模式判定、四条告警、作用面指纹、run.json 落盘。
 *
 * 全部在临时目录里的合成 git 仓库上跑，不碰本仓工作树。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  BUILD_WARN_CHECK_FAILED,
  BUILD_WARN_DIRTY,
  BUILD_WARN_HEAD,
  BUILD_WARN_INCOMPLETE,
  BUILD_WARN_MISSING,
  BUILD_WARN_STALE_INPUTS,
  INSTALL_INPUT_PATHS,
  SELF_PACKAGE_NAME,
  buildStampWarnings,
  checkBuildStamp,
  collectBuildStampNotices,
  computeBuildStamp,
  computeInputsSha256,
  embeddedBuildStamp,
  isSelfRepo,
  readPackageName,
  type BuildStamp,
} from '../../src/trivium/build-stamp.js';
import { headSha, initFixtureRepo, isShallowRepo, rootCommit } from '../../src/trivium/util/git.js';
import { run } from '../../src/trivium/util/exec.js';
import { newRunMeta } from '../../src/trivium/meta.js';
import { validateRunMeta } from '../../src/trivium/schemas.js';
import { REPO_ROOT } from '../helpers/fixture.js';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'trivium-buildstamp-'));

/** 一个像本仓的最小仓库：作用面内外各有文件 */
async function selfLikeRepo(name = SELF_PACKAGE_NAME): Promise<string> {
  const dir = await tmp();
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
  await fs.mkdir(path.join(dir, 'skills/x'), { recursive: true });
  await fs.mkdir(path.join(dir, 'doc'), { recursive: true });
  await fs.writeFile(path.join(dir, 'src/a.ts'), 'export const a = 1;\n');
  await fs.writeFile(path.join(dir, 'skills/x/SKILL.md'), '# x\n');
  await fs.writeFile(path.join(dir, 'doc/n.md'), '# n\n');
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name }));
  await initFixtureRepo(dir);
  return dir;
}

const stamp = (over: Partial<BuildStamp> = {}): BuildStamp => ({
  repo_root_commit: 'root', git_head: 'head', dirty: false, inputs_sha256: 'in', built_at: '2026-09-24T00:00:00Z', ...over,
});

// ── 纯函数：本仓模式与四条告警 ──

test('本仓模式：有标识时按根提交判；缺标识时按包名兜底', () => {
  assert.equal(isSelfRepo({ build: stamp(), projectRootCommit: 'root', projectPackageName: 'other' }), true);
  assert.equal(isSelfRepo({ build: stamp(), projectRootCommit: 'elsewhere', projectPackageName: SELF_PACKAGE_NAME }), false,
    '有标识时只认根提交，包名不作数');
  assert.equal(isSelfRepo({ build: null, projectRootCommit: 'x', projectPackageName: SELF_PACKAGE_NAME }), true);
  assert.equal(isSelfRepo({ build: null, projectRootCommit: 'x', projectPackageName: 'other' }), false);
});

test('非本仓模式零告警：外部项目里 HEAD 恒不等，也不得出「不同版」（r2 CODEX-01）', () => {
  const w = buildStampWarnings({
    build: stamp({ dirty: true }), projectRootCommit: 'someone-else', projectHead: 'zzz',
    projectPackageName: 'their-app', currentInputsSha256: 'different',
  });
  assert.deepEqual(w, []);
  assert.deepEqual(buildStampWarnings({
    build: null, projectRootCommit: null, projectHead: null, projectPackageName: 'their-app', currentInputsSha256: null,
  }), []);
});

test('本仓模式四条告警各自独立：缺失 / dirty / 构建后又改 / HEAD 不同', () => {
  const base = { projectRootCommit: 'root', projectHead: 'head', projectPackageName: SELF_PACKAGE_NAME, currentInputsSha256: 'in' };
  assert.deepEqual(buildStampWarnings({ ...base, build: null }), [BUILD_WARN_MISSING]);
  assert.deepEqual(buildStampWarnings({ ...base, build: stamp() }), [], '一致时零告警');
  assert.deepEqual(buildStampWarnings({ ...base, build: stamp({ dirty: true }) }), [BUILD_WARN_DIRTY]);
  assert.deepEqual(buildStampWarnings({ ...base, currentInputsSha256: 'changed', build: stamp() }), [BUILD_WARN_STALE_INPUTS]);
  const head = buildStampWarnings({ ...base, projectHead: 'newhead', build: stamp() });
  assert.equal(head.length, 1);
  assert.ok(head[0]!.startsWith(BUILD_WARN_HEAD));
});

test('本仓模式下判据输入取不到 ⇒「比对未能完成」，不与「查过、干净」同形（r2 CODEX-05）', () => {
  const base = { projectRootCommit: 'root', projectPackageName: SELF_PACKAGE_NAME, build: stamp() };
  const noInputs = buildStampWarnings({ ...base, projectHead: 'head', currentInputsSha256: null });
  assert.equal(noInputs.length, 1);
  assert.ok(noInputs[0]!.startsWith(BUILD_WARN_INCOMPLETE) && noInputs[0]!.includes('作用面指纹'));
  const noHead = buildStampWarnings({ ...base, projectHead: null, currentInputsSha256: 'in' });
  assert.equal(noHead.length, 1);
  assert.ok(noHead[0]!.startsWith(BUILD_WARN_INCOMPLETE) && noHead[0]!.includes('HEAD'));
  // 非本仓模式仍然零告警，哪怕两项都取不到
  assert.deepEqual(buildStampWarnings({ ...base, projectRootCommit: 'other', projectHead: null, currentInputsSha256: null }), []);
});

// ── 作用面指纹 ──

test('inputs_sha256：作用面内改文件（含未跟踪）⇒ 变；作用面外（doc/）改 ⇒ 不变', async () => {
  const dir = await selfLikeRepo();
  const h0 = await computeInputsSha256(dir);
  assert.ok(h0);
  await fs.writeFile(path.join(dir, 'doc/n.md'), '# changed\n');
  assert.equal(await computeInputsSha256(dir), h0, 'doc/ 不在作用面');
  await fs.writeFile(path.join(dir, 'skills/x/SKILL.md'), '# changed\n');
  const h1 = await computeInputsSha256(dir);
  assert.notEqual(h1, h0, 'skills/ 在作用面（CODEX-07）');
  await fs.writeFile(path.join(dir, 'src/new.ts'), 'export {};\n');
  assert.notEqual(await computeInputsSha256(dir), h1, '未跟踪文件也算');
  assert.ok(INSTALL_INPUT_PATHS.includes('skills') && INSTALL_INPUT_PATHS.includes('tsconfig.json'));
});

test('computeBuildStamp：git 仓库里各项齐全；非 git 目录 ⇒ null，不抛', async () => {
  const dir = await selfLikeRepo();
  const s = await computeBuildStamp(dir);
  assert.ok(s);
  assert.equal(s!.git_head, await headSha(dir));
  assert.equal(s!.repo_root_commit, await rootCommit(dir));
  assert.equal(s!.dirty, false);
  await fs.writeFile(path.join(dir, 'src/a.ts'), 'export const a = 2;\n');
  assert.equal((await computeBuildStamp(dir))!.dirty, true);
  assert.equal(await computeBuildStamp(await tmp()), null);
});

test('checkBuildStamp：本仓模式下构建后又改作用面 ⇒「不是当前工作树构建的」；外部仓库零告警', async () => {
  const dir = await selfLikeRepo();
  const s = (await computeBuildStamp(dir))!;
  assert.deepEqual(await checkBuildStamp(dir, s), []);
  await fs.writeFile(path.join(dir, 'src/a.ts'), 'export const a = 3;\n');
  assert.deepEqual(await checkBuildStamp(dir, s), [BUILD_WARN_STALE_INPUTS]);

  const other = await selfLikeRepo('their-app');
  assert.deepEqual(await checkBuildStamp(other, s), [], '根提交不同 ⇒ 非本仓模式');
});

// ── 代码双审 r1 的补强 ──

test('包名兜底的常量与 package.json 对账：改名或加 scope 当场红（CODEX-02）', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'package.json'), 'utf8')) as { name: string };
  assert.equal(SELF_PACKAGE_NAME, pkg.name);
});

test('浅克隆：rootCommit 返回 null 而非移植边界；本仓判定退到包名，不静默判否（CODEX-03 ≡ GLM-04）', async () => {
  const origin = await selfLikeRepo();
  await fs.writeFile(path.join(origin, 'src/b.ts'), 'export const b = 1;\n');
  await run('git', ['add', '-A'], { cwd: origin });
  await run('git', ['commit', '-q', '-m', 'second', '--no-verify'], { cwd: origin });
  const shallowParent = await tmp();
  const shallow = path.join(shallowParent, 'clone');
  const c = await run('git', ['clone', '-q', '--depth', '1', `file://${origin}`, shallow], { cwd: shallowParent, timeoutMs: 60_000 });
  assert.equal(c.code, 0, c.stderr);
  assert.equal(await isShallowRepo(shallow), true);
  assert.equal(await rootCommit(shallow), null, '浅仓不得返回浅边界提交');
  assert.notEqual(await rootCommit(origin), null);
  // 构建来自完整仓（有根提交），被审项目是浅克隆：按包名仍判本仓
  const s = (await computeBuildStamp(origin))!;
  assert.equal(isSelfRepo({ build: s, projectRootCommit: await rootCommit(shallow), projectPackageName: await readPackageName(shallow) }), true);
  // 构建来自浅仓：取不到根提交 ⇒ 标识为 null ⇒ 本仓里出「构建标识缺失」，可见
  assert.equal(await computeBuildStamp(shallow), null);
  assert.deepEqual(await checkBuildStamp(shallow, null), [BUILD_WARN_MISSING]);
});

test('比对本身抛错 ⇒ 转成一条「构建标识比对失败」告警，不重抛、不静默（GLM-03）', async () => {
  const notices = await collectBuildStampNotices('/nowhere', null, async () => { throw new Error('boom'); });
  assert.deepEqual(notices, [`${BUILD_WARN_CHECK_FAILED}：boom`]);
});

test('测试构建没有注入 __TRIVIUM_BUILD__ ⇒ embeddedBuildStamp() 为 null', () => {
  assert.equal(embeddedBuildStamp(), null);
});

// ── run.json 落盘 ──

function metaInput(build?: BuildStamp | null) {
  return {
    runId: '20260924T000000Z', topic: 't', stage: 'plan' as const, rerunIndex: 1,
    command: 'B' as const, promptHint: null, taskGoal: null, criticsSelected: ['glm' as const],
    treeHash: 'tree', gitHead: 'h', dirty: false, subjectSha256: 's', denyPaths: [], driftPolicy: 'warn' as const,
    ...(build === undefined ? {} : { build }),
  };
}

test('snapshot.build 恒写：未给 ⇒ null，给了原样落', () => {
  assert.equal(newRunMeta(metaInput() as never).snapshot.build, null);
  assert.deepEqual(newRunMeta(metaInput(stamp()) as never).snapshot.build, stamp());
});

test('schema：snapshot.build 为对象或 null 都合法，缺必填键被拒；旧留痕缺席照样合法', async () => {
  // 以一份真实的成功 run.json 为底，只动 snapshot.build：别的字段与本用例无关，不能让它们混进错误
  const real = JSON.parse(await fs.readFile(
    path.join(REPO_ROOT, '.reviews/M10b-入口资产与真载体验收/plan/_meta/run-20260924T004706Z.json'), 'utf8',
  )) as { snapshot: Record<string, unknown> };
  assert.deepEqual(validateRunMeta(real), [], '底样本本身合法（旧留痕，没有 build）');
  for (const b of [stamp(), null]) {
    const m = structuredClone(real);
    m.snapshot['build'] = b;
    assert.deepEqual(validateRunMeta(m), [], `build=${JSON.stringify(b)}`);
  }
  const bad = structuredClone(real);
  const { inputs_sha256: _drop, ...partial } = stamp();
  bad.snapshot['build'] = partial;
  assert.notDeepEqual(validateRunMeta(bad), [], '缺 inputs_sha256 必须被拒');
});
