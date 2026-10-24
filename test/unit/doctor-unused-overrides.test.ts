import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describeUnusedOverrides, doctorSectionConsumesOverrides, runDoctor, type UnusedOverridesInput } from '../../src/trivium/doctor.js';
import { TRIVIUM_DIR, agentConfigOf, defaultConfig } from '../../src/trivium/config.js';
import { AGENTS, ALL_CLI_NAMES, type AgentDescriptor } from '../../src/trivium/agents/registry.js';
import { assertModelOverrideKeys } from '../../src/trivium/critics.js';
import { EXIT, TriviumError } from '../../src/trivium/exit-codes.js';
import { REPO_ROOT } from '../helpers/fixture.js';
import { scratchDir } from '../helpers/scratch.js';
import { isolateEntryScanHome } from '../helpers/entry-scan-home.js';

isolateEntryScanHome();

/*
 * doctor 收到写给它不消费的家的覆盖旗标时给一条提示（EV-245，计划 r2 §2.1、§2.3 U1～U3、U5）。
 * 「用上没有」按 runDoctor 的运行期记录判（`overridesFor`），提示只进 warnings、退出码不变。
 */

const HEAD = '以下命令行覆盖本次没有用上';
const byCli = (cli: string): AgentDescriptor => AGENTS.find((a) => a.cliName === cli)!;
const AGY = byCli('agy');
const ZCODE = byCli('zcode');
const CODEX = byCli('codex');
const CLAUDE = byCli('claude');

function input(over: Partial<UnusedOverridesInput>): UnusedOverridesInput {
  return { consumed: new Set(), ran: new Set(), only: null, ...over };
}

// ── U1 纯函数 ──────────────────────────────────────────────────────────

test('U1 ① 写了的覆盖全部被读过 ⇒ null；什么都没写 ⇒ null', () => {
  assert.equal(describeUnusedOverrides(input({})), null);
  assert.equal(
    describeUnusedOverrides(input({
      modelOverrides: { [CODEX.id]: 'm' },
      tierFlags: { [CLAUDE.id]: { tier: 'high' } },
      consumed: new Set([CODEX.id, CLAUDE.id]),
      ran: new Set([CODEX.cliName, CLAUDE.cliName]),
    })),
    null,
  );
});

test('U1 ② 段跑了却没读覆盖 ⇒ 一条提示，点名旗标与显示名，原因是固定的探测口径；不回显取值', () => {
  const s = describeUnusedOverrides(input({
    modelOverrides: { [AGY.id]: 'secret-looking-model-value' },
    tierFlags: { [ZCODE.id]: { tier: 'high', effort: 'max' } },
    ran: new Set([AGY.cliName, ZCODE.cliName, CODEX.cliName, CLAUDE.cliName]),
    consumed: new Set([CODEX.id, CLAUDE.id]),
  }));
  assert.ok(s);
  const lines = s.split('\n');
  assert.ok(lines[0]!.startsWith(HEAD), s);
  assert.match(lines[0]!, /退出码与探测结论不受影响/);
  assert.equal(lines.length, 2, '同一原因归成一行');
  assert.equal(
    lines[1],
    `  · --model-${AGY.id}、--tier-${ZCODE.id}、--effort-${ZCODE.id}：${AGY.display}、${ZCODE.display} 的探测不读命令行覆盖值，用的是各自固定的探测口径`,
  );
  assert.ok(!s.includes('secret-looking-model-value'), '只列旗标名、不列取值');
  assert.ok(!s.includes('max'), '只列旗标名、不列取值');
});

test('U1 ③ 被 --only 滤掉的段 ⇒ 原因②，点名 --only 的取值', () => {
  const s = describeUnusedOverrides(input({
    modelOverrides: { [CODEX.id]: 'm' },
    tierFlags: { [CODEX.id]: { vendorProfile: null } },
    only: AGY.cliName,
    ran: new Set([AGY.cliName]),
  }));
  assert.equal(s?.split('\n')[1], `  · --model-${CODEX.id}、--native-${CODEX.id}：本次 --only ${AGY.cliName}，没有探测 ${CODEX.display}`);
});

/** 第五家：已登记、doctor 里没有它的段（桩描述符，不依赖真实注册表长什么样） */
const FIFTH: AgentDescriptor = { ...CODEX, id: 'fifth' as AgentDescriptor['id'], cliName: 'fifthcli', display: 'Fifth' };
const WITH_FIFTH = [...AGENTS, FIFTH];

test('U1 ④ 已登记、doctor 里尚无该段、不带 --only ⇒ 原因③（尚无探针）', () => {
  const s = describeUnusedOverrides(input({
    agents: WITH_FIFTH,
    modelOverrides: { fifth: 'm' } as UnusedOverridesInput['modelOverrides'],
    ran: new Set(AGENTS.map((a) => a.cliName)),
    consumed: new Set([CODEX.id, CLAUDE.id]),
  }));
  assert.equal(s?.split('\n')[1], '  · --model-fifth：doctor 尚无 Fifth 的探针');
});

test('U1 ④′ 同一家：--only 别的值 ⇒ 原因②优先；--only 恰为它 ⇒ 仍是原因③', () => {
  const base = { agents: WITH_FIFTH, modelOverrides: { fifth: 'm' } as UnusedOverridesInput['modelOverrides'] };
  const other = describeUnusedOverrides(input({ ...base, only: AGY.cliName, ran: new Set([AGY.cliName]) }));
  assert.equal(other?.split('\n')[1], `  · --model-fifth：本次 --only ${AGY.cliName}，没有探测 Fifth`);
  const self = describeUnusedOverrides(input({ ...base, only: 'fifthcli' }));
  assert.equal(self?.split('\n')[1], '  · --model-fifth：doctor 尚无 Fifth 的探针');
});

test('U1 ⑤ 三种原因同时出现：按「固定口径 → --only → 尚无探针」分行，组内按注册表顺序', () => {
  const s = describeUnusedOverrides(input({
    agents: WITH_FIFTH,
    // 故意倒序写入：顺序取注册表，不取写入序
    modelOverrides: { fifth: 'm', [ZCODE.id]: 'm', [AGY.id]: 'm' } as UnusedOverridesInput['modelOverrides'],
    tierFlags: { [CODEX.id]: { tier: 'low' } },
    only: null,
    ran: new Set([AGY.cliName, ZCODE.cliName]),
  }));
  const lines = s!.split('\n');
  assert.equal(lines.length, 3, s!);
  const order = AGENTS.filter((a) => a.id === AGY.id || a.id === ZCODE.id).map((a) => `--model-${a.id}`).join('、');
  assert.ok(lines[1]!.startsWith(`  · ${order}：`), s!);
  // codex 的段这一格没跑、也没被 --only 滤掉 ⇒ 与第五家同属原因③（这一格没有原因②，不出空行）
  assert.equal(lines[2], `  · --tier-${CODEX.id}、--model-fifth：doctor 尚无 ${CODEX.display}、Fifth 的探针`);
});

// ── U2 经 runDoctor ──────────────────────────────────────────────────

/** 只会报版本号的假入口：agy / codex 段在 skipModelCalls 下走得到、零配额 */
async function fakeBin(dir: string, name: string): Promise<string> {
  const p = path.join(dir, name);
  await fs.writeFile(p, `#!${process.execPath}\nconsole.log('${name} 0.0.1');\n`, { mode: 0o755 });
  return p;
}

async function doctorWorld() {
  const root = await scratchDir('trivium-unused-ovr-');
  const triviumDir = path.join(root, TRIVIUM_DIR);
  await fs.mkdir(triviumDir, { recursive: true });
  const bin = path.join(root, 'bin');
  await fs.mkdir(bin);
  const cfg = defaultConfig();
  agentConfigOf(cfg, 'gemini', 'antigravity').bin = await fakeBin(bin, 'agy');
  return { root, triviumDir, cfg, codexBin: await fakeBin(bin, 'codex') };
}

/** 段里会读家目录的探针（agy 的 Agent 文件、codex 的 CODEX_HOME）一律钉到夹具，不读真实家目录 */
async function withPinnedHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const saved = { HOME: process.env['HOME'], CODEX_HOME: process.env['CODEX_HOME'] };
  process.env['HOME'] = home;
  process.env['CODEX_HOME'] = path.join(home, '.codex');
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const hintsOf = (ws: readonly string[]): string[] => ws.filter((w) => w.startsWith(HEAD));

test('U2 --only env：写了覆盖 ⇒ warnings 末项是提示（原因②）、blockers 不变；不写 ⇒ warnings 与不传逐项相同', async () => {
  const w = await doctorWorld();
  const run = (extra: Partial<Parameters<typeof runDoctor>[0]>) =>
    runDoctor({ config: w.cfg, projectRoot: w.root, triviumDir: w.triviumDir, only: 'env', skipModelCalls: true, ...extra });
  const plain = await run({});
  const empty = await run({ modelOverrides: {}, tierFlags: {} });
  assert.deepEqual(empty.warnings, plain.warnings);
  assert.deepEqual(empty.blockers, plain.blockers);

  const hinted = await run({ modelOverrides: { [AGY.id]: 'x' } as never, tierFlags: { [ZCODE.id]: { tier: 'high' } } as never });
  assert.deepEqual(hinted.blockers, plain.blockers, '提示不进 blockers——退出码由 blockers 定');
  assert.deepEqual(hinted.warnings.slice(0, -1), plain.warnings, '其余告警逐项不变');
  const last = hinted.warnings.at(-1)!;
  assert.ok(last.startsWith(HEAD), last);
  assert.match(last, new RegExp(`--model-${AGY.id}、--tier-${ZCODE.id}：本次 --only env`));
});

test('U2 段跑了：agy 段不读覆盖 ⇒ 原因①；codex 段经 overridesFor 读了 ⇒ 不提示', async () => {
  const w = await doctorWorld();
  await withPinnedHome(path.join(w.root, 'home'), async () => {
    const agy = await runDoctor({
      config: w.cfg, projectRoot: w.root, triviumDir: w.triviumDir, only: AGY.cliName, skipModelCalls: true,
      modelOverrides: { [AGY.id]: 'x' } as never,
    });
    const h = hintsOf(agy.warnings);
    assert.equal(h.length, 1, agy.warnings.join('\n---\n'));
    assert.match(h[0]!, new RegExp(`--model-${AGY.id}：${AGY.display} 的探测不读命令行覆盖值`));

    const codex = await runDoctor({
      config: w.cfg, projectRoot: w.root, triviumDir: w.triviumDir, only: CODEX.cliName, skipModelCalls: true,
      probeBins: { codex: w.codexBin },
      modelOverrides: { [CODEX.id]: 'x' } as never,
    });
    assert.deepEqual(hintsOf(codex.warnings), [], 'codex 段读了它的覆盖，不该被报成没用上');

    // 同一次 --only codex 里写给 agy 的覆盖：原因②，且 codex 自己的不出现
    const mixed = await runDoctor({
      config: w.cfg, projectRoot: w.root, triviumDir: w.triviumDir, only: CODEX.cliName, skipModelCalls: true,
      probeBins: { codex: w.codexBin },
      modelOverrides: { [CODEX.id]: 'x', [AGY.id]: 'y' } as never,
    });
    const m = hintsOf(mixed.warnings);
    assert.equal(m.length, 1);
    assert.equal(m[0]!.split('\n')[1], `  · --model-${AGY.id}：本次 --only ${CODEX.cliName}，没有探测 ${AGY.display}`);
  });
});

// ── U3 源码护栏 ──────────────────────────────────────────────────────

test('U3 doctor.ts 里覆盖值只经 overridesFor 读（另一处是交给提示的入参），段内不得直接读 opts.tierFlags / opts.modelOverrides', async () => {
  const src = await fs.readFile(path.join(REPO_ROOT, 'src/trivium/doctor.ts'), 'utf8');
  const cut = (text: string, start: string, end: string): string => {
    const i = text.indexOf(start);
    assert.ok(i >= 0, `锚点不在：${start}`);
    const j = text.indexOf(end, i);
    assert.ok(j > i, `收尾锚点不在：${end}`);
    return text.slice(0, i) + text.slice(j + end.length);
  };
  let rest = cut(src, 'const overridesFor = ', '\n  };');
  // EV-251 起收尾挪进 finalize，多缩进一层
  rest = cut(rest, 'describeUnusedOverrides({\n', '\n    });');
  // 终端重跑命令按本次收到的旗标原样拼出（EV-251），不是段内读覆盖、不影响「用上没有」的记录
  rest = cut(rest, 'export function doctorRerunCommand(', '\n}\n');
  const isComment = (l: string): boolean => /^\s*(\*|\/\/|\/\*)/.test(l);
  const left = rest.split('\n').filter((l) => !isComment(l) && /opts\.(tierFlags|modelOverrides)\b/.test(l));
  assert.deepEqual(left, [], '这些行绕过了 overridesFor：用上的覆盖会被报成没用上');
  // 守住两段确实经助手：读覆盖的段数与 overridesFor( 调用数相同（今天是两段）
  const calls = src.split('overridesFor(').length - 1;
  assert.ok(calls >= 2, `overridesFor 调用只有 ${calls} 处`);
});

test('U3′ 「读覆盖的段」集合与源码对账（EV-251）：预检据它决定自动校准的调用带不带覆盖旗标', async () => {
  const src = await fs.readFile(path.join(REPO_ROOT, 'src/trivium/doctor.ts'), 'utf8');
  // 段边界：`if (only === null || only === '<cli>') {` 到下一段的同形开头（或「已登记但尚无探针实现」那一圈）
  const heads = [...src.matchAll(/if \(only === null \|\| only === '([a-z]+)'\) \{/g)];
  assert.ok(heads.length >= 4, `段开头只扫到 ${heads.length} 处`);
  const consuming: string[] = [];
  heads.forEach((m, i) => {
    const end = i + 1 < heads.length ? heads[i + 1]!.index! : src.indexOf('已登记但尚无探针实现', m.index!);
    if (src.slice(m.index!, end).includes('overridesFor(')) consuming.push(m[1]!);
  });
  for (const a of AGENTS) {
    assert.equal(doctorSectionConsumesOverrides(a.cliName), consuming.includes(a.cliName), a.cliName);
  }
});

test('U3″ 段次序常量与源码里各段的出现次序一致，集合等于注册表的 ALL_CLI_NAMES（代码三审 GLM-01）', async () => {
  const src = await fs.readFile(path.join(REPO_ROOT, 'src/trivium/doctor.ts'), 'utf8');
  const order = [...src.matchAll(/if \(only === null \|\| only === '([a-z]+)'\) \{/g)].map((m) => m[1]!);
  const decl = /DOCTOR_SECTION_ORDER: readonly string\[\] = \[([^\]]*)\]/.exec(src);
  assert.ok(decl, '找不到 DOCTOR_SECTION_ORDER 的声明');
  const constant = [...decl[1]!.matchAll(/'([a-z]+)'/g)].map((m) => m[1]!);
  assert.deepEqual(constant, order, '常量要与 runDoctor 里各段的执行次序一致，否则 deadline.sections 会漏段或错序');
  assert.deepEqual([...constant].sort(), [...ALL_CLI_NAMES].sort(), '新增一家 CLI 时常量要跟着加');
});

// ── U5 判键接线 ──────────────────────────────────────────────────────

test('U5 cmdDoctor：模型旗标与档位旗标同一份判键——同一个 driver、同一个 picked（CRITIC_AGENT_IDS），先键后值', async () => {
  const src = await fs.readFile(path.join(REPO_ROOT, 'src/trivium/cli.ts'), 'utf8');
  const start = src.indexOf('async function cmdDoctor(');
  const end = src.indexOf('\nasync function ', start + 1);
  const body = src.slice(start, end);
  const tier = body.indexOf('assertTierFlags(ctx.config, driver, collectTierFlags(tierFlagGetter(args)), CRITIC_AGENT_IDS)');
  const keys = body.indexOf('assertModelOverrideKeys(ctx.config, driver, Object.keys(modelRaw), CRITIC_AGENT_IDS)');
  const values = body.indexOf("assertFlagValuesGiven('model', modelRaw)");
  assert.ok(tier > 0, '档位旗标判键不在原处');
  assert.ok(keys > tier, '模型旗标判键缺失，或不在档位之后');
  assert.ok(values > keys, '先键后值');
  assert.equal(body.split('resolveDriver(').length - 1, 1, 'driver 只解析一次、两处共用');
});

test('U5 行为面：picked 取全部审核者时，已登记却未启用为审核者的一家 ⇒ 退 64（doctor 的口径，桩注册表）', () => {
  const target = AGY.id;
  const registry = AGENTS.map((a) => ({ ...a, criticEnabled: a.id !== target }));
  const picked = registry.filter((a) => a.criticEnabled).map((a) => a.id);
  const cfg = defaultConfig();
  assert.throws(
    () => assertModelOverrideKeys(cfg, CLAUDE.id, [target], picked, registry),
    (e: unknown) => e instanceof TriviumError && e.code === EXIT.USAGE && e.message.includes(`--model-${target}：${target} 本轮不是可用审核者`),
  );
  // 启用了的照常放行（今天的注册表就是这一格）
  assertModelOverrideKeys(cfg, CLAUDE.id, [CODEX.id, AGY.id], AGENTS.filter((a) => a.criticEnabled).map((a) => a.id));
});
