import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { ASSET_ROOT, BUNDLE, bundleMissing, bundleSkipReason, cli, makeFixture } from '../helpers/fixture.js';
import { groupsWithMark, killGroup } from '../helpers/proc.js';
import { SH } from '../helpers/platform.js';
import { newStatus, writeStatus } from '../../src/trivium/status.js';
import { processStartTime, run } from '../../src/trivium/util/exec.js';
import { repoId } from '../../src/trivium/review.js';

/**
 * EV-164：`trivium scrub` 的人读输出与帮助里两处失实文字改准（清扫输出失实文字计划 r2 §4.1 T1～T6；
 * T7 钉住核后不改的会话启动第四格，代码双审 r1 CODEX-04）。
 *
 * 人读渲染在 `cmdScrub` 里、不导出，所以走真实打包产物。期望块由用例用自己派生的组号、运行目录绝对路径与运行根插值生成，
 * stdout 不做任何归一化、整段逐字比（计划双审 r1 CODEX-01）——这同时钉住「其余人读行逐字不变」，此前没有任何用例守着它。
 *
 * 夹具：运行根下两个别的项目的桶（`scrub` 要补的跨仓那一格）。桶内 `readdir` 不排序、桶名由 `scrubAllRunRoot` 排序，
 * 所以两条第四格分放 `aa-` / `bb-` 两个桶，顺序由代码自己定（GLM-01）。A 格的 CLI 组是真实的 detached `sh`，
 * 挂 600 s（与桩 `hang_cli` 对齐，GLM-02），finally 里按组结束、再按标记兜底；worker 用已退出的 pid。
 *
 * EV-166（清扫帮助主句失实计划 r2 §4.1）：帮助动机句的主句改写——到期整删与凭据抹除都只在那个仓库自己的会话启动时跑，
 * 不再回去就没有任何自动清理（此前「副本会一直躺到 retention.run_dir_days 整删」失实）。T5 的逐字期望随之更新，
 * 新增 T8 钉语义要素与「不产生新的最宽行」；T1～T4、T6、T7 不动。
 */

const MARK = 'trivium-it-scrub-text';
const HINT = '    CLI 结束后再跑会重判；「记录读不懂」不会自愈，需把该侧 cli 改回 null（到期整删也会保留它）';
const OLD_HALF = '或等 run_dir_days 整删';
const MOTIVE =
  '      到期整删也只在它的会话启动时跑（记录里的审查员 CLI 仍在、判不了或读不懂时到期也不删）；不再回到那个仓库就没有任何自动清理，这条命令只补抹凭据。';
const OLD_MOTIVE = '副本会一直躺到 retention.run_dir_days 整删。';
/** EV-164 那一版的整句（EV-166 改写前） */
const EV164_MOTIVE =
  '      不再回到那个仓库时，副本会一直躺到 retention.run_dir_days 整删（那一轮记录里的审查员 CLI 仍在、判不了或读不懂时，到期也不删）。这条命令补那一格。';
const MALFORMED = { pgid: 'not-a-number' };

/** 一个已退出的 worker pid，连同它生前的两种启动时刻 */
async function deadWorker(): Promise<{ pid: number; legacy: string | null; canonical: string | null }> {
  const c = spawn(SH, ['-c', 'sleep 30'], { stdio: 'ignore' });
  const exited = new Promise<void>((r) => c.once('exit', () => r()));
  const pid = c.pid!;
  const legacy = await processStartTime(pid);
  const canonical = await processStartTime(pid, { canonical: true });
  c.kill('SIGKILL');
  await exited;
  return { pid, legacy, canonical };
}

type Cell = 'A' | 'D' | 'E';

interface Scene {
  root: string;
  runRoot: string;
  dirs: Partial<Record<Cell, string>>;
  carriers: Partial<Record<Cell, string>>;
  pgid: number | null;
  tag: string;
  stop: () => Promise<void>;
}

/** 一个运行目录：status.json（worker 已退出、glm 侧记录为 cliRec）+ glm 侧一份 zcode 载体 */
async function runDir(d: string, runId: string, dead: Awaited<ReturnType<typeof deadWorker>>, cliRec: unknown) {
  const carrier = path.join(d, 'glm', 'home', '.zcode', 'cli', 'config.json');
  await fs.mkdir(path.dirname(carrier), { recursive: true });
  await fs.writeFile(carrier, '{"provider":{"k":{"apiKey":"fake"}}}');
  await fs.mkdir(path.join(d, 'glm', 'out'), { recursive: true });
  const s = newStatus({ runId, topic: '清扫文字用例', stage: 'plan', sides: ['gemini', 'glm'], models: {} });
  s.phase = 'running';
  s.worker_pid = dead.pid;
  s.worker_started_at = dead.legacy;
  s.worker_started_at_canonical = dead.canonical;
  (s.sides.glm as unknown as Record<string, unknown>)['cli'] = cliRec;
  await writeStatus(d, s);
  return carrier;
}

/**
 * 按格布置运行根：A、E 进 `aa-ev164-other`，D 进 `bb-ev164-other`。
 * 清理在派生那一刻就登记：派生之后的搭建若抛出，先结束已派生的组再重抛——否则调用方拿不到 `stop()`，
 * 600 s 的组只能等自然结束（代码双审 r1 CODEX-02 ≡ GLM-01）。
 */
async function scene(cells: Cell[]): Promise<Scene> {
  const fx = await makeFixture({ topic: '清扫文字用例', draft: false });
  const runRoot = fx.runRoot;
  const tag = `${MARK}:${fx.root}`;
  const held = { pgid: null as number | null, exited: Promise.resolve() };
  const stop = async () => {
    if (held.pgid !== null) {
      killGroup(held.pgid);
      await held.exited;
    }
    for (const g of groupsWithMark(tag)) killGroup(g);
  };
  try {
    const dead = await deadWorker();
    const dirs: Scene['dirs'] = {};
    const carriers: Scene['carriers'] = {};
    for (const cell of cells) {
      let cliRec: unknown = null;
      if (cell === 'A') {
        const g = spawn(SH, ['-c', 'sleep 600; : "$0"', tag], { detached: true, stdio: 'ignore' });
        held.exited = new Promise<void>((r) => g.once('exit', () => r()));
        held.pgid = g.pid!;
        const startedAt = await processStartTime(held.pgid, { canonical: true });
        assert.ok(startedAt, `组长 ${held.pgid} 的启动时刻应已取到（用例前提）`);
        cliRec = { pgid: held.pgid, started_at: startedAt };
      } else if (cell === 'D') {
        cliRec = MALFORMED;
      }
      const d = path.join(runRoot, cell === 'D' ? 'bb-ev164-other' : 'aa-ev164-other', `R-${cell}`);
      carriers[cell] = await runDir(d, `R-${cell}`, dead, cliRec);
      dirs[cell] = d;
    }
    return { root: fx.root, runRoot, dirs, carriers, pgid: held.pgid, tag, stop };
  } catch (e) {
    await stop();
    throw e;
  }
}

const exists = (p: string) => fs.access(p).then(() => true, () => false);

/** A、D 两行第四格（A 在 aa- 桶、D 在 bb- 桶，按桶名定序） */
function fourthCell(s: Scene): string[] {
  return [
    `  · 因审查员 CLI 未动：${s.dirs.A}（glm 侧审查员 CLI 进程组 ${s.pgid} 仍在）`,
    `  · 因审查员 CLI 未动：${s.dirs.D}（CLI 记录读不懂（glm：${JSON.stringify(MALFORMED)}）：判不了）`,
  ];
}

const lines = (out: string) => out.replace(/\n+$/, '').split('\n');

test('EV-164 T1：真跑，A / D / E 三格——stdout 整段逐字（新提示行恰一次，其余人读行不变）；A / D 不抹、E 已抹', { skip: bundleMissing && bundleSkipReason }, async () => {
  const s = await scene(['A', 'D', 'E']);
  try {
    const r = await cli(s.root, ['scrub']);
    assert.equal(r.code, 0);
    assert.deepEqual(lines(r.stdout), [
      `运行根：${s.runRoot}`,
      '项目桶 2 个 ｜ 运行目录 3 个 ｜ 进行中跳过 0 个',
      '  · 侧层已收工 0 个（哨兵已记完成；运行目录层仍会复查，那层不写哨兵）',
      '  · 已抹除 1 个运行目录的凭据副本',
      ...fourthCell(s),
      HINT,
    ]);
    assert.ok(!r.stdout.includes(OLD_HALF), '走不通的出口「或等 run_dir_days 整删」不该再出现');
    assert.ok(await exists(s.carriers.A!), 'A 格（CLI 仍在）不抹');
    assert.ok(await exists(s.carriers.D!), 'D 格（记录读不懂）不抹');
    assert.ok(!(await exists(s.carriers.E!)), 'E 格（没有记录）已抹');
  } finally {
    await s.stop();
  }
});

test('EV-164 T2：--dry-run，同一现场——stdout 整段逐字（预览行、第四格与新提示行）；盘上什么都不动', { skip: bundleMissing && bundleSkipReason }, async () => {
  const s = await scene(['A', 'D', 'E']);
  try {
    const r = await cli(s.root, ['scrub', '--dry-run']);
    assert.equal(r.code, 0);
    assert.deepEqual(lines(r.stdout), [
      `运行根：${s.runRoot}`,
      '项目桶 2 个 ｜ 运行目录 3 个 ｜ 进行中跳过 0 个',
      '  · 侧层已收工 0 个（哨兵已记完成；运行目录层仍会复查，那层不写哨兵）',
      '  · 侧层本会抹 1 个运行目录（--dry-run，盘上什么都没动）',
      `      ${s.dirs.E}`,
      '    预览只预测侧层：运行目录层是否有活取决于交接包正文是否命中，不读正文答不了',
      ...fourthCell(s),
      HINT,
    ]);
    for (const c of ['A', 'D', 'E'] as Cell[]) assert.ok(await exists(s.carriers[c]!), `dry-run 不动格 ${c} 的载体`);
  } finally {
    await s.stop();
  }
});

test('EV-164 T3：没有第四格——stdout 整段逐字，不打提示行（触发条件不变）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const s = await scene(['E']);
  try {
    const r = await cli(s.root, ['scrub']);
    assert.equal(r.code, 0);
    assert.deepEqual(lines(r.stdout), [
      `运行根：${s.runRoot}`,
      '项目桶 1 个 ｜ 运行目录 1 个 ｜ 进行中跳过 0 个',
      '  · 侧层已收工 0 个（哨兵已记完成；运行目录层仍会复查，那层不写哨兵）',
      '  · 已抹除 1 个运行目录的凭据副本',
    ]);
  } finally {
    await s.stop();
  }
});

test('EV-164 T4：--json，同一现场——15 个键不变，deferred_cli 的 detail 逐字，没有任何人读行', { skip: bundleMissing && bundleSkipReason }, async () => {
  const s = await scene(['A', 'D', 'E']);
  try {
    const r = await cli(s.root, ['scrub', '--json']);
    assert.equal(r.code, 0);
    const js = JSON.parse(r.stdout) as Record<string, unknown>;
    assert.deepEqual(Object.keys(js), [
      'ok', 'dry_run', 'buckets', 'visited', 'alive', 'eligible', 'settled', 'scrubbed', 'run_dir_redacted',
      'scrub_failed', 'unknown', 'deferred', 'deferred_cli', 'incomplete', 'unreadable_buckets',
    ]);
    const detail = Object.fromEntries((js['deferred_cli'] as { dir: string; detail: string }[]).map((x) => [x.dir, x.detail]));
    assert.deepEqual(detail, {
      [s.dirs.A!]: `glm 侧审查员 CLI 进程组 ${s.pgid} 仍在`,
      [s.dirs.D!]: `CLI 记录读不懂（glm：${JSON.stringify(MALFORMED)}）：判不了`,
    });
    assert.ok(!r.stdout.includes('CLI 结束后再跑会重判'), '--json 不打人读行');
    assert.ok(!r.stdout.includes('运行根：'));
  } finally {
    await s.stop();
  }
});

/*
 * 不钉 USAGE 的全局行数（代码双审 r1 CODEX-03）：它与这两处文字无关，钉住会让下一次任何正当的帮助改动红在这里。
 * 「动机句仍是一行」由下面 scrub 一节的整段逐字守住（拆成两行这一节就不等）；新旧全局行数的对照在验收 B1。
 */
test('EV-164 T5：--help 的 trivium scrub 一节整段逐字（动机句 EV-166 改写、仍是一行，其余 9 行不变）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: '清扫文字用例', draft: false });
  const r = await cli(fx.root, ['--help']);
  assert.equal(r.code, 0);
  const all = lines(r.stdout);
  const i = all.indexOf('  trivium scrub [--dry-run] [--json]');
  assert.ok(i >= 0, '帮助里应有 trivium scrub 一节');
  const end = all.indexOf('', i);
  assert.deepEqual(all.slice(i, end), [
    '  trivium scrub [--dry-run] [--json]',
    '      对**整个运行根**做一次凭据清扫：只抹凭据、**不删任何目录**（BACKLOG EV-33）。',
    '      会话启动清扫只覆盖本项目的桶，别的仓库遗留的副本要等它自己再开一次会话；',
    MOTIVE,
    '      --dry-run  列出「侧层本会抹哪些运行目录」，不动盘上任何文件。',
    '                 **只预测侧层**：运行目录那一层（request.json 等）没有哨兵、每轮都复查，',
    '                 有没有活取决于正文是否命中密钥，不读正文答不了——预览不该为此整份读它们。',
    '      判据与会话启动清扫同源：worker 现势活着的不动，status.json 读不到的一律跳过并计数',
    '      （抹除不可逆，读不到状态就没有证据说它已经跑完）；准入未过而状态读得到的单列一格，',
    '      不让任何一类看过的目录哪一格都不进。',
  ]);
  assert.ok(!r.stdout.includes(OLD_MOTIVE), '旧动机句不该再出现');
  assert.ok(!r.stdout.includes(EV164_MOTIVE), 'EV-164 版动机句不该再出现');
});

/**
 * 显示宽度：Unicode East Asian Width（UAX #11）为 W / F 的码位记 2，其余一律记 1——含二义宽度 A 类
 * （如 preflight 那一行里的「…」U+2026）。只列帮助文本可能用到的 W / F 主要区段，不是完整的 EAW 表。
 * 断言只用相对不变量（不产生新的最宽行），对 A 类取 1 还是 2 不敏感（清扫帮助主句失实计划 r2 §2.1，GLM-01）。
 * **前提**：本表只覆盖当前帮助文本用到的码位，未含组合标记（应记 0）、变体选择符（如 U+FE0F）与部分 W 区段
 * （如 U+1F680–1F6FF、Tangut）；帮助里新增 emoji、变体选择符或生僻文字之前先补表（代码双审 r1 CODEX-03）。
 */
function displayWidth(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const wide =
      (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0x303e) || (c >= 0x3041 && c <= 0x33ff) ||
      (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xa000 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1f64f) ||
      (c >= 0x1f900 && c <= 0x1f9ff) || (c >= 0x20000 && c <= 0x3fffd);
    n += wide ? 2 : 1;
  }
  return n;
}

/*
 * T5 钉措辞，T8 钉语义要素：将来有人重写这句，T5 必然要改，T8 守住「不许再承诺整删、事实要素不许丢、不许变成最宽行」
 * （清扫帮助主句失实计划 r2 §4.1；宽度断言 r2 CODEX-03）。
 *
 * 宽度断言的耦合面（代码双审 r1 CODEX-01）：上界取「帮助其余各行的最大宽度」，是用户约束「不超过 USAGE 现有最宽行」的直译，
 * 不钉 151 这个数。别处写宽不会让它红（上界只会变大）；只在两种情况下红——动机句自己变宽，或现有最宽行
 * （今天是 preflight 那一行）被改窄到动机句以下。后者与本句无关，所以失败文案带出最宽行原文，红的人不必反推。
 */
test('EV-166 T8：帮助不再承诺「躺到整删」；动机句带齐事实要素、不产生新的最宽行', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: '清扫文字用例', draft: false });
  const r = await cli(fx.root, ['--help']);
  assert.equal(r.code, 0);
  const all = lines(r.stdout);
  const promise = all.filter((l) => l.includes('躺到') && l.includes('整删'));
  assert.deepEqual(promise, [], '帮助里不该再有同时含「躺到」与「整删」的行');
  const i = all.indexOf('  trivium scrub [--dry-run] [--json]');
  assert.ok(i >= 0, '帮助里应有 trivium scrub 一节');
  const motive = all.slice(i, all.indexOf('', i)).find((l) => l.includes('没有任何自动清理'));
  assert.ok(motive !== undefined, 'scrub 一节应写明「没有任何自动清理」');
  for (const part of ['到期整删也只在它的会话启动时跑', '不再回到那个仓库就没有任何自动清理', '仍在、判不了或读不懂时到期也不删']) {
    assert.ok(motive.includes(part), `动机句应含「${part}」，实得：${motive}`);
  }
  const rest = all.filter((l) => l !== motive);
  const widths = rest.map(displayWidth);
  const max = Math.max(...widths);
  assert.ok(
    displayWidth(motive) <= max,
    `动机句宽 ${displayWidth(motive)}，不应超过帮助其余各行的最大宽度 ${max}（最宽行：${rest[widths.indexOf(max)]}）`,
  );
});

/*
 * 会话启动提示的第四格：本主题逐句核过、判「不失实、不改」（计划 r2 §2.3），此前没有进 CI 的逐字用例（代码双审 r1 CODEX-04）。
 * 只放一格（D，记录读不懂，不起进程）：「首个」取桶内 readdir 的第一条，两格以上顺序不定。
 */
test('EV-164 T7：会话启动提示第四格整行逐字（「CLI 结束后下次会话会再判；记录读不懂的不会自愈」不改）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: '清扫文字用例', draft: false });
  const d = path.join(fx.runRoot, repoId(fx.root), 'R-D');
  const carrier = await runDir(d, 'R-D', await deadWorker(), MALFORMED);
  const r = await run(process.execPath, [BUNDLE, 'gate', 'hook-session-start'], {
    cwd: fx.root,
    env: { TRIVIUM_ASSET_ROOT: ASSET_ROOT, CLAUDE_SESSION_ID: 'S-清扫文字' },
    stdin: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'S-清扫文字' }),
    timeoutMs: 30_000,
  });
  assert.equal(r.code, 0);
  const ctx = (JSON.parse(r.stdout) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext ?? '';
  assert.ok(
    ctx.split('\n').includes(
      '  · 1 个运行目录因审查员 CLI 进程组记录未动（CLI 仍在／判不了／记录读不懂）——' +
        `CLI 结束后下次会话会再判；记录读不懂的不会自愈。首个：${d}（CLI 记录读不懂（glm：${JSON.stringify(MALFORMED)}）：判不了）`,
    ),
    `第四格那一行应逐字不变，实得：\n${ctx}`,
  );
  assert.ok(await exists(carrier), '记录读不懂：不抹');
});

test('EV-164 T6：scrub --help、help、无参数都与 --help 逐字相同、退出码 0', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({ topic: '清扫文字用例', draft: false });
  const base = await cli(fx.root, ['--help']);
  for (const argv of [['scrub', '--help'], ['help'], []]) {
    const r = await cli(fx.root, argv);
    assert.equal(r.code, 0, `trivium ${argv.join(' ')}`);
    assert.equal(r.stdout, base.stdout, `trivium ${argv.join(' ')} 与 --help 逐字相同`);
  }
});
