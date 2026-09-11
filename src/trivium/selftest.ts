/**
 * `trivium doctor --selftest`（设计 §16.1 M5、交付物 8 与 9）。
 *
 * M5 的完成判据是「非作者可在 15 分钟内独立装好并跑通一条任务」。那需要一个
 * 装完就能问「到底装好了没有」的命令——而不是让新用户拿自己的真实仓库当试验场。
 *
 * ## 做法：在临时夹具仓库里真跑整条流水线
 *
 * 不是 mock，不是「检查文件存在」。它建一个真 git 仓库、调**真实打包 CLI**
 * 走 plan 双审 → 闸门拦截 → 补裁决 → 闸门放行 → verify → report，
 * 逐步核对退出码与落盘结果。跑完即删。
 *
 * ## 两侧 Agent 用桩，且必须说清楚
 *
 * 经 `TRIVIUM_STUB_CRITIC` 注入桩适配器，因此**零配额消耗、不依赖网络**。
 * 代价是它**证明不了**两家 CLI 可用——那是 `doctor` 与 `preflight` 的职责。
 * 这条边界必须在输出里写明：把「selftest 通过」误读成「两侧能用」，
 * 会让人带着一个装不全的环境去跑真实任务。
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { run } from './util/exec.js';
import { initFixtureRepo } from './util/git.js';
import { localDate } from './naming.js';
import { EXIT } from './exit-codes.js';
import { STUB_ENV_VAR } from './adapters/stub.js';
import { say, step, warn } from './util/log.js';

export interface SelftestStep {
  name: string;
  ok: boolean;
  detail: string;
  /** 期望与实际的退出码，便于一眼看出差在哪 */
  expected?: number;
  actual?: number | null;
}

export interface SelftestResult {
  ok: boolean;
  steps: SelftestStep[];
  fixtureRoot: string;
  kept: boolean;
  /** 本次自检**没有**覆盖的东西，必须一并呈现 */
  notCovered: string[];
}

const TOPIC = '自检任务';
const SESSION = 'selftest-session';

/** 桩注入配置：一侧给两条意见、一侧给一条，用来验证逐条裁决真的逐条 */
const STUB = JSON.stringify({
  gemini: { mode: 'ok', findings: 2 },
  glm: { mode: 'ok', findings: 1 },
});

export interface SelftestOptions {
  /** 自身打包产物路径。默认取 process.argv[1] */
  selfScript?: string;
  assetRoot?: string | null;
  /** 失败时保留夹具目录供排查 */
  keepFixture?: boolean;
}

/**
 * 夹具仓库：一个「故意留洞」的最小项目（§17.3）。
 *
 * 留的洞是 `src/payment.ts` 里未处理的并发退款——桩适配器不会真的发现它，
 * 但真实审查会。这样同一个夹具既能给 selftest 用，也能给人拿去手工验收：
 * 把 `TRIVIUM_STUB_CRITIC` 去掉重跑，看两侧是否真能指出这个洞。
 */
async function buildFixture(): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-selftest-'));
  const root = await fs.realpath(raw);

  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'src/payment.ts'),
    [
      '/** 退款。**故意留的洞**：并发退款未做幂等，同一笔可被退两次。 */',
      'export async function refund(orderId: string, amount: number): Promise<void> {',
      '  const order = await load(orderId);',
      '  if (order.refunded) return;',
      '  await charge(-amount);',
      '  order.refunded = true;',
      '  await save(order);',
      '}',
      '',
      'declare function load(id: string): Promise<{ refunded: boolean }>;',
      'declare function charge(amount: number): Promise<void>;',
      'declare function save(o: unknown): Promise<void>;',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(root, 'README.md'),
    '# selftest 夹具\n\n一个故意留洞的最小项目：`src/payment.ts` 的并发退款没有幂等保护。\n',
    'utf8',
  );
  await fs.writeFile(path.join(root, '.gitignore'), '.trivium/state.json\n.trivium/lock/\n.trivium/logs/\n', 'utf8');

  await fs.mkdir(path.join(root, '.trivium'), { recursive: true });
  await fs.writeFile(
    path.join(root, '.trivium/config.yaml'),
    [
      'review:',
      '  timeout_s:',
      '    plan: 120',
      '    code: 120',
      '    bug: 120',
      '  wait_timeout_s: 30',
      'verify:',
      // 用一条必然成功且零副作用的命令：selftest 要验的是「verify 真的执行并记录」，
      // 不是这个夹具能不能编译
      "  build: ['echo selftest-build-ok']",
      "  test: ['echo selftest-test-ok']",
      '',
    ].join('\n'),
    'utf8',
  );

  const planDir = path.join(root, '.reviews', TOPIC, 'plan');
  await fs.mkdir(planDir, { recursive: true });
  await fs.writeFile(
    path.join(planDir, `${localDate()}-${TOPIC}-claude.md`),
    [
      '# 计划：给退款加幂等',
      '',
      '## 一、目标',
      '',
      '`src/payment.ts` 的 `refund` 在并发下可能重复退款，需要加幂等保护。',
      '',
      '## 二、步骤',
      '',
      '1. 以 `orderId` 为键加分布式锁。',
      '2. 退款前后各读一次状态。',
      '',
    ].join('\n'),
    'utf8',
  );

  await initFixtureRepo(root);
  return root;
}

export async function runSelftest(opts: SelftestOptions = {}): Promise<SelftestResult> {
  const selfScript = opts.selfScript ?? process.argv[1];
  const steps: SelftestStep[] = [];
  const notCovered = [
    'Antigravity 与 ZCode 两家 CLI 是否可调用、是否已认证——两侧一律走桩适配器。' +
      '请另跑 `trivium doctor` 与 `trivium preflight`。',
    '真实模型的审查质量：桩产出的是固定假数据，不代表任何真实结论。',
    '路径级 deny 等隔离机制的厂商侧行为（M0 探针的职责）。',
  ];

  if (!selfScript) {
    return {
      ok: false,
      steps: [{ name: '定位自身脚本', ok: false, detail: '拿不到 process.argv[1]，无法自调用' }],
      fixtureRoot: '',
      kept: false,
      notCovered,
    };
  }

  /*
   * 夹具的创建也要在 try 里（审查意见 AGY-06）：原先它在 try 之外，
   * mkdtemp / git init 失败会直接抛出——临时目录可能已建了一半却没人清，
   * 调用方也拿不到结构化诊断，只得到一个裸异常。
   */
  let root = '';
  try {
    root = await buildFixture();
  } catch (e) {
    if (root) await fs.rm(root, { recursive: true, force: true });
    return {
      ok: false,
      steps: [{ name: '创建夹具仓库', ok: false, detail: (e as Error).message }],
      fixtureRoot: root,
      kept: false,
      notCovered,
    };
  }

  const env: Record<string, string | undefined> = {
    [STUB_ENV_VAR]: STUB,
    CLAUDE_SESSION_ID: SESSION,
    ...(opts.assetRoot ? { TRIVIUM_ASSET_ROOT: opts.assetRoot } : {}),
  };

  const tv = (args: string[], stdin?: string) =>
    run(process.execPath, [selfScript, ...args], {
      cwd: root,
      env,
      timeoutMs: 180_000,
      ...(stdin !== undefined ? { stdin } : {}),
    });

  const record = (
    name: string,
    expected: number,
    actual: number | null,
    detail: string,
    extraOk = true,
  ): boolean => {
    const ok = actual === expected && extraOk;
    steps.push({ name, ok, detail, expected, actual });
    if (ok) step(`✓ ${name}`);
    else warn(`✗ ${name}（期望退出码 ${expected}，实际 ${actual}）：${detail}`);
    return ok;
  };

  let runId = '';
  try {
    // ① 双审跑通并落盘两份文档
    const review = await tv([
      'review', '--start', '--stage', 'plan', '--topic', TOPIC,
      '--focus', '并发与幂等', '--session-id', SESSION, '--json',
    ]);
    const m = /"run_id"\s*:\s*"([^"]+)"/.exec(review.stdout);
    runId = m?.[1] ?? '';
    if (!record('双审启动（review --start）', EXIT.OK, review.code, review.stdout + review.stderr, runId !== '')) {
      return finish(false);
    }

    let waitCode: number | null = EXIT.STILL_RUNNING;
    for (let i = 0; i < 12 && waitCode === EXIT.STILL_RUNNING; i++) {
      const w = await tv(['review', '--wait', runId, '--timeout', '20']);
      waitCode = w.code;
    }
    if (!record('双审收敛（review --wait）', EXIT.OK, waitCode, '轮询到终态')) return finish(false);

    const planDir = path.join(root, '.reviews', TOPIC, 'plan');
    const docs = await fs.readdir(planDir);
    const bothSides = docs.some((f) => f.endsWith('-gemini.md')) && docs.some((f) => f.endsWith('-glm.md'));
    record('两侧审查文档均已落盘', 0, 0, docs.join(', '), bothSides);

    // ② 裁决未齐备：工件校验与两个 Hook 都必须拦
    const artifactsBefore = await tv(['gate', '--stage', 'plan', '--topic', TOPIC, '--check-artifacts']);
    record('缺裁决件时工件校验报缺（退 65）', EXIT.MISSING_ARTIFACT, artifactsBefore.code, artifactsBefore.stdout);

    const commitEvent = JSON.stringify({
      session_id: SESSION, tool_name: 'Bash', tool_input: { command: 'git commit -m x' },
    });
    const preCommit = await tv(['gate', 'hook-pre-commit'], commitEvent);
    record('裁决未齐备时禁止提交（Hook 退 2）', EXIT.GATE_BLOCK, preCommit.code, preCommit.stderr);

    const stopEvent = JSON.stringify({ session_id: SESSION, hook_event_name: 'Stop' });
    const stop = await tv(['gate', 'hook-stop'], stopEvent);
    record('裁决未齐备时禁止收工（Hook 退 2）', EXIT.GATE_BLOCK, stop.code, stop.stdout);

    // ③ 补齐裁决 → 校验通过 → 闸门放行
    await fs.writeFile(
      path.join(planDir, `${localDate()}-${TOPIC}-revised-claude.md`),
      [
        '---', 'schema: trivium.disposition.v1', `topic: ${TOPIC}`, 'stage: plan',
        'role: claude', 'kind: revised', `run_id: ${runId}`,
        'addresses:',
        `  - ${localDate()}-${TOPIC}-gemini.md`,
        `  - ${localDate()}-${TOPIC}-glm.md`,
        '---', '',
        '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |',
        '| :--- | :--- | :--- | :--- | :--- | :--- |',
        '| AGY-01 | gemini | blocker | 接受 | selftest 的示例裁决：确认需要补 | §二 |',
        '| AGY-02 | gemini | minor | 驳回 | selftest 的示例驳回：与 §一 的目标不符 | 不改 |',
        '| GLM-01 | glm | blocker | 接受 | selftest 的示例裁决：同一处并发问题 | §二 |',
        '',
      ].join('\n'),
      'utf8',
    );

    const check = await tv(['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--session-id', SESSION]);
    record('裁决完整性校验通过（逐条对齐三条意见）', EXIT.OK, check.code, check.stdout + check.stderr);

    const artifactsAfter = await tv(['gate', '--stage', 'plan', '--topic', TOPIC, '--check-artifacts']);
    record('工件齐备（AC-01 四件套）', EXIT.OK, artifactsAfter.code, artifactsAfter.stdout);

    const preCommit2 = await tv(['gate', 'hook-pre-commit'], commitEvent);
    record('裁决齐备后放行提交', EXIT.OK, preCommit2.code, preCommit2.stderr);

    const stop2 = await tv(['gate', 'hook-stop'], stopEvent);
    record('裁决齐备后放行收工', EXIT.OK, stop2.code, stop2.stdout);

    // ④ 伪造角色后缀必须被拦，与闸门状态无关
    const forge = await tv(
      ['gate', 'hook-pre-write'],
      JSON.stringify({
        session_id: SESSION, tool_name: 'Write',
        tool_input: { file_path: path.join(planDir, `${localDate()}-${TOPIC}-r9-gemini.md`) },
      }),
    );
    record('禁止主脑自行产出 -gemini.md（AC-07）', EXIT.GATE_BLOCK, forge.code, forge.stderr);

    // ⑤ 编译测试出口真实执行
    const verify = await tv(['verify', '--topic', TOPIC]);
    const verifyOk = /selftest-build-ok/.test(verify.stdout) || verify.code === EXIT.OK;
    record('编译测试出口真实执行并落盘（AC-10）', EXIT.OK, verify.code, verify.stdout, verifyOk);

    // ⑥ 复盘可生成
    const report = await tv(['report', '--topic', TOPIC]);
    const hasSections = /时间线/.test(report.stdout) && /采纳率/.test(report.stdout);
    record('复盘可生成（含时间线与采纳率）', EXIT.OK, report.code, report.stdout.slice(0, 200), hasSections);

    // ⑦ 重跑不覆盖
    const firstDoc = path.join(planDir, `${localDate()}-${TOPIC}-gemini.md`);
    const before = await fs.readFile(firstDoc);
    const rerun = await tv([
      'review', '--stage', 'plan', '--topic', TOPIC, '--focus', '再审一次', '--session-id', SESSION,
    ]);
    const unchanged = Buffer.compare(await fs.readFile(firstDoc), before) === 0;
    const bumped = (await fs.readdir(planDir)).some((f) => f.includes('-r2-'));
    record('重跑抬升 -r2 且首轮字节不变（FR-25 / P6）', EXIT.OK, rerun.code, `字节不变=${unchanged} 抬轮=${bumped}`, unchanged && bumped);

    return finish(steps.every((s) => s.ok));
  } catch (e) {
    steps.push({ name: '自检过程异常', ok: false, detail: (e as Error).message });
    return finish(false);
  }

  async function finish(ok: boolean): Promise<SelftestResult> {
    const keep = !ok || opts.keepFixture === true;
    if (!keep) {
      await fs.rm(root, { recursive: true, force: true });
    }
    return { ok, steps, fixtureRoot: root, kept: keep, notCovered };
  }
}

export function renderSelftest(r: SelftestResult): string {
  const passed = r.steps.filter((s) => s.ok).length;
  const L: string[] = ['', `自检：${r.ok ? '✅ 通过' : '❌ 未通过'}（${passed}/${r.steps.length} 步）`, ''];

  // 每一步在执行时已经逐条打过了，这里**只**复述失败项，免得同一份清单出现两遍
  for (const s of r.steps.filter((x) => !x.ok)) {
    L.push(`  ✗ ${s.name}`);
    if (s.expected !== undefined) L.push(`      期望退出码 ${s.expected}，实际 ${s.actual}`);
    for (const d of s.detail.trim().split('\n').slice(0, 6)) L.push(`      ${d}`);
  }
  if (!r.ok) L.push('');
  L.push('本次自检**未**覆盖：');
  for (const n of r.notCovered) L.push(`  · ${n}`);
  L.push('');
  if (r.kept) {
    L.push(`夹具保留在 ${r.fixtureRoot}`);
    L.push('  它是一个故意留洞的最小项目（src/payment.ts 的并发退款没有幂等保护）。');
    L.push('  去掉 TRIVIUM_STUB_CRITIC 在其中重跑一次，可检验两侧真实审查能否指出这个洞。');
  } else {
    L.push('夹具已清理。加 --keep-fixture 可保留以供手工验收（§17.3）。');
  }
  return L.join('\n');
}

/** 供 cli 调用的薄壳 */
export async function selftestCommand(opts: SelftestOptions): Promise<number> {
  say('自检：在临时夹具仓库里真跑一遍整条流水线（两侧走桩适配器，不消耗厂商配额）');
  const r = await runSelftest(opts);
  say(renderSelftest(r));
  return r.ok ? EXIT.OK : EXIT.FAIL;
}
