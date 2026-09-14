/**
 * Codex `exec --json` 事件流解析（M6 第 2 步）。
 *
 * 喂给解析器的是 **2026-09-14 真跑录下来的输出**（`test/fixtures/codex-events/`），
 * 不是手编的样本。计划 §6.2 把这条写死：手编只能证明「解析器能解析我以为的格式」，
 * 而探针存在的全部理由是我以为的格式可能不对。
 *
 * 本组里有两条**锁事实**的用例（读取路径无结构化字段、被拒命令不进轨迹）。
 * 它们守的不是代码行为，而是**我们据以做 M8 设计决策的那两个前提**：
 * 哪天 codex 改了行为，它们会红——那不是坏消息，是通知我们可以收回相应的降级。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  HEADER_LABELS,
  judgeHeadlessRead,
  parseCodexEvents,
  parseHeaderLines,
  probeCodexProfiles,
  traceCompleted,
} from '../../src/trivium/probes/codex.js';
import { REPO_ROOT } from '../helpers/fixture.js';

/*
 * 从 REPO_ROOT 取，不从 import.meta.url 取：`.jsonl` 是**源码资产**不是构建产物，
 * esbuild 不会把它搬进 dist/，按产物目录解析会 ENOENT。
 * M7b 第 6 步的 `.ts.txt` 夹具踩过同一个坑。
 */
const FIXTURES = path.join(REPO_ROOT, 'test/fixtures/codex-events');

const load = (name: string): Promise<string> =>
  fs.readFile(path.join(FIXTURES, name), 'utf8');

test('录制样本：读文件任务的事件类型图谱与哨兵回显', async () => {
  const t = parseCodexEvents(await load('read-sentinel.jsonl'));

  assert.deepEqual(
    t.eventTypes,
    ['item.completed', 'item.started', 'thread.started', 'turn.completed', 'turn.started'],
    '顶层事件类型变了就要重录样本并复核解析器',
  );
  assert.ok(t.itemTypes.includes('command_execution'));
  assert.ok(t.itemTypes.includes('agent_message'));
  assert.match(t.finalText ?? '', /SENTINEL[-_]OPEN/, '哨兵必须出现在最终回复里');
});

test('锁事实①：读取路径只在命令文本里，没有结构化字段', async () => {
  /*
   * codex 读文件是让模型跑 shell，而不是调专用 read 工具：
   *   command: "/bin/zsh -lc 'head -n 1 /tmp/.../sentinel.txt'"
   * agy 与 zcode 的读事件都带独立路径字段，codex 没有。
   *
   * 后果（写进 CodexProbe.trace_path_structured 的「消费方」注释）：
   * M8 的 project_reads 统计与禁读核验只能走命令文本解析——
   * BACKLOG EV-01 的「措施 b」对另两家是补充手段，对 codex 是**唯一**手段。
   */
  const t = parseCodexEvents(await load('read-sentinel.jsonl'));
  const exec = t.commands.find((c) => c.command.includes('sentinel.txt'));
  assert.ok(exec, '样本里应当有一条读哨兵的命令');
  assert.match(exec.command, /head -n 1/, '读文件确实是经 shell 完成的');
  assert.equal(exec.exitCode, 0);
  assert.match(exec.output, /SENTINEL[-_]OPEN/, '文件内容经 aggregated_output 回来');
});

test('锁事实②：被只读沙箱拒绝的命令完全不进事件流', async () => {
  /*
   * 这条是本步最重要的发现，也是**检测盲区**的机器化断言。
   *
   * 录制时模型明说它试了两条写入途径且都被拒（`operation not permitted`、
   * `blocked by read-only sandbox`），而事件流里 command_execution 一条都没有。
   * 写入确实被挡住了（沙箱有效，不是安全漏洞），丢的是「尝试过写入」这个行为信号——
   * 设计 §10.3「轨迹有写事件即判失守」对该侧恒为假。
   *
   * **哪天这条红了，说明 codex 开始记录被拒命令**，那时 guard 的轨迹核验
   * 对 codex 侧就可用了，`rejected_command_in_trace` 该改回 true。
   */
  const t = parseCodexEvents(await load('readonly-denied.jsonl'));
  assert.deepEqual(
    t.commands, [],
    '被拒的写命令若开始出现在轨迹里，说明盲区消失了——' +
      '这不是失败，是该回头启用 codex 侧轨迹核验的信号',
  );
  assert.match(
    t.finalText ?? '', /只读|read-only|not permitted/i,
    '模型的最终回复应当说明它被拒了（人读证据仍在，只是没有结构化事件）',
  );
});

test('解析器：坏行跳过而不是抛', () => {
  const t = parseCodexEvents(
    [
      'Reading additional input from stdin...', // 真实输出里混进来的 stderr 噪声
      '{"type":"thread.started","thread_id":"x"}',
      '{ 这行不是合法 JSON',
      '',
      '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}',
    ].join('\n'),
  );
  assert.deepEqual(t.eventTypes, ['item.completed', 'thread.started']);
  assert.equal(t.finalText, 'ok');
});

test('解析器：只统计 completed 的命令，in_progress 不算证据', async () => {
  /*
   * 同一条命令会先后产生 in_progress 与 completed 两条事件（录制样本里就是）。
   * 统计时算两次会让 project_reads 凭空翻倍——证据下限就失真了。
   */
  const t = parseCodexEvents(await load('read-sentinel.jsonl'));
  const sentinelCmds = t.commands.filter((c) => c.command.includes('sentinel.txt'));
  assert.equal(sentinelCmds.length, 1, 'in_progress 与 completed 是同一条命令，只能算一次');
});

test('profile 名单按 $CODEX_HOME/<name>.config.toml 枚举', async () => {
  /*
   * 设计原定义是「读 config.toml 的 [profiles.*] 名单」。0.154.0 的 -p 是
   * **文件分层**（参数类型就叫 CONFIG_PROFILE_V2），那个段在本机五份 toml 里
   * 一个都没有——按原定义取，名单恒为空，而 M8 的「未知 profile 拦截」是
   * 「名单为空即跳过」，于是那道拦截会静默失效。
   */
  const home = await fs.mkdtemp(path.join(REPO_ROOT, 'node_modules/.codexhome-'));
  try {
    await fs.writeFile(path.join(home, 'config.toml'), 'model = "x"\n');
    await fs.writeFile(path.join(home, 'deepseek.config.toml'), 'model = "y"\n');
    await fs.writeFile(path.join(home, 'qwen.config.toml'), 'model = "z"\n');
    await fs.writeFile(path.join(home, 'models-qwen.json'), '{}');

    assert.deepEqual(
      await probeCodexProfiles(home),
      ['deepseek', 'qwen'],
      'config.toml 自身不是 profile；非 .config.toml 的文件不计入',
    );
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('profile 名单：目录不存在时返回空集而不是抛', async () => {
  assert.deepEqual(await probeCodexProfiles('/nonexistent/codex/home'), []);
});

/*
 * ── header 解析（审查意见 GLM-07）──
 *
 * 事件流有「图谱变了就重录样本」的守卫，header 原先一个测试都没有——
 * 而它的五个标签拼写恰是本步真机第一遍栽过的坑。防护不对称。
 * 样本同样是真录的（`header-stderr.txt`，含 codex 打在 stderr 上的完整段落）。
 */

test('录制样本：header 的五个标签都能抽出来', async () => {
  const lines = (await load('header-stderr.txt')).split('\n');
  const h = parseHeaderLines(lines);

  assert.equal(h.get('model'), 'deepseek-flash');
  assert.equal(h.get('provider'), 'deepseek');
  assert.equal(h.get('sandbox'), 'read-only', '只读沙箱是 exec 的默认值，本步实测确认');
  assert.equal(h.get('reasoning effort'), 'medium');
  assert.equal(h.get('approval'), 'never');

  for (const label of HEADER_LABELS) {
    assert.ok(
      h.has(label),
      `标签「${label}」没抽到——codex 可能改了拼写。改了就要重录样本并同步 HEADER_LABELS，` +
        '否则五个派生字段会集体变 null 而没有任何测试变红',
    );
  }
});

test('header 解析：只认认识的标签，不把正文行当成配置', () => {
  /*
   * header 段之后紧跟着 `user` 与提示词正文。正文里完全可能出现
   * 「xxx: yyy」形态的句子，不能被当成配置回读。
   */
  const h = parseHeaderLines([
    'model: deepseek-flash',
    'session id: 01a0a07b-76bf-7642-946a-1069172d8a5d', // 真实存在但我们不认
    'note: this is prose, not config',
    '--------',
    'user',
  ]);
  assert.deepEqual([...h.keys()], ['model']);
});

test('header 解析：值里含冒号时只切第一个', () => {
  const h = parseHeaderLines(['model: provider/name:tag']);
  assert.equal(h.get('model'), 'provider/name:tag');
});

/*
 * 录制样本里的哨兵是 `SENTINEL-OPEN-7f3a2b91`，与生产常量 `SENTINEL_OPEN`
 * （`SENTINEL_OPEN_7f3a2b`）**不是同一个字符串**：录制时我用的是手工搭的夹具，
 * 不是 `createFixture()`。
 *
 * 记在这里而不是改掉，是因为它划出了样本的能力边界——这两份样本能验证
 * 「解析器能从最终回复里认出给定哨兵」，**不能**验证「生产探针用的那个哨兵
 * 会被模型原样回显」。后者要等下次按 README 的命令行重录时用真夹具补上。
 * 判据本身把哨兵当参数传入，所以与具体取值无关。
 */
const RECORDED_SENTINEL = 'SENTINEL-OPEN-7f3a2b91';

/*
 * ── 读文件能力的三态判定（审查意见 GLM-01）──
 *
 * 这是**唯一驱动 doctor blocker 的 codex 判据**。原写法 `?? false` 把
 * 「没测成」塌缩成确定否定，于是一次网络抖动就会在盘上落下「能力缺陷」这个事实。
 *
 * 判据原先埋在探针里、要真跑 codex 才走得到——**等于没有断言守着**，
 * 而那正是本轮 GLM-08 打过的形态（改动宣称了防护，却没有断言证明防护存在）。
 */

test('三态①：跑完且哨兵命中 → true', async () => {
  const t = parseCodexEvents(await load('read-sentinel.jsonl'));
  assert.equal(judgeHeadlessRead(t, false, RECORDED_SENTINEL), true);
});

test('三态②：跑完但哨兵没出现 → false（这才是真的能力否定）', async () => {
  const t = parseCodexEvents(await load('readonly-denied.jsonl'));
  assert.equal(
    judgeHeadlessRead(t, false, RECORDED_SENTINEL), false,
    '模型有最终回复、只是没读到哨兵——这是测出来的否定，与没测成不同',
  );
});

test('三态③：超时 → null，不得记成能力缺陷', async () => {
  const t = parseCodexEvents(await load('read-sentinel.jsonl'));
  assert.equal(
    judgeHeadlessRead(t, true, RECORDED_SENTINEL), null,
    '超时被杀时哪怕输出里恰好有哨兵，也不能当成「测过了」——输出是截断的',
  );
});

test('三态④：没有最终回复 → null', () => {
  const t = parseCodexEvents('{"type":"thread.started","thread_id":"x"}');
  assert.equal(
    judgeHeadlessRead(t, false, RECORDED_SENTINEL), null,
    'provider 报错退出、模型拒绝任务都会走到这里：没结论，不是没能力',
  );
});

test('completed 的判据取「有没有最终回复」而不是退出码', () => {
  const withText = parseCodexEvents(
    '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}',
  );
  const without = parseCodexEvents('{"type":"turn.completed","usage":{}}');
  assert.equal(traceCompleted(withText, false), true);
  assert.equal(traceCompleted(without, false), false, 'codex 拒绝任务时也可能退 0');
  assert.equal(traceCompleted(withText, true), false, '超时一定不算跑完');
});
