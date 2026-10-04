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
 * ## 各入选侧 Agent 用桩，且必须说清楚
 *
 * 经 `TRIVIUM_STUB_CRITIC` 注入桩适配器，因此**零配额消耗、不依赖网络**。
 * 代价是它**证明不了**那几家 CLI 可用——那是 `doctor` 与 `preflight` 的职责。
 * 这条边界必须在输出里写明：把「selftest 通过」误读成「那几侧能用」，
 * 会让人带着一个装不全的环境去跑真实任务。
 *
 * **本文件对「默认跑几侧」不持有意见**：桩集合、裁决表、落盘断言、边界声明
 * 一律按 `DEFAULT_CRITICS` 派生，注册表改了它跟着改。手点侧数或写死后缀，
 * 下一次缺省集合变动时会变成沉默的漏检——2026-09-16 r12 实际发生过一次。
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { run } from './util/exec.js';
import { initFixtureRepo } from './util/git.js';
import { tildeHome, tryRemoveTempDir } from './util/fsx.js';
import { localDate } from './naming.js';
import { DEFAULT_CRITICS } from './types.js';
import { agentById } from './agents/registry.js';
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
  /**
   * 本该删掉的夹具目录没删掉时的提示（{@link selftestResidueText}），删掉了或本就保留时为 null（EV-204）。
   * 不进 `steps`、不改 `ok`：删不掉是收尾的事，不改写已经得出的自检结论（决策三）。
   */
  cleanupResidue: string | null;
}

/** 自检夹具目录删不掉时的提示（EV-204）：主语是自检，不断言目录全貌（同 `indexResidueText`） */
export function selftestResidueText(dir: string, code: string): string {
  return (
    `自检夹具目录删除失败（${code}）：${tildeHome(dir)} 仍在——` +
    '自检只往里写了夹具文件与本次自检的审查留痕（.reviews/），没有凭据，请手工删除'
  );
}

/** 测试注入口（EV-204 计划双审 GLM-01）：只换建夹具的最后一步，`mkdtemp` 与写文件仍走生产路径 */
export interface SelftestDeps {
  initFixtureRepo: (dir: string) => Promise<void>;
}

const TOPIC = '自检任务';
const SESSION = 'selftest-session';

/**
 * 桩注入配置：**按缺省入选集合派生**，第一侧给两条意见、其余各给一条——
 * 意见数不等是为了验证逐条裁决真的逐条，而不是按侧数凑。
 *
 * 此前写死 `{gemini, glm}` 两侧。D4-4 把 codex 纳入缺省集合后，
 * 自检当场起不来：运行选了三侧，而第三侧没有桩（报「检测到 TRIVIUM_STUB_CRITIC」
 * 却缺该侧配置）。**自检要验的是「这台机器上默认那条路跑得通」**，
 * 所以它必须跟着缺省集合走，不能钉死侧数。
 */
const STUB = JSON.stringify(
  Object.fromEntries(
    DEFAULT_CRITICS.map((c, i) => [c, { mode: 'ok', findings: i === 0 ? 2 : 1 }]),
  ),
);

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
 * 把 `TRIVIUM_STUB_CRITIC` 去掉重跑，看各侧是否真能指出这个洞。
 *
 * `made.dir` 在 mkdtemp 一返回就记下（EV-204）：此前调用方写的是 `root = await buildFixture()`，
 * 中途抛出时赋值不发生，catch 里的删除恒走不到，建到一半的目录无人清理。删除只认 mkdtemp 的返回值。
 */
async function buildFixture(
  made: { dir: string | null },
  init: (dir: string) => Promise<void>,
): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-selftest-'));
  made.dir = raw;
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
      // 运行目录放到夹具旁边，不污染真实的 ~/.trivium/runs（M20）；夹具本身随 --keep-fixture 决定去留
      'runtime:',
      `  run_root: ${root}-runs`,
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

  await init(root);
  return root;
}

export async function runSelftest(
  opts: SelftestOptions = {},
  deps: SelftestDeps = { initFixtureRepo },
): Promise<SelftestResult> {
  const selfScript = opts.selfScript ?? process.argv[1];
  const steps: SelftestStep[] = [];
  /*
   * 第一条按缺省集合**派生**家数与厂商名，不手点。
   *
   * 这条边界声明的作用恰是告诉用户「自检证明不了哪几侧可用」——少说一家，
   * 用户就会带着一个装不全的环境去跑真实任务，而这正是本文件头注警告的那类失实。
   * 2026-09-16 r12：codex 进缺省集合后，此处仍只点名两家（CODEX-04 ≡ GLM-03）。
   */
  const stubbedClis = DEFAULT_CRITICS.map((c) => agentById(c)?.display ?? c).join('、');
  const notCovered = [
    `${stubbedClis} 各家 CLI 是否可调用、是否已认证——各入选侧一律走桩适配器。` +
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
      cleanupResidue: null,
    };
  }

  /*
   * 夹具的创建也要在 try 里（审查意见 AGY-06）：原先它在 try 之外，
   * mkdtemp / git init 失败会直接抛出——临时目录可能已建了一半却没人清，
   * 调用方也拿不到结构化诊断，只得到一个裸异常。
   *
   * 删除走 `made.dir`（mkdtemp 的返回值）而不是 `root`：`root` 在 buildFixture 抛出时还没被赋值（EV-204）。
   * 失败步骤的 `detail` 仍是建夹具失败的原因，删不掉另放 `cleanupResidue`，不顶替它（决策三）。
   */
  const made: { dir: string | null } = { dir: null };
  let root = '';
  try {
    root = await buildFixture(made, deps.initFixtureRepo);
  } catch (e) {
    const left = made.dir ? await tryRemoveTempDir(made.dir, []) : null;
    return {
      ok: false,
      steps: [{ name: '创建夹具仓库', ok: false, detail: (e as Error).message }],
      fixtureRoot: left ? made.dir! : '',
      kept: false,
      notCovered,
      cleanupResidue: left ? selftestResidueText(made.dir!, left.code) : null,
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
    /*
     * 按缺省集合**逐侧**核验，不写死后缀。
     *
     * 2026-09-16 r12 三侧独立指出：此处曾硬编码 `-gemini.md` 与 `-glm.md`，
     * 而同一次改造已把产出侧（STUB、addresses、裁决表）全部按 `DEFAULT_CRITICS` 派生。
     * 产出泛化、断言没跟上 = 缺省集合的首侧（codex）若没落盘，本步照样判通过——
     * 「看起来已经泛化了」比没泛化更危险。
     */
    const missingDocs = DEFAULT_CRITICS.filter(
      (c) => !docs.some((f) => f.endsWith(`-${agentById(c)?.suffix ?? c}.md`)),
    );
    record('各入选侧审查文档均已落盘', 0, 0, docs.join(', '), missingDocs.length === 0);

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
        ...DEFAULT_CRITICS.map(
          (c) => `  - ${localDate()}-${TOPIC}-${agentById(c)?.suffix ?? c}.md`,
        ),
        '---', '',
        '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |',
        '| :--- | :--- | :--- | :--- | :--- | :--- |',
        /*
         * **编号、来源与条数一律按缺省集合派生**，不写死。
         *
         * 原先是三行字面量，钉死了「两侧、第一侧两条」。D4-4 把 codex 纳入缺省之后，
         * 实际编号变成四条，而裁决件还在裁一个不存在的编号——闸门同时报
         * 「缺两条」与「有一条不在本轮结论中」。
         *
         * 派生之后本文件对「默认跑几侧」**不再有意见**：注册表改，它跟着改。
         * 意见数仍是「第一侧两条、其余各一条」，与上面 `STUB` 的构造同源，
         * 保住「逐条裁决真的逐条」这个原始意图。
         */
        ...DEFAULT_CRITICS.flatMap((c, i) => {
          const prefix = agentById(c)?.findingPrefix ?? c.toUpperCase();
          const rows = [
            `| ${prefix}-01 | ${c} | blocker | 接受 | selftest 的示例裁决：确认需要补 | §二 |`,
          ];
          if (i === 0) {
            rows.push(
              `| ${prefix}-02 | ${c} | minor | 驳回 | selftest 的示例驳回：与 §一 的目标不符 | 不改 |`,
            );
          }
          return rows;
        }),
        '',
      ].join('\n'),
      'utf8',
    );

    const check = await tv(['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--session-id', SESSION]);
    record(`裁决完整性校验通过（逐条对齐 ${DEFAULT_CRITICS.length + 1} 条意见）`, EXIT.OK, check.code, check.stdout + check.stderr);

    const artifactsAfter = await tv(['gate', '--stage', 'plan', '--topic', TOPIC, '--check-artifacts']);
    // 「四件套」是两侧时代的说法：最低工件集 = 原稿 + 各入选侧审查 + 裁决件，随缺省集合变
    record(
      `工件齐备（AC-01：原稿 + ${DEFAULT_CRITICS.length} 侧审查 + 裁决件，共 ${DEFAULT_CRITICS.length + 2} 件）`,
      EXIT.OK,
      artifactsAfter.code,
      artifactsAfter.stdout,
    );

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

  /*
   * 删不掉不抛（EV-204）：此前 `fs.rm` 从这里抛出，而调用处是不带 await 的 `return finish(…)`，
   * 拒绝不进上面的 catch、直接穿出 runSelftest，一次已经得出结论的自检崩成内部错误。
   * 删的是 `made.dir`（mkdtemp 的返回值，`root` 是它的 realpath，同一个目录）。
   *
   * `made.dir` 在这里本应非空：finish 只在建夹具成功之后可达（`!selfScript` 早退与建夹具的 catch 都不经它）。
   * 不写非空断言而显式短路（代码双审 GLM-01）：将来若多出一条建夹具成功前的 `return finish(…)`，断言不会红——
   * tryRemoveTempDir 吞掉一切抛出，会把 TypeError 的整段消息当错误码拼进提示；为 null 时夹具根根本没建出来，「无残留」是实情。
   */
  async function finish(ok: boolean): Promise<SelftestResult> {
    const keep = !ok || opts.keepFixture === true;
    const dir = made.dir;
    const left = keep || dir === null ? null : await tryRemoveTempDir(dir, []);
    return {
      ok,
      steps,
      fixtureRoot: root,
      kept: keep,
      notCovered,
      cleanupResidue: left && dir !== null ? selftestResidueText(dir, left.code) : null,
    };
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
    L.push('  去掉 TRIVIUM_STUB_CRITIC 在其中重跑一次，可检验各侧真实审查能否指出这个洞。');
  } else if (r.cleanupResidue) {
    // 没删掉就不能说「已清理」（EV-204）
    L.push(r.cleanupResidue);
  } else {
    L.push('夹具已清理。加 --keep-fixture 可保留以供手工验收（§17.3）。');
  }
  return L.join('\n');
}

/** 供 cli 调用的薄壳 */
export async function selftestCommand(opts: SelftestOptions): Promise<number> {
  say('自检：在临时夹具仓库里真跑一遍整条流水线（各入选侧走桩适配器，不消耗厂商配额）');
  const r = await runSelftest(opts);
  say(renderSelftest(r));
  return r.ok ? EXIT.OK : EXIT.FAIL;
}
