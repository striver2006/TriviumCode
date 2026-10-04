/**
 * `prepareRun` 的入选集合前置校验（M7b 第 5 步，审查意见 GLM-05）。
 *
 * `resolveCriticSelection` 保证返回非空，但 `ReviewOptions.critics` 是可直传的字段，
 * 且它的注释**明确邀请**手工构造的调用方（测试、selftest）省略或自填。
 * 那正是最可能传错的调用方——而传 `[]` 的后果是一次**什么都没审的运行成功过闸**：
 * 可用性检查空转、`decideMode` 对空入选集按「全成功」记 `full`、闸门按空集校验通过。
 * 判定处的非空不变式必须延伸到直传路径。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { prepareRun } from '../../src/trivium/review.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { initFixtureRepo } from '../../src/trivium/util/git.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { Ctx } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';

async function fakeCtx(): Promise<Ctx> {
  const root = await scratchDir('trivium-sides-');
  await fs.writeFile(path.join(root, 'a.ts'), 'export const a = 1;\n');
  await initFixtureRepo(root);
  await fs.writeFile(path.join(root, 'a.ts'), 'export const a = 2;\n');
  return {
    config: defaultConfig(),
    projectRoot: root,
    archiveRoot: path.join(root, '.reviews'),
    triviumDir: path.join(root, '.trivium'),
    sources: ['<test>'],
  };
}

const baseOpts = (ctx: Ctx) => ({
  ctx,
  stage: 'code' as const,
  topic: '空集合',
  promptHint: '看并发',
  contextPaths: [],
  subjectFile: null,
  modelOverrides: {},
  command: 'test',
  diffBase: 'HEAD',
});

test('prepareRun：直传空入选集合 → 退 64，而不是跑一次零侧审查', async () => {
  const ctx = await fakeCtx();
  await assert.rejects(
    prepareRun({ ...baseOpts(ctx), critics: [] }),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.USAGE, '参数错误一律退 64');
      assert.match(e.message, /至少要有一个审核者/);
      return true;
    },
  );
});

/*
 * **正例不在这里**：`prepareRun` 继续往下会做可用性检查（要真实探针与 CLI），
 * 单测环境里必然失败。非空路径由 `fault-injection.test.ts` 的集成用例覆盖
 * （走打包产物的真实子进程，断言入选集合一路落到 run.json 与文档清单）。
 *
 * 这条负例能成立，靠的是空集合校验**排在可用性检查之前**——顺序调换就测不到了。
 * 下面这条正是锁那个顺序：若校验被挪到可用性检查之后，错误信息会变成
 * 「某侧不可用」而不是「至少要有一个审核者」。
 */
test('空集合校验排在可用性检查之前（顺序调换会让它永远测不到）', async () => {
  const ctx = await fakeCtx();
  await assert.rejects(
    prepareRun({ ...baseOpts(ctx), critics: [] }),
    (e: { message: string }) => {
      assert.doesNotMatch(
        e.message, /不可用/,
        '空集合应当在探针可用性检查之前就被拒——否则报错会指向一个无关的原因',
      );
      return true;
    },
  );
});
