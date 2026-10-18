// A-2 doctor / preflight 读数 + A-3 送审请求文件新旧对照（M12 批次 5，计划 r2 §5）。零真实模型调用：
// 审核者全部走桩；预检跳过探活（--skip-auth-check），只会跑各家 CLI 的 --version。
// 用法：node a23-readings.mjs <旧仓库导出目录> <新仓库根> <输出 JSON>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';

const [OLD, NEW, OUT] = process.argv.slice(2);
const T = (p) => path.join(NEW, 'dist/test', p);
const { makeFixture } = await import(T('test/helpers/fixture.js'));
const { encodeStubConfig, STUB_ENV_VAR } = await import(T('src/trivium/adapters/stub.js'));
const { unpackSnapshots } = await import(T('src/trivium/run-protocol.js'));
const { repoId } = await import(T('src/trivium/review.js'));
const YAML = createRequire(path.join(NEW, 'package.json'))('yaml');

const bundleOf = (repo) => path.join(repo, 'skills/dual-critic/scripts/trivium.cjs');
const assetOf = (repo) => path.join(repo, 'skills/dual-critic');
const STUB = encodeStubConfig({ gemini: { mode: 'ok' }, glm: { mode: 'ok' } });
const SCAN_ENV = 'TRIVIUM_ENTRY_SCAN_HOME';

function tv(repo, cwd, args, extra = {}) {
  const r = spawnSync(process.execPath, [bundleOf(repo), ...args], {
    cwd, encoding: 'utf8', timeout: 240_000,
    env: { ...process.env, TRIVIUM_ASSET_ROOT: assetOf(repo), ...extra },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
const lastJson = (s) => JSON.parse(s.slice(s.indexOf('{')));

const out = { a2: {}, a3: {} };

// ── A-2：doctor / preflight 读数（新产物）──
{
  const fx = await makeFixture({ topic: 'A2', draft: false });
  // 照搬本仓本机层的探针结论（只取 cli / host / generated_at，不拷 auth 与其它段），让预检走得到只告警项
  const local = YAML.parse(fs.readFileSync(path.join(NEW, '.trivium/config.local.yaml'), 'utf8'));
  const probe = { generated_at: local.probe.generated_at, host: local.probe.host, cli: local.probe.cli };
  // 本机 agy 会话中自动升级（1.4.0 → 1.4.2），本仓探针未刷新；夹具里按 `agy --version` 现值改写版本号（零配额），
  // 否则只选 gemini 的格子在「版本与探针一致」先失败、走不到本批的只告警项。只改夹具，不碰本仓探针
  const agyNow = spawnSync(probe.cli.agy.entrypoint, ['--version'], { encoding: 'utf8' }).stdout.trim().split('\n')[0];
  out.a2.agy_version_fixture = { probe: probe.cli.agy.version, installed: agyNow };
  probe.cli.agy.version = agyNow;
  fs.writeFileSync(path.join(fx.root, '.trivium/config.local.yaml'), YAML.stringify({ probe }));
  const dirty = fs.mkdtempSync(path.join(path.dirname(fx.root), 'home-dirty-'));
  const clean = fs.mkdtempSync(path.join(path.dirname(fx.root), 'home-clean-'));
  for (const [n, md] of [['dual-run', '---\nname: dual-run\n---\n别家的\n'], ['dual-status', '---\nname: dual-status\n---\n./.trivium/bin/trivium\n']]) {
    fs.mkdirSync(path.join(dirty, '.agents/skills', n), { recursive: true });
    fs.writeFileSync(path.join(dirty, '.agents/skills', n, 'SKILL.md'), md);
  }
  const shared = (ws) => (ws ?? []).filter((w) => (typeof w === 'string' ? w : w.name).includes('共享读取面'));
  const doc = (home) => {
    const r = tv(NEW, fx.root, ['doctor', '--only', 'env', '--no-model-calls', '--json'], { [SCAN_ENV]: home });
    const js = lastJson(r.stdout);
    return { code: r.code, blockers: js.blockers.length, shared_warnings: shared(js.warnings).map((w) => w.split(dirty).join('<DIRTY>')) };
  };
  const pf = (home, args) => {
    const r = tv(NEW, fx.root, ['preflight', '--stage', 'plan', '--skip-auth-check', '--json', ...args], { [SCAN_ENV]: home });
    const js = lastJson(r.stdout);
    return { args: args.join(' '), code: r.code, ok: js.ok, shared: shared(js.warnings).map((w) => w.detail),
      failed: (js.checks ?? []).filter((c) => !c.ok).map((c) => c.name) };
  };
  out.a2 = {
    ...out.a2,
    doctor_dirty: doc(dirty),
    doctor_clean: doc(clean),
    preflight: [
      pf(dirty, ['--critics', 'gemini']),
      pf(dirty, ['--critics', 'codex,glm']),
      pf(dirty, ['--driver', 'glm', '--critics', 'gemini']),
      pf(clean, ['--critics', 'codex,glm']),
    ],
  };
}

// ── A-3：同一组桩、同一形态的夹具，旧产物与新产物各跑一次 code 阶段 ──
async function codeRun(repo) {
  const fx = await makeFixture({ topic: 'A3', draft: false });
  // 超过任务书节选上限（400 行）的改动：节选不再是全文，体积差只来自快照里的正文份数（计划双审 CODEX-02）
  const big = Array.from({ length: 600 }, (_, i) => `export const v${i} = ${i}; // 行 ${i}`).join('\n') + '\n';
  fs.writeFileSync(path.join(fx.root, 'src/big.ts'), big);
  fs.writeFileSync(path.join(fx.root, 'src/a.ts'), 'export const a = 4242;\n');
  const s = tv(repo, fx.root, ['review', '--start', '--stage', 'code', '--topic', 'A3', '--focus', '看变更', '--json'], { [STUB_ENV_VAR]: STUB });
  if (s.code !== 0) throw new Error(`--start 失败 ${repo}\n${s.stdout}\n${s.stderr}`);
  const runId = lastJson(s.stdout).run_id;
  const reqPath = path.join(fx.runRoot, repoId(fx.root), runId, 'request.json');
  const reqText = fs.readFileSync(reqPath, 'utf8');
  let code = 73;
  for (let i = 0; i < 12 && code === 73; i++) code = tv(repo, fx.root, ['review', '--wait', runId, '--timeout', '20'], { [STUB_ENV_VAR]: STUB }).code;
  const meta = path.join(fx.archiveRoot, 'A3/code', '_' + 'meta');
  const files = fs.readdirSync(meta).filter((f) => f.startsWith('brief-') || f.startsWith(`changes-${runId}`)).sort();
  const runJson = JSON.parse(fs.readFileSync(path.join(meta, `run-${runId}.json`), 'utf8'));
  // 运行时根（任务书里的 schema 路径）新旧各指各的产物，归一成 <ASSET>
  const norm = (t) => t.split(assetOf(repo)).join('<ASSET>').split(fx.root).join('<ROOT>').split(path.dirname(fx.root)).join('<FX>').split(runId).join('<RUN>')
    .replace(/\b[0-9a-f]{64}\b/g, '<SHA256>').replace(/\b[0-9a-f]{40}\b/g, '<SHA1>').replace(/\b[0-9a-f]{12}\b/g, '<SHA12>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<TS>');
  return {
    code, status: runJson.status, reqBytes: Buffer.byteLength(reqText), req: JSON.parse(reqText),
    // 体积差里与本批无关的部分：运行时根路径（新旧各指各的产物）在交接文件里的出现次数与字节数
    assetBytes: reqText.split(assetOf(repo)).length - 1 > 0 ? (reqText.split(assetOf(repo)).length - 1) * Buffer.byteLength(assetOf(repo)) : 0,
    files: Object.fromEntries(files.map((f) => [norm(f), norm(fs.readFileSync(path.join(meta, f), 'utf8'))])),
    // build 是构建标识：旧产物从 git archive 导出、没有 .git，记 null；与本批改动无关，不进比对
    snapshotFields: norm(JSON.stringify({ ...runJson.snapshot, taken_at: undefined, build: undefined })),
    diffText: fs.readFileSync(path.join(meta, files.find((f) => f.startsWith('changes-'))), 'utf8'),
  };
}
{
  const o = await codeRun(OLD);
  const n = await codeRun(NEW);
  const sides = Object.keys(o.req.snapshots);
  const sameFiles = isDeepStrictEqual(o.files, n.files);
  // 新 worker 的读路径对旧格式：原样返回、与旧文件里的快照逐字段相同
  const oldReadByNew = unpackSnapshots(o.req, 'old');
  const newUnpacked = unpackSnapshots(n.req, 'new');
  out.a3 = {
    old: { code: o.code, status: o.status, request_bytes: o.reqBytes, sides, snapshot_copies: sides.filter((c) => typeof o.req.snapshots[c].diffText === 'string').length },
    new: { code: n.code, status: n.status, request_bytes: n.reqBytes, has_frozen_diff: !!n.req.frozen_diff,
      snapshot_copies: sides.filter((c) => typeof n.req.snapshots[c].diffText === 'string').length },
    briefs_and_diff_identical_after_normalization: sameFiles,
    compared_files: Object.keys(n.files),
    run_json_snapshot_fields_identical_after_normalization: o.snapshotFields === n.snapshotFields,
    // 一份补丁在 JSON 里的**字节**数（补丁含中文，按字符数算会少算）
    diff_json_bytes: Buffer.byteLength(JSON.stringify(n.diffText)),
    request_bytes_saved: o.reqBytes - n.reqBytes,
    // 扣掉运行时根路径长度差之后的节省量，应约等于去掉的那一份补丁（减去 frozen_diff 外壳与两处 null）
    request_bytes_saved_excluding_asset_paths: (o.reqBytes - o.assetBytes) - (n.reqBytes - n.assetBytes),
    new_worker_reads_old_format_unchanged: isDeepStrictEqual(oldReadByNew, o.req.snapshots),
    new_format_unpacks_to_frozen_text: sides.every((c) => newUnpacked[c].diffText === n.diffText),
    brief_text_equals_archive_new: sides.every((c) => n.req.requests[c].brief_text === fs.readFileSync(n.req.requests[c].brief_path, 'utf8')),
  };
  if (!sameFiles) out.a3.first_mismatch = Object.keys(n.files).find((k) => o.files[k] !== n.files[k]) ?? 'key-set-differs';
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
