#!/usr/bin/env node
// M11 第 1 步 · codex 档位事实探针。
// 用法：node 本文件 〈仓库根〉 〈证据目录〉 〈临时根（scratchpad）〉
//
// 一、零配额：逐 profile `codex debug models`，记逐模型 supported_reasoning_levels；
//     只从 profile 文件里取三个键的值（model_catalog_json / model / model_reasoning_effort），绝不整份打印。
// 二、花配额：逐格 `codex exec` 最小调用（经项目自己的 invokeCodex 与 prepareCodexHome 副本），
//     记请求值、header 的 reasoning effort、会话文件 turn_context 的 effort、token 用量里的推理 token。
// 证据只写抽出的字段，不落 stdout / stderr 原文、不落会话文件原文。
// 副本建在 mkdtemp 返回的目录里，结束时只删这个目录。
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [root, outDir, tmpBase] = process.argv.slice(2).map((p) => path.resolve(p));
const D = (p) => path.join(root, 'dist/test/src/trivium', p);
const P = await import(D('probes/codex.js'));
const H = await import(D('adapters/codex-home.js'));
const A = await import(D('adapters/codex.js'));
const T = await import(D('adapters/codex-trace.js'));

await fs.mkdir(outDir, { recursive: true });
const home = P.codexHome();
const keyOf = (text, key) => new RegExp(`^\\s*${key}\\s*=\\s*["']?([^"'\\n#]+?)["']?\\s*(#.*)?$`, 'm').exec(text)?.[1]?.trim() ?? null;
const keysIn = async (file) => {
  try {
    const t = await fs.readFile(file, 'utf8');
    return {
      model_catalog_json: keyOf(t, 'model_catalog_json'),
      model: keyOf(t, 'model'),
      model_reasoning_effort: keyOf(t, 'model_reasoning_effort'),
      model_provider: keyOf(t, 'model_provider'),
    };
  } catch {
    return null;
  }
};

const { bin, version } = await P.probeCodexBin(null);
const profiles = await P.probeCodexProfiles(home);
const base = await keysIn(path.join(home, 'config.toml'));

// ── 一、零配额：逐 profile 的目录与 effort 枚举 ──
const catalogs = {};
const profileKeys = {};
for (const name of profiles) {
  const k = await keysIn(path.join(home, `${name}.config.toml`));
  profileKeys[name] = k;
  const catalog = k?.model_catalog_json ?? base?.model_catalog_json ?? null;
  const c = await P.probeCodexModels(bin, catalog);
  catalogs[name] = c.ok ? { visible: c.visible, efforts: c.efforts } : { error: c.why };
}
await fs.writeFile(
  path.join(outDir, 'codex-catalogs.json'),
  JSON.stringify({ bin, version, base_keys: base, profiles, profile_keys: profileKeys, catalogs }, null, 2) + '\n',
);

// ── 二、花配额：逐格最小调用 ──
const cells = JSON.parse(process.env.M11_CELLS ?? '[]');
const prompt = 'Reply with exactly one word: OK. Do not run any command or read any file.';
const results = [];
for (const cell of cells) {
  const tmp = await fs.mkdtemp(path.join(tmpBase, 'trivium-m11probe-'));
  const workdir = path.join(tmp, 'work');
  await fs.mkdir(workdir);
  const rec = { ...cell };
  try {
    const prep = await H.prepareCodexHome(tmp, { profile: cell.profile, projectRoot: workdir });
    rec.prep_warnings = prep.warnings;
    const o = await A.invokeCodex({
      bin, cwd: workdir, prompt,
      profile: cell.profile, model: cell.model, effort: cell.effort,
      readonlyArgs: ['-s', 'read-only'],
      codexHome: prep.codexHome, fakeHome: prep.fakeHome,
      timeoutMs: 240_000,
    });
    rec.exit_code = o.exitCode;
    rec.timed_out = o.timedOut;
    rec.duration_s = Math.round(o.durationMs / 100) / 10;
    // header：只取认得的五个标签
    const header = P.parseHeaderLines(o.stderr.split('\n'));
    rec.header = Object.fromEntries(P.HEADER_LABELS.map((l) => [l, header.get(l) ?? null]));
    // stderr 末行（错误时用；截 200 字，凭据形态的行不会出现在这里——仍按键名过滤一次）
    const tail = o.stderr.trim().split('\n').filter((l) => !/token|key|secret|bearer/i.test(l)).slice(-2).join(' ｜ ');
    rec.stderr_tail = o.exitCode === 0 ? null : tail.slice(0, 200);
    const trace = T.parseCodexEvents(o.stdout);
    rec.final_text = (trace.finalText ?? '').slice(0, 40);
    rec.thread_id = trace.threadId;
    // 事件流里有没有任何 effort 字样的键
    rec.events_effort_keys = [...new Set([...o.stdout.matchAll(/"([a-z_]*effort[a-z_]*)"\s*:\s*("?[^,"}]*"?)/g)].map((m) => `${m[1]}=${m[2]}`))];
    const usage = [...o.stdout.matchAll(/"reasoning_output_tokens"\s*:\s*(\d+)/g)].map((m) => Number(m[1]));
    rec.events_reasoning_output_tokens = usage.length ? usage[usage.length - 1] : null;
    // 会话文件：session_meta 与 turn_context
    if (trace.threadId) {
      const f = await T.findSessionFile(prep.codexHome, trace.threadId);
      if (f) {
        const lines = (await fs.readFile(f, 'utf8')).split('\n').filter(Boolean);
        rec.session_meta = T.parseCodexSessionMeta(lines[0] ?? '');
        const tc = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
          .filter((o2) => o2?.type === 'turn_context');
        rec.turn_context = tc.map((o2) => ({
          model: o2.payload?.model ?? null,
          effort: o2.payload?.effort ?? null,
          collab_reasoning_effort: o2.payload?.collaboration_mode?.settings?.reasoning_effort ?? null,
          summary: o2.payload?.summary ?? null,
        }));
        // 会话文件里其它带 effort 的键（只记键名与值，不记上下文）
        rec.session_effort_keys = [...new Set(lines.flatMap((l) => [...l.matchAll(/"([a-z_]*effort[a-z_]*)"\s*:\s*("?[^,"}]*"?)/g)].map((m) => `${m[1]}=${m[2]}`)))];
        const rt = lines.flatMap((l) => [...l.matchAll(/"reasoning_output_tokens"\s*:\s*(\d+)/g)].map((m) => Number(m[1])));
        rec.session_reasoning_output_tokens = rt.length ? rt[rt.length - 1] : null;
      } else {
        rec.session_file = 'not-found';
      }
    }
  } catch (e) {
    rec.error = String(e?.message ?? e).slice(0, 300);
  } finally {
    // 只删 mkdtemp 返回的这个目录（凭据副本在里面）
    await fs.rm(tmp, { recursive: true, force: true });
  }
  results.push(rec);
  console.log(JSON.stringify({ cell: cell.id, exit: rec.exit_code, header_effort: rec.header?.['reasoning effort'], turn: rec.turn_context, err: rec.error ?? rec.stderr_tail }));
}
if (cells.length) {
  await fs.writeFile(path.join(outDir, 'codex-effort-cells.json'), JSON.stringify(results, null, 2) + '\n');
}
console.log(JSON.stringify({ bin, version, profiles, catalogs: Object.fromEntries(Object.entries(catalogs).map(([k, v]) => [k, v.error ?? v.efforts])) }, null, 1));
