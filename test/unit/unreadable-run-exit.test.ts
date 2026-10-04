/**
 * 运行留痕读不出时的共用出口（留痕读不出的出口计划 r2 §5.1，EV-148 文案部分）。
 *
 * - U1：共用出口段自身——三档成因各有可执行的落点、明示重跑不是出口、警示别动锚、逐份列文件；
 * - U2：源码契约——`src/` 里（含注释）再没有「重跑……会（先）落一份可读 / 随即恢复」这类循环出口；
 * - U3：`--await-approval` 与 `approve` 两处的出口构造函数接进 `verifyRoundForApproval` 后的真实文案。
 *   `--await-approval` 那一格只在竞态下可达（runId 取自读得出的那份），CLI 层没有端到端用例，只能在这里咬住。
 *
 * 另外五处（`review --start`、`topic claim`、`topic resolve`、`hook-pre-write`、`gate` 一份都读不出）
 * 由 `topic-claim.test.ts`、`hooks.test.ts`、`gate-loop.test.ts` 经同一个 `assertUnreadableExit` 断言。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  UNREADABLE_RUN_META_EXIT_BODY, UNREADABLE_RUN_META_LIST_LIMIT, runMetaPaths, unreadableRunMetaExit,
  unreadableRunMetaExitAt,
} from '../../src/trivium/meta.js';
import type { BuildStamp } from '../../src/trivium/build-stamp.js';
import {
  APPROVAL_CHECK_META_UNREADABLE, APPROVAL_CHECK_NO_RUN_ID,
  approveForkRecovery, awaitApprovalRecovery, verifyRoundForApproval,
} from '../../src/trivium/gate.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { ArchiveLayout } from '../../src/trivium/archive.js';
import { REPO_ROOT } from '../helpers/fixture.js';
import { CIRCULAR_EXIT_PATTERNS, assertUnreadableExit } from '../helpers/unreadable-exit.js';
import { scratchDir } from '../helpers/scratch.js';

const TOPIC = '留痕读不出-出口';

async function layoutWithUnreadable(runId: string): Promise<{ l: ArchiveLayout; file: string }> {
  const root = await fs.realpath(await scratchDir('trivium-unreadable-exit-'));
  const l: ArchiveLayout = { archiveRoot: path.join(root, '.reviews'), topic: TOPIC };
  const [file] = runMetaPaths(l, 'plan', [runId]);
  await fs.mkdir(path.dirname(file!), { recursive: true });
  await fs.writeFile(file!, '{}\n', 'utf8');
  return { l, file: file! };
}

// ─────────── U1：共用出口段自身 ───────────

test('U1：共用出口段按成因给三档出口，每档都有可执行的落点', () => {
  const b = UNREADABLE_RUN_META_EXIT_BODY;
  assert.match(b, /重跑该阶段双审不是出口/, '要明说重跑不是出口：review --start 在冻结之前就按同一判定拒绝');
  // ① 版本落后：落点是 MANUAL 的升级一节（计划双审 CODEX-05：「重装」不能只是一句口号）
  assert.match(b, /①[^\n]*版本落后[^\n]*MANUAL §3\.6「升级」/, `① 档缺可执行的落点：\n${b}`);
  // ② 已提交而工作树被改坏：用户在终端 restore，且说清会话里做不了
  // 判别动作给现成命令（含 core.quotePath=false，免得中文路径被转义），restore 的路径加引号（代码双审 r1 CODEX-05）
  assert.match(
    b, /②[^\n]*git -c core\.quotePath=false status --porcelain -- '<路径>'[^\n]*终端执行 git restore -- '<上面列出的路径>'/,
    `② 档缺判别命令或终端 restore：\n${b}`,
  );
  assert.match(b, /②[^\n]*会话里的恢复命令会被 Hook 拦下/, '② 档要说清这一步只能在终端做');
  // ③ 其余：工具内没有出口，指向 EV-148 的剩余项，不编造出口
  assert.match(b, /③[^\n]*工具内没有出口[^\n]*EV-148/, `③ 档要如实写「工具内没有出口」：\n${b}`);
  assert.match(b, /③[^\n]*已提交的版本本身就读不出/, '③ 档要覆盖「已提交、工作树干净却读不出」那一态（计划双审 CODEX-04）');
  assert.match(b, /不要删除或改写这些 run-\*\.json/, '要警示别动提交锚');
  assert.match(b, /运行清单已丢失/, '要说清删掉只是把拒绝挪到提交时');
  // 「提交时会被拦」只对登记过的运行成立；没登记的删掉无从追查（代码双审 r1 CODEX-01）
  assert.match(b, /登记过的运行[^\n]*运行清单已丢失[^\n]*没登记的删掉则无从追查/, `删除那一句丢了「登记」前提：\n${b}`);
  assert.match(b, /①[^\n]*判别见上面那行构建标识/, '① 档要指向构建标识那一行（代码双审 r1 CODEX-02）');
  // ② 不写「删掉」：第 1～5 处报出来的文件按定义都在磁盘上（计划双审 AGY-02）
  assert.doesNotMatch(b, /②[^\n]*删掉/, '② 档不该写「删掉」——扫不到的文件进不了这条拒绝');
  for (const re of CIRCULAR_EXIT_PATTERNS) assert.doesNotMatch(b, re);
});

test('U1：unreadableRunMetaExit 逐行列出每一份（绝对路径），再接固定段', () => {
  const a = '/abs/.reviews/t/plan/_meta/run-R2.json';
  const c = '/abs/.reviews/t/plan/_meta/run-R1.json';
  const text = unreadableRunMetaExit([a, c]);
  assert.match(text, /逐份判断成因/, '一次常报多份、成因可能各不相同，要提示逐份判断（计划双审 CODEX-07）');
  assertUnreadableExit(text, [a, c], 'unreadableRunMetaExit');
  assert.ok(text.indexOf(a) < text.indexOf(c), '按传入的顺序列（调用方传的是从新到旧）');
  assert.ok(text.endsWith(UNREADABLE_RUN_META_EXIT_BODY), '固定段在最后，各处只拼自己的前半句');
});

test('U1：清单至多列 UNREADABLE_RUN_META_LIST_LIMIT 份，其余报数（代码双审 r1 CODEX-03）', () => {
  const files = Array.from({ length: UNREADABLE_RUN_META_LIST_LIMIT + 2 }, (_, i) => `/abs/_meta/run-R${i}.json`);
  const text = unreadableRunMetaExit(files);
  for (const f of files.slice(0, UNREADABLE_RUN_META_LIST_LIMIT)) assert.ok(text.includes(`    · ${f}\n`), f);
  for (const f of files.slice(UNREADABLE_RUN_META_LIST_LIMIT)) assert.ok(!text.includes(f), `超出上限的不该列出：${f}`);
  assert.match(text, /另有 2 份同状态未列出/);
  assert.ok(text.endsWith(UNREADABLE_RUN_META_EXIT_BODY));
});

test('U1：判别 ① 那一行给出本工具的构建标识；取不到时如实说缺失（代码双审 r1 CODEX-02）', () => {
  const stamp = {
    repo_root_commit: 'r'.repeat(40), git_head: 'abcdef1234567890abcdef1234567890abcdef12', dirty: false,
    inputs_sha256: 's'.repeat(64), built_at: '2026-10-01T00:00:00.000Z',
  } as BuildStamp;
  const withStamp = unreadableRunMetaExit(['/abs/_meta/run-R1.json'], stamp);
  assert.match(withStamp, /判别 ①：本工具的构建是 abcdef1（2026-10-01T00:00:00\.000Z）[^\n]*snapshot\.build\.git_head/);
  const without = unreadableRunMetaExit(['/abs/_meta/run-R1.json'], null);
  assert.match(without, /判别 ①：本工具的构建标识缺失/);
  for (const t of [withStamp, without]) assert.ok(t.endsWith(UNREADABLE_RUN_META_EXIT_BODY));
});

test('U1：unreadableRunMetaExitAt 拼绝对路径；空列表是程序缺陷（代码双审 r1 GLM-02 / GLM-03）', () => {
  const l: ArchiveLayout = { archiveRoot: '/abs/.reviews', topic: 't' };
  assertUnreadableExit(
    unreadableRunMetaExitAt(l, 'plan', ['R1']), ['/abs/.reviews/t/plan/_meta/run-R1.json'], 'unreadableRunMetaExitAt',
  );
  assert.throws(() => unreadableRunMetaExitAt(l, 'plan', []), /没有读不出的 run_id/);
});

test('U1：runMetaPaths 给出 _meta 下 run-<id>.json 的绝对路径', () => {
  const l: ArchiveLayout = { archiveRoot: '/abs/.reviews', topic: 't' };
  assert.deepEqual(runMetaPaths(l, 'code', ['R1', 'R2']), [
    '/abs/.reviews/t/code/_meta/run-R1.json',
    '/abs/.reviews/t/code/_meta/run-R2.json',
  ]);
});

// ─────────── U2：源码契约 ───────────

test('U2：src/ 里（含注释）没有「重跑……会落一份可读 / 随即恢复」这类循环出口', async () => {
  const hits: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && p.endsWith('.ts')) {
        const lines = (await fs.readFile(p, 'utf8')).split('\n');
        lines.forEach((line, i) => {
          if (CIRCULAR_EXIT_PATTERNS.some((re) => re.test(line))) {
            hits.push(`${path.relative(REPO_ROOT, p)}:${i + 1}: ${line.trim()}`);
          }
        });
      }
    }
  };
  await walk(path.join(REPO_ROOT, 'src'));
  assert.deepEqual(hits, [], `源码里又出现了指回自己的出口：\n${hits.join('\n')}`);
});

// ─────────── U3：第 6、7 处接进 verifyRoundForApproval 后的真实文案 ───────────

test('U3：--await-approval 读不出本轮运行元数据 ⇒ 以共用出口段收尾，列出那一份', async () => {
  const { l, file } = await layoutWithUnreadable('R1');
  await assert.rejects(
    verifyRoundForApproval({
      cfg: defaultConfig(), layout: l, stage: 'plan', runId: 'R1',
      runIdPinned: false, runIdSource: '最新一次运行',
      recovery: await awaitApprovalRecovery(l, 'plan', 'R1'),
    }),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.MISSING_ARTIFACT, '只改文案，退出码不动');
      assert.ok(e.message.includes(APPROVAL_CHECK_META_UNREADABLE));
      assertUnreadableExit(e.message, [file], '--await-approval');
      assert.match(e.message, /不要删除或改写/, '「别动锚」随内联行挪进共用段后仍然可达（计划双审 CODEX-03）');
      return true;
    },
  );
});

test('U3：--await-approval 缺 run_id ⇒ 出口仍是「用 --run-id 指定」，不拼三档成因', async () => {
  const { l } = await layoutWithUnreadable('R1');
  const rec = await awaitApprovalRecovery(l, 'plan', null);
  assert.ok(!rec.missingRunId.includes(UNREADABLE_RUN_META_EXIT_BODY));
  assert.match(rec.missingRunId, /--run-id/);
  // runId 为 null 时读不出那一条也不拼共用段：没有文件可判成因（代码双审 r1 GLM-03）
  assert.ok(!rec.unreadableRunMeta.includes(UNREADABLE_RUN_META_EXIT_BODY), rec.unreadableRunMeta);
});

test('U3：approve 闸门项的 run_id 读不出 ⇒ 先恢复后重新 approve，恢复不了才 abandon，以共用出口段收尾', async () => {
  const { l, file } = await layoutWithUnreadable('R1');
  const recovery = await approveForkRecovery({
    layout: l, topic: TOPIC, stage: 'plan', abandonCmd: '/dual-abandon', runId: 'R1',
  });
  await assert.rejects(
    verifyRoundForApproval({
      cfg: defaultConfig(), layout: l, stage: 'plan', runId: 'R1',
      runIdPinned: true, runIdSource: '本机闸门记录', recovery,
    }),
    (e: { code?: number; message: string }) => {
      assert.equal(e.code, EXIT.MISSING_ARTIFACT);
      assertUnreadableExit(e.message, [file], 'approve（run_id 读不出）');
      const restore = e.message.indexOf('恢复后直接重新 approve');
      const abandon = e.message.indexOf('/dual-abandon');
      assert.ok(restore >= 0 && abandon > restore, `恢复要排在 abandon 之前（计划双审 AGY-01）：\n${e.message}`);
      assert.match(e.message, /重跑同样会被拒绝/, 'abandon 之后的重跑是有条件的');
      assert.match(e.message, /不要删除或改写/);
      return true;
    },
  );
});

test('U3：approve 闸门项没有 run_id ⇒ 维持 abandon 后重跑，不拼三档成因（计划双审 AGY-04）', async () => {
  const { l } = await layoutWithUnreadable('R1');
  const recovery = await approveForkRecovery({
    layout: l, topic: TOPIC, stage: 'plan', abandonCmd: '/dual-abandon', runId: null,
  });
  assert.ok(!recovery.missingRunId.includes(UNREADABLE_RUN_META_EXIT_BODY), '没有文件可判成因，拼三档成因文不对题');
  assert.ok(!recovery.unreadableRunMeta.includes(UNREADABLE_RUN_META_EXIT_BODY), '同理，null 档的读不出那一条也不拼（GLM-03）');
  await assert.rejects(
    verifyRoundForApproval({
      cfg: defaultConfig(), layout: l, stage: 'plan', runId: null,
      runIdPinned: true, runIdSource: '本机闸门记录', recovery,
    }),
    (e: { message: string }) => {
      assert.ok(e.message.includes(APPROVAL_CHECK_NO_RUN_ID));
      assert.match(e.message, /\/dual-abandon[^\n]*然后重跑该阶段双审/);
      assert.ok(!e.message.includes(UNREADABLE_RUN_META_EXIT_BODY));
      return true;
    },
  );
});
