#!/usr/bin/env node
/**
 * 「留痕与文案小修」零配额验收（计划 r2 §6.7）：EV-134 的新判据在**真实历史留痕**上的读数。
 *
 * **不碰真实 HOME、不碰本仓归档**：用仓库构建出的 `skills/dual-critic/scripts/trivium.cjs`，资产根经 `TRIVIUM_ASSET_ROOT`
 * 指向工作树；`gate --check` 会写 `task.json.joint_checks`，所以不在本仓跑，而是把历史主题目录**拷进 mkdtemp 临时项目**再跑。
 * 删除只认 mkdtemp 的返回值。不发起任何模型调用。
 *
 * 三格：
 *   A1 编号形态（EV-125 plan 轮，三侧、addresses 填 13 个意见编号）⇒ 退 2，文案点名三份期望文件名并给两档出口；
 *   A2 编号形态 + 解析回退侧（EV-122 code 轮，glm 侧 parse_fallback）⇒ 退 2，期望集含回退侧的文档；
 *   A3 契约形态（EV-136 code 轮，addresses 填三份审查文档文件名）⇒ 退 0。
 * 每格前后比对该轮 run.json 字节不变。
 *
 * 用法：node doc/05_testing/evidence/trace-copy-fixes-20260926/acceptance.mjs
 * 读数写进同目录 `acceptance-readout.json`，终端出摘要。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const CLI = path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs');
const ENV = { ...process.env, TRIVIUM_ASSET_ROOT: path.join(ROOT, 'skills/dual-critic') };

const CASES = [
  { id: 'A1', topic: 'EV-125-命令A支持选侧旗标', stage: 'plan', runId: '20260925T073426Z', wantExit: 2, wantDocs: 3 },
  { id: 'A2', topic: 'EV-122-未受控模型播报', stage: 'code', runId: '20260924T222959Z', wantExit: 2, wantDocs: 3 },
  { id: 'A3', topic: 'EV-136-glm探活选模路径', stage: 'code', runId: '20260926T051412Z', wantExit: 0, wantDocs: 3 },
];

const results = [];
const raw = {};
const check = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? '✓' : '✖'} ${id}：${detail}`); };

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ev134-accept-'));
try {
  await fs.mkdir(path.join(tmp, '.trivium'), { recursive: true });
  await fs.copyFile(path.join(ROOT, '.trivium/config.yaml'), path.join(tmp, '.trivium/config.yaml'));
  await run('git', ['init', '-q'], { cwd: tmp });
  for (const c of CASES) {
    await fs.cp(path.join(ROOT, '.reviews', c.topic), path.join(tmp, '.reviews', c.topic), { recursive: true });
  }

  for (const c of CASES) {
    const runJson = path.join(tmp, '.reviews', c.topic, c.stage, '_meta', `run-${c.runId}.json`);
    const before = await fs.readFile(runJson, 'utf8');
    let r;
    try {
      const o = await run(process.execPath, [CLI, 'gate', '--stage', c.stage, '--topic', c.topic, '--run-id', c.runId, '--check', '--json'],
        { cwd: tmp, env: ENV, maxBuffer: 64 * 1024 * 1024 });
      r = { code: 0, stdout: o.stdout, stderr: o.stderr };
    } catch (e) {
      r = { code: typeof e.code === 'number' ? e.code : null, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
    raw[c.id] = r;
    const text = r.stdout + r.stderr;
    // 只数审查文档：JSON 输出的 disposition 字段里还有裁决件自己的路径（-revised- / -response-），不算
    const docs = [...text.matchAll(/\d{4}-\d{2}-\d{2}-[^、。\s"/]+?-(?:codex|gemini|glm|claude)\.md/g)]
      .map((m) => m[0])
      .filter((d) => !/-(revised|response)-/.test(d));
    check(`${c.id} 退出码`, r.code === c.wantExit, `${c.topic} ${c.stage} ${c.runId}：code=${r.code}（期望 ${c.wantExit}）`);
    if (c.wantExit !== 0) {
      check(`${c.id} 文案点名期望文件名`, new Set(docs).size >= c.wantDocs, `点名 ${new Set(docs).size} 份：${[...new Set(docs)].join('、')}`);
      check(`${c.id} 两档出口`, /已提交的历史轮次，不要改已提交的裁决件/.test(text) && /在途轮次/.test(text), '含「历史轮次不要改」与「在途轮次改写」');
    }
    check(`${c.id} run.json 不变`, (await fs.readFile(runJson, 'utf8')) === before, 'gate --check 前后逐字节一致');
  }
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}

await fs.writeFile(path.join(HERE, 'acceptance-readout.json'), JSON.stringify({ at: new Date().toISOString(), results, raw }, null, 2) + '\n', 'utf8');
const bad = results.filter((x) => !x.ok);
console.log(`\n结论：${results.length - bad.length}/${results.length} 通过`);
process.exit(bad.length === 0 ? 0 : 1);
