#!/usr/bin/env node
/**
 * EV-122 零配额验收（计划 r2 §4.3）：拿 EV-112 E2 的**真实形态**喂判定与播报。
 *
 * 被取形态：run `20260924T172304Z`（主题 `EV-112-E2验收`，单侧 glm），副本源暂时不在、审查运行走无副本一支，
 * run.json 里 `model_requested: GLM-5.3`、`model_effective: …/qwen3.8-max`、`model_route: global`、`model_override_applied` 缺席，守卫零播报。
 *
 * run.json 里**没有** `reason` 与 `cause`（计划 r2 C7），所以不按记忆抄：现跑 `prepareZcodeHome`，
 * `srcConfig` 指向本脚本 mkdtemp 出来的目录下一个不存在的文件——走第一个出口早退，不建目录、不写文件，
 * 也不碰真实的 `~/.zcode/cli/config.json`（它在，走默认路径就会进副本支、把凭据拷进临时目录）。
 * 于是 `reason` 里的路径是临时路径而非 E2 当时的真实路径，只有这一处与 E2 不同，不影响判定（判定只认 `cause`）。
 *
 * 与 EV-112 的 e1/e2 脚本不同，本脚本从**构建产物** `dist/test/src/…` 导模块（先跑 `npm run build`）。
 * 只读：唯一的写是同目录 e1-output.json 与一个空的 mkdtemp 目录（跑完即删）。
 *
 * 用法：node doc/05_testing/evidence/ev122-acceptance-20260925/e1-check.mjs
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const RUN_ID = '20260924T172304Z';
const load = (rel) => import(pathToFileURL(path.join(ROOT, 'dist/test/src/trivium', rel)).href);

const { prepareZcodeHome, decideModelUnenforced, decideModelOverride } = await load('adapters/zcode.js');
const { judgeSide, renderGuardWarnings } = await load('guard.js');
const { failedResult, TOOL_TRACE_CAPABILITY } = await load('adapters/base.js');
const { defaultConfig } = await load('config.js');

const runJson = JSON.parse(await fs.readFile(path.join(ROOT, '.reviews/EV-112-E2验收/plan', '_' + 'meta', `run-${RUN_ID}.json`), 'utf8'));
const g = runJson.critics.glm;

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ev122-e1-'));
let prep;
try {
  prep = await prepareZcodeHome(path.join(tmp, 'glm'), g.model_requested, { srcConfig: path.join(tmp, 'absent', 'config.json') });
  var tmpEntries = await fs.readdir(tmp);
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}

const attempted = g.model_route === 'config_copy';
const override = decideModelOverride(attempted, prep.qualified, g.model_effective);
const unenforced = decideModelUnenforced(attempted, g.model_requested, g.model_effective, prep.cause, prep.reason);

const base = failedResult('glm', { status: 'failed', reason: 'EV-122 验收夹具' });
const result = unenforced ? { ...base, model_unenforced: unenforced } : base;
const req = {
  critic: 'glm', stage: 'plan', model: g.model_requested, effort: null,
  brief_text: '', brief_path: '/proj/b.md', subject_path: '/proj/s.md',
  project_root: '/proj', out_dir: '/tmp/out', timeout_s: 60,
  min_tool_calls: 0, min_project_reads: 0, deny_paths: [],
};
const verdict = judgeSide(defaultConfig(), 'glm', result, null, req, {
  archiveRootAbs: '/proj/.reviews', projectRoot: '/proj', triviumDir: '/proj/.trivium', runRoot: '/tmp/runs',
  capability: TOOL_TRACE_CAPABILITY,
});
const notes = renderGuardWarnings({
  sides: { glm: verdict }, drift: { changed: false, files: [], related: [] },
  driftAction: 'ok', fingerprintChangedFiles: [], unattributedDriftFiles: [],
});
const broadcast = notes.filter((n) => n.includes('本次没有做模型覆盖'));

const checks = {
  A1_e2_shape: g.model_requested === 'GLM-5.3' && g.model_route === 'global' && !('model_override_applied' in g) && typeof g.model_effective === 'string',
  A2_prep_early_exit: prep.homeDir === null && prep.route === 'global' && prep.cause === 'source_missing' && tmpEntries.length === 0,
  A3_override_absent: override.applied === undefined && override.note === null,
  A4_unenforced_produced: !!unenforced && unenforced.requested === 'GLM-5.3' && unenforced.effective === g.model_effective && unenforced.cause === 'source_missing',
  A5_guard_one_line: broadcast.length === 1
    && broadcast[0].includes('GLM-5.3') && broadcast[0].includes(g.model_effective)
    && broadcast[0].includes('FR-06') && broadcast[0].includes('副本源 `~/.zcode/cli/config.json` 在不在'),
  A6_no_false_alarm: !notes.some((n) => n.includes('没有生效')),
};

const output = {
  run_id: RUN_ID,
  e2_fields: { model_requested: g.model_requested, model_effective: g.model_effective, model_route: g.model_route, model_override_applied_present: 'model_override_applied' in g },
  prep: { homeDir: prep.homeDir, route: prep.route, cause: prep.cause, reason_kind: prep.reason?.startsWith('未找到 ') ? '未找到 <临时路径>…' : prep.reason, tmp_entries_after: tmpEntries.length },
  model_unenforced: unenforced ? { ...unenforced, reason: '（同 prep.reason）' } : null,
  guard_broadcast: broadcast.map((n) => n.replace(prep.reason, '<reason>')),
  checks,
  all_ok: Object.values(checks).every(Boolean),
};
await fs.writeFile(path.join(HERE, 'e1-output.json'), JSON.stringify(output, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ checks, all_ok: output.all_ok }, null, 2));
process.exit(output.all_ok ? 0 : 1);
