import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../helpers/fixture.js';
import {
  ENTRY_OUT_DIR, loadEntrySources, renderAll, renderEntry,
  type Carrier, type Contract, type EntrySources, type RenderedEntry,
} from '../../src/entry-render.js';
import { AGENTS, ALL_AGENT_IDS, agentById, guardProfileOf } from '../../src/trivium/agents/registry.js';

/**
 * 入口资产单源渲染的契约（M10b 第 2 步；计划 r5 §5.1、r9 §2、r10 §2.4 / §3.1.3）。
 *
 * ## 守什么
 *
 *   1. **源 → 产物零 diff**：`skills-src/` 渲染出的内容与仓库里的产物逐字节一致，且没有残留产物。
 *      产物进 Git、缺省构建不重写它们（`scripts/build.mjs` 头注释），所以改了源忘了 `npm run render`
 *      会在这里红；若构建顺手重写，这条在 `npm test` 下恒绿。
 *   2. **参数写法**：claude 产物用 `$ARGUMENTS`；另三家不含它，改为转抄规约，且「空参数不编造」
 *      「拼串」两段完整在场（r10 §2.4.1）。
 *   3. **`--driver <自家 id>` 注入**：出现次数等于应注入的调用数，不含别家 id（r5 §5.1 ③；命令 A 6 处，§5.3）。
 *   4. **认领步骤**位于「写原稿」之前（r5 §5.2）。
 *   5. **护栏注入段**与 r10 §3.1.3 的表一致。
 *
 * ## 证不到什么
 *
 * J3 的「渲染回 claude 载体 = 抽单源之前的文件」是**一次性**的：第一阶段只抽单源、不改语义时
 * 逐字节比对过，读数与当时的源快照在 `doc/05_testing/evidence/m10b-step2-20260925/`。
 * 之后 claude 产物随认领步骤、`--driver` 注入、护栏段一起变了，本文件守的是「此后源与产物不漂」。
 * 模型转抄那一环的保真（r10 §2.4.3）只能在真实轮上核，不在这里。
 */

const src: EntrySources = await loadEntrySources(REPO_ROOT);
const rendered: RenderedEntry[] = renderAll(src);

const carrierOf = (agent: string): Carrier => src.carriers.find((c) => c.agent === agent)!;
const contractOf = (id: string): Contract => src.contracts.find((c) => c.id === id)!;
const partial = (key: string): string => {
  const p = src.partials.get(key);
  assert.ok(p !== undefined, `缺少片段 ${key}`);
  return p!.replace(/\n$/, '');
};

/** 有「执行契约」、会产出工件的主命令；其余三条是辅助命令 */
const MAIN_COMMANDS = ['run', 'review-plan', 'review-code', 'review-bug'];

test('论域：四家载体 × 七条命令，且覆盖全部可作 Driver 的 Agent', () => {
  assert.ok(src.carriers.length >= 4, `只有 ${src.carriers.length} 份载体`);
  assert.ok(src.contracts.length >= 7, `只有 ${src.contracts.length} 份契约`);
  assert.equal(rendered.length, src.carriers.length * src.contracts.length);
  for (const a of AGENTS.filter((x) => x.driverEnabled)) {
    assert.ok(src.carriers.some((c) => c.agent === a.id), `可作 Driver 的 ${a.id} 没有载体`);
  }
  for (const id of MAIN_COMMANDS) assert.ok(contractOf(id), `缺主命令契约 ${id}`);
});

test('源 → 产物零 diff（改了源请跑 npm run render）', async () => {
  const stale: string[] = [];
  for (const r of rendered) {
    let disk: string | null = null;
    try {
      disk = await fs.readFile(path.join(REPO_ROOT, r.relPath), 'utf8');
    } catch {
      disk = null;
    }
    if (disk !== r.content) stale.push(r.relPath);
  }
  /*
   * 出口分两种（代码双审 CODEX-05）：改了源忘了渲染，跑 render 即可；**手改了产物**，
   * 直接跑 render 会把手改的内容按源整份覆盖掉——先把改动挪进 skills-src/。
   */
  assert.deepEqual(
    stale, [],
    `这些产物与源不一致：\n  ${stale.join('\n  ')}\n` +
      '  · 改的是 skills-src/：跑 `npm run render` 重出产物，一起提交；\n' +
      '  · 手改的是上面这些产物：它们是生成物，render 会把改动覆盖掉——先把改动挪进 skills-src/ 再 render。',
  );
});

async function listFiles(dir: string, base = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(path.join(dir, e.name), rel)));
    else out.push(rel);
  }
  return out;
}

test('没有残留产物：entry/ 下只有渲染出来的文件，top 布局的 skill 目录都来自契约', async () => {
  const want = new Set(rendered.map((r) => r.relPath));
  const onDisk = (await listFiles(path.join(REPO_ROOT, ENTRY_OUT_DIR))).map((f) => `${ENTRY_OUT_DIR}/${f}`);
  assert.deepEqual(onDisk.filter((f) => !want.has(f)), [], 'entry/ 下有源里已没有的产物');

  // 运行时资产根（dual-critic）是手写的，不在渲染论域；其余每个带 SKILL.md 的顶层目录都必须是渲染产物
  const runtimeDir = path.basename(path.dirname(ENTRY_OUT_DIR));
  const topDirs: string[] = [];
  for (const d of await fs.readdir(path.join(REPO_ROOT, 'skills'))) {
    if (d === runtimeDir) continue;
    try {
      await fs.access(path.join(REPO_ROOT, 'skills', d, 'SKILL.md'));
      topDirs.push(`skills/${d}/SKILL.md`);
    } catch {
      /* 不是 skill 目录 */
    }
  }
  assert.ok(topDirs.length >= 7, `顶层只找到 ${topDirs.length} 个 skill，扫描空转了`);
  assert.deepEqual(topDirs.filter((f) => !want.has(f)), [], '顶层有不来自契约的入口 skill（手改产物或残留）');
});

test('参数写法：substitute 载体用 $ARGUMENTS；transcribe 载体一处都不许有，且两段规约完整在场', () => {
  const empty = partial('args/rule-empty');
  let transcribeSeen = 0;
  for (const r of rendered) {
    const carrier = carrierOf(r.agent);
    const contract = contractOf(r.command);
    if (carrier.arguments === 'substitute') {
      assert.match(r.content, /\$ARGUMENTS/, `${r.relPath}：substitute 载体的产物要用 $ARGUMENTS`);
      assert.ok(!r.content.includes(empty), `${r.relPath}：substitute 载体不该带转抄规约`);
      continue;
    }
    transcribeSeen++;
    assert.equal((r.content.match(/\$ARGUMENTS/g) ?? []).length, 0, `${r.relPath}：载体不替换 $ARGUMENTS，字面留着会被原样执行`);
    assert.ok(r.content.includes(empty), `${r.relPath}：「空参数不编造」一段不完整或缺失（FR-20 的唯一事前防线）`);
    const kind = contract.vars['ARG_KIND'];
    assert.ok(kind, `${contract.id} 没声明 ARG_KIND`);
    const quote = partial(`args/rule-quote.${kind}`).replace('{{QUOTE_RULE_AT}}', contract.vars['QUOTE_RULE_AT'] ?? '');
    assert.ok(r.content.includes(quote), `${r.relPath}：「拼串」一段不完整或缺失`);
    // 只输出实测过的两个 front-matter 键；argument-hint 改写进正文
    const fm = r.content.slice(4, r.content.indexOf('\n---\n'));
    assert.deepEqual(fm.split('\n').map((l) => l.slice(0, l.indexOf(':'))), ['name', 'description'], r.relPath);
    assert.match(r.content, /参数写法：`/, `${r.relPath}：argument-hint 没写进正文`);
  }
  assert.ok(transcribeSeen >= 21, `只检查了 ${transcribeSeen} 份 transcribe 产物，论域塌了`);
});

/**
 * 每条命令应注入 `--driver` 的调用数（计划 r5 §5.1 ③ / §5.3）。
 *
 *   run         S0.5 解析、S0.6 预检、S0.8 认领 plan、S2 `--start`、S4.5 认领 code、S6 `--start`
 *   review-plan / review-bug  第 0 步认领、预检、解析、两条解析样例、`--start`
 *   review-code 同上去掉认领（code 阶段的 Driver 产出在 `--start` 之后，`--start` 自带比对）
 *
 * 写成显式表而不是从源里数：从源里数会把「漏注入」数成「应注入的就这么多」。
 */
const DRIVER_CALLS: Readonly<Record<string, number>> = {
  run: 6, 'review-plan': 6, 'review-bug': 6, 'review-code': 5, approve: 0, abandon: 0, status: 0,
};

test('--driver <自家 id>：次数等于应注入的调用数，且不出现别家 id', () => {
  for (const r of rendered) {
    const want = DRIVER_CALLS[r.command];
    assert.notEqual(want, undefined, `新契约 ${r.command} 没登记应注入次数`);
    const all = [...r.content.matchAll(/--driver (\S+?)(?=[`\s）]|$)/g)].map((m) => m[1]);
    assert.deepEqual(
      [...new Set(all)].filter((id) => id !== r.agent), [],
      `${r.relPath}：出现了别家的 --driver`,
    );
    assert.equal(all.length, want, `${r.relPath}：--driver ${r.agent} 出现 ${all.length} 次，应为 ${want}`);
    // topic resolve 只解析 `--` 之后的 argv：放在 `--` 之前会被静默忽略
    for (const line of r.content.split('\n').filter((l) => /topic resolve/.test(l) && /--driver/.test(l))) {
      assert.ok(line.indexOf('--driver') > line.indexOf(' -- '), `${r.relPath}：--driver 须在 -- 之后：${line}`);
    }
  }
});

test('认领步骤：plan / bug / run 在「写原稿」之前；run 在 S5 之前认领 code；命令 C 不认领', () => {
  const writeMark = '<日期>-<主题>-<当轮 Driver>.md';
  for (const r of rendered) {
    if (r.command === 'review-plan' || r.command === 'review-bug' || r.command === 'run') {
      const claim = r.content.indexOf('topic claim');
      assert.ok(claim >= 0, `${r.relPath}：缺认领步骤`);
      assert.ok(claim < r.content.indexOf(writeMark), `${r.relPath}：认领须在写原稿之前`);
    }
    if (r.command === 'run') {
      const codeClaim = r.content.search(/topic claim --topic <主题> --stage code/);
      assert.ok(codeClaim >= 0 && codeClaim < r.content.indexOf('### S5'), `${r.relPath}：code 阶段须在 S5 之前认领`);
    }
    if (r.command === 'review-code') {
      assert.ok(!r.content.includes('topic claim'), `${r.relPath}：命令 C 不该认领`);
    }
    if (r.content.includes('topic claim')) {
      assert.match(r.content, /不要删那些文件来换回认领/, `${r.relPath}：被拒时的禁令没写进资产`);
      assert.match(r.content, /自声明/, `${r.relPath}：认领是自声明这条边界没写`);
    }
  }
});

test('命令 A 先解析、后预检，预检带上 resolve 解析出的入选集合（EV-125 D2）', () => {
  /*
   * 预检要查的是本轮实际入选的那几家：用户用 `--critics` 加进来的一家若缺 code 阶段 slug 或没登录，
   * 不在开跑前查出来，就要到 S6（编码已做完）才暴露。次序反了、或预检不带 `--critics`，
   * `--stage all` 这道保证就对显式选侧失效——两处任改其一都应当红。
   */
  const runs = rendered.filter((r) => r.command === 'run');
  assert.equal(runs.length, src.carriers.length, '论域塌了');
  for (const r of runs) {
    const resolveAt = r.content.indexOf('TV topic resolve --stage all');
    const preflightLine = r.content.split('\n').find((l) => l.includes('TV preflight --stage all'));
    assert.ok(resolveAt >= 0 && preflightLine, `${r.relPath}：缺解析或预检命令`);
    assert.ok(resolveAt < r.content.indexOf(preflightLine), `${r.relPath}：预检须在解析之后`);
    assert.match(preflightLine, /--critics /, `${r.relPath}：预检须带 --critics`);
    assert.ok(r.content.indexOf(preflightLine) < r.content.indexOf('topic claim'), `${r.relPath}：预检须在认领之前`);
  }
});

test('护栏注入段与 r10 §3.1.3 的表一致', () => {
  // 表本身先钉住：它来自注册表派生，派生规则或登记值一改，这里先红
  const table = Object.fromEntries(AGENTS.map((a) => [a.id, guardProfileOf(a)]));
  assert.deepEqual(table, { claude: 'l1-hook', codex: 'l2-none', gemini: 'l2-none', glm: 'l2-hook' });

  const heads = {
    'l1-hook': partial('guard/main.l1-hook').split('\n')[0]!,
    'l2-none': partial('guard/main.l2-none').split('\n')[0]!,
    'l2-hook': partial('guard/main.l2-hook').split('\n')[0]!,
  };
  const misfire = partial('guard/misfire');
  const l2 = partial('guard/l2-notice');
  for (const r of rendered) {
    const profile = guardProfileOf(agentById(r.agent)!);
    if (!MAIN_COMMANDS.includes(r.command)) {
      for (const h of Object.values(heads)) assert.ok(!r.content.includes(h), `${r.relPath}：辅助命令不注入护栏段`);
      continue;
    }
    for (const [p, h] of Object.entries(heads)) {
      assert.equal(r.content.includes(h), p === profile, `${r.relPath}：护栏段应为 ${profile}`);
    }
    assert.equal(r.content.includes(misfire), profile !== 'l2-none', `${r.relPath}：误拦提示只给有 Hook 的载体`);
    assert.equal(r.content.includes(l2), profile !== 'l1-hook', `${r.relPath}：L2 明示只给 L2 载体`);
    if (profile === 'l2-hook') assert.match(r.content, /五个前提/, `${r.relPath}：尽力拦截要写出五个生效前提`);
  }
});

test('调用写法按载体渲染：codex 用 $名字，另两家与 claude 各按实测写法', () => {
  for (const r of rendered.filter((x) => x.command === 'review-plan')) {
    const inv = carrierOf(r.agent).invocation.replace('{name}', 'dual-approve');
    assert.ok(r.content.includes(`\`${inv}\``), `${r.relPath}：停点那句应写 ${inv}`);
  }
});

test('模型与选侧取值由注册表派生，不给当轮 Driver 自己留槽位（EV-61）', () => {
  // 论域含 `run`（EV-125）：命令 A 自此与 B / C / D 同一组槽位，而它的参数写法正是历史上漏过一侧的那一处
  const checked = rendered.filter((x) => x.command.startsWith('review-') || x.command === 'run');
  assert.equal(checked.filter((x) => x.command === 'run').length, src.carriers.length, '论域塌了：run 没进来');
  for (const r of checked) {
    const hint = r.content.split('\n').find((l) => l.startsWith('argument-hint:') || l.includes('参数写法：`'))!;
    const models = [...hint.matchAll(/--model-([a-z]+)/g)].map((m) => m[1]!);
    assert.ok(!models.includes(r.agent), `${r.relPath}：不该有 --model-${r.agent}`);
    const want = AGENTS.filter((a) => a.criticEnabled && a.id !== r.agent).map((a) => a.id);
    assert.deepEqual(models, want, `${r.relPath}：--model-* 须等于本轮可入选的审核者`);
    const only = /--only ([a-z|]+)/.exec(hint)?.[1]?.split('|') ?? [];
    assert.deepEqual(only, want, `${r.relPath}：--only 的取值须等于本轮可入选的审核者`);
    for (const id of models) assert.ok(ALL_AGENT_IDS.includes(id as never));
  }
});

test('渲染器自测：未知变量与缺失片段当场抛错，不静默留空', () => {
  const carrier = src.carriers[0]!;
  const fake = (body: string): Contract => ({
    id: 'fake', name: 'dual-fake', frontmatter: [['name', 'dual-fake'], ['description', 'x']], vars: {}, body,
  });
  assert.throws(() => renderEntry(src, carrier, fake('{{NO_SUCH_VAR}}\n')), /未定义的模板变量/);
  assert.throws(() => renderEntry(src, carrier, fake('{{> no/such}}\n')), /缺少片段/);
  assert.throws(() => renderEntry(src, carrier, fake('{{> no/such@ARG_MODE}}\n')), /缺少片段/);
  // 独立行片段渲染为空：连同其后一个空行去掉
  const r = renderEntry(src, carrier, fake('甲\n\n{{> review/claim@SUBJECT_KIND}}\n\n乙\n'.replace('@SUBJECT_KIND', '.diff')));
  assert.ok(r.content.endsWith('甲\n\n乙\n'), JSON.stringify(r.content));
});
