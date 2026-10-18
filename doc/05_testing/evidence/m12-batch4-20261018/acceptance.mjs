// M12 批次 4 桩级验收（计划 r2 §6）：同一组输入分别喂旧构建（固定提交 79d2dd57）与新构建（工作树），比对读数。
// 只读脚本：只往本脚本 mkdtemp 出来的目录里写；不调任何审查员 CLI、不花配额（doctor 只跑环境段且 --no-model-calls）。
// 用法（仓库根，先 node scripts/build.mjs；变异装置与全量检查都不在跑）：node acceptance.mjs [输出 JSON 路径]
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OLD_REV = '79d2dd57';
const REPO = process.cwd();
const OUT = process.argv[2] ?? null;
const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trivium-m12b4-accept-')));
try {
  // ── 旧构建：git archive 固定提交（带 .reviews/ 无妨），node_modules 软链工作树，原地构建 ──
  const oldSrc = path.join(work, 'old');
  fs.mkdirSync(oldSrc);
  const tar = path.join(work, 'old.tar');
  execFileSync('git', ['archive', '--format=tar', '-o', tar, OLD_REV], { cwd: REPO });
  execFileSync('tar', ['-xf', tar, '-C', oldSrc]);
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(oldSrc, 'node_modules'));
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: oldSrc, stdio: 'ignore' });

  const builds = {
    old: { bundle: path.join(oldSrc, 'skills/dual-critic/scripts/trivium.cjs'), assets: path.join(oldSrc, 'skills/dual-critic') },
    new: { bundle: path.join(REPO, 'skills/dual-critic/scripts/trivium.cjs'), assets: path.join(REPO, 'skills/dual-critic') },
  };
  const hashes = { old: sha(builds.old.bundle), new: sha(builds.new.bundle) };
  if (hashes.old === hashes.new) throw new Error('新旧 bundle 哈希相同：比对没有意义');

  // ── 夹具：最小项目，钉两侧、运行根放进本目录；extra 追加在配置末尾 ──
  const fixture = (name, extra = []) => {
    const root = path.join(work, name);
    fs.mkdirSync(path.join(root, '.trivium'), { recursive: true });
    fs.writeFileSync(path.join(root, 'README.md'), '# 验收夹具\n');
    fs.writeFileSync(path.join(root, '.trivium/config.yaml'), [
      'runtime:', `  run_root: ${path.join(work, name + '-runs')}`,
      'review:', '  default_critics: [gemini, glm]',
      'verify:', '  build: []', '  test: []',
      ...extra, '',
    ].join('\n'));
    for (const a of [['init', '-q'], ['add', 'README.md'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init']]) {
      execFileSync('git', a, { cwd: root });
    }
    return root;
  };
  const run = (which, root, args) => {
    const r = spawnSync(process.execPath, [builds[which].bundle, ...args], {
      cwd: root, encoding: 'utf8', timeout: 120_000,
      env: { ...process.env, TRIVIUM_ASSET_ROOT: builds[which].assets, NODE_TEST_CONTEXT: undefined },
    });
    const norm = (s) => (s ?? '').split(work).join('<WORK>').split(REPO).join('<REPO>');
    return { code: r.status, stdout: norm(r.stdout), stderr: norm(r.stderr) };
  };

  const plain = fixture('plain');
  // --stage all（命令 A 的 S0.5）：夹具里不放原稿，plan 阶段会先因找不到被审对象退 65（首跑撞过）
  const resolveArgs = (extra) => ['topic', 'resolve', '--stage', 'all', '--json', '--', '做个功能', '--topic', 'T', '--focus', '看', ...extra];
  const cases = {
    none: [],
    normal: ['--model-glm', 'GLM-5.3'],
    normal_eq: ['--model-glm=GLM-5.3'],
    empty_eq: ['--model-glm='],
    empty_followed: ['--model-glm', '--critics', 'gemini,glm'],
    empty_end: ['--model-glm'],
  };
  const out = { old_rev: OLD_REV, bundle_sha256: hashes, resolve: {}, doctor: {} };
  for (const [name, extra] of Object.entries(cases)) {
    const o = run('old', plain, resolveArgs(extra));
    const n = run('new', plain, resolveArgs(extra));
    const models = (r) => { try { return JSON.parse(r.stdout).models; } catch { return null; } };
    out.resolve[name] = {
      old: { code: o.code, models: models(o) },
      new: { code: n.code, models: models(n), message: n.code === 0 ? null : (n.stdout + n.stderr).trim().split('\n').find((l) => l.includes('--model-glm')) ?? null },
      stdout_identical: o.stdout === n.stdout,
    };
  }

  // cli.ts 侧的 `=` 空：doctor 只跑环境段，不调模型
  const doctorArgs = (extra) => ['doctor', '--only', 'env', '--no-model-calls', '--json', ...extra];
  for (const [name, extra] of Object.entries({ model_empty_eq: ['--model-glm='] })) {
    const o = run('old', plain, doctorArgs(extra));
    const n = run('new', plain, doctorArgs(extra));
    out.doctor[name] = { old: { code: o.code }, new: { code: n.code, has_message: (n.stdout + n.stderr).includes('--model-glm 需要一个值，但没有给出。') } };
  }

  // EV-227：带档位表 Agent 级 effort 与阶段格子 {model, effort}
  const dep = fixture('deprecated', [
    'profiles:', '  default:',
    '    gemini: { plan: gemini-3.8-flash-high, code: gemini-3.8-flash-high, bug: gemini-3.8-flash-high, effort: high }',
    '    glm: { plan: { model: GLM-5.3, effort: high }, code: GLM-5.3, bug: GLM-5.3 }',
  ]);
  const warnings = (r) => { try { return JSON.parse(r.stdout).warnings.filter((w) => w.includes('已废弃的键')); } catch { return null; } };
  for (const [name, root] of Object.entries({ plain, deprecated: dep })) {
    const o = run('old', root, doctorArgs([]));
    const n = run('new', root, doctorArgs([]));
    out.doctor[`env_${name}`] = { old: { code: o.code, deprecated_warnings: warnings(o) }, new: { code: n.code, deprecated_warnings: warnings(n) } };
  }

  // ── 判据 ──
  const r = out.resolve;
  const d = out.doctor;
  const msg = '--model-glm 需要一个值，但没有给出。';
  const checks = {
    A1_none_normal_identical: ['none', 'normal', 'normal_eq'].every((k) => r[k].stdout_identical && r[k].old.code === 0 && r[k].new.code === 0),
    A2_empty_old_silently_dropped: ['empty_eq', 'empty_followed', 'empty_end'].every((k) => r[k].old.code === 0 && JSON.stringify(r[k].old.models) === '{}'),
    A3_empty_new_usage_64: ['empty_eq', 'empty_followed', 'empty_end'].every((k) => r[k].new.code === 64 && (r[k].new.message ?? '').includes(msg)),
    B1_doctor_eq_old_ok_new_64: d.model_empty_eq.old.code === 0 && d.model_empty_eq.new.code === 64 && d.model_empty_eq.new.has_message,
    C1_plain_no_notice_both: JSON.stringify(d.env_plain.old.deprecated_warnings) === '[]' && JSON.stringify(d.env_plain.new.deprecated_warnings) === '[]',
    C2_old_no_notice: JSON.stringify(d.env_deprecated.old.deprecated_warnings) === '[]',
    C3_new_one_notice_agent_level_only: (d.env_deprecated.new.deprecated_warnings ?? []).length === 1
      && d.env_deprecated.new.deprecated_warnings[0].includes('已废弃的键：profiles.default.gemini.effort。')
      && !d.env_deprecated.new.deprecated_warnings[0].includes('glm'),
    C4_exit_codes_unchanged: d.env_deprecated.old.code === d.env_deprecated.new.code && d.env_plain.old.code === d.env_plain.new.code,
  };
  out.checks = checks;
  out.all_pass = Object.values(checks).every(Boolean);
  const text = JSON.stringify(out, null, 2) + '\n';
  if (OUT) fs.writeFileSync(OUT, text);
  process.stdout.write(text);
  process.exitCode = out.all_pass ? 0 : 1;
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
