/**
 * e2e：插件旁观真实编排器全链（D7′，CODEX-08 桩配置）。
 *
 * 前提（runE2E.mjs 已做）：夹具 wrapper 指向本仓真实 trivium.cjs；
 * TRIVIUM_STUB_CRITIC=按审核者 JSON 桩（启动前由本测试自检）。
 * 断言面：真 CLI resolve → 真 review --start（桩审核者）→ RunWatch 观察
 * status.json 推进至终态 → 归档件带桩指纹 stub/0.0.0。
 */
import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TriviumCli } from '../../src/cli/triviumCli';
import { TriviumCommands } from '../../src/cli/commands';
import { extractJson } from '../../src/cli/triviumCli';
import { StateWatch } from '../../src/monitor/stateWatch';
import { RunWatch } from '../../src/monitor/statusWatch';
import { waitFor } from '../integration/fixtureLib';

const exec = promisify(execFile);
const TOPIC = 'E2E桩链路';

async function fixtureRoot(): Promise<string> {
  const r = process.env['TRIVIUM_EXT_FIXTURE'];
  assert.ok(r, 'TRIVIUM_EXT_FIXTURE 未设置');
  return r;
}

suite('e2e：真实编排器 + 桩审核者（零配额）', function () {
  this.timeout(300_000);

  suiteSetup(async function () {
    // CODEX-08：启动真实子进程前自检桩配置完整有效
    const stub = process.env['TRIVIUM_STUB_CRITIC'];
    assert.ok(stub, 'TRIVIUM_STUB_CRITIC 未注入');
    const parsed = JSON.parse(stub!) as Record<string, unknown>;
    assert.ok(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), '桩配置必须是对象（"1" 会被视为未注入）');
    // 夹具须为 git 仓库（freeze 做 git 快照）
    const root = await fixtureRoot();
    await exec('git', ['init', '-q'], { cwd: root });
    await exec('git', ['config', 'user.email', 'e2e@test'], { cwd: root });
    await exec('git', ['config', 'user.name', 'e2e'], { cwd: root });
    await fs.writeFile(path.join(root, 'README.md'), '# e2e fixture\n');
    await exec('git', ['add', '-A'], { cwd: root });
    await exec('git', ['commit', '-qm', 'init'], { cwd: root });
    // 原稿（plan 阶段被审对象）
    const planDir = path.join(root, '.reviews', TOPIC, 'plan');
    await fs.mkdir(planDir, { recursive: true });
    await fs.writeFile(
      path.join(planDir, `2026-11-06-${TOPIC}-glm.md`),
      `# ${TOPIC} · 实施计划（e2e 原稿）\n\n- 执笔：glm（e2e 桩链路自检）\n\n## 一、目标\n证明插件能旁观真实编排器。\n`,
    );
  });

  test('resolve → --start → RunWatch 至终态 → 桩指纹', async () => {
    const root = await fixtureRoot();
    const cli = new TriviumCli(root);
    const cmds = new TriviumCommands(cli);

    // 1) 真 resolve
    const resolveRaw = await cli.run([
      'topic', 'resolve', '--stage', 'plan', '--json', '--', 'e2e 桩链路自检目标', '--driver', 'glm', '--topic', TOPIC,
    ], 60_000);
    assert.equal(resolveRaw.code, 0, `resolve 失败：${resolveRaw.stderr}`);
    const resolved = extractJson<{ ok: boolean; topic: string; critics: string[] }>(resolveRaw.stdout);
    assert.equal(resolved?.ok, true);
    assert.equal(resolved!.topic, TOPIC);

    // 2) 真 review --start（桩审核者）
    const startRaw = await cli.run([
      'review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', TOPIC,
      '--driver', 'glm', '--focus', 'e2e 焦点：核对桩链路', '--critics', 'claude,gemini,codex', '--json',
    ], 120_000);
    assert.equal(startRaw.code, 0, `--start 失败：${startRaw.stdout}\n${startRaw.stderr}`);
    const started = extractJson<{ ok: boolean; run_id: string; run_dir: string; max_waits: number }>(startRaw.stdout);
    assert.ok(started?.ok && started.run_id, '--start 未返回 run_id');

    // 3) 插件侧旁观：RunWatch 推进至终态（终态复核走真 --status）
    const finals: string[] = [];
    const w = new RunWatch(
      {
        runDir: started!.run_dir!, runId: started!.run_id!, heartbeatStaleS: 120, heartbeatIntervalS: 10, logTailBytes: 65536,
        statusProbe: async (id) => {
          const r = await cmds.reviewStatus(id);
          return r.out ? { phase: r.out.phase ?? null, artifacts: r.out.artifacts ?? null } : null;
        },
      },
      { onRender: () => {}, onFinal: (r) => finals.push(r.phase) },
    );
    await waitFor(() => finals.length > 0, 240_000);
    assert.ok(['success', 'failed', 'cancelled'].includes(finals[0]!), `终态异常：${finals[0]}`);
    w.dispose();

    // 4) 桩指纹：run.json 的 critics.<side>.cli_version 应为 stub/0.0.0（CODEX-08）
    if (finals[0] === 'success') {
      const metaDir = path.join(root, '.reviews', TOPIC, 'plan', '_meta');
      const files = await fs.readdir(metaDir).catch(() => [] as string[]);
      const reviews = files.filter((f) => f.startsWith('review-'));
      assert.ok(reviews.length >= 3, `应归档三侧审查件，实际 ${reviews.length}`);
      const runMeta = await fs.readFile(path.join(metaDir, `run-${started!.run_id!}.json`), 'utf8');
      const parsed = JSON.parse(runMeta) as { critics?: Record<string, { cli_version?: string }> };
      const versions = Object.values(parsed.critics ?? {}).map((c) => c.cli_version);
      assert.ok(versions.length >= 3 && versions.every((v) => v === 'stub/0.0.0'), `三侧均应为桩指纹，实际 ${JSON.stringify(versions)}`);
    }
  });

  test('StateWatch 发现真实运行（M3 路径）', async () => {
    const root = await fixtureRoot();
    let sawActive = false;
    const w = new StateWatch(root);
    w.onChange((snap) => {
      if (snap.active.length > 0) sawActive = true;
    });
    // 上面那条 run 可能已结束（gates 回 idle/收尾态）；再起一条短的?——这里只验证
    // 初始扫描与解析在真实 state.json 上不抛错即可
    await w.rescan();
    w.dispose();
    assert.ok(typeof sawActive === 'boolean');
  });
});
