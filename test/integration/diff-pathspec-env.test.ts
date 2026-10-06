import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, makeFixture, today } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import type { RunMeta } from '../../src/trivium/types.js';

/**
 * code 阶段补丁的排除不受用户环境里的 pathspec 变量影响（EV-222）经真实 CLI。
 *
 * `diffAgainst` 用 `:(exclude)<前缀>/**` 与 `:(exclude,glob)<glob>` 剔除归档根、`.trivium/`、`.git` 与敏感文件的已跟踪改动。
 * 用户全局设了 `GIT_LITERAL_PATHSPECS=1` 时整串被当字面路径、三类排除全部失效；`GIT_NOGLOB_PATHSPECS=1` 时 `/**` 被当字面、
 * 前缀排除失效——`git diff` 对不匹配的 pathspec 不报错，补丁照常冻结，对方产出与敏感文件经被审对象本身送出。
 * 夹具建仓时全部提交，下面改的四个文件都是已跟踪的：业务文件、归档里的计划原稿、`.trivium/config.yaml`（加一行注释）、`.env`。
 * 环境变量经 `cli` 的第 5 参叠加给 `--start` 与 `--wait`，工作进程继承它（跑后复算重取补丁也在这个环境里）。
 */

const TOPIC = 'EV222补丁';
const STUB = { gemini: { mode: 'ok' as const }, glm: { mode: 'ok' as const } };
const MARK = 'EV222_LEAK_MARKER';

for (const v of ['GIT_LITERAL_PATHSPECS', 'GIT_NOGLOB_PATHSPECS'] as const) {
  test(`EV-222 W：用户环境带 ${v}=1 时 code 阶段冻结的补丁只含业务文件，不含归档根、.trivium/ 与 .env 的改动`, { skip: bundleMissing && bundleSkipReason }, async () => {
    const fx = await makeFixture({ topic: TOPIC });
    const env = { [v]: '1' };
    await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 2;\n');
    await fs.writeFile(path.join(fx.stageDir, `${today()}-${TOPIC}-claude.md`), `# 待审计划（改过）\n\n${MARK}\n`);
    await fs.appendFile(path.join(fx.root, '.trivium/config.yaml'), `# ${MARK}\n`);
    await fs.writeFile(path.join(fx.root, '.env'), `FAKE_PLACEHOLDER=${MARK}\n`);

    const started = await cli(fx.root, ['review', '--start', '--stage', 'code', '--topic', TOPIC, '--focus', '看变更', '--json'], STUB, 120_000, env);
    assert.equal(started.code, EXIT.OK, `${started.stdout}${started.stderr}`);
    const runId = (JSON.parse(extractJsonCandidate(started.stdout)!.json) as { run_id: string }).run_id;
    let code: number | null = EXIT.STILL_RUNNING;
    let out = '';
    for (let i = 0; i < 12 && code === EXIT.STILL_RUNNING; i++) {
      const w = await cli(fx.root, ['review', '--wait', runId, '--timeout', '20'], STUB, 60_000, env);
      code = w.code;
      out = w.stdout + w.stderr;
    }
    assert.equal(code, EXIT.OK, out);

    const codeDir = path.join(fx.archiveRoot, TOPIC, 'code');
    const meta = JSON.parse(await fs.readFile(path.join(codeDir, '_meta', `run-${runId}.json`), 'utf8')) as RunMeta;
    const entry = meta.artifacts.find((a) => /changes-.+\.diff$/.test(a.path));
    assert.ok(entry, '没有冻结补丁');
    const diff = await fs.readFile(path.join(fx.archiveRoot, entry!.path), 'utf8');
    const files = [...diff.matchAll(/^diff --git a\/(\S+) /gm)].map((m) => m[1]);
    assert.deepEqual(files, ['src/a.ts'], `补丁里的文件不对：${files.join(', ')}`);
    assert.doesNotMatch(diff, new RegExp(MARK), '被排除文件的内容进了补丁');
    assert.equal(meta.snapshot.drift.changed, false, '跑后复算在同一环境里重取补丁，应与冻结值一致');
  });
}
