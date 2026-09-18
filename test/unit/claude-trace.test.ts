/**
 * Claude Code 轨迹的**提取与计数**（M9 第 3 步，`adapters/claude-trace.ts`）。
 *
 * 与 `claude-events.test.ts` 的分工：那边锁的是**解析**（什么算一条事件、
 * 什么算跑完了），且那批用例是搬家前就存在的——它们逐字不变地继续跑，
 * 正是「搬家零行为变化」的安全网。本文件锁的是搬家时**新增**的那一层：
 * 成功/失败配对、路径提取、覆盖率分母、按工具计数。
 *
 * 样本是 **2026-09-14 真跑录下来的**（`test/fixtures/claude-events/`），
 * 三份恰好覆盖三种情形：Read 成功、Read 被路径级 deny 挡住、白名单外工具被拒。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  CLAUDE_MUST_HAVE_PATH,
  CLAUDE_PATH_KEYS,
  CLAUDE_READ_TOOLS,
  countTools,
  extractClaudePath,
  finalReviewText,
  parseClaudeEvents,
  pathCoverage,
  readPaths,
  successfulToolUses,
} from '../../src/trivium/adapters/claude-trace.js';
import { REPO_ROOT } from '../helpers/fixture.js';

// `.jsonl` 是源码资产不是构建产物，esbuild 不搬进 dist/——按产物目录解析会 ENOENT
const FIXTURES = path.join(REPO_ROOT, 'test/fixtures/claude-events');
const load = (name: string): Promise<string> => fs.readFile(path.join(FIXTURES, name), 'utf8');

test('成功配对：被 deny 挡住的调用不算成功（errored 的 tool_use_id 要配对排除）', async () => {
  const ok = parseClaudeEvents(await load('read-sentinel.jsonl'));
  const denied = parseClaudeEvents(await load('path-denied.jsonl'));

  // 两份样本各有一次 Read，差别只在结果是不是 is_error
  assert.equal(ok.toolUses.length, 1);
  assert.equal(denied.toolUses.length, 1);

  assert.equal(successfulToolUses(ok).length, 1, '正常完成的 Read 要算成功');
  assert.equal(
    successfulToolUses(denied).length,
    0,
    '被路径级 deny 挡住的 Read 不算成功——它没有真的读到东西',
  );
});

test('读取路径：deny 生效时 read_paths 为空，而不是反而多出一条', async () => {
  const ok = parseClaudeEvents(await load('read-sentinel.jsonl'));
  const denied = parseClaudeEvents(await load('path-denied.jsonl'));

  assert.deepEqual(readPaths(ok), ['/private/tmp/claude-probe-ffQFA9/sentinel.txt']);

  /*
   * 这条是本组最要紧的一条：`path-denied.jsonl` 里那次 Read 的 `input.file_path`
   * **是有值的**（同侪产出的路径），只是调用被挡下了。若不按 errored 配对排除，
   * 路径级 deny 真正生效的那一刻反而会让读取证据计数**升高**——方向正好相反。
   */
  assert.deepEqual(readPaths(denied), [], '被挡下的调用不得计入读取证据');
});

test('读取路径：只收读类工具，写工具的 file_path 不进 read_paths', async () => {
  const t = parseClaudeEvents(await load('tool-denied.jsonl'));
  assert.equal(t.toolUses[0]?.name, 'Write');
  assert.ok(!CLAUDE_READ_TOOLS.has('Write'), 'Write 不该在读类工具集合里');
  assert.deepEqual(readPaths(t), []);
});

test('覆盖率分母只含 Read——Grep/Glob 的路径参数可选，进分母会变成稳态噪声', () => {
  assert.deepEqual([...CLAUDE_MUST_HAVE_PATH], ['Read']);

  /*
   * 合成一条轨迹：一次带路径的 Read、一次**不带**路径的 Grep。
   * Grep 不传路径是**合法调用**（不传即从当前工作目录搜），不是提取器退化，
   * 所以它不能进分母。这条断言就是 `zcode-trace.ts` 那段注释说的
   * 「把它们计进分母会让降级档位变成稳态噪声，淹掉真信号」。
   */
  const jsonl = [
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read', id: 'a', input: { file_path: '/x/a.ts' } },
          { type: 'tool_use', name: 'Grep', id: 'b', input: { pattern: 'foo' } },
        ],
      },
    }),
    JSON.stringify({ type: 'result', subtype: 'success', result: 'done' }),
  ].join('\n');

  const t = parseClaudeEvents(jsonl);
  assert.deepEqual(pathCoverage(t), { total: 1, withPath: 1 });
  // 而 Grep 本身仍然被计数、路径提不出来也不报退化
  assert.deepEqual(countTools(t), { read: 1, grep: 1, glob: 0 });
});

test('覆盖率：Read 提不出路径时 total 与 withPath 不等（提取器退化的唯一运行时信号）', () => {
  const jsonl = [
    JSON.stringify({
      type: 'assistant',
      // 厂商把参数名改成了我们没收的那个 ⇒ 提不出来
      message: { content: [{ type: 'tool_use', name: 'Read', id: 'a', input: { target: '/x/a.ts' } }] },
    }),
    JSON.stringify({ type: 'result', subtype: 'success', result: 'done' }),
  ].join('\n');

  assert.deepEqual(
    pathCoverage(parseClaudeEvents(jsonl)),
    { total: 1, withPath: 0 },
    '必带路径的调用提不出路径 ⇒ 两个计数不等，这正是设计 §10.1.1 第②层要的信号',
  );
});

test('按工具计数：不产出 run_command 键（该侧工具面里没有命令工具）', async () => {
  const t = parseClaudeEvents(await load('read-sentinel.jsonl'));
  const counts = countTools(t);
  assert.deepEqual(Object.keys(counts).sort(), ['glob', 'grep', 'read']);
  assert.ok(
    !('run_command' in counts),
    '给一个不存在的概念记 0，会与「跑了 0 条命令」长得一样，而两者含义不同',
  );
});

test('路径提取：按 CLAUDE_PATH_KEYS 的顺序取第一个非空字符串', () => {
  assert.equal(extractClaudePath({ file_path: '/a' }), '/a');
  assert.equal(extractClaudePath({ path: '/b' }), '/b');
  // 空串不算（与 zcode 侧同口径：`v.length > 0`）
  assert.equal(extractClaudePath({ file_path: '', path: '/c' }), '/c');
  // 非字符串不算
  assert.equal(extractClaudePath({ file_path: 123 }), null);
  // 一个都没有 ⇒ null，不抛（Grep 只给 pattern 是常态）
  assert.equal(extractClaudePath({ pattern: 'foo' }), null);
});

test('最终回复：原样取 result.result，不在这一层 parse JSON', async () => {
  const t = parseClaudeEvents(await load('read-sentinel.jsonl'));
  assert.equal(finalReviewText(t), t.finalText);
  assert.equal(typeof finalReviewText(t), 'string');
});

test('契约：夹具样本里呈路径形态的参数键，必须都在 CLAUDE_PATH_KEYS 里', async () => {
  /*
   * ## 这条用例存在的理由
   *
   * `CLAUDE_PATH_KEYS` 里**只有 `file_path` 有本侧实测样本**；`path` 与
   * `notebook_path` 目前只有同族衍生 CLI（zcode）的旁证。而设计 §3.7 对 M9
   * 写死了一条：路径级 deny 对 `Grep` **实测不生效**，那条通道的唯一兜底
   * 就是事后轨迹核验，**且必须覆盖 `Grep` 的路径参数**——收不到就等于兜底不存在。
   *
   * v1.3.12 教训七记过同一形态的实账：措施 a 对 agy 的 grep 通道**全盲**，
   * 因为 `PATH_KEYS` 不含它的搜索目录参数名，实测 15 次 grep 提出 **0** 条路径。
   *
   * ## 它怎么把「记得回填」变成结构保证
   *
   * M9 第 3 步的 EV-43 复验**必跑 Grep 臂**，届时会把真实事件流落一份进
   * `test/fixtures/claude-events/`。那一刻若 Grep 的路径参数叫别的名字，
   * **本用例当场红**，而不是等到某次真实审查里 deny 兜底静默失效。
   *
   * 两条判据并用，因为它们漏的方向不同：
   *   (a) 按**键名**——抓 `search_path` 这类换了前缀的；
   *   (b) 按**值**——抓键名完全不含 path 字样、但值确实是路径的。
   */
  const keys = new Set(CLAUDE_PATH_KEYS);
  const offenders: string[] = [];

  for (const name of await fs.readdir(FIXTURES)) {
    if (!name.endsWith('.jsonl')) continue;
    const t = parseClaudeEvents(await load(name));
    for (const u of t.toolUses) {
      for (const [k, v] of Object.entries(u.input)) {
        if (keys.has(k)) continue;
        // (a) 键名呈路径形态
        if (/path/i.test(k)) offenders.push(`${name} ${u.name}.${k}（键名含 path）`);
        // (b) 值是绝对路径形态
        else if (typeof v === 'string' && v.startsWith('/')) {
          offenders.push(`${name} ${u.name}.${k}=${v.slice(0, 40)}（值是绝对路径）`);
        }
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    '夹具样本里出现了 CLAUDE_PATH_KEYS 收不到的路径参数：\n  ' +
      offenders.join('\n  ') +
      '\n  把键名补进 CLAUDE_PATH_KEYS 并更新它的证据等级表。' +
      '漏收一个键，事后轨迹核验对那条通道就是全盲的（设计 §3.7 / v1.3.12 教训七）。',
  );

  // 防空转：论域不能是空的，否则这条契约永远绿
  assert.ok(
    (await fs.readdir(FIXTURES)).filter((f) => f.endsWith('.jsonl')).length >= 3,
    '夹具样本少于 3 份——扫描范围写错了会让本条永绿',
  );
});
