/**
 * Antigravity（`agy`）能力探针（设计 §3.5）。
 *
 * M0 实测确立的调用配方，后续适配层必须复用：
 *   1. `--agent trivium-critic`：只读工具白名单，**不含 `run_command`**。
 *      这是绕开 issue #548 软拒绝的关键——模型一旦选择 `run_command`，
 *      headless 下拿不到审批就会被静默拒绝，产出「exit 0 但零读取」的空审查。
 *   2. 提示词中的路径**一律绝对化**。agy 的文件工具只接受绝对路径，
 *      且模型在没有 `run_command` 时无法 `pwd`，不给绝对路径它会跑出项目乱翻。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { run, tryRun } from '../util/exec.js';
import { workTreeHash, statusPorcelain, diffTrees } from '../util/git.js';
import { exists } from '../util/fsx.js';
import { readPaths } from '../adapters/agy-events.js';
// 命令行只在适配层构造（设计 §5.1）：探针复用同一个 invokeAgy，
// 保证「探到的能力」与「实际调用方式」不会分叉。
import { invokeAgy, type AgyInvokeOutcome } from '../adapters/agy.js';
import { createFixture, SENTINEL_OPEN, SENTINEL_PEER, type Fixture } from './fixture.js';
import type { AgyProbe } from '../types.js';
import { emptyPathDeny } from '../config.js';

/** 探针用的模型：挑最便宜的，探的是能力不是质量 */
const PROBE_MODEL = 'gemini-3.8-flash-low';
const PROBE_TIMEOUT_MS = 180_000;

/** 只读审查 Agent 定义的路径（安装器与探针共用同一条规则） */
export function agyAgentPath(agentName: string): string {
  return path.join(os.homedir(), '.gemini/config/agents', agentName, 'agent.md');
}

/** `agy` 绝对路径 + 版本 */
export async function probeAgyBin(configured: string | null): Promise<{ bin: string | null; version: string | null }> {
  const candidates = [
    configured,
    path.join(os.homedir(), '.local/bin/agy'),
    '/usr/local/bin/agy',
    '/opt/homebrew/bin/agy',
  ].filter((c): c is string => Boolean(c));

  let bin: string | null = null;
  for (const c of candidates) {
    if (await exists(c)) {
      bin = c;
      break;
    }
  }
  if (!bin) {
    const which = await tryRun('/usr/bin/which', ['agy']);
    if (which.ok) bin = which.stdout.trim();
  }
  if (!bin) return { bin: null, version: null };

  const v = await run(bin, ['--version'], { timeoutMs: 60_000 });
  return { bin, version: v.code === 0 ? v.stdout.trim() : null };
}

/** `agy models` → slug 列表。输出为 `<slug>\t<显示名>` 每行一条 */
export async function probeAgyModels(bin: string): Promise<string[]> {
  const r = await run(bin, ['models'], { timeoutMs: 90_000 });
  if (r.code !== 0) return [];
  return r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('\t'))
    .map((l) => l.split('\t')[0]!.trim())
    .filter(Boolean);
}

export interface HeadlessReadResult {
  ok: boolean;
  /** 达成 ok 所用的手段，供适配层复现 */
  strategy: 'default' | 'pty' | null;
  ptyRequired: boolean;
  /** 软拒绝信号，非空说明有工具被静默拒了 */
  deniedActions: string[];
  detail: string;
}

/**
 * `agy.headless_read_ok`：能否真的读到文件（issue #548 的本机判定）。
 *
 * 判定要同时满足两条，缺一不可：
 *   ① 轨迹中有成功（DONE）的读取事件；
 *   ② 回答里出现夹具的哨兵串。
 * 只看 ① 会被「读了别的文件」蒙混，只看 ② 会被模型凭空编造蒙混。
 */
export async function probeHeadlessRead(
  bin: string,
  fx: Fixture,
  agent: string | null,
): Promise<HeadlessReadResult> {
  const prompt =
    `项目根目录是 ${fx.root} 。请用 view_file 读取绝对路径 ${fx.openFile} ，` +
    `并原样回显它的第一行内容。只做这一件事，读完立即给出答案。`;

  const attempt = async (pty: boolean): Promise<{ out: AgyInvokeOutcome; paths: string[]; sentinel: boolean; ok: boolean }> => {
    const out = await invokeAgy({
      bin, cwd: fx.root, prompt, agent, pty,
      model: PROBE_MODEL, timeoutMs: PROBE_TIMEOUT_MS,
    });
    const paths = readPaths(out.parsed);
    const sentinel = out.parsed.response.includes(SENTINEL_OPEN);
    return { out, paths, sentinel, ok: paths.length > 0 && sentinel };
  };

  const first = await attempt(false);
  const denied = first.out.parsed.deniedActions.map((d) => d.action);
  // 管道下 stdout 为空但进程正常退出 → 需要伪终端包装
  const ptyRequired = first.out.stdout.trim().length === 0 && !first.out.timedOut;

  if (first.ok) {
    return {
      ok: true,
      strategy: 'default',
      ptyRequired: false,
      deniedActions: denied,
      detail: `读到 ${first.paths.length} 个文件，哨兵命中`,
    };
  }

  if (ptyRequired) {
    const second = await attempt(true);
    if (second.ok) {
      return {
        ok: true,
        strategy: 'pty',
        ptyRequired: true,
        deniedActions: second.out.parsed.deniedActions.map((d) => d.action),
        detail: '管道下 stdout 为空，伪终端包装后成功',
      };
    }
  }

  return {
    ok: false,
    strategy: null,
    ptyRequired,
    deniedActions: denied,
    detail:
      denied.length > 0
        ? `工具被软拒绝：${denied.join(', ')}（issue #548）。stderr: ${first.out.stderr.slice(0, 200)}`
        : `未读到文件或哨兵未命中。status=${first.out.parsed.status}, ` +
          `读取数=${first.paths.length}, 哨兵=${first.sentinel}`,
  };
}

/** `agy.json_schema_ok`：`--json-schema` 能否强制出可解析的结构化输出 */
export async function probeJsonSchema(bin: string, fx: Fixture, agent: string | null): Promise<boolean> {
  const schemaPath = path.join(fx.root, '.probe-schema.json');
  await fs.writeFile(
    schemaPath,
    JSON.stringify({
      type: 'object',
      required: ['first_line', 'read_ok'],
      properties: { first_line: { type: 'string' }, read_ok: { type: 'boolean' } },
      additionalProperties: false,
    }),
    'utf8',
  );
  try {
    const out = await invokeAgy({
      bin,
      cwd: fx.root,
      agent,
      jsonSchemaPath: schemaPath,
      model: PROBE_MODEL,
      timeoutMs: PROBE_TIMEOUT_MS,
      prompt:
        `请用 view_file 读取绝对路径 ${fx.openFile} ，把它的第一行放进 first_line 字段，` +
        `read_ok 置为 true。严格按给定 schema 输出。`,
    });
    const body = out.parsed.response.trim();
    if (!body) return false;
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return typeof parsed['first_line'] === 'string' && typeof parsed['read_ok'] === 'boolean';
  } catch {
    return false;
  } finally {
    await fs.rm(schemaPath, { force: true });
  }
}

/**
 * `agy.path_deny`：能否以**路径级**规则拒绝读取指定文件。
 *
 * M0 结论：Antigravity 的授权语法是 `action(target)`，合法 action 为
 * `command` / `unsandboxed` / `mcp` / `url` / `read`，其中 `read` 是 **GitHub 仓库读取授权**
 * （校验消息为 `invalid grant: org and repo are required`），不是文件系统路径。
 * 文件访问只有粗粒度的 `fileAccessPolicy` 枚举与工作区边界，都无法只挡单个文件
 * 而放行同目录下的被审对象。
 *
 * 本函数仍然**真跑一次否定对照**：确认不加任何限制时 agy 确实能读到对方产出。
 * 这样 `supported: false` 才是「实测过的结论」而不是「没试过」。
 */
export async function probePathDeny(
  bin: string,
  fx: Fixture,
  agent: string | null,
): Promise<{ supported: boolean; ruleSyntax: string | null; method: string; attempts: string[] }> {
  const attempts = [
    'permissions.deny 的 grant 语法 action(target)：合法 action 为 command/unsandboxed/mcp/url/read；' +
      'read 属 GitHub 仓库授权（校验消息 "invalid grant: org and repo are required"），无文件系统路径档位',
    'settings.fileAccessPolicy：枚举 AGENT_SETTING_POLICY_{ALLOW,ASK,DENY,UNSPECIFIED}，' +
      '作用于整个作用域，会连被审对象一起挡掉，粒度不可用',
    'allowNonWorkspaceAccess / isWorkspaceOnly：工作区边界控制，而 deny_paths 就在项目根内，边界挡不住',
    'allow_agent_access_gitignore_files：依赖 .gitignore，但对方产出必须进 Git，不可用',
    '未尝试：plugin 的 hooks.json（PreToolUse 可返回 deny 决定）——需向用户 plugin 集安装 TriviumCode plugin，留作 M3 候选',
  ];

  // 否定对照：不加任何限制，agy 应当能读到 peer 文件
  const out = await invokeAgy({
    bin,
    cwd: fx.root,
    agent,
    model: PROBE_MODEL,
    timeoutMs: PROBE_TIMEOUT_MS,
    prompt: `请用 view_file 读取绝对路径 ${fx.peerFile} ，并原样回显它的第一行内容。只做这一件事。`,
  });
  const leaked = out.parsed.response.includes(SENTINEL_PEER) || readPaths(out.parsed).includes(fx.peerFile);

  return {
    supported: false,
    ruleSyntax: null,
    method: leaked
      ? '否定对照成立：无路径级 deny 机制时，agy 确实读到了对方产出（哨兵命中）'
      : `否定对照未命中（status=${out.parsed.status}），可能是模型未执行读取而非被拒；` +
        '结论仍为不支持——因为本机不存在任何可用的路径级 deny 配置项',
    attempts,
  };
}

/**
 * `agy.scratch_paths`：Agent 在项目根自建的临时文件白名单。
 *
 * 必须在**跑过若干次真实任务之后**调用，否则测不出东西。
 * M0 实测本机结果为 `[]`——agy 的会话缓存全在 `~/.gemini/antigravity-cli/` 下（项目外）。
 */
export async function probeScratchPaths(fx: Fixture): Promise<string[]> {
  const now = await workTreeHash(fx.root);
  if (now === fx.baselineTree) return [];
  const changed = await diffTrees(fx.root, fx.baselineTree, now);
  const untracked = (await statusPorcelain(fx.root))
    .filter((e) => e.status.trim() === '??')
    .map((e) => e.path);
  // 探针夹具自己创建的文件不算 Agent 的 scratch
  const ours = new Set(['.probe-schema.json']);
  return [...new Set([...changed, ...untracked])].filter((p) => !ours.has(p)).sort();
}

/** 编排 agy 侧的全部探针 */
export async function probeAgy(
  configuredBin: string | null,
  agentName: string,
  opts: { skipModelCalls?: boolean; existing?: AgyProbe } = {},
): Promise<{ probe: AgyProbe; notes: string[] }> {
  const notes: string[] = [];
  /*
   * 以**既有结论**为起点，而不是从 null 开始。
   *
   * 否则 `doctor --no-model-calls`（文档里作为「省配额」选项推荐的）会把上一次
   * 真实探到的 headless_read_ok / json_schema_ok / path_deny / scratch_paths
   * 统统覆盖成 null，preflight 随即判该侧不可用——用户会以为是环境坏了。
   * 真跑时踩过这一次。跳过的探针必须保留原值。
   */
  const probe: AgyProbe = opts.existing
    ? structuredClone(opts.existing)
    : {
        entrypoint: null,
        version: null,
        version_probe: null,
        probed_at: null,
        models: [],
        headless_read_ok: null,
        json_schema_ok: null,
        pty_required: null,
        path_deny: emptyPathDeny(),
        scratch_paths: [],
        isolation: 'shared',
        read_strategy: null,
        agent: null,
      };

  const { bin, version } = await probeAgyBin(configuredBin);
  probe.entrypoint = bin;
  probe.version = version;
  // 这一段刚探过，时间戳按键记（TTL 按键判定，见 CommonProbe.probed_at）
  probe.probed_at = new Date().toISOString();
  /*
   * 把「怎么再取一次版本」也落盘（P7）。preflight 的版本漂移比对据此复现调用，
   * 不再按家写死分支——这是 checkCliVersions 能泛化的前提。
   * agy 直接执行、取 stdout 全文，所以 runner 为 null、extract 为 null。
   */
  probe.version_probe = { runner: null, args: ['--version'], extract: null };
  if (!bin) {
    notes.push('未找到 agy 可执行文件，Antigravity 侧不可用');
    return { probe, notes };
  }
  probe.models = await probeAgyModels(bin);
  if (probe.models.length === 0) notes.push('agy models 输出为空或不可解析');

  if (opts.skipModelCalls) {
    notes.push(
      '已跳过需要真实模型调用的探针（--no-model-calls）——' +
        'headless_read_ok / json_schema_ok / path_deny / scratch_paths 保留上一次的结论',
    );
    return { probe, notes };
  }

  // 自定义 Agent 必须已安装，否则只读白名单不生效
  const agentPath = agyAgentPath(agentName);
  const agent = (await exists(agentPath)) ? agentName : null;
  // 记下本次验证用的是哪个 Agent：适配层只认这个值，不认配置意图（P7）
  probe.agent = agent;
  if (!agent) {
    notes.push(
      `未找到只读审查 Agent 定义 ${agentPath}；将以默认 Agent 探测，` +
        `headless_read_ok 很可能因 run_command 被软拒绝而失败。请先运行安装器。`,
    );
  }

  const fx = await createFixture();
  try {
    const read = await probeHeadlessRead(bin, fx, agent);
    probe.headless_read_ok = read.ok;
    probe.pty_required = read.ptyRequired;
    probe.read_strategy = read.strategy;
    notes.push(`headless_read_ok=${read.ok}：${read.detail}`);

    if (read.ok) {
      probe.json_schema_ok = await probeJsonSchema(bin, fx, agent);
      notes.push(`json_schema_ok=${probe.json_schema_ok}`);

      const deny = await probePathDeny(bin, fx, agent);
      probe.path_deny = {
        supported: deny.supported,
        rule_syntax: deny.ruleSyntax,
        method: deny.method,
        attempts: deny.attempts,
        /*
         * 本族没有「主判据之外另测一个读工具」这回事——M0 实测 `supported` 为 false，
         * 覆盖面无从谈起。`null` 是如实的「没另测过」，不是「覆盖不完整」。
         */
        coverage_complete: null,
        // 逐文件形态未验（本族 supported 为 false，这个问题不成立）
        file_shape_verified: null,
      };
      notes.push(`path_deny.supported=${deny.supported}：${deny.method}`);
    } else {
      notes.push('headless 读取不通，跳过 json_schema 与 path_deny 探针');
    }

    probe.scratch_paths = await probeScratchPaths(fx);
    notes.push(
      probe.scratch_paths.length === 0
        ? 'scratch_paths=[]：agy 在项目根零污染，只读指纹比对不需要白名单'
        : `scratch_paths=${JSON.stringify(probe.scratch_paths)}`,
    );
  } finally {
    // 删不掉不抛、提示进 notes（EV-199）：抛出会顶替上面的结论、把 doctor 崩成内部错误
    const fixtureResidue = await fx.cleanup();
    if (fixtureResidue) notes.push(fixtureResidue);
  }

  return { probe, notes };
}
