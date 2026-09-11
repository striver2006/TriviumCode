import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import YAML from 'yaml';
import {
  parsePreflightScope, checkModelSlugs, runPreflight, commitAuthCache, renderPreflight,
} from '../../src/trivium/preflight.js';
import { defaultConfig, patchProbe } from '../../src/trivium/config.js';
import { runDoctor } from '../../src/trivium/doctor.js';
import { initFixtureRepo } from '../../src/trivium/util/git.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { Config, Ctx, ProbeSection } from '../../src/trivium/types.js';

function freshProbe(cfg: Config): void {
  cfg.probe.generated_at = new Date().toISOString();
  cfg.probe.agy.bin = '/nonexistent/agy';
  cfg.probe.agy.version = '1.2.0';
  cfg.probe.agy.models = ['gemini-3.1-pro-high', 'gemini-3.8-flash-high', 'gemini-3.8-flash-low'];
  cfg.probe.zcode.entry = '/nonexistent/zcode.cjs';
  cfg.probe.zcode.version = '0.16.5';
  cfg.probe.zcode.models = ['GLM-5.3', 'GLM-5.3-Flash', 'bigmodel/GLM-5.3', 'bigmodel/GLM-5.3-Flash'];
  cfg.probe.zcode.model_id_form = 'bigmodel/GLM-5.3';
  cfg.probe.zcode.readonly_flags = ['--mode plan', '--disallowed-tools Write,Edit'];
}

async function fakeCtx(mutate?: (c: Config) => void): Promise<Ctx> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-pf-'));
  await fs.writeFile(path.join(root, 'x.ts'), 'export const x = 1;\n');
  await initFixtureRepo(root);
  const cfg = defaultConfig();
  freshProbe(cfg);
  mutate?.(cfg);
  return {
    config: cfg,
    projectRoot: root,
    archiveRoot: path.join(root, '.reviews'),
    triviumDir: path.join(root, '.trivium'),
    sources: ['<test>'],
  };
}

// ── scope 解析（GLM-02）──

test('--stage 接受 plan|code|bug|all', () => {
  for (const s of ['plan', 'code', 'bug', 'all'] as const) {
    assert.equal(parsePreflightScope(s), s);
  }
});

test('--stage 拒绝其它取值与缺省，退 64', () => {
  for (const bad of ['stage1', 'ALL', '']) {
    assert.throws(() => parsePreflightScope(bad || null), (e: { code?: number }) => {
      assert.equal(e.code, EXIT.USAGE);
      return true;
    });
  }
});

// ── slug 校验（GLM-01）──

test('默认 profile 的 slug 全部合法', async () => {
  const ctx = await fakeCtx();
  assert.equal(checkModelSlugs(ctx.config, 'plan').ok, true);
  assert.equal(checkModelSlugs(ctx.config, 'all').ok, true, '--stage all 校验三个阶段');
});

test('gemini 侧非法覆盖 → 不合格并列出可用值，退 64', async () => {
  const ctx = await fakeCtx();
  const r = checkModelSlugs(ctx.config, 'plan', { gemini: 'gemini-9.9-nope' });
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, EXIT.USAGE);
  assert.match(r.detail, /gemini-9\.9-nope/);
  assert.match(r.detail, /可用值/);
  assert.match(r.detail, /gemini-3\.1-pro-high/);
});

test('glm 侧非法覆盖同样被拦（此前因模型清单为空而空转）', async () => {
  const ctx = await fakeCtx();
  const r = checkModelSlugs(ctx.config, 'plan', { glm: 'GLM-999-nope' });
  assert.equal(r.ok, false);
  assert.match(r.detail, /不在 ZCode 模型目录中/);
});

test('glm 侧短名合法（适配层会补 providerId 前缀）', async () => {
  const ctx = await fakeCtx();
  assert.equal(checkModelSlugs(ctx.config, 'plan', { glm: 'GLM-5.3' }).ok, true);
  assert.equal(checkModelSlugs(ctx.config, 'plan', { glm: 'bigmodel/GLM-5.3' }).ok, true);
});

test('模型清单为空时不误判（探针未采集到就跳过该项）', async () => {
  const ctx = await fakeCtx((c) => {
    c.probe.agy.models = [];
    c.probe.zcode.models = [];
  });
  assert.equal(checkModelSlugs(ctx.config, 'plan', { gemini: 'anything' }).ok, true);
});

test('profile 缺该阶段模型时报不合格', async () => {
  const ctx = await fakeCtx((c) => {
    c.profiles['bare'] = { gemini: {} };
    c.active_profile = 'bare';
  });
  const r = checkModelSlugs(ctx.config, 'plan');
  assert.equal(r.ok, false);
  assert.match(r.detail, /未定义模型且无覆盖/);
});

// ── 探针新鲜度：快速失败，不拉 doctor（AGY-03 / GLM-08）──

test('从未探针 → 退 69，且明确说明不自动拉起 doctor', async () => {
  const ctx = await fakeCtx((c) => {
    c.probe.generated_at = null;
  });
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true });
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, EXIT.ENV);
  const c = r.checks.find((x) => !x.ok)!;
  assert.match(c.detail, /手动运行 `trivium doctor`/);
  assert.match(c.detail, /刻意\*\*不\*\*自动拉起/);
});

test('探针过期 → 退 69 并指引手动执行', async () => {
  const ctx = await fakeCtx((c) => {
    c.probe.generated_at = new Date(Date.now() - 30 * 86_400_000).toISOString();
  });
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true });
  assert.equal(r.ok, false);
  assert.match(r.checks.find((x) => !x.ok)!.detail, /已过期/);
});

test('探针过期时后续检查不再执行（快速失败，不白烧配额）', async () => {
  const ctx = await fakeCtx((c) => {
    c.probe.generated_at = null;
  });
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true });
  assert.equal(r.checks.length, 1, `应只跑第一项就停，实际跑了 ${r.checks.length} 项`);
});

// ── 命令 A 的编译测试检查（§14.1 / GLM-02）──

test('--stage all 会校验全部三个阶段的 slug（GLM-02）', async () => {
  const ctx = await fakeCtx((c) => {
    // 只把 code 阶段的 gemini 模型改成非法值
    c.profiles['default']!.gemini!.code = 'gemini-9.9-nope';
  });
  assert.equal(checkModelSlugs(ctx.config, 'plan').ok, true, 'plan 阶段本身合法');
  const all = checkModelSlugs(ctx.config, 'all');
  assert.equal(all.ok, false, '--stage all 必须覆盖到 code 阶段的非法值');
  assert.match(all.detail, /gemini\/code/);
});

test('单阶段 scope 不执行 verify 检查', async () => {
  const ctx = await fakeCtx();
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true });
  assert.equal(
    r.checks.some((c) => c.name === '编译测试命令已配置'),
    false,
    'verify 检查只属于 --stage all',
  );
});

// ── 零工件（AC-16 / GLM-05）──

test('预检失败时不写探活缓存', async () => {
  const ctx = await fakeCtx((c) => {
    c.probe.generated_at = null;
  });
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true });
  assert.equal(r.ok, false);
  await commitAuthCache(ctx, r);
  await assert.rejects(
    fs.access(path.join(ctx.triviumDir, 'config.local.yaml')),
    '预检失败不得留下任何写入',
  );
});

test('预检失败时不创建归档根（可写性探测用父目录权限）', async () => {
  const ctx = await fakeCtx((c) => {
    c.probe.zcode.readonly_flags = [];
  });
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true });
  assert.equal(r.ok, false);
  await assert.rejects(fs.access(ctx.archiveRoot), '严禁为探测可写性而创建 .reviews/');
});

test('渲染器把失败项与退出码都写清楚', async () => {
  const ctx = await fakeCtx((c) => {
    c.probe.agy.bin = null;
  });
  const r = await runPreflight({ ctx, scope: 'plan', skipAuthCheck: true });
  const out = renderPreflight(r);
  assert.match(out, /✗/);
  assert.match(out, /不会产生任何工件/);
  assert.match(out, new RegExp(String(r.exitCode)));
});

// ── 缓存并发（GLM-07）──

test('并发 patchProbe 不丢更新（经全局锁串行化）', async () => {
  const ctx = await fakeCtx();
  await fs.mkdir(ctx.triviumDir, { recursive: true });
  await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      patchProbe(ctx.triviumDir, (p) => {
        p.auth = {
          ...(p.auth ?? {}),
          [i % 2 === 0 ? 'gemini' : 'glm']: {
            checked_at: new Date().toISOString(),
            cli_version: `v${i}`,
            fingerprint: `f${i}`,
            ok: true,
          },
        };
      }),
    ),
  );
  const YAML = await import('yaml');
  const raw = await fs.readFile(path.join(ctx.triviumDir, 'config.local.yaml'), 'utf8');
  const parsed = YAML.parse(raw) as { probe: { auth: Record<string, unknown> } };
  assert.equal(
    Object.keys(parsed.probe.auth).length,
    2,
    '两侧的缓存都应存在——丢更新会只剩一侧',
  );
});

// ── 回归：部分探测不得用 null 覆盖既有结论（真跑时踩过）──

test('回归：--no-model-calls 保留上一次探到的 agy 结论', async () => {
  const { probeAgy } = await import('../../src/trivium/probes/agy.js');
  const existing = {
    bin: '/usr/bin/agy', version: '1.2.0', models: ['m1'],
    headless_read_ok: true, json_schema_ok: true, pty_required: false,
    path_deny: { supported: false, rule_syntax: null, method: 'tested', attempts: ['a'] },
    scratch_paths: [], isolation: 'shared' as const, read_strategy: 'default' as const,
  };
  const { probe } = await probeAgy(null, 'trivium-critic', {
    skipModelCalls: true,
    existing,
  });
  assert.equal(probe.headless_read_ok, true, '不得被覆盖成 null');
  assert.equal(probe.json_schema_ok, true);
  assert.equal(probe.path_deny.supported, false);
  assert.equal(probe.path_deny.method, 'tested');
});

test('回归：--no-model-calls 保留上一次探到的 zcode 结论', async () => {
  const { probeZcode } = await import('../../src/trivium/probes/zcode.js');
  const existing = {
    entry: '/x/zcode.cjs', version: '0.16.5',
    readonly_flags: ['--mode plan'], model_override: 'config_copy' as const,
    trace_source: '/log/{date}.jsonl', trace_args_source: '/rollout/{sessionId}.jsonl',
    response_field: 'response',
    path_deny: { supported: false, rule_syntax: null, method: 'tested', attempts: [] },
    scratch_paths: [], isolation: 'home_copy' as const,
    model_id_form: 'p/GLM-5.3', models: ['GLM-5.3'],
  };
  const { probe } = await probeZcode(null, process.execPath, {
    skipModelCalls: true,
    existing,
  });
  assert.equal(probe.response_field, 'response', '不得被覆盖成 null');
  assert.equal(probe.model_override, 'config_copy');
  assert.equal(probe.model_id_form, 'p/GLM-5.3');
});

test('无既有结论时仍从默认值起步（首次探测）', async () => {
  const { probeAgy } = await import('../../src/trivium/probes/agy.js');
  const { probe } = await probeAgy(null, 'trivium-critic', { skipModelCalls: true });
  assert.equal(probe.headless_read_ok, null);
  assert.equal(probe.path_deny.supported, null);
});

// ── doctor 的分段落盘（审查意见 GLM-08）──

test('doctor 探完一侧即中途落盘，且 --only 不碰未探的那一侧', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ckpt-'));
  const triviumDir = path.join(root, '.trivium');
  await fs.mkdir(triviumDir, { recursive: true });

  // 先摆一份「上一次探到的」zcode 结论
  await patchProbe(triviumDir, (cur) => {
    cur.zcode.response_field = 'response';
    cur.zcode.version = '0.16.5';
  });

  /*
   * 关键：调用方传进来的 config.probe **故意不含**这份 zcode 结论
   * （模拟配置合并链没把 config.local.yaml 读进来，或两次 doctor 并发）。
   * checkpoint 若整段 Object.assign，zcode 就会被擦成默认值——
   * 那正是 GLM-08 当初修掉的问题。
   */
  const cfg = defaultConfig();
  await runDoctor({
    config: cfg, projectRoot: root, triviumDir,
    only: 'agy', skipModelCalls: true,
  });

  const onDisk = YAML.parse(
    await fs.readFile(path.join(triviumDir, 'config.local.yaml'), 'utf8'),
  ) as { probe: ProbeSection };

  assert.ok(onDisk.probe.host, 'env 段必须已落盘——中途写过一次');
  assert.ok(onDisk.probe.generated_at, 'generated_at 应已写入');
  assert.equal(
    onDisk.probe.zcode.response_field,
    'response',
    '--only agy 不得覆盖 zcode 段',
  );
  assert.equal(onDisk.probe.zcode.version, '0.16.5');
});

test('--only zcode 同样不碰 agy 段', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ckpt3-'));
  const triviumDir = path.join(root, '.trivium');
  await fs.mkdir(triviumDir, { recursive: true });
  await patchProbe(triviumDir, (cur) => {
    cur.agy.version = '1.2.0';
    cur.agy.headless_read_ok = true;
  });

  await runDoctor({
    config: defaultConfig(), projectRoot: root, triviumDir,
    only: 'zcode', skipModelCalls: true,
  });

  const onDisk = YAML.parse(
    await fs.readFile(path.join(triviumDir, 'config.local.yaml'), 'utf8'),
  ) as { probe: ProbeSection };
  assert.equal(onDisk.probe.agy.version, '1.2.0');
  assert.equal(onDisk.probe.agy.headless_read_ok, true);
});
