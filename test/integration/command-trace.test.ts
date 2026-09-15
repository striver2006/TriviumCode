import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  bundleMissing,
  bundleSkipReason,
  cli,
  makeFixture,
} from '../helpers/fixture.js';
import { type StubConfig } from '../../src/trivium/adapters/stub.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import type { RunMeta } from '../../src/trivium/types.js';

/**
 * 「读即命令」形态的**端到端**接线（§11.1，M8 第 2 步）。
 *
 * ## 为什么必须走真实子进程
 *
 * 单元测试（`guard-capability.test.ts`）直调 `judgeSide` 并手工传 `capability`，
 * 那验的是**判定函数**，绕过了整条接线：
 *
 *   适配器声明 capability → review.ts 从 `adapters[c].capability` 取值
 *   → `judgeRun` 的 `capabilities` 透传 → `judgeSide` → `checkEvidence` / consulted
 *   → 五面留痕落盘
 *
 * 链条上任一环漏传或错接，单元测试全绿而故障要等到真接入第三家才以
 * 「证据恒不达标」的远因远果形态出现。
 *
 * 更要紧的是：r2 裁决把 `TraceCapability` 的挂载点从注册表改到 `CriticAdapter`，
 * **理由就是「桩适配器可以声明能力，泛化才有机器判据」**。
 * 本文件就是那个判据；没有它，那条论证只兑现了一半（r6 双审 GLM-01）。
 *
 * 全程不触碰任何厂商 CLI，不消耗配额。
 */

const TOPIC = '读即命令端到端';

/**
 * 桩七条命令在 `projectRoot` 过滤后应计入的项目内读取数。
 *
 * 逐条走查并**实跑校正**：`src/a.ts`（子 shell + 绝对）、`src/b.ts`（子 shell + 裸相对）、
 * `src/c.ts`（sed 脚本参数排除后的目标）、`README.md`（git 对象语法）、
 * `src/d.ts`（fd 重定向排除后的读取源）、`src/e.ts`（cp 的**源**，目标 `tmp/e.bak` 排除）
 * ＝ 6 条；`../Other/outside.ts` 归一后落在项目根外，由 `isUnder` 过滤掉。
 */
const EXPECTED_PROJECT_READS = 6;

/** 跑完整 --start → --wait 循环，返回 run.json 与落盘的审查文档 */
async function runCommandTrace(): Promise<{
  archiveRoot: string;
  stageDir: string;
  meta: RunMeta;
  waitOut: string;
  workerLog: string;
  runId: string;
}> {
  const { root, archiveRoot, stageDir } = await makeFixture({ topic: TOPIC });

  const stub: StubConfig = {
    // gemini 侧走「读即命令」：read_paths 恒空，全靠 command_texts 回填
    gemini: { mode: 'command_trace' },
    // glm 侧保持结构化轨迹——同一次运行里两族并存，档位必须逐侧分开记
    glm: { mode: 'ok' },
  };

  const started = await cli(
    root,
    ['review', '--start', '--stage', 'plan', '--topic', TOPIC, '--focus', '读即命令接线', '--json'],
    stub,
  );
  assert.equal(started.code, EXIT.OK, `--start 应成功：\n${started.stdout}\n${started.stderr}`);
  const candidate = extractJsonCandidate(started.stdout);
  assert.ok(candidate, `--start --json 未产出可解析 JSON：\n${started.stdout}`);
  const startJson = JSON.parse(candidate.json) as { run_id: string; run_dir: string };
  const runId = startJson.run_id;

  let exitCode: number = EXIT.STILL_RUNNING;
  let waitOut = started.stdout + started.stderr;
  for (let i = 0; i < 12 && exitCode === EXIT.STILL_RUNNING; i++) {
    const w = await cli(root, ['review', '--wait', runId, '--timeout', '20'], stub, 60_000);
    exitCode = w.code ?? EXIT.FAIL;
    waitOut += w.stdout + w.stderr;
  }
  assert.notEqual(exitCode, EXIT.STILL_RUNNING, `--wait 未在上限内收敛：\n${waitOut}`);

  const metaPath = path.join(stageDir, '_meta', `run-${runId}.json`);
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8')) as RunMeta;

  /*
   * 运行时告警打在**工作进程**里，stdio 重定向到 `<run_dir>/worker.log`，
   * 不进 `--wait` 的 stdout（`run-protocol.ts:293`：绝不继承父进程管道）。
   * 所以第五面的断言要读这个文件——起初我断言 `--wait` 输出，找错了地方。
   */
  const workerLog = await fs
    .readFile(path.join(startJson.run_dir, 'worker.log'), 'utf8')
    .catch(() => '');
  return { archiveRoot, stageDir, meta, waitOut, workerLog, runId };
}

/*
 * 五个用例共享**同一次**运行的产物（r7 双审 AGY-06）。
 *
 * 除了省掉四次流水线，更要紧的是：五面留痕断言的是**同一次运行**的五个落点，
 * 而不是五次独立运行各自的一面——后者理论上可能出现「这次这面对、那次那面对」
 * 而合起来从未同时成立。
 */
let shared: Awaited<ReturnType<typeof runCommandTrace>>;

before(async () => {
  if (bundleMissing) return;
  shared = await runCommandTrace();
});

test(
  'command-trace 侧证据达标：路径只在命令文本里，回填与 toolTotal 分档全程生效',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { meta } = shared;

    assert.equal(meta.critics.gemini?.cli_version, 'stub/0.0.0', 'worker 必须真的用了桩');
    assert.equal(
      meta.critics.gemini?.evidence_ok,
      true,
      'read_paths 恒空、tool_calls 只有 run_command——不回填且不分档就必然判证据不足，' +
        '这一条断言的就是整条接线通了',
    );
    assert.equal(meta.critics.glm?.evidence_ok, true, '结构化轨迹侧不受影响');
  },
);

test(
  '桩七条命令的提取口径被精确计数咬住（r7 AGY-05 ≡ GLM-05）',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { meta } = shared;
    /*
     * 只断言 `evidence_ok` 是**聚合**判据：七条命令里改坏任意一条
     * （把 `2>/dev/null` 换掉、把 `cp` 换成 `cat`、把 `../Other` 改成项目内路径），
     * 只要还剩 ≥ 阈值就照样绿。精确计数才咬得住桩注释承诺的那份口径清单。
     *
     * 期望值由实跑校正，不照搬静态走查——审查员没跑，我也不该照抄他们算的数。
     */
    assert.equal(
      meta.critics.gemini?.tool_calls?.project_reads,
      EXPECTED_PROJECT_READS,
      '七条命令中：五条读取源 + README.md 计入；cp 的写目标与 ../Other 的逃逸路径不计入',
    );
  },
);

test(
  '两条通道的降级档位逐侧落进 run.json（留痕第一面）',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { meta } = shared;
    const deg = meta.guard.verification_degraded;
    assert.ok(deg, 'guard.verification_degraded 必须落盘');

    // command-trace 侧：两条通道都降级
    assert.equal(deg.gemini?.readonly, 'unavailable', '被拒的写不留痕 ⇒ 尝试写的检测失效');
    assert.equal(deg.gemini?.path, 'unavailable', '路径只在命令文本里 ⇒ 措施 a 无输入可扫');
    assert.equal(
      deg.gemini?.evidence_threshold,
      2,
      '该族下限折减（默认 3 ⇒ 2），生效值必须如实记——否则两族间一过一不过看起来像 bug',
    );

    // 结构化轨迹侧：两条都可用，同一次运行里逐侧分开记
    assert.equal(deg.glm?.readonly, 'ok');
    assert.equal(deg.glm?.path, 'ok');
    assert.equal(deg.glm?.evidence_threshold, 3, '不降级的一侧用配置原值');
  },
);

test(
  '降级档位进审查文档 front-matter（留痕第二面）',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { stageDir } = shared;
    const files = await fs.readdir(stageDir);

    const geminiDoc = files.find((f) => f.endsWith('-gemini.md'));
    assert.ok(geminiDoc, 'gemini 侧审查文档应落盘');
    const gemini = await fs.readFile(path.join(stageDir, geminiDoc), 'utf8');
    assert.match(gemini, /readonly_verification: unavailable/);
    assert.match(gemini, /path_verification: unavailable/);

    const glmDoc = files.find((f) => f.endsWith('-glm.md'));
    assert.ok(glmDoc, 'glm 侧审查文档应落盘');
    const glm = await fs.readFile(path.join(stageDir, glmDoc), 'utf8');
    assert.doesNotMatch(
      glm,
      /readonly_verification|path_verification/,
      '不降级的一侧不写这两个键——恒出现的 ok 会稀释真正要看见的那一行',
    );
  },
);

test(
  '降级横幅进审查文档正文（留痕第三面）',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { stageDir } = shared;
    const files = await fs.readdir(stageDir);
    const geminiDoc = files.find((f) => f.endsWith('-gemini.md'))!;
    const gemini = await fs.readFile(path.join(stageDir, geminiDoc), 'utf8');

    assert.match(gemini, /只读核验不可用/);
    assert.match(gemini, /路径核验无结构化输入/);

    const glmDoc = files.find((f) => f.endsWith('-glm.md'))!;
    const glm = await fs.readFile(path.join(stageDir, glmDoc), 'utf8');
    assert.doesNotMatch(
      glm,
      /只读核验不可用|路径核验无结构化输入/,
      '不降级的一侧正文不出横幅（r7 AGY-04：原用例只断言了 gemini 侧含有）',
    );
  },
);

test(
  '降级两行进复盘报告 guardFlags（留痕第四面）',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { buildTopicReport } = await import('../../src/trivium/report.js');

    /*
     * 第四面此前**零判据**——而 report.ts 本轮三处新逻辑（合并展示算术、
     * 降级两行、unattributed 独立行）都没被咬住，那个重复推送的旗标
     * 正是从这个缺口溜进来的（r7 AGY-02 ≡ GLM-03）。
     *
     * 走公开的 `buildTopicReport` 而不是内部的 `buildRound`：它是复盘报告的
     * 真实入口，测的路径与用户实际跑 `report` 时一致。
     */
    const report = await buildTopicReport({ archiveRoot: shared.archiveRoot, topic: TOPIC });
    const round = report.rounds.find((r) => r.stage === 'plan');
    assert.ok(round, '应能找到本次 plan 轮次的复盘条目');
    const flags = round.guardFlags.join(' ｜ ');

    assert.match(flags, /gemini 侧只读核验不可用/);
    assert.match(flags, /gemini 侧路径核验无结构化输入/);
    assert.doesNotMatch(flags, /glm 侧只读核验不可用|glm 侧路径核验/);

    // 「无法归因」只在漂移行内以 suffix 出现，不再单独推一条
    const unattributedLines = round.guardFlags.filter((f) => f.includes('无法归因'));
    assert.ok(
      unattributedLines.length <= 1,
      `同一信息不得在 guardFlags 里并排出现两次，实际：${flags}`,
    );
  },
);

test(
  '降级两行进运行时 CLI 告警（留痕第五面）',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { workerLog } = shared;

    assert.match(
      workerLog,
      /gemini 侧只读核验不可用/,
      '既有的 peer_deny_applied 有四面留痕却独缺运行时这一面，新字段不重蹈：' +
        '降级只落在 run 元数据里，跑的人当场看不见',
    );
    assert.match(workerLog, /gemini 侧路径核验无结构化输入/);
    assert.doesNotMatch(
      workerLog,
      /glm 侧只读核验不可用|glm 侧路径核验/,
      '不降级的一侧不出告警——每次都打只会淹掉真正的降级',
    );
  },
);
