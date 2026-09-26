/**
 * 项目内 Hook 配置的渲染、合并与在场判定（M10b 第 3 步，计划 r10 §3.1.2、§3.2、§3.3；r9 §3.4）。
 *
 * 渲染源用仓库里**真实的** `skills/dual-critic/hooks/hooks.json`：ZCode 形态是从它派生的，
 * 拿一份手写的最小源测，就测不到「源里新加一条 ZCode 没有的工具名」「护栏失效提示点名的文件」这类真实形态。
 * 注册表按形态取家（`hookConfigTarget.format`），不写死哪家是哪种形态。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  describeGuard, effectiveGuardLevel, gateHoldNotice, hookConfigPresent, hookNamesOf, loadHookSource, mergeAgentHooks,
  renderHookEvents, type HookEntry, type HookMergeReport, type HookSource,
} from '../../src/trivium/hook-config.js';
import { AGENTS, DEFAULT_DRIVER, entryCommandOf, type AgentDescriptor } from '../../src/trivium/agents/registry.js';
import { REPO_ROOT } from '../helpers/fixture.js';
import { initFixtureRepo } from '../../src/trivium/util/git.js';
import { renderTamperedArtifacts } from '../../src/trivium/gate.js';
import { resolveTopicArgs } from '../../src/trivium/topic-args.js';
import { defaultConfig } from '../../src/trivium/config.js';

const HOOKS_JSON = path.join(REPO_ROOT, 'skills/dual-critic/hooks/hooks.json');
const byFormat = (f: string): AgentDescriptor => {
  const a = AGENTS.find((x) => x.hookConfigTarget?.format === f);
  assert.ok(a, `注册表里没有登记 ${f} 形态的家——本组用例的前提不成立`);
  return a;
};
const CLAUDE_FMT = byFormat('claude-settings');
const ZCODE_FMT = byFormat('zcode-config');
const NO_HOOK = AGENTS.find((a) => a.hookConfigTarget === null)!;

const report = (): HookMergeReport => ({ created: [], updated: [], skipped: [], notes: [] });
async function project(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'trivium-hookcfg-'));
}
async function source(): Promise<HookSource> {
  const s = await loadHookSource(HOOKS_JSON);
  assert.ok(s, '读不到仓库的 hooks.json');
  return s;
}
async function readJson(p: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(p, 'utf8')) as Record<string, unknown>;
}
function zcodeEvents(cfg: Record<string, unknown>): Record<string, HookEntry[]> {
  return ((cfg['hooks'] as Record<string, unknown>)['events'] ?? {}) as Record<string, HookEntry[]>;
}
const allNames = (events: Record<string, HookEntry[]>): string[] =>
  Object.values(events).flat().flatMap((e) => [...hookNamesOf(e)]).sort();

// ─────────────────────────── 渲染 ───────────────────────────

test('渲染：claude-settings 形态原样返回源（与改动前的合并逐字相同）', async () => {
  const s = await source();
  assert.equal(renderHookEvents('claude-settings', s, '.claude/settings.json'), s.hooks);
});

test('渲染：zcode-config 形态——matcher 只留 ZCode 有的工具名、timeout 换成 timeoutMs、提示点名本家配置文件', async () => {
  const s = await source();
  const target = ZCODE_FMT.hookConfigTarget!.path;
  const z = renderHookEvents('zcode-config', s, target);
  assert.deepEqual(Object.keys(z).sort(), Object.keys(s.hooks).sort(), '事件与源同名同集（ZCode 事件枚举含这五个）');
  assert.deepEqual(allNames(z), allNames(s.hooks), '五个 gate hook-* 一个不少、一个不多');
  for (const e of Object.values(z).flat()) {
    if (e.matcher !== undefined) {
      assert.match(e.matcher, /^[A-Za-z0-9_|]+$/, '只写精确名单形态：否则 ZCode 当不锚定正则，Write 会误配 TodoWrite');
      assert.ok(!e.matcher.split('|').includes('NotebookEdit'), 'NotebookEdit 不在 ZCode 工具注册表里');
    }
    for (const h of e.hooks as Record<string, unknown>[]) {
      assert.equal(h['timeout'], undefined, 'ZCode 不认 timeout（秒）');
      assert.equal(typeof h['timeoutMs'], 'number');
      assert.ok(!String(h['command']).includes('.claude/settings.json'), '护栏失效提示不能把人指到 Claude 的配置文件');
    }
  }
  const preWrite = z['PreToolUse']!.find((e) => hookNamesOf(e).has('pre-write'))!;
  assert.deepEqual(preWrite.matcher!.split('|').sort(), ['Edit', 'Write']);
  const srcPreWrite = s.hooks['PreToolUse']!.find((e) => hookNamesOf(e).has('pre-write'))!;
  assert.equal((preWrite.hooks[0] as Record<string, unknown>)['timeoutMs'], srcPreWrite.hooks[0]!.timeout! * 1000);
  assert.match(preWrite.hooks[0]!.command, new RegExp(`${target.replace(/\./g, '\\.')} 中的 TriviumCode Hook`));
});

test('渲染：事件名不在 ZCode 的事件枚举里 ⇒ 当场抛（与工具名同一条理由，代码双审 r3 GLM-04）', () => {
  const s: HookSource = { hooks: { SubagentStop: [{ hooks: [{ type: 'command', command: 'x gate hook-stop' }] }] } };
  assert.throws(() => renderHookEvents('zcode-config', s, '.zcode/config.json'), /不在 ZCode 的事件枚举里/);
  // Claude 形态原样返回，不受 ZCode 枚举约束
  assert.equal(renderHookEvents('claude-settings', s, '.claude/settings.json'), s.hooks);
});

test('渲染：matcher 在 ZCode 上一个工具名都不剩 ⇒ 当场抛（静默丢掉整条就是「装上了却不拦」）', () => {
  const s: HookSource = { hooks: { PreToolUse: [{ matcher: 'NotebookEdit', hooks: [{ type: 'command', command: 'x gate hook-pre-write' }] }] } };
  assert.throws(() => renderHookEvents('zcode-config', s, '.zcode/config.json'), /一个工具名都不剩/);
});

// ─────────────────────────── 合并 ───────────────────────────

test('合并（ZCode）：新项目 ⇒ 建 .zcode/config.json、hooks.enabled 置 true、提示重新信任', async () => {
  const root = await project();
  const r = report();
  await mergeAgentHooks(root, ZCODE_FMT, await source(), r, false);
  const p = path.join(root, ZCODE_FMT.hookConfigTarget!.path);
  const cfg = await readJson(p);
  assert.equal((cfg['hooks'] as Record<string, unknown>)['enabled'], true, 'ZCode 缺省 enabled: false，不开就一条都不跑');
  assert.deepEqual(allNames(zcodeEvents(cfg)), allNames((await source()).hooks));
  assert.deepEqual(r.created, [p]);
  assert.ok(r.notes.some((n) => /重新信任/.test(n) && /子代理/.test(n)), '信任与子代理两条边界要说出来');
});

test('合并（ZCode）：幂等——重跑不叠加、记「已就位」', async () => {
  const root = await project();
  await mergeAgentHooks(root, ZCODE_FMT, await source(), report(), false);
  const r2 = report();
  await mergeAgentHooks(root, ZCODE_FMT, await source(), r2, false);
  const cfg = await readJson(path.join(root, ZCODE_FMT.hookConfigTarget!.path));
  assert.equal(allNames(zcodeEvents(cfg)).length, allNames((await source()).hooks).length, '重跑不得叠加');
  assert.equal(r2.skipped.length, 1);
  assert.equal(r2.created.length + r2.updated.length, 0);
});

test('合并（ZCode）：保留用户已有的 Hook 与其它键；旧版同名条目原位替换；显式 enabled: false 不翻回', async () => {
  const root = await project();
  const p = path.join(root, ZCODE_FMT.hookConfigTarget!.path);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify({
    model: 'keep-me',
    hooks: {
      enabled: false,
      events: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] },
          { matcher: 'Write', hooks: [{ type: 'command', command: 'old gate hook-pre-write', timeoutMs: 1 }] },
        ],
      },
    },
  }));
  const r = report();
  await mergeAgentHooks(root, ZCODE_FMT, await source(), r, false);
  const cfg = await readJson(p);
  assert.equal(cfg['model'], 'keep-me', '其它键不得丢失');
  const hooks = cfg['hooks'] as Record<string, unknown>;
  assert.equal(hooks['enabled'], false, '用户显式停用（r10 §3.2.3 停用态）不得被重跑翻回');
  assert.ok(r.notes.some((n) => /enabled 为 false/.test(n)), '停用态要说出来：写进去了但不会运行');
  const pre = zcodeEvents(cfg)['PreToolUse']!;
  assert.ok(pre.some((e) => e.hooks.some((h) => h.command === 'echo mine')), '用户自己的 Hook 不动');
  const preWrite = pre.filter((e) => hookNamesOf(e).has('pre-write'));
  assert.equal(preWrite.length, 1, '旧版同名条目应被替换而非叠加');
  assert.notEqual(preWrite[0]!.hooks[0]!.command, 'old gate hook-pre-write');
  await fs.access(`${p}.trivium-backup`);
});

test('合并：不是合法 JSON 对象时跳过、原样保留内容', async () => {
  const root = await project();
  const p = path.join(root, ZCODE_FMT.hookConfigTarget!.path);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, '[1, 2]');
  const r = report();
  await mergeAgentHooks(root, ZCODE_FMT, await source(), r, false);
  assert.equal(await fs.readFile(p, 'utf8'), '[1, 2]');
  assert.ok(r.notes.some((n) => n.includes('解析失败')));
});

test('合并：嵌套键形态不对（hooks 为数组 / 字符串，ZCode 的 hooks.events 为数组）⇒ 跳过、原样保留（代码双审 r3 GLM-02）', async () => {
  const cases: [AgentDescriptor, unknown][] = [
    [CLAUDE_FMT, { hooks: [1, 2] }],
    [CLAUDE_FMT, { hooks: 'x' }],
    [ZCODE_FMT, { hooks: [] }],
    [ZCODE_FMT, { hooks: { enabled: true, events: [] } }],
  ];
  for (const [agent, content] of cases) {
    const root = await project();
    const p = path.join(root, agent.hookConfigTarget!.path);
    await fs.mkdir(path.dirname(p), { recursive: true });
    const text = JSON.stringify(content);
    await fs.writeFile(p, text);
    const r = report();
    await mergeAgentHooks(root, agent, await source(), r, false);
    assert.equal(await fs.readFile(p, 'utf8'), text, `${text}：内容必须原样保留`);
    assert.equal(r.created.length + r.updated.length, 0, `${text}：不得报成功`);
    assert.ok(r.notes.some((n) => /形态不对/.test(n)), `${text}：要说出来`);
  }
});

test('合并：dry-run 不落任何东西（连目录也不建），notes 用「将……」措辞（代码双审 r3 CODEX-04）', async () => {
  const root = await project();
  const r = report();
  await mergeAgentHooks(root, ZCODE_FMT, await source(), r, true);
  await assert.rejects(fs.access(path.dirname(path.join(root, ZCODE_FMT.hookConfigTarget!.path))), '预演不得建目录');
  assert.deepEqual(r.created, [path.join(root, ZCODE_FMT.hookConfigTarget!.path)], '汇报「将新建」');
  assert.ok(r.notes.some((n) => n.startsWith('将写入')));
  assert.ok(!r.notes.some((n) => /已写入|已备份/.test(n)), '不得汇报没发生的事');
});

test('合并（ZCode）：配置被 .gitignore 忽略时如实说「只对本机生效、不随仓库分发」（代码双审 r3 CODEX-03 ≡ GLM-05）', async () => {
  for (const ignored of [true, false]) {
    const root = await project();
    if (ignored) await fs.writeFile(path.join(root, '.gitignore'), '.zcode/\n');
    await initFixtureRepo(root);
    const r = report();
    await mergeAgentHooks(root, ZCODE_FMT, await source(), r, false);
    assert.equal(r.notes.some((n) => /不随仓库分发/.test(n)), ignored, `ignored=${ignored}`);
    assert.ok(r.notes.some((n) => /不用 ZCode 可忽略/.test(n)), '不用 ZCode 的项目也会收到这条，要告诉它可以忽略');
  }
});

test('合并：没有 Hook 机制的家什么都不做', async () => {
  const root = await project();
  const r = report();
  await mergeAgentHooks(root, NO_HOOK, await source(), r, false);
  assert.deepEqual(r, report());
  assert.deepEqual(await fs.readdir(root), []);
});

// ─────────────────────────── 在场判定与有效等级（B1）───────────────────────────

test('在场判定：配置文件不在 ⇒ false；合并后 ⇒ true；缺 pre-bash 一道 ⇒ false', async () => {
  const root = await project();
  assert.equal(await hookConfigPresent(root, CLAUDE_FMT), false);
  await mergeAgentHooks(root, CLAUDE_FMT, await source(), report(), false);
  assert.equal(await hookConfigPresent(root, CLAUDE_FMT), true);
  const p = path.join(root, CLAUDE_FMT.hookConfigTarget!.path);
  const cfg = await readJson(p);
  const hooks = cfg['hooks'] as Record<string, HookEntry[]>;
  hooks['PreToolUse'] = hooks['PreToolUse']!.filter((e) => !hookNamesOf(e).has('pre-bash'));
  await fs.writeFile(p, JSON.stringify(cfg));
  assert.equal(await hookConfigPresent(root, CLAUDE_FMT), false, 'Bash 这道没了，写入就有一条无人判定的路');
});

test('在场判定：必需集是 L1 承诺覆盖的四道——单独摘掉 Stop 或 pre-commit 也 ⇒ false（代码双审 r3 CODEX-01）', async () => {
  for (const [event, name] of [['Stop', 'stop'], ['PreToolUse', 'pre-commit']] as const) {
    const root = await project();
    await mergeAgentHooks(root, CLAUDE_FMT, await source(), report(), false);
    const p = path.join(root, CLAUDE_FMT.hookConfigTarget!.path);
    const cfg = await readJson(p);
    const hooks = cfg['hooks'] as Record<string, HookEntry[]>;
    hooks[event] = hooks[event]!.filter((e) => !hookNamesOf(e).has(name));
    await fs.writeFile(p, JSON.stringify(cfg));
    assert.equal(
      await hookConfigPresent(root, CLAUDE_FMT), false,
      `摘掉 ${name}：L1 入口资产承诺「裁决未完成不得收工 / 提交拦截由 Hook 强制」就不成立了`,
    );
  }
});

test('在场判定（Claude）：disableAllHooks——项目层 true ⇒ false；local 层优先于项目层（代码双审 r3 GLM-01）', async () => {
  const root = await project();
  await mergeAgentHooks(root, CLAUDE_FMT, await source(), report(), false);
  const p = path.join(root, CLAUDE_FMT.hookConfigTarget!.path);
  const local = path.join(path.dirname(p), 'settings.local.json');
  const cfg = await readJson(p);
  await fs.writeFile(p, JSON.stringify({ ...cfg, disableAllHooks: true }));
  assert.equal(await hookConfigPresent(root, CLAUDE_FMT), false, '项目层停用了全部 Hook');
  await fs.writeFile(local, JSON.stringify({ disableAllHooks: false }));
  assert.equal(await hookConfigPresent(root, CLAUDE_FMT), true, 'local 层的 false 覆盖项目层的 true');
  await fs.writeFile(p, JSON.stringify(cfg));
  await fs.writeFile(local, JSON.stringify({ disableAllHooks: true }));
  assert.equal(await hookConfigPresent(root, CLAUDE_FMT), false, 'local 层停用了全部 Hook');
});

test('在场判定（ZCode）：hooks.enabled 不为 true ⇒ false', async () => {
  const root = await project();
  await mergeAgentHooks(root, ZCODE_FMT, await source(), report(), false);
  assert.equal(await hookConfigPresent(root, ZCODE_FMT), true);
  const p = path.join(root, ZCODE_FMT.hookConfigTarget!.path);
  const cfg = await readJson(p);
  (cfg['hooks'] as Record<string, unknown>)['enabled'] = false;
  await fs.writeFile(p, JSON.stringify(cfg));
  assert.equal(await hookConfigPresent(root, ZCODE_FMT), false);
});

test('有效等级：登记 L1 且 Hook 在场 ⇒ L1；不在场 ⇒ 降 L2 并标 downgraded，文案给修复出口', async () => {
  const l1 = AGENTS.find((a) => a.guardLevel === 'L1')!;
  const root = await project();
  const down = await effectiveGuardLevel(root, l1);
  assert.deepEqual([down.level, down.registered, down.downgraded], ['L2', 'L1', true]);
  assert.match(describeGuard(l1, down), new RegExp(`trivium hooks --agent ${l1.id}`));
  await mergeAgentHooks(root, l1, await source(), report(), false);
  const up = await effectiveGuardLevel(root, l1);
  assert.deepEqual([up.level, up.downgraded], ['L1', false]);
});

test('停点后半句按有效等级四档措辞：只有真正 L1 才说「Hook 会拦下」（M10b 第 3 步）', async () => {
  const root = await project();
  const l1 = AGENTS.find((a) => a.guardLevel === 'L1')!;
  const texts: Record<string, string> = {};
  texts['l1-down'] = gateHoldNotice(await effectiveGuardLevel(root, l1));
  await mergeAgentHooks(root, l1, await source(), report(), false);
  texts['l1'] = gateHoldNotice(await effectiveGuardLevel(root, l1));
  texts['l2-hook'] = gateHoldNotice(await effectiveGuardLevel(root, ZCODE_FMT));
  texts['l2-none'] = gateHoldNotice(await effectiveGuardLevel(root, NO_HOOK));

  // L1 档也登记超时例外（代码双审 r3 GLM-06）：不写成无例外的「会拦下」
  assert.match(texts['l1']!, /^在此期间不得修改业务文件（Hook 会拦下；Hook 超时即放行/);
  for (const k of ['l1-down', 'l2-hook', 'l2-none']) {
    assert.doesNotMatch(texts[k]!, /Hook 会拦下/, `${k}：说「会拦下」而实际不拦，执笔者会放心去写`);
    /*
     * EV-132 候选 ①：闸门期改业务文件，审批前复核与跑后复算两道都发现不了（M10b 第 4 步 3-4 实测）。
     * 旧尾句「越界……会在审批前复核与跑后漂移复算时暴露」对闸门期不成立，这里钉住它不再回来。
     */
    /*
     * EV-132 候选 ② 折中版（计划 `.reviews/审批前工作树摘要/plan/` r2 D6）：闸门期改业务文件不会让审批失败，
     * 审批时 approve 会列出自审查收尾以来改过的文件（只告知）。共用前段不就「拦不拦」表态（计划双审 GLM-02）——
     * l2-hook 档前缀是「尽力拦截」，再说「不会被拦」就同句自相矛盾。
     */
    assert.match(texts[k]!, /此刻改了业务文件也不会让审批失败/, `${k}：要写实闸门期改了也不会让审批失败`);
    assert.match(texts[k]!, /审批时 approve 会列出自审查收尾以来改过的文件（只告知/, `${k}：要说审批时会列出改动`);
    // 代码双审 r1 GLM-02：「会列出」不写成无条件承诺，取不到时如实报原因
    assert.match(texts[k]!, /取不到时如实报原因/, `${k}：要交代取不到的情形`);
    assert.doesNotMatch(texts[k]!, /不会被拦|不拦/, `${k}：共用前段不就拦不拦表态`);
    assert.doesNotMatch(texts[k]!, /事后也没有机制会发现/, `${k}：摘要上线后这句不再属实`);
    assert.doesNotMatch(texts[k]!, /会在审批前复核|复算时暴露/, `${k}：不得再宣称闸门期越界会被事后暴露`);
    assert.match(texts[k]!, /审批之后删改审查工件/, `${k}：后段要说审批之后的情形`);
  }
  // 后段按档分：三档互不相同，且各含本档的出口
  assert.match(texts['l2-hook']!, /只有 Hook 生效的会话里提交时才会被核对/);
  assert.match(texts['l2-none']!, /本载体上没有机制会发现；要让提交锚补上，就在 Claude Code 会话里提交/);
  assert.match(texts['l1-down']!, /要先重跑 `init` 恢复 Hook/);
  assert.equal(new Set(['l1-down', 'l2-hook', 'l2-none'].map((k) => texts[k])).size, 3);
  assert.match(texts['l1-down']!, /Hook 配置不在场（登记 L1，本次按 L2 计）/);
  assert.match(texts['l2-hook']!, /只作尽力拦截、不兜底/);
  assert.match(texts['l2-none']!, /没有 Hook 拦截/);
});

test('EV-132 D7：describeGuard 的 L1 降级与 l2-none 两档不再把审批前复核列成业务写入越界的兜底', async () => {
  const root = await project();
  const l1 = AGENTS.find((a) => a.guardLevel === 'L1')!;
  const down = describeGuard(l1, await effectiveGuardLevel(root, l1));
  const none = describeGuard(NO_HOOK, await effectiveGuardLevel(root, NO_HOOK));
  for (const [k, t] of [['l1-down', down], ['l2-none', none]] as const) {
    assert.doesNotMatch(t, /靠审批前复核/, `${k}：${t}`);
    assert.match(t, /闸门期改业务文件不会让审批失败，命令 B \/ C \/ D 审批时只打印工作树改动摘要/, `${k}：${t}`);
    assert.doesNotMatch(t, /没有机制会发现/, `${k}：摘要上线后这句不再属实：${t}`);
    assert.match(t, /审查中的越界由跑后复算发现/, `${k}：${t}`);
  }
});

test('entryCommandOf：按当轮 Driver 的调用写法；取不到或未登记时回落缺省 Driver', () => {
  for (const a of AGENTS) {
    assert.equal(entryCommandOf(a.id, 'dual-approve'), a.entryInvocation.replace('{name}', 'dual-approve'));
  }
  const dflt = AGENTS.find((a) => a.id === DEFAULT_DRIVER)!.entryInvocation.replace('{name}', 'x');
  assert.equal(entryCommandOf(null, 'x'), dflt, '旧闸门记录没有 driver 字段');
  assert.equal(entryCommandOf('nosuch', 'x'), dflt);
  assert.ok(AGENTS.some((a) => !a.entryInvocation.startsWith('/')), '前提：至少一家不是斜杠写法，否则本条区分不开');
});

/*
 * 恢复路径文案同样按当轮 Driver 取调用写法（代码双审 r3 GLM-03）。取一家非斜杠写法的 Driver（注册表派生，今天是 codex），
 * 否则写死 `/` 与派生区分不开。
 */
const NON_SLASH = AGENTS.find((a) => a.driverEnabled && !a.entryInvocation.startsWith('/'))!;

test('工件篡改的出口按当轮 Driver 取写法；缺省按缺省 Driver（GLM-03）', () => {
  const t = [{ kind: 'missing', relPath: 'x.md', runId: 'R', recordedSha256: '0'.repeat(64) }] as unknown as Parameters<
    typeof renderTamperedArtifacts
  >[0];
  assert.ok(renderTamperedArtifacts(t, NON_SLASH.id).includes(`\`${entryCommandOf(NON_SLASH.id, 'dual-abandon')}\``));
  assert.ok(!renderTamperedArtifacts(t, NON_SLASH.id).includes('`/dual-abandon`'));
  assert.ok(renderTamperedArtifacts(t).includes(`\`${entryCommandOf(DEFAULT_DRIVER, 'dual-abandon')}\``));
});

test('缺焦点的用法报错按本次声明的 Driver 取写法（GLM-03）', async () => {
  const root = await project();
  const ctx = {
    config: defaultConfig(), projectRoot: root, archiveRoot: path.join(root, '.reviews'),
    triviumDir: path.join(root, '.trivium'), sources: ['<test>'],
  };
  await assert.rejects(
    resolveTopicArgs({ ctx, scope: 'plan', rawArgs: ['--driver', NON_SLASH.id] }),
    (e: { message: string }) => {
      assert.ok(e.message.includes(`${entryCommandOf(NON_SLASH.id, 'dual-review-<plan|code|bug>')} <本次重点看什么>`), e.message);
      return true;
    },
  );
});

test('有效等级：登记 L2 的家不看 Hook 在不在场（D-3 撤回 hooks_deny_ok，r10 §3.3）', async () => {
  const root = await project();
  for (const a of AGENTS.filter((x) => x.guardLevel === 'L2')) {
    const g = await effectiveGuardLevel(root, a);
    assert.deepEqual([g.level, g.downgraded], ['L2', false], a.id);
    if (a.hookConfigTarget) {
      await mergeAgentHooks(root, a, await source(), report(), false);
      assert.equal((await effectiveGuardLevel(root, a)).level, 'L2', `${a.id}：装上尽力拦截的 Hook 也不升 L1`);
    }
  }
});
