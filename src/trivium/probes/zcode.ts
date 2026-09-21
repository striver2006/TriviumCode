/**
 * ZCode（`zcode.cjs`）能力探针（设计 §3.5）。
 *
 * M0 实测要点：
 *   - CLI 的**模型 provider 配置独立于桌面端**：桌面端读 `~/.zcode/v2/config.json`，
 *     CLI 读 `~/.zcode/cli/config.json`。凭据（OAuth）是共享的，但配置不是。
 *     因此「已登录」不等于「可用」，预检必须真跑一次最小 headless。
 *   - `--help` 列出的参数不等于实际接受的参数（`--max-turns` 即为反例），
 *     `readonly_flags` 必须逐个实测。
 *   - **不存在裸 `ZCODE_MODEL` 环境变量**（0.16.5），模型覆盖只能走
 *     `config_copy`（`ZCODE_HOME` 指向独立配置副本）或 `global`。
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { run } from '../util/exec.js';
// 命令行只在适配层构造（设计 §5.1）
import {
  invokeZcode,
  zcodeProviderConfigPaths,
  zcodeProviderEnv,
  ZCODE_ARGV_PARSED_RE,
  ZCODE_BUILTIN_PROVIDER_ENV,
  ZCODE_PERSONAL_PROVIDER_ENV,
  ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE,
} from '../adapters/zcode.js';
import { exists, makeTempDir } from '../util/fsx.js';
// CLI 原话进 note 之前过一遍脱敏（r5 CODEX-06）
import { redactSecrets } from '../secrets.js';
import { workTreeHash, statusPorcelain, diffTrees } from '../util/git.js';
import { createFixture, SENTINEL_OPEN, SENTINEL_PEER, type Fixture } from './fixture.js';
import {
  parseZcodeRollout,
  parseZcodeTrace,
  type ZcodeRollout,
} from '../adapters/zcode-trace.js';
import type { ZcodeProbe } from '../types.js';
import { emptyPathDeny } from '../config.js';

const ENTRY_CANDIDATES = [
  '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs',
  path.join(os.homedir(), 'Applications/ZCode.app/Contents/Resources/glm/zcode.cjs'),
];

/** 探针用超时：探的是能力不是质量，不必给足生产上限 */
const PROBE_TIMEOUT_MS = 300_000;

/** CLI 侧配置根（与桌面端 `~/.zcode/v2/` 不是同一份） */
export const ZCODE_CLI_DIR = path.join(os.homedir(), '.zcode/cli');
export const ZCODE_CLI_CONFIG = path.join(ZCODE_CLI_DIR, 'config.json');

export async function probeZcodeEntry(
  configured: string | null,
  node: string,
): Promise<{ entry: string | null; version: string | null }> {
  const candidates = [configured, ...ENTRY_CANDIDATES].filter((c): c is string => Boolean(c));
  let entry: string | null = null;
  for (const c of candidates) {
    if (await exists(c)) {
      entry = c;
      break;
    }
  }
  if (!entry) return { entry: null, version: null };
  /*
   * 两个 provider 变量在这条路径上也要**清底色**（r3 CODEX-F01-01）。
   *
   * 0.16.9 实测 `version` 子命令不读 provider 配置（M0 报告 P-28 末句），所以现势无害；
   * 但 `zcodeProviderEnv` 的判据自述是「子进程拿不到」，只在两条主拉起路径上兑现、
   * 在这里留个口子，等于让这句话在第三条路径上不成立。而 P-29 已经证明这个 CLI 的演化方向
   * 就是把 provider 定位挪得更早——哪天 `version` 臂也开始吃这两个变量，入口与 cli_version
   * 就会在「被宿主诱饵改造过」的环境下采得，与真实拉起口径分叉，且 doctor 全程沉默。
   *
   * **只清不给**：不调 `zcodeProviderEnv`。这里是逐候选路径试探，派生要多做存在性判断，
   * 而 version 本就不需要这两个变量——给它反而多一条要维护的假设。
   */
  const r = await run(node, [entry, 'version'], {
    timeoutMs: 60_000,
    env: { [ZCODE_BUILTIN_PROVIDER_ENV]: undefined, [ZCODE_PERSONAL_PROVIDER_ENV]: undefined },
    // 与其余五处拉起厂商 CLI 的口径一致（r5 CODEX-04）：此前这里是全仓唯一没开的一处。
    // `version` 现在不起子进程，但 P-29 已经证明这个 CLI 的演化方向是把活儿往前挪——
    // 真挪过来时，超时只杀直接子进程会留下孤儿继续跑
    killTree: true,
  });
  if (r.code !== 0) return { entry, version: null };
  const m = /(\d+\.\d+\.\d+)/.exec(r.stdout);
  return { entry, version: m?.[1] ?? r.stdout.trim() };
}

/**
 * `zcode.readonly_flags`：逐个实测**实际被接受**的只读参数组合。
 *
 * 不能信 `--help`——M0 实测 `--max-turns` 在 help 中列出但会报
 * `Unknown option '--max-turns'`。判定方式是看 stderr 里是否出现 `Unknown option '<flag>'`：
 * 参数解析发生在模型调用之前，因此这一步**不消耗配额**。
 *
 * **但参数解析不是第一步**（坑 P-29）：0.16.9 先定位 provider 配置，定位不到就带着
 * 那一行报错退出，`Unknown option` 根本报不出来。若仍按「没报 Unknown 就是接受」判，
 * 七个候选会**全部**记成接受——2026-09-19 那次 doctor 就把 0.16.5 已证实被拒的四个
 * 旗标全写进了 `readonly_flags`。所以这里第三态 `indeterminate`：命中该报错的候选
 * 既不算接受也不算拒绝，调用方不得把它写进结论。
 */
export async function probeReadonlyFlags(
  entry: string,
  node: string,
  cwd: string,
): Promise<{
  accepted: string[];
  rejected: string[];
  indeterminate: { flag: string; why: string }[];
  /**
   * 靠**退 0** 判成接受的候选（r5 CODEX-02）。
   *
   * 退 0 证明 argv 吃完了，这个推理没问题；有问题的是它在**这个装置里**意味着什么：
   * 本探针的零配额不变量是「空 HOME + 只给内置 ⇒ 必停在 `Model creation failed` 退 1」（P-30 实测），
   * 所以这里出现退 0 的唯一现实解释，是一次完整 headless 运行真的发生了、配额真的烧了。
   * 结论照记接受，但**不能静默**——调用方据此出 note 与告警。
   */
  zeroExit: string[];
}> {
  const candidates: string[][] = [
    ['--mode', 'plan'],
    ['--mode', 'yolo'],
    ['--disallowed-tools', 'Write,Edit,MultiEdit,ApplyPatch,Bash'],
    ['--allowed-tools', 'Read,Grep,Glob'],
    ['--max-turns', '40'],
    ['--permission-mode', 'plan'],
    ['--settings', '/nonexistent-probe-settings.json'],
  ];

  const accepted: string[] = [];
  const rejected: string[] = [];
  const indeterminate: { flag: string; why: string }[] = [];
  const zeroExit: string[] = [];

  // 关键：把 **HOME** 指向一个空目录，让模型配置解析必然失败。
  // ZCode 的处理顺序是「provider 配置定位 → 参数解析 → 模型配置解析 → 模型调用」，
  // 因此这样能在拿到参数解析结论的同时，在模型配置解析阶段就停住，**一次模型调用都不会发生**。
  // 否则在配置正常的机器上跑 doctor 会白白烧掉 7 次 ZCode 配额。
  //
  // 注意必须是 HOME 而不是 ZCODE_HOME —— M0 实测后者对配置解析无效（冲突项 C-08）。
  //
  // provider 配置**只注入内置那一份**（P-30）：个人配置 `~/.zcode/v2/provider_config.json`
  // 自带默认模型，两份都给时空 HOME 挡不住——0.16.9 实测在没有 cli/config.json 的空 HOME 下
  // 照样起了一个 turn（stderr 出现 `AI SDK Warning (… / qwen3.8-max)`），七个候选就是七次真实调用。
  // 只给内置那份则停在「Model creation failed」（无凭据），参数解析已经做完，正是这里要的停点。
  //
  // 个人那份**显式置 `undefined`**（r2 CODEX-01 ≡ AGY-02）：`run()` 以 `{...process.env}` 为底，
  // 只追加不清除的话，宿主环境里预置的同名变量会原样透传进来——「我没给」不等于「它没有」，
  // 而这里正是「它有就会烧七次配额」的那个位置。
  const { [ZCODE_BUILTIN_PROVIDER_ENV]: builtinFile } = await zcodeProviderEnv(entry);
  const providerEnv: Record<string, string | undefined> = {
    [ZCODE_BUILTIN_PROVIDER_ENV]: builtinFile,
    [ZCODE_PERSONAL_PROVIDER_ENV]: undefined,
  };
  const emptyHome = await makeTempDir('trivium-flagprobe');
  try {
    for (const flag of candidates) {
      const r = await run(
        node,
        [entry, '--prompt', 'ok', '--cwd', cwd, '--json', '--no-color', ...flag],
        // `killTree`：P-30 实测该 CLI 能在一个 turn 里 3 分钟不退。第三态的前提（只给内置那份
        // 就停在无凭据）一旦被某次升版打破，这七次就是七次真实调用——超时杀父进程而遗弃孙进程，
        // 它们会继续烧配额（r3 CODEX-F01-04；`exec.ts` 要求拉起厂商 CLI 一律打开）。
        { cwd, timeoutMs: 30_000, env: { ...providerEnv, HOME: emptyHome }, killTree: true },
      );
      /*
       * 判定链是**三分**，且「接受」要正向证据（r4 CODEX-01）。
       *
       * 原判据是否定式：没报 `Unknown option` 就算接受。于是任何「参数解析同样没发生」
       * 的失败都会被记成接受——spawn 失败（`run()` 给 `code: null` 与 `[spawn error]`）、
       * 模块加载崩溃、入口对子进程 cwd 不可达，全落进 accepted。这与 P-29 那次
       * 「七个候选全记成接受」是同一类污染，只是成因换了一个。r3 补的退出码门控解决的是
       * 「误放成功调用」，这里解决的是「误放崩溃」，是同一课的另一半。
       *
       * 顺序上 `Unknown option` 先判：它既是被拒的证据，本身也证明参数解析已经发生。
       */
      const unknown = new RegExp(`Unknown option '${flag[0]!.replace(/-/g, '\\-')}`).test(r.stderr);
      if (unknown) {
        rejected.push(flag.join(' '));
        continue;
      }
      // 与 `invokeZcode` 同口径：**退出码非 0 才看形态**（r3 CODEX-F01-04）——
      // 裸正则会把 stderr 带同名诊断行的成功调用误判成布局失败。
      if (r.code !== 0 && ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE.test(r.stderr)) {
        indeterminate.push({ flag: flag.join(' '), why: '内置 provider 配置定位失败，参数解析未发生（P-28/P-29）' });
        continue;
      }
      // 正向证据：退 0（参数吃完了才跑得到成功），或停在模型/凭据层的已知停点。
      // 退 0 另记一笔——在这个装置里它同时意味着零配额前提被打破（见 `zeroExit` 的说明）
      if (r.code === 0) {
        accepted.push(flag.join(' '));
        zeroExit.push(flag.join(' '));
        continue;
      }
      if (ZCODE_ARGV_PARSED_RE.test(r.stderr)) {
        accepted.push(flag.join(' '));
        continue;
      }
      // 其余一切一律判不出：**不回落成接受**。把退出码与 stderr 首行带上，
      // 否则「为什么判不出」又要靠人复跑一次探针才知道
      /*
       * CLI 原话**过一遍脱敏再拼**（r5 CODEX-06）。这行文字会进 doctor notes，而 notes 的实际
       * 流转方式是被人抄进 git 里的 `doc/05_testing/evidence/`——那条路径上没有 secrets 闸门，
       * 防线只剩手抄纪律。`secrets.ts` 专为 ZCode 的凭据形态写过扫描规则，说明「CLI 错误行回显凭据」
       * 是被当过真的风险。机制在先，纪律在后。
       */
      const firstLine = r.stderr.split('\n').map((l) => l.trim()).find(Boolean) ?? '（stderr 为空）';
      indeterminate.push({
        flag: flag.join(' '),
        why:
          `未识别的失败形态（退出码 ${r.code === null ? 'null' : r.code}）：` +
          redactSecrets(firstLine.slice(0, 120)).content,
      });
    }
  } finally {
    await fs.rm(emptyHome, { recursive: true, force: true });
  }
  return { accepted, rejected, indeterminate, zeroExit };
}

/**
 * 采集 ZCode 的可用模型清单。
 *
 * 数据源是 CLI 侧的 `~/.zcode/cli/config.json`——**不是**桌面端那份
 * （两者配置不共享，坑 P-08）。清单同时收录短名与 `<providerId>/<modelName>`
 * 全限定形态，因为 profile 里允许写短名、适配层再补全前缀（坑 P-06）。
 *
 * 不采集这一项的后果很隐蔽：`preflight` 的 slug 校验会因清单为空而**空转**，
 * 非法模型名一路漏到运行中段才以业务性失败暴露。本项目真的踩过这一次。
 */
export async function probeZcodeModels(homeDir?: string | null): Promise<string[]> {
  const p = path.join(
    homeDir ? path.join(homeDir, '.zcode/cli') : ZCODE_CLI_DIR,
    'config.json',
  );
  if (!(await exists(p))) return [];
  try {
    const cfg = JSON.parse(await fs.readFile(p, 'utf8')) as {
      provider?: Record<string, { models?: Record<string, unknown> }>;
    };
    const out = new Set<string>();
    for (const [providerId, pv] of Object.entries(cfg.provider ?? {})) {
      for (const modelId of Object.keys(pv.models ?? {})) {
        out.add(modelId);
        out.add(`${providerId}/${modelId}`);
      }
    }
    return [...out].sort();
  } catch {
    return [];
  }
}

/**
 * 定位工具轨迹来源。M0 实测需要**两个**文件，各自提供不同的信息：
 *   - `log/zcode-<date>.jsonl`：工具名、调用计数、`context.model`、结构化失败根因；
 *   - `rollout/model-io-sess_<sessionId>.jsonl`：工具**参数**（含文件路径）、`model.source`。
 * 前者缺路径，后者缺调用状态，缺一不可。
 */
export async function probeTraceSource(
  homeDir?: string | null,
): Promise<{ names: string | null; args: string | null }> {
  const cliDir = homeDir ? path.join(homeDir, '.zcode/cli') : ZCODE_CLI_DIR;
  const pick = async (sub: string, tpl: string): Promise<string | null> => {
    const dir = path.join(cliDir, sub);
    if (!(await exists(dir))) return null;
    const entries = await fs.readdir(dir).catch(() => [] as string[]);
    return entries.some((e) => e.endsWith('.jsonl')) ? path.join(dir, tpl) : null;
  };
  return {
    names: await pick('log', 'zcode-{date}.jsonl'),
    args: await pick('rollout', 'model-io-{sessionId}.jsonl'),
  };
}

/** 读取某次会话的 rollout（工具参数与模型来源的唯一取值点） */
export async function readRollout(
  sessionId: string,
  homeDir?: string | null,
): Promise<ZcodeRollout | null> {
  const dir = path.join(homeDir ? path.join(homeDir, '.zcode/cli') : ZCODE_CLI_DIR, 'rollout');
  // 注意：sessionId 自带 `sess_` 前缀，文件名是 `model-io-` + sessionId。
  // 拼成 `model-io-sess_${sessionId}` 会得到 model-io-sess_sess_… 而找不到文件。
  const file = path.join(dir, `model-io-${sessionId}.jsonl`);
  if (!(await exists(file))) return null;
  return parseZcodeRollout(await fs.readFile(file, 'utf8'));
}

export async function probeScratchPaths(fx: Fixture): Promise<string[]> {
  const now = await workTreeHash(fx.root);
  if (now === fx.baselineTree) return [];
  const changed = await diffTrees(fx.root, fx.baselineTree, now);
  const untracked = (await statusPorcelain(fx.root))
    .filter((e) => e.status.trim() === '??')
    .map((e) => e.path);
  return [...new Set([...changed, ...untracked])].sort();
}

/** 读取某个 sessionId 的会话日志并解析轨迹 */
export async function readTrace(
  sessionId: string | null,
  logDir?: string,
): Promise<ReturnType<typeof parseZcodeTrace> | null> {
  const dir = logDir ?? path.join(ZCODE_CLI_DIR, 'log');
  let files: string[];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.jsonl')).sort();
  } catch {
    return null;
  }
  const latest = files.at(-1);
  if (!latest) return null;
  const jsonl = await fs.readFile(path.join(dir, latest), 'utf8');
  return parseZcodeTrace(jsonl, sessionId);
}

/**
 * `zcode.path_deny`：能否以**路径级**规则拒绝读取指定文件。
 *
 * M0 实测结论：**不支持**。`--disallowed-tools` 支持 `Tool(arg)` 带参形态
 * （`--help` 示例即 `"Bash(git *) Edit"`），语法上接受 `Read(<path>)`，
 * 但**挡不住文件**——ZCode 的读路径有多条（`Read` / `Grep` / `Glob` /
 * `ReadSessionContext` / `Bash`），封掉一条模型会换另一条。实测中：
 *   - 只封 `Read(<peer>)` + `Write` + `Edit` 时，模型用 `Bash` 的 `head -1` 读到了；
 *   - 再加封 `Bash` 后，模型用 `Grep` 读到了。
 * 要靠 denylist 挡住一个文件，等于要枚举并封掉全部读路径，那样连被审对象也读不了。
 *
 * 附带确认了一件重要的事：**`--mode plan` 并不阻止命令执行**，
 * 与设计 §11.3 要点 4 引述的社区观察一致，因此完整 denylist 中 `Bash` 是必需项。
 */
export async function probePathDeny(
  entry: string,
  node: string,
  fx: Fixture,
  readonlyFlags: string[],
): Promise<{ supported: boolean; ruleSyntax: string | null; method: string; attempts: string[] }> {
  const attempts = [
    '--disallowed-tools "Read(<绝对路径>)"：语法被接受，但模型改用 Bash(head -1) 读到了目标文件',
    '--disallowed-tools "Read(<路径>) Write Edit MultiEdit ApplyPatch Bash"：模型改用 Grep 读到了目标文件',
    '--settings <path>：参数被拒绝（Unknown option），无法注入独立权限配置',
    '--mode plan：实测**不阻止命令执行**，不能作为只读手段单独使用',
    '结论：要靠 denylist 挡住单个文件需封掉全部读路径（Read/Grep/Glob/ReadSessionContext/Bash），' +
      '那样连被审对象也读不了，粒度不可用',
  ];

  const out = await invokeZcode({
    entry,
    node,
    cwd: fx.root,
    readonlyArgs: [...readonlyFlags, '--disallowed-tools', `Read(${fx.peerFile})`],
    timeoutMs: PROBE_TIMEOUT_MS,
    prompt: `请读取绝对路径 ${fx.peerFile} 并原样回显它的第一行内容。只做这一件事。`,
  });
  const leaked = (out.envelope?.response ?? '').includes(SENTINEL_PEER);

  return {
    supported: false,
    ruleSyntax: null,
    method: leaked
      ? '否定对照成立：即使显式 deny 该路径，模型仍换用其它读工具读到了对方产出（哨兵命中）'
      : `本次未命中哨兵（failureKind=${out.failureKind}），但结论仍为不支持——` +
        'denylist 是工具级而非路径级，无法只挡一个文件',
    attempts,
  };
}

/** 编排 ZCode 侧的全部探针 */
export async function probeZcode(
  configuredEntry: string | null,
  node: string,
  opts: { skipModelCalls?: boolean; existing?: ZcodeProbe } = {},
): Promise<{ probe: ZcodeProbe; notes: string[]; flagsIndeterminate: string[]; flagsZeroExit: string[] }> {
  const notes: string[] = [];
  /*
   * 本轮**没能判定**的候选旗标（P-29）。结论文件里没有这一格——它是「本次探测过程」的事实，
   * 不是「被探对象」的属性，落盘会立刻过期。doctor 要靠它区分 `readonly_flags` 为空的两种成因：
   * 判过、一个都不接受（该拦）；本轮没判、保留的旧值恰好为空（拦它只会把人引向升级 ZCode）。
   */
  const flagsIndeterminate: string[] = [];
  /**
   * 本轮有多少候选是靠**退 0** 判成接受的（r5 CODEX-02）。同样是「本次探测过程」的事实、不落盘。
   * 非空即意味着零配额前提被打破：doctor 据此出告警，让烧掉的配额被看见而不是静默。
   */
  const flagsZeroExit: string[] = [];
  // 同 probeAgy：以既有结论为起点，跳过的探针保留原值——否则
  // `doctor --no-model-calls` 会把上一次真实探到的 response_field / path_deny /
  // scratch_paths / model_override 覆盖成 null，preflight 随即判该侧不可用。
  const probe: ZcodeProbe = opts.existing
    ? structuredClone(opts.existing)
    : {
        entrypoint: null,
        version: null,
        version_probe: null,
        probed_at: null,
        readonly_flags: [],
        model_override: null,
        trace_source: null,
        response_field: null,
        path_deny: emptyPathDeny(),
        scratch_paths: [],
        isolation: 'shared',
        model_id_form: null,
        models: [],
      };

  const { entry, version } = await probeZcodeEntry(configuredEntry, node);
  probe.entrypoint = entry;
  probe.version = version;
  probe.probed_at = new Date().toISOString();
  /*
   * 取版本的方式与 agy 完全不同：要用 node 跑 .cjs、子命令是 `version` 而非
   * `--version`、且 stdout 里混着别的内容要正则抠。正因为不同，它才必须
   * 随结论落盘而不是写死在读侧（P7）。`runner: 'node'` 记的是「需要 node」
   * 这个事实——具体哪个 node 由运行时的 runtime.node 决定，落盘会立刻过期。
   */
  probe.version_probe = {
    runner: 'node',
    args: ['version'],
    extract: String.raw`(\d+\.\d+\.\d+)`,
  };
  if (!entry) {
    notes.push('未找到 zcode.cjs 入口，ZCode 侧不可用');
    return { probe, notes, flagsIndeterminate, flagsZeroExit };
  }

  const zcodeModels = await probeZcodeModels();
  probe.models = zcodeModels;
  notes.push(
    zcodeModels.length > 0
      ? `可用模型 ${zcodeModels.length} 个（含短名与全限定形态）：${zcodeModels.slice(0, 6).join(', ')}…`
      : '⚠️ 未采集到模型清单（CLI config.json 缺失或无 provider）——preflight 的 slug 校验会空转',
  );

  const ts = await probeTraceSource();
  probe.trace_source = ts.names;
  probe.trace_args_source = ts.args;
  notes.push(
    `trace_source（工具名/模型）=${ts.names ?? '未定位'}；` +
      `trace_args_source（工具参数与路径）=${ts.args ?? '未定位'}`,
  );

  // CLI 侧模型配置是否就位——这一步不花配额，但决定后面能不能跑
  const cliConfigured = await exists(ZCODE_CLI_CONFIG);
  if (!cliConfigured) {
    notes.push(
      `⚠️ 缺少 ${ZCODE_CLI_CONFIG}。ZCode 的 CLI 模型 provider 配置独立于桌面端` +
        `（桌面端在 ~/.zcode/v2/config.json），凭据共享但配置不共享。` +
        `注意 zcode.cjs 无法单独拉起 TUI（缺 @zcode/tui 运行时），需手工创建该文件，形如：\n` +
        `  {"provider":{"<providerId>":{"name":…,"kind":"anthropic",` +
        `"options":{"apiKey":"…","baseURL":"…"},"source":"custom","models":{…}}},` +
        `"model":{"main":"<providerId>/<modelName>","lite":"…"}}`,
    );
  }

  // provider 配置文件的存在性（P-28）。只记有无、不读内容；适配层拉起时自己重算，这格是给人看的
  const providerPaths = await zcodeProviderConfigPaths(entry);
  probe.provider_config = {
    builtin_file: (await exists(providerPaths.builtin)) ? providerPaths.builtin : null,
    personal_file: (await exists(providerPaths.personal)) ? providerPaths.personal : null,
  };
  notes.push(
    `provider_config：内置=${probe.provider_config.builtin_file ?? '未找到'}；` +
      `个人=${probe.provider_config.personal_file ?? '未找到'}` +
      // 个人那份按 `os.homedir()` 取，而它读的是 `$HOME`（r2 CODEX-03）：编排器若跑在被重定向
      // HOME 的会话里，这一格会在错误目录下找、门控静默不给、CLI 换个面目报错。写出本次取的是哪个
      // 目录，让人在 doctor 输出里就能认出这一形态。切到 `os.userInfo().homedir` 见 BACKLOG EV-83。
      `（个人那份按用户目录 ${os.homedir()} 取）` +
      (probe.provider_config.builtin_file
        ? '（拉起时经 ZCODE_*_PROVIDER_CONFIG_FILE 注入，0.16.9 起独立拉起必需）'
        : '——0.16.9 起独立拉起会报「无法定位 CLI ZCode Built-in Provider Config」，请核对 ZCode 安装布局'),
  );
  /*
   * 这两个变量是 CLI 官方承认的定位通道，非标准安装布局下用户自设曾是唯一可行方案；
   * 而编排器**独占**它们：派生路径在就覆盖、不在就删除，两条路都不尊重宿主预置值
   * （判据必须是「子进程拿不到」而不是「我没主动注入」，见 `zcodeProviderEnv`）。
   * 这个口径此前只活在代码注释里——用户自设了却不生效时，他在 doctor 输出里看不到任何线索
   * （r4 CODEX-02，「记录不改行为」那一支）。
   */
  const hostPreset = [ZCODE_BUILTIN_PROVIDER_ENV, ZCODE_PERSONAL_PROVIDER_ENV].filter((k) => process.env[k]);
  if (hostPreset.length > 0) {
    notes.push(
      `⚠️ 宿主环境预置了 ${hostPreset.join(' / ')}——**编排器独占这两个变量**，` +
        '拉起时一律按派生路径注入、派生不到就删除，你设的值不会生效（这是有意的：' +
        '判据是「子进程拿不到」，否则宿主环境能改变探针行为）。要换 provider 配置位置请调整 ZCode 安装布局',
    );
  }

  const fx = await createFixture();
  try {
    const flags = await probeReadonlyFlags(entry, node, fx.root);
    flagsIndeterminate.push(...flags.indeterminate.map((i) => i.flag));
    flagsZeroExit.push(...flags.zeroExit);
    if (flags.zeroExit.length > 0) {
      /*
       * 零配额前提被打破了（r5 CODEX-02）。本探针整套设计就建立在「空 HOME ⇒ 停在模型层」上，
       * 退 0 意味着那个停点没生效、真跑完了一轮。结论照记接受（argv 确实吃完了），
       * 但这件事必须被说出来——r3 给「turn 里 3 分钟不退」加了 killTree，超时会被看见；
       * 「跑完并成功」是同族形态，此前无人说话。
       */
      notes.push(
        `⚠️ 旗标探针出现 ${flags.zeroExit.length} 次退 0（${JSON.stringify(flags.zeroExit)}）——` +
          '空 HOME 停在模型层的假设（P-30）已被打破，本轮疑似发生同样次数的真实模型调用。' +
          '结论仍按接受记（退 0 证明参数解析已完成），但请核对停点形态与配额消耗',
      );
    }
    if (flags.indeterminate.length > 0) {
      /*
       * **本轮未判定就不写结论**（r2 CODEX-02）：原先无条件 `probe.readonly_flags = flags.accepted`，
       * 全 indeterminate 时写进去的是 `[]`——与紧邻的「不写入 readonly_flags」自相矛盾，
       * 且空集在本仓是有双义的（types.ts 明写）：`availability()` 会把布局问题报成
       * 「无可用只读旗标、请升级 ZCode」，还顺手抹掉上一轮有效的结论。
       * 保留旧值 + note 写明「本轮未判定」，让空集只有「判过、一个都不接受」这一个意思。
       */
      notes.push(
        `⚠️ ${flags.indeterminate.length} 个候选旗标本轮未判定是否被接受——` +
          `readonly_flags 保留上一次的结论 ${JSON.stringify(probe.readonly_flags)}，不覆盖。` +
          // 逐条写出成因：不写的话「为什么判不出」要靠人再跑一次探针才知道（r4 CODEX-01）
          flags.indeterminate.map((i) => `\n    · ${i.flag} ← ${i.why}`).join(''),
      );
    } else {
      probe.readonly_flags = flags.accepted;
      notes.push(
        `readonly_flags 接受=${JSON.stringify(flags.accepted)}；` +
          `拒绝=${JSON.stringify(flags.rejected)}（--help 列出不等于实际接受）`,
      );
    }

    if (opts.skipModelCalls || !cliConfigured) {
      notes.push(
        '跳过需要真实模型调用的 ZCode 探针（配置缺失或已显式跳过）——' +
          'response_field / path_deny / scratch_paths / model_override 保留上一次的结论',
      );
      return { probe, notes, flagsIndeterminate, flagsZeroExit };
    }

    // 只取实测被接受的只读组合，展开成 argv。
    // 取的是 `probe.readonly_flags`（本轮结论，未判定时是保留下来的旧值）而不是 `flags.accepted`：
    // 两者在正常路径上相同，而在「本轮未判定」那一支上，后者是空数组——拿它去跑真实模型调用，
    // 等于在没有任何只读参数的情况下拉起 CLI。
    const readonly = probe.readonly_flags
      .filter((f) => f.startsWith('--mode plan') || f.startsWith('--disallowed-tools'))
      .flatMap((f) => f.split(' '));

    const out = await invokeZcode({
      entry,
      node,
      cwd: fx.root,
      readonlyArgs: readonly,
      timeoutMs: PROBE_TIMEOUT_MS,
      prompt:
        `项目根目录是 ${fx.root} 。请读取绝对路径 ${fx.openFile} ，` +
        `并原样回显它的第一行内容。只做这一件事。`,
    });

    if (out.failureKind !== 'none') {
      notes.push(`ZCode headless 失败（${out.failureKind}）：${redactSecrets(out.stderr.slice(0, 200)).content}`);
      return { probe, notes, flagsIndeterminate, flagsZeroExit };
    }

    // 正文字段：设计记载为 .response，实测确认
    if (out.envelope) {
      probe.response_field = out.envelope.keys.includes('response') ? 'response' : null;
      notes.push(
        `envelope 字段=${JSON.stringify(out.envelope.keys)}；response_field=${probe.response_field}；` +
          `哨兵命中=${out.envelope.response.includes(SENTINEL_OPEN)}`,
      );

      // envelope 中**没有** model 字段，生效模型只能从日志/rollout 回读（AC-13）
      const trace = await readTrace(out.envelope.sessionId);
      if (trace?.modelEffective) {
        probe.model_id_form = trace.modelEffective;
        notes.push(
          `生效模型回读=${trace.modelEffective}（来源：会话日志 context.model —— ` +
            `envelope 无 model 字段，这是 AC-13 的取值点之一）`,
        );
        notes.push(`轨迹工具计数=${JSON.stringify(trace.toolCalls)}（标准日志只有工具名，无路径）`);
      } else {
        notes.push('未能从会话日志回读生效模型——AC-13 的证据链在本机不完整');
      }

      // 读取路径只能从 rollout 取——标准日志的 tool.call.* 不带任何路径字段
      const rollout = out.envelope.sessionId ? await readRollout(out.envelope.sessionId) : null;
      if (rollout) {
        notes.push(
          `rollout 工具调用=${rollout.toolCalls.length} 条，可提取读取路径 ${rollout.readPaths.length} 个；` +
            `model.source=${rollout.modelSource}（印证模型覆盖档位为 config_copy）`,
        );
        if (!probe.model_id_form && rollout.modelEffective) probe.model_id_form = rollout.modelEffective;
      } else {
        notes.push(
          '未找到该会话的 rollout 文件——deny_paths 轨迹核验（AC-04）与 consulted ' +
            '交叉核对（AC-11）在 ZCode 侧将缺少路径证据',
        );
      }
    } else {
      notes.push('ZCode stdout 中抠不出 JSON envelope');
    }

    const deny = await probePathDeny(entry, node, fx, readonly);
    probe.path_deny = {
      supported: deny.supported,
      rule_syntax: deny.ruleSyntax,
      method: deny.method,
      attempts: deny.attempts,
      // 同 agy：本族 supported 为 false，没有「另测的读工具」可谈，如实记未测
      coverage_complete: null,
      // 逐文件形态未验（本族 supported 为 false，这个问题不成立）
      file_shape_verified: null,
    };
    notes.push(`path_deny.supported=${deny.supported}：${deny.method}`);

    probe.scratch_paths = await probeScratchPaths(fx);
    notes.push(`scratch_paths=${JSON.stringify(probe.scratch_paths)}`);

    // 模型覆盖：env 档已被证伪（0.16.5 无裸 ZCODE_MODEL），只剩 config_copy 与 global
    probe.model_override = 'config_copy';
    probe.isolation = 'home_copy';
    notes.push(
      'model_override=config_copy / isolation=home_copy：0.16.5 既无裸 ZCODE_MODEL 环境变量，' +
        '`--settings` 参数也被拒绝，且 ZCODE_HOME/ZCODE_DATA_BASE_DIR/ZCODE_STORAGE_DIR ' +
        '对配置解析无效——模型覆盖只能靠独立 HOME 下的 <home>/.zcode/cli/config.json 副本实现',
    );
  } finally {
    await fx.cleanup();
  }

  return { probe, notes, flagsIndeterminate, flagsZeroExit };
}
