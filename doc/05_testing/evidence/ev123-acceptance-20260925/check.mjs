#!/usr/bin/env node
/**
 * EV-123 零配额验收（r3 §4.3）：E1 正向、E2 反向函数层、E3 反向 CLI 层。
 *
 * - 全程带 `--skip-auth-check`：它只跳过 ⑧ 探活（唯一真实消耗配额的一项），不影响 ④″；
 * - **不在真实 HOME 上挪 `~/.zcode/cli/config.json`**：反向两项把 HOME 钉到 mkdtemp 的空目录；
 * - 清理只认 `mkdtemp` 的返回值（2026-09-20 事故后的 R1），绝不拼接真实 HOME；
 * - E1 只记检查项名与 warn 标记，不记 detail：detail 里有带用户名的绝对路径（归档根等）。
 * - 读数写进本目录 `results.json`；会话里的命令不带重定向。
 *
 * 前置：`npm run install:local`（E1 / E3 走安装副本）；`dist/test/` 已由 `npm test` 或
 * `build.mjs --with-tests` 产出（E2 从那里导入）。
 *
 * 用法：node doc/05_testing/evidence/ev123-acceptance-20260925/check.mjs
 */
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const WRAPPER = path.join(ROOT, '.trivium/bin/trivium');
const NAME_SUFFIX = '模型覆盖副本源';

const results = { date: new Date().toISOString(), E1: {}, E2: {}, E3: {} };
const failures = [];
const expect = (cond, what) => { if (!cond) failures.push(what); return cond; };
const temps = [];

async function mkHome() {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'ev123-home-'));
  temps.push(d);
  return d;
}

function preflight(env) {
  const r = spawnSync(WRAPPER, ['preflight', '--stage', 'plan', '--skip-auth-check', '--json'], {
    cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 300_000,
  });
  return { code: r.status, out: JSON.parse(r.stdout) };
}

try {
  // ── E1 正向：本机副本源在（不读它的内容，只确认存在性结论与出项一致）──
  {
    const { code, out } = preflight({});
    const warnNames = (out.warnings ?? []).map((w) => w.name);
    results.E1 = {
      exit_code: code,
      ok: out.ok,
      warnings_key_present: Array.isArray(out.warnings),
      warn_items: out.checks.filter((c) => c.warn).map((c) => c.name),
      warnings: warnNames,
      override_source_item_present: out.checks.some((c) => c.name.endsWith(NAME_SUFFIX)),
    };
    expect(code === 0, 'E1 退出码应为 0');
    expect(Array.isArray(out.warnings), 'E1 warnings 键必须在');
    expect(!warnNames.some((n) => n.endsWith(NAME_SUFFIX)), 'E1 副本源在时不得出副本源条目');
    expect(!out.checks.some((c) => c.name.endsWith(NAME_SUFFIX)), 'E1 checks 里不得有副本源项');
    expect(warnNames.includes('探活'), 'E1 带 --skip-auth-check 时「探活已跳过」必然是 warn');
  }

  // ── E2 反向·函数层：从构建产物导入，HOME 钉到空目录，用真实适配器表 ──
  {
    const home = await mkHome();
    const saved = process.env.HOME;
    process.env.HOME = home;
    try {
      const pf = await import(pathToFileURL(path.join(ROOT, 'dist/test/src/trivium/preflight.js')).href);
      const items = await pf.checkModelOverrideSource(['codex', 'gemini', 'glm']);
      const rendered = pf.renderPreflight({
        ok: true, scope: 'plan', checks: items, warnings: pf.collectWarnings(items), exitCode: 0, pendingAuthCache: {},
      });
      const lines = rendered.split('\n');
      results.E2 = {
        items: items.map((c) => ({ name: c.name, ok: c.ok, warn: c.warn ?? null, detail_starts_with_warning: c.detail.startsWith('⚠️ ') })),
        detail_uses_tilde_path: items.every((c) => c.detail.includes('~/.zcode/cli/config.json')),
        detail_leaks_temp_home: items.some((c) => c.detail.includes(home)),
        rendered_item_line: lines.find((l) => l.includes(NAME_SUFFIX)) ?? null,
        rendered_last_line: lines.at(-1),
      };
      expect(items.length === 1, 'E2 真实适配器表下只有一侧实现了该成员，应恰出一项');
      expect(items[0]?.ok === true && items[0]?.warn === true, 'E2 出项应为 ok:true、warn:true');
      expect(results.E2.detail_uses_tilde_path, 'E2 路径应以 ~/ 展示');
      expect(!results.E2.detail_leaks_temp_home, 'E2 不得带出临时 HOME 的绝对路径');
      expect(/^ {2}⚠ /.test(results.E2.rendered_item_line ?? ''), 'E2 渲染行首应为 ⚠');
      expect(results.E2.rendered_last_line === '✓ 预检通过（含 1 条警告）', 'E2 末行应报条数');
    } finally {
      if (saved === undefined) delete process.env.HOME; else process.env.HOME = saved;
    }
  }

  // ── E3 反向·CLI 层：安装副本，以空 HOME 拉起 ──
  {
    const home = await mkHome();
    const { code, out } = preflight({ HOME: home });
    const item = (out.warnings ?? []).find((w) => w.name.endsWith(NAME_SUFFIX));
    results.E3 = {
      exit_code: code,
      ok: out.ok,
      first_failed_check: out.checks.find((c) => !c.ok)?.name ?? null,
      warnings: (out.warnings ?? []).map((w) => w.name),
      override_source_warning_present: Boolean(item),
      detail_uses_tilde_path: item ? item.detail.includes('~/.zcode/cli/config.json') : null,
      detail_leaks_temp_home: item ? item.detail.includes(home) : null,
      check_item_has_warn: out.checks.find((c) => c.name.endsWith(NAME_SUFFIX))?.warn ?? null,
    };
    expect(code === 0, `E3 退出码应为 0（首个失败项：${results.E3.first_failed_check}）`);
    expect(Boolean(item), 'E3 warnings 应含副本源条目');
    expect(results.E3.detail_uses_tilde_path === true, 'E3 路径应以 ~/ 展示');
    expect(results.E3.detail_leaks_temp_home === false, 'E3 不得带出临时 HOME 的绝对路径');
    expect(results.E3.check_item_has_warn === true, 'E3 checks[] 里该项应带 warn');
  }
} finally {
  for (const d of temps) await fs.rm(d, { recursive: true, force: true }); // 只删 mkdtemp 的返回值
}

results.failures = failures;
await fs.writeFile(path.join(HERE, 'results.json'), JSON.stringify(results, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(results, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
