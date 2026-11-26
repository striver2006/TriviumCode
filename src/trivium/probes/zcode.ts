/**
 * ZCode（`zcode.cjs`）能力探针（设计 §3.5）。
 *
 * M0 实测要点：
 *   - CLI 的**模型 provider 配置独立于桌面端**：桌面端读 `~/.zcode/v2/config.json`，
 *     CLI 读 `~/.zcode/cli/config.json`。凭据（OAuth）是共享的，但配置不是。
 *     因此「已登录」不等于「可用」，预检必须真跑一次最小 headless。
 *   - `--help` 列出的参数不等于实际接受的参数（`--max-turns` 即为反例），
 *     `readonly_flags` 必须逐个实测。
 *   - **不存在裸 `ZCODE_MODEL` 环境变量**（0.16.5，0.16.9 亦无 model 旗标），模型覆盖只能走
 *     `config_copy`（独立 `HOME` 下的 `cli/config.json` 副本）或 `global`。
 *   - **0.16.9 起 `config_copy` 生效的前提是不注入个人 provider 配置**（EV-82）：个人文件存在
 *     CLI 就直接用它、不做 legacy 导入，副本里的 `model.main` 没人读。`probeModelOverride` 臂
 *     零配额实测这条前提是否仍成立。
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { run } from '../util/exec.js';
// 命令行只在适配层构造（设计 §5.1）
import {
  invokeZcode,
  zcodeInvocation,
  zcodeVersionEnv,
  isZcodeScript,
  reviewEntry,
  type ZcodeSearch,
  legacyProviderMembers,
  prepareZcodeHome,
  qualifyAgainstCliConfig,
  readonlyArgsFromProbe,
  reorderRequestedFirst,
  zcodeProviderConfigPaths,
  zcodeProviderEnv,
  ZCODE_ARGV_PARSED_RE,
  ZCODE_CREDENTIAL_ENV_KEYS,
  ZCODE_DIR_ENV_KEYS,
  ZCODE_LANDING_SWITCH_ENV_KEYS,
  ZCODE_BETA_ARGV_RE,
  ZCODE_BUILTIN_PROVIDER_ENV,
  ZCODE_PERSONAL_PROVIDER_ENV,
  ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE,
  zcodeModelTail,
  describeZcodeProbedPath,
  removeZcodeTempDir,
  tildeHome,
  zcodeCliCopyPath,
  zcodeHomeUnder,
  zcodeHomeEnv,
  zcodeStorageRedirectEnv,
  type VariantOutcome,
  type ZcodeHomePrep,
  type ZcodeInvokeOptions,
  type ZcodeTempDirCopyKind,
} from '../adapters/zcode.js';
import { exists, makeTempDir } from '../util/fsx.js';
// CLI 原话进 note 之前过一遍脱敏（r5 CODEX-06）
import { redactSecrets } from '../secrets.js';
import { workTreeHash, statusPorcelain, diffTrees } from '../util/git.js';

// 置首函数在第三段搬到适配层（r3 §3.1）；原名再导出，既有用例与 evidence 脚本不用改
export { reorderRequestedFirst };
export type { VariantKind, VariantOutcome } from '../adapters/zcode.js';
import { createFixture, SENTINEL_OPEN, SENTINEL_PEER, type Fixture } from './fixture.js';
import {
  parseZcodeRollout,
  parseZcodeTrace,
  type ZcodeRollout,
} from '../adapters/zcode-trace.js';
import type { ZcodeProbe } from '../types.js';
import { defaultProbe } from '../config.js';

/** 探针用超时：探的是能力不是质量，不必给足生产上限 */
const PROBE_TIMEOUT_MS = 300_000;

/** CLI 侧配置根（与桌面端 `~/.zcode/v2/` 不是同一份） */
export const ZCODE_CLI_DIR = path.join(os.homedir(), '.zcode/cli');
export const ZCODE_CLI_CONFIG = path.join(ZCODE_CLI_DIR, 'config.json');

export async function probeZcodeEntry(
  configured: string | null,
  node: string,
  search?: ZcodeSearch,
): Promise<{ entry: string | null; version: string | null; error?: string }> {
  let entry: string | undefined;
  try { entry = reviewEntry(configured, search); }
  catch (e) { return { entry: null, version: null, error: (e as Error).message }; }
  if (!entry) return { entry: null, version: null, error: '未找到 ZCode 独立 CLI 或桌面内置入口' };
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
  const r = await run(...zcodeInvocation(node, [entry, 'version']), {
    timeoutMs: 60_000,
    // 目录 / 路径键、落点开关键（EV-112 起共十一个）与两个凭据键同样清底色（代码双审 r1 codex 子项 06）：口径是「全部探针路径」，不是「两条主路径」
    env: zcodeVersionEnv(),
    // 与其余五处拉起厂商 CLI 的口径一致（r5 CODEX-04）：此前这里是全仓唯一没开的一处。
    // `version` 现在不起子进程，但 P-29 已经证明这个 CLI 的演化方向是把活儿往前挪——
    // 真挪过来时，超时只杀直接子进程会留下孤儿继续跑
    killTree: true,
  });
  const version = r.code === 0 ? /(\d+\.\d+\.\d+)/.exec(r.stdout)?.[1] : undefined;
  if (version) return { entry, version };
  const why = r.timedOut ? '超时' : r.code === 0 ? '未返回 Agent 版本号' :
    '退出码 ' + r.code + '，' + redactSecrets(r.stderr.trim().split('\n')[0]?.slice(0, 180) ?? '').content;
  return { entry, version: null, error: 'ZCode 入口 ' + entry + ' 的 version 核验失败：' + why };
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
  /** 空 HOME 删不掉时的残留提示（EV-198，`removeZcodeTempDir` 给出）；删成功为 null。不影响上面四项结论 */
  tempDirResidue: string | null;
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
  //
  // **整包接收 `zcodeProviderEnv` 的返回**（代码双审 r1 codex 子项 01 ≡ AGY-01）：此前只解构内置键、手拼两键对象，
  // 把目录键丢在解构之外——宿主预置 `ZCODE_DATA_BASE_DIR` 时 `FZi` 会推出副本外的个人配置根，空 HOME 挡不住，
  // 七个候选变七次真实调用。`run()` 只对「值为 undefined 的键」做删除，键缺席就是原样透传。
  // 两个凭据键一并清：探针路径不该继承宿主的凭据/端点通道。
  const providerEnv: Record<string, string | undefined> = {
    ...(await zcodeProviderEnv(entry, undefined, { omitPersonal: true })),
    ...Object.fromEntries(ZCODE_CREDENTIAL_ENV_KEYS.map((k) => [k, undefined])),
  };
  const emptyHome = await makeTempDir('trivium-flagprobe');
  let tempDirResidue: string | null = null;
  try {
    for (const flag of candidates) {
      const r = await run(
        ...zcodeInvocation(node, [entry, '--prompt', 'ok', '--cwd', cwd, '--json', '--no-color', ...flag]),
        // `killTree`：P-30 实测该 CLI 能在一个 turn 里 3 分钟不退。第三态的前提（只给内置那份
        // 就停在无凭据）一旦被某次升版打破，这七次就是七次真实调用——超时杀父进程而遗弃孙进程，
        // 它们会继续烧配额（r3 CODEX-F01-04；`exec.ts` 要求拉起厂商 CLI 一律打开）。
        { cwd, timeoutMs: 30_000, env: { ...providerEnv, ...zcodeHomeEnv(emptyHome) }, killTree: true },
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
    /*
     * 删除失败不抛（EV-198）：裸删的 ENOTEMPTY / EBUSY / EACCES 会从这里抛穿 `probeZcode` 与 `runDoctor`，
     * 本轮已探的结论在 checkpoint 前丢失。空 HOME 从不写副本，传 null——删不掉时说「没有副本」，不去查。
     */
    tempDirResidue = await removeZcodeTempDir(emptyHome, '探针', null);
  }
  return { accepted, rejected, indeterminate, zeroExit, tempDirResidue };
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

/** `probeModelOverride` 写进副本、供比对的哨兵密钥——不像任何真实凭据形态，扫描器也不会误认 */
export const ZCODE_PROBE_SENTINEL_KEY = 'trivium-probe-sentinel-not-a-key';

/** 探针副本里每个 provider 保留的键——**白名单**，不在这里的一律不带（含 `headers` 等任何凭据形态） */
const PROBE_PROVIDER_KEEP: readonly string[] = ['name', 'kind', 'source', 'enabled', 'models'];
/** 放哨兵的那个 options 键名（CLI legacy 导入读 `options.apiKey`） */
const PROBE_SENTINEL_FIELD = 'apiKey';

/**
 * 按**白名单**重建探针用的 `cli/config.json` 副本（代码双审 r1 codex 子项 03 ≡ AGY-02）。
 *
 * 此前是黑名单：只把名为 `apiKey` 的值换成哨兵。黑名单漏一个键就是一份真实凭据进副本——
 * `headers.Authorization`、`token` 这类形态原样保留，副本在 `finally` 之前被 SIGKILL 就残留在临时目录。
 * 白名单反过来：每个 provider 只留 CLI legacy 导入要看的 `name` / `kind` / `source` / `enabled` / `models`，
 * `options` 只留 `baseURL`（provider 定义要它）与哨兵 `apiKey`，其余键**一律不带**。
 * 漏掉一个该留的键只会让导入不成（可见），漏掉一个该剥的键会静默泄漏（不可见）——与 codex 侧
 * `KEEP_TOP_KEYS` 选白名单是同一条取向。
 *
 * ## 白名单 ⊇ 导入器必需键（代码双审 r2 CODEX-02）
 *
 * 探针臂的输入（本副本）与审查运行的输入（整份拷贝）**不同形**，所以要说清楚裁掉的键不会让导入失败。
 * 包内 `Oqa`（`importLegacyCliPersonalProviderConfig`）对 custom provider 读的是：`source`（非 custom 跳过）、
 * `name`、`kind`（→ `Dqa` 映射 api 类型，缺省 openai-chat-completions）、`options.apiKey`、`models`（`Nqa`，
 * 跳 `deleted`、取 `id ?? 键名`、含 `contextWindow`）、`options.headers`（`Lqa` 合并，**可缺**）、
 * **`options.apiKeyRequired`**（`Fqa`：它的判定语义是「provider **显式声明** `apiKeyRequired: false` 就抛
 * `UnsupportedLegacyCliProviderConfigError`」，`skt` 捕获后**整份**导入返回 null——**不是**「缺 apiKey 才抛」，
 * 代码双审 r3 CODEX-01 纠正了我这里原先写反的语义）。
 * 于是白名单**必须**带上 `apiKeyRequired`（布尔，非凭据）：裁掉它，探针副本在免密 provider 上不触发抛错、
 * 判 `config_copy`，而审查运行的整份拷贝会被导入器整份拒掉——探针对运行**假乐观**。带上之后，两种副本在
 * 「导入会不会被拒」这件事上同形；被裁掉的 `headers` 等则确实只影响「导入带不带某些信息」，不影响成败。
 * 若某版 CLI 把别的可缺项改成必需，探针臂会先于审查运行翻成未判定/`global`（文案里写明了这种可能），
 * 同形第二臂作可选后续（EV-94）。**引用包内函数作论据时，写它的判定语义，不只写它读了哪些键。**
 */
export function buildProbeCliConfig(
  cfg: { provider?: Record<string, Record<string, unknown> | undefined> },
  qualified: string,
): Record<string, unknown> {
  const provider: Record<string, unknown> = {};
  for (const [key, p] of Object.entries(cfg.provider ?? {})) {
    if (!p) continue;
    const kept: Record<string, unknown> = {};
    for (const k of PROBE_PROVIDER_KEEP) if (k in p) kept[k] = p[k];
    const opts = (p['options'] ?? {}) as Record<string, unknown>;
    // 键用计算属性写：`fixture-credentials` 契约扫描器把「apiKey: <长标识符>」的字面形态当成密钥赋值，
    // 这里放的是哨兵常量而不是密钥，但形态判据不看语义，改写法比给扫描器开豁免便宜
    kept['options'] = {
      ...(typeof opts['baseURL'] === 'string' ? { baseURL: opts['baseURL'] } : {}),
      // `apiKeyRequired` 决定导入会不会被拒（`Fqa`），探针必须与整份拷贝同形（r3 CODEX-01）
      ...(typeof opts['apiKeyRequired'] === 'boolean' ? { apiKeyRequired: opts['apiKeyRequired'] } : {}),
      [PROBE_SENTINEL_FIELD]: ZCODE_PROBE_SENTINEL_KEY,
    };
    provider[key] = kept;
  }
  return { provider, model: { main: qualified, lite: qualified } };
}

/**
 * 在 `cli/config.json` 的目录里挑一个**非首位**模型作探针请求（计划双审 r3 CODEX-01）。
 *
 * 为什么必须非首位：CLI 的模型选择解析在 `defaultModelSelection` 验不过时回落到
 * 「第一个可见 provider 的第一个模型」——请求首位模型时，「读到了 `model.main`」与「没读到、回落」
 * 两个世界的回读值相同，判据结构性失明。挑不出非首位模型时返回 null，调用方记「未判定」。
 */
export function pickNonFirstModel(cfg: { provider?: Record<string, { models?: Record<string, unknown> } | undefined> }): string | null {
  // 成员按导入器同一组规则取（r3 CODEX-02）：被删的、非 custom 的、builtin:/account: 前缀的都不在注册表里
  for (const [key, members] of legacyProviderMembers(cfg)) {
    const list = [...members];
    if (list.length >= 2) return `${key}/${list[1]}`;
  }
  return null;
}

/**
 * 请求是否正落在目录首位（代码双审 r1 CODEX-04）：`opts.model` 绕过了 `pickNonFirstModel`，
 * 请求首位模型时「采信 model.main」与「回落首位」回读同值，配置层判据按构造失明。
 * 首位取第一个有成员的 provider 的第一个成员（`legacyProviderMembers` 同规则），只比 modelId 段（与判据同口径）。
 * 是则返回追加到 `why` 的标注，否则空串。结论照出、不改：改结论等于替实验下判断，如实标注即可。
 */
export function catalogFirstNote(cfg: Parameters<typeof legacyProviderMembers>[0], qualified: string): string {
  for (const members of legacyProviderMembers(cfg).values()) {
    const first = members.values().next().value;
    if (first === undefined) continue;
    return first === zcodeModelTail(qualified)
      ? '。⚠️ 请求为目录首位：采信与回落回读同值，本轮配置层结论无判别力'
      : '';
  }
  return '';
}

/** `probeModelOverride` 的结论 */
export interface ModelOverrideProbe {
  /** `config_copy`：副本 `model.main` 被读到并成为默认选择；`global`：CLI 跑到了模型层却没读它；null：本轮判不出 */
  override: 'config_copy' | 'global' | null;
  /** 写进副本 `model.main` 的请求串 */
  requested: string | null;
  /** CLI 自写的 `v2/provider_config.json` 里 `defaultModelSelection` 的 `<providerId>/<modelId>` */
  observed: string | null;
  /** 人读说明 */
  why: string;
  /**
   * 运行期选定（EV-82 第二段 r2 §3）：副本日志启动事件的 `context.model`，带成因。
   * 可选：桩与本字段之前的调用方不给它。
   */
  runtimeSelected?: RuntimeSelectionReadback;
  /**
   * 临时目录删不掉时的残留提示（EV-198，`removeZcodeTempDir` 给出），`probeZcode` 原样推进 notes。
   * 只在删除失败时出现、不影响上面的结论；可选的理由同 `runtimeSelected`。
   */
  tempDirResidue?: string;
}

/**
 * 运行期选定的读数（EV-82 第二段 r2 §3，第 1 轮 CODEX-02）。读不到时**带成因**：
 * 同一个「读不到」至少有五种来路，下一步各不相同，不能一律读成「哨兵走不到启动」。
 */
export type RuntimeSelectionCause = 'not_launched' | 'no_log_dir' | 'no_log_file' | 'no_event' | 'no_model_field' | 'ok';
export interface RuntimeSelectionReadback {
  cause: RuntimeSelectionCause;
  /** 仅 `cause === 'ok'` 时非 null：`<providerId>/<modelId>` */
  model: string | null;
}

/** CLI 启动时记下运行期选定的事件名（静态读数 S5；审查臂的 `modelFromLog` 取的就是它的 `context.model`） */
export const ZCODE_RUNTIME_CONFIG_EVENT = 'bootstrap.app.startup.runtime_config.completed';


/**
 * 读副本 HOME 下 CLI 日志里的运行期选定（EV-82 第二段 r2 §3）。
 *
 * - **取法**：日志目录里排序取**最新**的 `.jsonl`（探针 HOME 每次新建、单会话，所以不按 sessionId 过滤）；
 *   同一文件多条该事件取**最后一条**。三处取法各自有据（EV-194 代码双审 r1 CODEX-04）：本函数只取最新一片；
 *   审查臂与 doctor 的 `readTrace` 读独占落点目录的**全部**分片。
 *   审查臂自 EV-112（代码双审 r1 CODEX-02）起改为读运行目录下**全部**日志文件、按 sessionId 过滤——那个目录也是单次运行独占的，
 *   读全部是为了跨午夜不落空；探针 HOME 在一次探测内建完即删，跨午夜的代价只是本轮判不出，照旧取最新；
 * - 单行 JSON 解析失败跳过（超时被杀时末行可能残缺）；
 * - **只取 `context.model` 一个字段**，不读、不返回日志其它内容（日志可能含送审包全文）；
 * - I/O 异常 fail-closed：返回对应成因，**不抛**；
 * - `not_launched` **由调用方**在早退路径注入，不进本函数签名（代码双审 r1 GLM-05，相对计划 r2 §3 的
 *   `(home, launched)` 双参是有意偏离）：未拉起就不该去读，把「没读」伪装成一次读数反而多一个出错面。
 *
 * 与审查臂取法**方向相反**（代码双审 r1 codex）：`parseZcodeTrace` 取第一条带 `context.model` 的行，
 * 这里取最新文件里最后一条启动事件（计划 r2 §3 明文）。真实日志目前只有一行带该字段，两者等价；
 * 两处不是逐字同源，多条形态出现时读数可能分叉。
 */
export async function readRuntimeSelectedModel(home: string): Promise<RuntimeSelectionReadback> {
  const dir = path.join(home, '.zcode/cli/log');
  let files: string[];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.jsonl')).sort();
  } catch {
    return { cause: 'no_log_dir', model: null };
  }
  const latest = files.at(-1);
  if (!latest) return { cause: 'no_log_file', model: null };
  let text: string;
  try {
    text = await fs.readFile(path.join(dir, latest), 'utf8');
  } catch {
    return { cause: 'no_log_file', model: null };
  }
  let found = false;
  let model: string | null = null;
  for (const line of text.split('\n')) {
    if (!line.includes(ZCODE_RUNTIME_CONFIG_EVENT)) continue;
    let o: unknown;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (!o || typeof o !== 'object' || (o as { event?: unknown }).event !== ZCODE_RUNTIME_CONFIG_EVENT) continue;
    found = true;
    const ctx = (o as { context?: unknown }).context;
    const m = ctx && typeof ctx === 'object' ? (ctx as { model?: unknown }).model : undefined;
    model = typeof m === 'string' && m.length > 0 ? m : null; // 取最后一条：后出现的覆盖前面的
  }
  if (!found) return { cause: 'no_event', model: null };
  return model === null ? { cause: 'no_model_field', model: null } : { cause: 'ok', model };
}

/** 人读：运行期读数的一句话 */
export function describeRuntimeSelection(r: RuntimeSelectionReadback | undefined): string {
  if (!r) return '运行期选定：未采集';
  const why: Record<RuntimeSelectionCause, string> = {
    ok: '',
    not_launched: '该臂未拉起',
    no_log_dir: '副本 HOME 下没有 CLI 日志目录',
    no_log_file: '日志目录里没有 .jsonl',
    no_event: `日志里没有启动事件 ${ZCODE_RUNTIME_CONFIG_EVENT}`,
    no_model_field: '启动事件在，但 context.model 缺失（启动时选定为空）',
  };
  return r.cause === 'ok' ? `运行期选定 ${r.model}` : `运行期选定读不到：${why[r.cause]}`;
}

/**
 * `zcode.model_override`：**实测** `config_copy` 档在本机 CLI 版本下是否仍生效（EV-82，r3 CODEX-04）。
 *
 * 判据取自 CLI 的模型选择链：副本 HOME 下**没有**个人 provider 配置时，CLI 从 `<HOME>/.zcode/cli/config.json`
 * legacy 导入、把 `model.main` 转成 `defaultModelSelection`，并把迁移结果**写成**
 * `<HOME>/.zcode/v2/provider_config.json`——这一步发生在配置读取阶段、**先于任何模型调用**。
 * 于是读那份自写文件就能知道 `model.main` 有没有被读到，**不必等模型回应**。
 *
 * 零配额、零真实凭据：副本按白名单重建（`buildProbeCliConfig`，apiKey 是哨兵、不带任何别的凭据键），
 * 探针路径的 env 清掉两个凭据键；请求一个**非首位**模型（否则回落也会得到同一个值，见 `pickNonFirstModel`）；
 * 只给内置变量、个人键与全部目录 / 路径键、落点开关键一律清掉（清除面与审查运行相同；审查运行另设落点，EV-112）；
 * **带只读参数**（`--mode plan` + 完整 denylist，代码双审 r1 AGY-02）：本地免密端点下哨兵挡不住真实请求，
 * CLI 可能真跑起来，只读参数把它限在不执行工具。
 *
 * **三分判定**（代码双审 r1 codex 子项 02）：拉起没跑到配置读取阶段（spawn 失败 / 超时 / 内置文件定位失败 /
 * 未识别形态）记 **null**（未判定、保留旧值），不得记成有定论的 `global`——那是把「本轮没判成」记成
 * 「判成了、没生效」，与 r2 CODEX-02 修 `readonly_flags` 时的双义同型。只有「CLI 跑到了模型/鉴权层
 * （`ZCODE_ARGV_PARSED_RE` 命中）却没写出 v2 文件」才是 `global`。
 *
 * 清理只认 `makeTempDir` 的返回值（2026-09-20 事故 R1）。
 */
export async function probeModelOverride(
  entry: string,
  node: string,
  cwd: string,
  opts: {
    cliConfigPath?: string;
    /**
     * 显式请求模型（EV-82 第二段 r2 §5.1，GLM-07）：实验里三次拉起传同一个值。缺省仍取 `pickNonFirstModel`。
     * 本臂判据的前提是「请求非首位」；显式传了首位时结论照出，`why` 带 {@link catalogFirstNote} 的标注（代码双审 r1 CODEX-04）
     */
    model?: string;
    timeoutMs?: number;
    readonlyArgs?: readonly string[];
  } = {},
): Promise<ModelOverrideProbe> {
  const notLaunched: RuntimeSelectionReadback = { cause: 'not_launched', model: null };
  const src = opts.cliConfigPath ?? ZCODE_CLI_CONFIG;
  let cfg: { provider?: Record<string, Record<string, unknown> | undefined>; model?: unknown };
  try {
    cfg = JSON.parse(await fs.readFile(src, 'utf8')) as typeof cfg;
  } catch (e) {
    return { override: null, requested: null, observed: null, why: `读不到 ${src}：${(e as Error).message}`, runtimeSelected: notLaunched };
  }
  const pick = opts.model ?? pickNonFirstModel(cfg as Parameters<typeof pickNonFirstModel>[0]);
  if (!pick) {
    return {
      override: null, requested: null, observed: null,
      why: 'cli/config.json 目录里没有任何 provider 拥有两个以上模型，挑不出非首位模型，判据会失明——本轮未判定',
      runtimeSelected: notLaunched,
    };
  }
  const q = qualifyAgainstCliConfig(pick, cfg as Parameters<typeof qualifyAgainstCliConfig>[1]);
  if (q.qualified === null) return { override: null, requested: pick, observed: null, why: q.reason, runtimeSelected: notLaunched };

  const qualified = q.qualified;
  const home = await makeTempDir('trivium-modeloverride');
  // 副本写在临时 HOME 本身之下（不在 `home/` 子层），写盘与删除失败后现场查共用这一个路径（EV-198）
  const copyPath = zcodeCliCopyPath(home);
  /*
   * 删除收尾（EV-198，同认证探活 EV-197 的形态）：结果在 `attempt` 里拼完，删除放在外层 finally、失败不抛。
   * 此前 finally 里裸删，ENOTEMPTY / EBUSY / EACCES 会顶替结论、抛穿 `probeZcode` 与 `runDoctor`。
   * 删不掉时提示挂在 `tempDirResidue` 上、结论不变；副本是白名单重建、apiKey 是哨兵，有副本时取哨兵那档。
   */
  let result: ModelOverrideProbe;
  let residue: string | null = null;
  try {
    result = await attempt();
  } finally {
    residue = await removeZcodeTempDir(home, '探针', { path: copyPath, kind: 'sentinel' });
  }
  return residue === null ? result : { ...result, tempDirResidue: residue };

  /** 一次白名单臂的全部工作（EV-198 从 try 体原样拆出）：结论在这里拼完，删除留给上面的 finally */
  async function attempt(): Promise<ModelOverrideProbe> {
    const copy = buildProbeCliConfig(cfg, qualified);
    await fs.mkdir(path.dirname(copyPath), { recursive: true });
    await fs.writeFile(copyPath, JSON.stringify(copy, null, 2), { encoding: 'utf8', mode: 0o600 });

    const env: Record<string, string | undefined> = {
      ...(await zcodeProviderEnv(entry, undefined, { omitPersonal: true })),
      ...Object.fromEntries(ZCODE_CREDENTIAL_ENV_KEYS.map((k) => [k, undefined])),
      ...zcodeHomeEnv(home),
    };
    const r = await run(...zcodeInvocation(node, [entry, '--prompt', 'ok', '--cwd', cwd, '--json', '--no-color', ...(opts.readonlyArgs ?? [])]), {
      cwd, timeoutMs: opts.timeoutMs ?? 30_000, env, killTree: true,
    });

    // 运行期读数必须在 finally 整删临时根之前读（r2 §3）
    const runtimeSelected = await readRuntimeSelectedModel(home);
    const j = judgeOverrideReadback(qualified, await readDefaultSelection(home), r);
    const base = { override: j.override, requested: qualified, observed: j.observed, runtimeSelected };
    const blind = catalogFirstNote(cfg as Parameters<typeof legacyProviderMembers>[0], qualified);
    const done = (why: string): ModelOverrideProbe => ({ ...base, why: why + blind });
    switch (j.stop) {
      case 'match':
        return done(`副本 model.main 被 legacy 导入读到并成为 defaultModelSelection${j.providerNote}`);
      case 'mismatch':
        return done(`CLI 写出的 defaultModelSelection 是 ${j.observed ?? '（缺失）'}，modelId 段不是请求的模型——model.main 未被采信`);
      case 'not_finished':
        return done(`拉起未完成，本轮未判定${j.tail}`);
      case 'provider_unresolved':
        return done(`内置 provider 配置定位失败（P-28），配置读取阶段未到，本轮未判定${j.tail}`);
      case 'no_import':
        // 文案不承诺 CLI 行为（代码双审 r2 CODEX-02）：探针副本是白名单重建，与审查运行的整份拷贝不同形
        return done(
          `CLI 跑到了模型层，但白名单重建的副本没有触发 legacy 导入（副本 HOME 下无 v2/provider_config.json）——` +
          `可能是 CLI 改了导入流程，也可能是探针裁剪掉了导入需要的键；请先核对 buildProbeCliConfig 的白名单是否仍 ⊇ 导入器必需键${j.tail}`,
        );
      case 'unrecognized':
        return done(`未识别的停止形态，本轮未判定${j.tail}`);
    }
  }
}

/** CLI 在副本 HOME 下自写的 `v2/provider_config.json` 里的默认模型选择 */
export interface DefaultSelectionReadback {
  wroteV2: boolean;
  /** `<providerId>/<modelId>`；文件在但字段缺失为 null */
  observed: string | null;
}

/** 读 `<home>/.zcode/v2/provider_config.json` 的 `defaultModelSelection`（两臂共用，只读） */
export async function readDefaultSelection(home: string): Promise<DefaultSelectionReadback> {
  try {
    const w = JSON.parse(await fs.readFile(path.join(home, '.zcode/v2/provider_config.json'), 'utf8')) as {
      config?: { defaultModelSelection?: { providerId?: unknown; modelId?: unknown } };
    };
    const sel = w.config?.defaultModelSelection;
    const observed = sel && typeof sel.providerId === 'string' && typeof sel.modelId === 'string' ? `${sel.providerId}/${sel.modelId}` : null;
    return { wroteV2: true, observed };
  } catch {
    return { wroteV2: false, observed: null };
  }
}

/**
 * 两臂共用的**判据**（EV-82 小主题第一段 r2 §3.2 第 7 条，GLM-07）：只返回三态与停止形态，
 * **成因文案由各臂自带**——白名单臂的 `no_import` 指向「核对白名单」，同形臂没有白名单可核。
 */
export type OverrideStop = 'match' | 'mismatch' | 'not_finished' | 'provider_unresolved' | 'no_import' | 'unrecognized';

export interface OverrideJudgement {
  override: 'config_copy' | 'global' | null;
  observed: string | null;
  stop: OverrideStop;
  /** 写出的 providerId 形态与请求不同、modelId 一致时的说明；否则空串 */
  providerNote: string;
  /** 退出码与 stderr 首行（已脱敏），供没写出 v2 的几支拼文案 */
  tail: string;
}

export function judgeOverrideReadback(
  requested: string,
  rb: DefaultSelectionReadback,
  r: { code: number | null; timedOut?: boolean; stderr: string },
): OverrideJudgement {
  const firstLine = r.stderr.split('\n').map((l) => l.trim()).find(Boolean) ?? '（stderr 为空）';
  const tail = `（退出码 ${r.code === null ? 'null' : r.code}${r.timedOut ? '，超时' : ''}：${redactSecrets(firstLine.slice(0, 120)).content}）`;
  // 先看 CLI 有没有写出 v2 文件——写了就有判据，与退出形态无关
  if (rb.wroteV2) {
    /*
     * 判据与 run() 侧**同一口径**（代码双审 r2 CODEX-03）：只看 modelId 段（`zcodeModelTail`）。
     * providerId 形态差只落说明，不改判定。
     */
    const matches = rb.observed !== null && zcodeModelTail(rb.observed) === zcodeModelTail(requested);
    const providerNote = rb.observed !== null && rb.observed !== requested && matches ? `（providerId 形态与副本源不同：写出 ${rb.observed}）` : '';
    return matches
      ? { override: 'config_copy', observed: rb.observed, stop: 'match', providerNote, tail }
      : { override: 'global', observed: rb.observed, stop: 'mismatch', providerNote: '', tail };
  }
  // 没写出 v2：只有「确实跑到了模型/鉴权层」才能说导入没发生；其余一律未判定
  if (r.code === null || r.timedOut) return { override: null, observed: null, stop: 'not_finished', providerNote: '', tail };
  if (ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE.test(r.stderr)) return { override: null, observed: null, stop: 'provider_unresolved', providerNote: '', tail };
  if (ZCODE_ARGV_PARSED_RE.test(r.stderr)) return { override: 'global', observed: null, stop: 'no_import', providerNote: '', tail };
  return { override: null, observed: null, stop: 'unrecognized', providerNote: '', tail };
}

// ── 同形第二臂（EV-94 ②；EV-82 小主题第一段 r2 §3） ──

/**
 * 凭据形态的键名（大小写不敏感、子串匹配）。命中的键，其下的字符串值换成哨兵。
 * 位于任一 `headers` 对象之下的字符串值也换（`Authorization` 等头字段名五花八门，按容器判更稳）。
 */
const CREDENTIAL_KEY_RE = /api[-_]?key|token|secret|passw(or)?d|authorization|cookie|credential|bearer/i;
/**
 * 短键：只在键名**恰好等于**它们时命中（代码双审 r2 GLM-02）。子串匹配会误伤 `keyboard` 一类，
 * 而不收它们，`auth` / `key` 下的裸长十六进制值会三层全过。
 */
const SHORT_CREDENTIAL_KEYS: ReadonlySet<string> = new Set(['key', 'auth', 'session', 'passphrase']);

function isCredentialKey(k: string): boolean {
  return CREDENTIAL_KEY_RE.test(k) || SHORT_CREDENTIAL_KEYS.has(k.toLowerCase());
}

/**
 * 按「保键骨架、字符串值换哨兵」改写一份配置（r2 §3.2 第 5 条，CODEX-04 / CODEX-05 / GLM-05）。
 *
 * **递归整份**（含嵌套对象与数组，不限于 `options`）；满足任一条的字符串值换成哨兵：
 *   ①键名命中凭据形态（子串 {@link CREDENTIAL_KEY_RE}，或短键精确匹配）；②位于某个 `headers` 对象之下；
 *   ③**形态兜底**：`redactSecrets` 判它像凭据（不论键名）。
 * 其余值原样，**所有键一律保留**：顶层与 provider 白名单外的键正是 H2 的嫌疑面，动了就测不到。
 *
 * `headersOnly` 模式（给 `apiKeyOnly` 档用，代码双审 r2 GLM-01）：只做②。收窄的变量是「键名替换面」，
 * `headers` 容器规则与它正交——导入器对 headers 可缺、不影响导入成败，换掉它不污染诊断目的；
 * 不换，`Authorization: Bearer <token>` 会原样进副本。
 *
 * 这仍是**黑名单**性质：漏判的凭据会原样进副本（r2 §3.3 写明，缓解不是消除）。
 * 返回替换过的**键路径**（不含值），供 notes 与报告登记。
 */
export function sentinelizeCredentials<T>(
  value: T,
  mode: 'full' | 'headersOnly' = 'full',
): { copy: T; replacedPaths: string[] } {
  const full = mode === 'full';
  const replacedPaths: string[] = [];
  const walk = (v: unknown, at: string, sensitive: boolean): unknown => {
    if (typeof v === 'string') {
      if (sensitive || (full && redactSecrets(v).count > 0)) {
        replacedPaths.push(at || '(root)');
        return ZCODE_PROBE_SENTINEL_KEY;
      }
      return v;
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${at}[${i}]`, sensitive));
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        out[k] = walk(x, at ? `${at}.${k}` : k, sensitive || (full && isCredentialKey(k)) || k.toLowerCase() === 'headers');
      }
      return out;
    }
    return v;
  };
  return { copy: walk(value, '', false) as T, replacedPaths };
}

/**
 * 结构兜底（代码双审 r1 CODEX-01）：每个 provider 的 `options.apiKey` **无条件**写哨兵，不存在也补上。
 * 与白名单臂同一取向：最可能的凭据载体不再依赖黑名单命中。只动这一个键的值，键与结构不动。
 * 返回它改写过的键路径（代码双审 r2 CODEX-02）：两档都并入 `replacedPaths`，读数与盘上一致。
 */
export function forceProviderApiKeySentinel<T>(cfg: T): { copy: T; forcedPaths: string[] } {
  const c = cfg as { provider?: Record<string, { options?: Record<string, unknown> } | undefined> };
  const forcedPaths: string[] = [];
  for (const [name, p] of Object.entries(c.provider ?? {})) {
    if (!p || typeof p !== 'object') continue;
    // 计算属性键：避开 fixture-credentials 扫描器对「apiKey: <长标识符>」字面形态的判据（与 buildProbeCliConfig 同理）
    p.options = { ...(p.options ?? {}), [PROBE_SENTINEL_FIELD]: ZCODE_PROBE_SENTINEL_KEY };
    forcedPaths.push(`provider.${name}.options.${PROBE_SENTINEL_FIELD}`);
  }
  return { copy: cfg, forcedPaths };
}

/** 长随机串的形态：≥20 位、只由 base64 / hex / token 常见字符组成 */
const RESIDUE_RE = /^[A-Za-z0-9._+/=-]{20,}$/;
/** 鉴权 scheme 前缀：先剥掉再测余下段（代码双审 r2 GLM-01：锚定正则会让 `Bearer <token>` 整串逃逸） */
const AUTH_SCHEME_PREFIX_RE = /^(?:bearer|basic|token)\s+/i;
/** 合法长标识，不算疑似凭据（代码双审 r2 CODEX-04）：标准 UUID；带点主机名加斜杠路径的无 scheme 端点 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOST_PATH_RE = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?:\/[A-Za-z0-9._~-]*)+$/;
/** provider 对象里不扫的键：`models` 下的长模型 id 会误挡实验；`name` 是人读名 */
const RESIDUE_SKIP_KEYS: ReadonlySet<string> = new Set(['models', 'name']);

function looksLikeResidue(key: string, raw: string): boolean {
  if (key === 'baseURL' || raw === ZCODE_PROBE_SENTINEL_KEY || raw.includes('://')) return false;
  const v = raw.replace(AUTH_SCHEME_PREFIX_RE, '');
  if (UUID_RE.test(v) || HOST_PATH_RE.test(v)) return false;
  return RESIDUE_RE.test(v);
}

/**
 * 拉起前的残余扫描（代码双审 r1 CODEX-01，r2 放宽论域）：替换之后，凡位于 `provider.<id>` 之下
 * （跳过 `models` 子树与 `name` 键）、像长随机串且不是 URL / UUID / 无 scheme 端点、不是哨兵的字符串，
 * 登记为「疑似未替换的凭据」。**只返回键路径，不返回值**。判定前先剥鉴权 scheme 前缀。
 *
 * **已知残余（代码双审 r2 GLM-02 落点②）**：副本**顶层**不扫。顶层有 `model.main` 一类合法长值
 * （`bigmodel-coding-plan/GLM-5.3-Flash`），扫它会把实验挡成未判定；顶层凭据只剩键名与形态两道黑名单。
 * 这一收窄登记在设计文档探针行与本段收口报告。
 */
export function findCredentialResidue(cfg: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown, at: string, key: string): void => {
    if (typeof v === 'string') {
      if (looksLikeResidue(key, v)) out.push(at);
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${at}[${i}]`, key)); return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, `${at}.${k}`, k);
  };
  const providers = (cfg as { provider?: Record<string, Record<string, unknown> | undefined> }).provider ?? {};
  for (const [name, p] of Object.entries(providers)) {
    if (!p || typeof p !== 'object') continue;
    for (const [k, x] of Object.entries(p)) {
      if (!RESIDUE_SKIP_KEYS.has(k)) walk(x, `provider.${name}.${k}`, k);
    }
  }
  return out;
}

/** `judgeRuntimeSelection` 的结论：值与一句人读说明 */
export interface RuntimeSelectionVerdict {
  value: 'honored' | 'reorder_needed' | 'reorder_ineffective' | null;
  why: string;
}

/**
 * `zcode.runtime_selection`（EV-82 第三段 r3 §4.2）：用同形臂两支（原样 `as`、置首 `ro`）的**运行期**读数
 * 与请求按序判定，首命中即止。只比 modelId 段；不引入「首位」，也不看配置层结论。
 *
 * ① 任一支读数不是 ok、置首支 `kind` 不是 `applied`（全部成因，含恒等）、或两支请求值不同 ⇒ null；
 * ② 两支都 = 请求 ⇒ honored；③ 原样 ≠、置首 = ⇒ reorder_needed；④ 两支都 ≠ ⇒ reorder_ineffective；
 * ⑤ 原样 = 而置首 ≠（冲突）⇒ null。②～⑤ 穷尽两支的四种组合。null 由调用方**不覆盖旧值**。
 */
export function judgeRuntimeSelection(as: FullCopyOverrideProbe, ro: FullCopyOverrideProbe): RuntimeSelectionVerdict {
  const a = as.runtimeSelected;
  const r = ro.runtimeSelected;
  if (a?.cause !== 'ok' || a.model === null) return { value: null, why: `原样支${describeRuntimeSelection(a)}` };
  if (r?.cause !== 'ok' || r.model === null) return { value: null, why: `置首支${describeRuntimeSelection(r)}` };
  if (ro.variant?.kind !== 'applied') {
    return { value: null, why: `置首支没做成置首（${ro.variant?.kind ?? '无变体结果'}${ro.variant?.reason ? `：${ro.variant.reason}` : ''}），两支不可分` };
  }
  if (!as.requested || !ro.requested || zcodeModelTail(as.requested) !== zcodeModelTail(ro.requested)) {
    return { value: null, why: `两支请求值不同（原样 ${as.requested ?? '—'}、置首 ${ro.requested ?? '—'}），不可比` };
  }
  const req = zcodeModelTail(as.requested);
  const aOk = zcodeModelTail(a.model) === req;
  const rOk = zcodeModelTail(r.model) === req;
  if (aOk && rOk) return { value: 'honored', why: `原样与置首两支运行期都选中请求 ${as.requested}——副本默认被采信，审查臂的置首已非必需（上游可能已修）` };
  if (!aOk && rOk) return { value: 'reorder_needed', why: `原样支运行期回落到 ${a.model}，置首支选中请求 ${as.requested}——当前 CLI 仍需置首，审查臂已置首规避（EV-82 形态）` };
  if (!aOk && !rOk) {
    return { value: 'reorder_ineffective', why: `两支运行期都没选中请求 ${as.requested}（原样 ${a.model}、置首 ${r.model}）——置首也挡不住，glm 侧审查运行的模型覆盖会失败` };
  }
  return { value: null, why: `两支冲突：原样支选中请求 ${as.requested}，置首支却是 ${r.model}——不收录` };
}

/**
 * 同形臂临时根删不掉时，残留副本按哪一档说（EV-198；代码双审 r1 CODEX-05 抽成带名字的函数）。两支理由不同：
 * - `apiKeyOnly` 收窄档：这一档的替换面本身不保证副本干净（见 `replace` 的说明），残余扫描为空也不能断言没有凭据；
 * - 扫出残余：副本已在盘上（`prepareZcodeHome` 先写盘、本臂再判残余），只是不拉起，里面可能留着疑似凭据。
 * 两支都取「含真实凭据」，宁可多提醒；其余是凭据已换成哨兵的探针副本。现场查优先：副本不在时删除函数说「没有」。
 */
export function fullCopyResidueKind(replace: 'full' | 'apiKeyOnly' | undefined, residue: readonly string[]): ZcodeTempDirCopyKind {
  if (replace === 'apiKeyOnly') return 'credential';
  if (residue.length > 0) return 'credential';
  return 'sentinel';
}

/** 同形臂的结论：与白名单臂同一形状，外加替换键路径、宿主预置的凭据 env 键与变体结果 */
export interface FullCopyOverrideProbe extends ModelOverrideProbe {
  replacedPaths: string[];
  hostCredentialEnv: string[];
  variant?: VariantOutcome;
}

/**
 * `zcode.model_override_full_copy`：用与审查臂**同形**的副本，在**配置读取层**再判一次（r2 §3.2）。
 *
 * - 副本由审查臂同一个构造函数 `prepareZcodeHome` 造，经它的 `transformCopy` 在**写盘前**把凭据换成哨兵；
 * - `homeDir` 为 null 或 route 不是 `config_copy` ⇒ **不拉起**（CODEX-02：否则子进程继承真实 HOME，
 *   会读、甚至写用户真实的 `~/.zcode/v2/provider_config.json`）；
 * - 环境与**白名单探针臂**同形（清两个凭据 env 键以保零配额）。与审查臂的已知偏差：审查臂不清这两个键（GLM-04）；
 * - 判据与白名单臂共用 {@link judgeOverrideReadback}，成因文案本臂自带（GLM-07）；
 * - 清理只认 `makeTempDir` 的返回值，不调 `scrubZcodeHome`（2026-09-20 事故 R1 / R2）。
 *
 * 配置层结论（`override`）只判配置读取层；运行期选定另由 {@link readRuntimeSelectedModel} 读启动事件，
 * 放在 `runtimeSelected`（EV-82 第二段 r2 §3），两者分开报，不合成一个结论。
 */
export async function probeModelOverrideFullCopy(
  entry: string,
  node: string,
  cwd: string,
  opts: {
    cliConfigPath?: string;
    /** 显式请求模型；传了目录首位、或 `variant: 'requested-first'` 置首生效时，结论照出，`why` 标注配置层判据失明（代码双审 r1 CODEX-04） */
    model?: string;
    timeoutMs?: number;
    readonlyArgs?: readonly string[];
    /**
     * 替换面（代码双审 r1 CODEX-04）：`full`（缺省）= 键名 + headers + 形态兜底的递归替换；
     * `apiKeyOnly` = **只收窄键名替换面**：不做键名与形态替换，但 `headers` 容器替换（r2 GLM-01）、
     * 每个 provider 的 `apiKey` 结构兜底与拉起前残余扫描**照旧**。计划 §4 判读表 (cc, global) 一格
     * 「先分 H2 与替换伪影」的第一刀就用它复跑。
     *
     * **两档的零配额保证不同**（r2 CODEX-02）：`apiKeyOnly` 档下，不在 `headers` 里、键名又不叫 apiKey 的
     * 凭据若不被残余扫描命中，会原样进副本。它不是与 `full` 同等的零配额档。
     */
    replace?: 'full' | 'apiKeyOnly';
    /**
     * 副本变体（EV-82 第二段 r2 §4）：`as-is`（缺省）原样；`requested-first` 把请求的 provider / 模型排到首位，
     * 只动顺序。第三段起 doctor 也拉起这一支，作审查臂的零配额替身（r3 §3.3，是对第二段 AGY-02 的有意偏离）；
     * 缺省仍是 `as-is`，`model_override_full_copy` 与 EV-94 ② 只取原样支。
     */
    variant?: 'as-is' | 'requested-first';
    /**
     * 删除临时根的**测试注入口**（EV-198 计划 r2 §3.1 R4）：扫出残余那一支不拉起，子进程摆不了「删不掉」，
     * 用例要在删除前一刻自己上锁、再调真实的 `removeZcodeTempDir`。缺省就是它。
     * 与 `util/fsx.ts` 的 `tryRemoveTempDir` 不是一回事（EV-200 计划双审 GLM-04）：这里替的是返回整句提示的 zcode 薄包装。
     */
    removeTempDir?: typeof removeZcodeTempDir;
  } = {},
): Promise<FullCopyOverrideProbe> {
  const src = opts.cliConfigPath ?? ZCODE_CLI_CONFIG;
  const hostCredentialEnv = ZCODE_CREDENTIAL_ENV_KEYS.filter((k) => process.env[k]);
  const variantName = opts.variant ?? 'as-is';
  /*
   * 原样支由本臂自行合成（r3 §3.3，计划双审 r2 CODEX-04）；置首支的唯一来源是 `prep.reorder`，
   * 走到 `prepareZcodeHome` 之前的早退只剩这条占位（这些早退都不拉起，新事实按读数不 ok 记 null）。
   */
  let variant: VariantOutcome =
    variantName === 'as-is'
      ? { variant: 'as-is', applied: true, kind: 'applied' }
      : { variant: 'requested-first', applied: false, kind: 'not_movable', reason: '本轮没走到置首（早退）' };
  const none = (why: string, requested: string | null = null): FullCopyOverrideProbe => ({
    override: null, requested, observed: null, why, replacedPaths: [], hostCredentialEnv,
    runtimeSelected: { cause: 'not_launched', model: null }, variant,
  });

  let cfg: { provider?: Record<string, Record<string, unknown> | undefined> };
  try {
    cfg = JSON.parse(await fs.readFile(src, 'utf8')) as typeof cfg;
  } catch (e) {
    return none(`读不到 ${src}：${(e as Error).message}`);
  }
  const requested = opts.model ?? pickNonFirstModel(cfg as Parameters<typeof pickNonFirstModel>[0]);
  if (!requested) return none('cli/config.json 目录里没有任何 provider 拥有两个以上模型，挑不出非首位模型，判据会失明——本轮未判定');
  /*
   * 限定失败时 prepareZcodeHome 走 route global、`reorder` 为 null，下面的早退照样拦住、不拉起；
   * 在这里先限定一次，只为给置首支写明 `qualify_failed` 的原因。
   */
  const q = qualifyAgainstCliConfig(requested, cfg as Parameters<typeof qualifyAgainstCliConfig>[1]);
  if (variantName === 'requested-first' && q.qualified === null) {
    variant = { variant: 'requested-first', applied: false, kind: 'qualify_failed', reason: `请求模型限定失败，无从置首：${q.reason}` };
  }

  // 前缀不得以 `trivium-modeloverride` 开头：白名单臂的清理用例按那个前缀找残留，并行跑会互相误判
  const root = await makeTempDir('trivium-fullcopyarm');
  /*
   * 残余扫描的结果在删除时还要用（EV-198）：`transformCopy` 写盘前赋值，下面的 finally 据它取提示档位。
   * 它是「盘上副本长什么样」的单一事实源（代码双审 r1 CODEX-05）：日后在 `attempt` 里新增早退分支，
   * 须保证删除时刻它仍与盘上副本一致——不写副本就返回的分支不要动它，写了副本的分支要先经 `transformCopy`。
   */
  let residue: string[] = [];
  /*
   * 删除收尾（EV-198，同认证探活 EV-197 的形态）：结果在 `attempt` 里拼完，删除放在外层 finally、失败不抛，
   * 删不掉时提示挂在 `tempDirResidue` 上、结论不变。副本由 `prepareZcodeHome` 写在 `<临时根>/home` 下。
   * 档位：凭据写盘前已换哨兵，取哨兵那档；但扫出残余（副本照样已在盘上，只是不拉起）或走 `apiKeyOnly` 收窄档
   * （残余扫描为空也不保证没有凭据，见上面 `replace` 的说明）时取「含真实凭据」，宁可多提醒。
   * 按删除那一刻的 `residue` 取档，`prepareZcodeHome` 写盘后抛错的路径也一样；`transformCopy` 没跑到时副本不存在，
   * 现场查得 ENOENT 就说没有。
   */
  let result: FullCopyOverrideProbe;
  let tempDirResidue: string | null = null;
  try {
    result = await attempt();
  } finally {
    tempDirResidue = await (opts.removeTempDir ?? removeZcodeTempDir)(root, '探针', {
      path: zcodeCliCopyPath(zcodeHomeUnder(root)),
      kind: fullCopyResidueKind(opts.replace, residue),
    });
  }
  return tempDirResidue === null ? result : { ...result, tempDirResidue };

  /** 一次同形臂的全部工作（EV-198 从 try 体原样拆出）：结论在这里拼完，删除留给上面的 finally */
  async function attempt(): Promise<FullCopyOverrideProbe> {
    let replacedPaths: string[] = [];
    const prep = await prepareZcodeHome(root, requested, {
      srcConfig: src,
      // 置首统一走副本构造函数（r3 §3.3，计划双审 r1 CODEX-03 ≡ GLM-05）：与审查臂同一条路径；
      // 它在 transformCopy 之前做，这里收到的已是置首后的对象
      requestedFirst: variantName === 'requested-first',
      transformCopy: (c) => {
        const s = sentinelizeCredentials(c, opts.replace === 'apiKeyOnly' ? 'headersOnly' : 'full');
        const f = forceProviderApiKeySentinel(s.copy);
        // 读数与盘上一致：结构兜底改写的路径也算替换（r2 CODEX-02）；去重是因为 full 档可能已按键名换过 apiKey
        replacedPaths = [...new Set([...s.replacedPaths, ...f.forcedPaths])];
        residue = findCredentialResidue(f.copy);
        return f.copy;
      },
    });
    if (variantName === 'requested-first' && prep.reorder !== null) variant = prep.reorder;
    if (prep.homeDir === null || prep.route !== 'config_copy' || prep.qualified === null) {
      return { ...none(`同形副本没有建成模型覆盖（${prep.reason ?? prep.route}），不拉起、本轮未判定`, requested), replacedPaths };
    }
    /*
     * 零配额的前提是「副本里所有凭据都被换掉」（r2 §4 配额前提）。替换是黑名单性质，
     * 扫出疑似残余就**不拉起**：宁可本轮未判定，也不冒一次真实调用（CODEX-01，`--no-model-calls` 的承诺）。
     */
    if (residue.length > 0) {
      return {
        ...none(
          `同形副本里仍有 ${residue.length} 处疑似未替换的凭据（${residue.join('、')}），为守零配额不拉起、本轮未判定。` +
            '若确认不是凭据，需把判据收窄后再跑',
          prep.qualified,
        ),
        replacedPaths,
      };
    }

    const env: Record<string, string | undefined> = {
      ...(await zcodeProviderEnv(entry, undefined, { omitPersonal: true })),
      ...Object.fromEntries(ZCODE_CREDENTIAL_ENV_KEYS.map((k) => [k, undefined])),
      ...zcodeHomeEnv(prep.homeDir),
    };
    const r = await run(...zcodeInvocation(node, [entry, '--prompt', 'ok', '--cwd', cwd, '--json', '--no-color', ...(opts.readonlyArgs ?? [])]), {
      cwd, timeoutMs: opts.timeoutMs ?? 30_000, env, killTree: true,
    });

    // 运行期读数必须在 finally 整删临时根之前读（r2 §3）
    const runtimeSelected = await readRuntimeSelectedModel(prep.homeDir);
    const j = judgeOverrideReadback(prep.qualified, await readDefaultSelection(prep.homeDir), r);
    const base = { override: j.override, requested: prep.qualified, observed: j.observed, replacedPaths, hostCredentialEnv, runtimeSelected, variant };
    const blind =
      catalogFirstNote(cfg as Parameters<typeof legacyProviderMembers>[0], prep.qualified) +
      (variant.variant === 'requested-first' && variant.applied ? '。置首后请求就在首位，配置层判据按构造失明，本次只看运行期读数' : '');
    const done = (why: string): FullCopyOverrideProbe => ({ ...base, why: why + blind });
    switch (j.stop) {
      case 'match':
        return done(`同形副本（整份拷贝、凭据换哨兵）的 model.main 被 legacy 导入读到${j.providerNote}`);
      case 'mismatch':
      case 'no_import':
        return done(
          (j.stop === 'mismatch'
            ? `CLI 写出的 defaultModelSelection 是 ${j.observed ?? '（缺失）'}，modelId 段不是请求的模型`
            : 'CLI 跑到了模型层，但同形副本没有触发 legacy 导入（副本 HOME 下无 v2/provider_config.json）') +
          '——成因两种都可能：①整份拷贝里有键让配置层结果与白名单副本不同（H2）；②本臂的凭据替换破坏了导入' +
          `（本轮替换了 ${replacedPaths.length} 处：${replacedPaths.join('、') || '无'}）${j.tail}`,
        );
      case 'not_finished':
        return done(`拉起未完成，本轮未判定${j.tail}`);
      case 'provider_unresolved':
        return done(`内置 provider 配置定位失败（P-28），配置读取阶段未到，本轮未判定${j.tail}`);
      case 'unrecognized':
        return done(`未识别的停止形态，本轮未判定${j.tail}`);
    }
  }
}

/**
 * 只读个人 `v2/provider_config.json` 里的 provider **键名**（provider id），不读、不返回任何值（r2 §4.2，GLM-02）。
 *
 * 用途：核 EV-82 诊断 (D) 格的隔离腿前提「个人配置的 provider 键 ≠ 副本源 legacy 键」。
 * 文件结构未经完整实测，所以按形态收集：任何名为 `providers` 的对象取其键、数组取元素的 `id`，
 * 再加 `defaultModelSelection.providerId`。与 `provider_config.personal_file` 只判有无的既有纪律同型。
 */
export async function listPersonalProviderIds(file: string): Promise<{ present: boolean; ids: string[] }> {
  let j: unknown;
  try {
    j = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return { present: false, ids: [] };
  }
  const ids = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v === null || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'providers') {
        if (Array.isArray(x)) {
          for (const it of x) if (it && typeof it === 'object' && typeof (it as { id?: unknown }).id === 'string') ids.add((it as { id: string }).id);
        } else if (x && typeof x === 'object') {
          for (const key of Object.keys(x)) ids.add(key);
        }
      }
      if (k === 'defaultModelSelection' && x && typeof x === 'object' && typeof (x as { providerId?: unknown }).providerId === 'string') {
        ids.add((x as { providerId: string }).providerId);
      }
      walk(x);
    }
  };
  walk(j);
  return { present: true, ids: [...ids].sort() };
}

/**
 * doctor 两次真实调用（headless 与 path_deny 否定对照）共用的拉起形态（EV-194）：与 `authProbe` 同一组三个键。
 * 副本支：副本 HOME + 不注入个人配置；退路支（档位未给模型）：`homeDir` 为 null、注入个人配置。落点根两支都设。
 */
export type ZcodeProbeLaunch = Pick<ZcodeInvokeOptions, 'homeDir' | 'omitPersonalProviderConfig' | 'storageRedirectRoot'>;

/**
 * 读取某个 sessionId 的会话日志并解析轨迹。
 *
 * `logDir` 必填、且应是**本次独占**的落点日志目录（EV-194：doctor 的 headless 探针自此把日志指到临时运行目录）。
 * 读目录下**全部** `.jsonl`（按文件名即日期排序后拼接），与审查运行的回读（`adapters/zcode.ts` `run()` 的日志段）
 * 同一文件集合口径：日志按日期分片，只取最新一片的话，跨午夜时启动事件（`context.model`）落在前一天的文件里，
 * 生效模型回读不到（EV-194 计划双审 CODEX-05）。目录独占，所以读全部不会混进别的会话；仍按 sessionId 过滤。
 * 此前缺省读真实 `~/.zcode/cli/log` 的最新一片，那条路径随 EV-194 去掉（唯一调用方已改传落点目录）。
 */
export async function readTrace(
  sessionId: string | null,
  logDir: string,
): Promise<ReturnType<typeof parseZcodeTrace> | null> {
  let files: string[];
  try {
    files = (await fs.readdir(logDir)).filter((f) => f.endsWith('.jsonl')).sort();
  } catch {
    return null;
  }
  // 逐片兜底（代码双审 r1 CODEX-02）：分片可能在 readdir 之后被清掉或读不了，单片失败跳过，不让整个探针抛出
  const texts = (
    await Promise.all(files.map((f) => fs.readFile(path.join(logDir, f), 'utf8').catch(() => null)))
  ).filter((t): t is string => t !== null);
  if (texts.length === 0) return null;
  return parseZcodeTrace(texts.join('\n'), sessionId);
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
 *
 * `extra.launch`（EV-194）：与 headless 那次共用的副本 HOME / 不注入个人配置 / 落点根三个键，原样展开进这次拉起，
 * 让否定对照也跑在审查运行那条路径上；`extra.invoke` 是测试注入口。都不给时与 EV-194 之前相同（只有用例会不给）。
 */
export async function probePathDeny(
  entry: string,
  node: string,
  fx: Fixture,
  readonlyFlags: string[],
  extra: { launch?: ZcodeProbeLaunch; invoke?: typeof invokeZcode } = {},
): Promise<{ supported: boolean; ruleSyntax: string | null; method: string; attempts: string[] }> {
  const attempts = [
    '--disallowed-tools "Read(<绝对路径>)"：语法被接受，但模型改用 Bash(head -1) 读到了目标文件',
    '--disallowed-tools "Read(<路径>) Write Edit MultiEdit ApplyPatch Bash"：模型改用 Grep 读到了目标文件',
    '--settings <path>：参数被拒绝（Unknown option），无法注入独立权限配置',
    '--mode plan：实测**不阻止命令执行**，不能作为只读手段单独使用',
    '结论：要靠 denylist 挡住单个文件需封掉全部读路径（Read/Grep/Glob/ReadSessionContext/Bash），' +
      '那样连被审对象也读不了，粒度不可用',
  ];

  const out = await (extra.invoke ?? invokeZcode)({
    entry,
    node,
    ...extra.launch,
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

/**
 * 本轮进了真实调用段、`response_field` 却没被刷新的三支（EV-196）。
 *
 * 与 `flagsIndeterminate` 同类：是「本次探测过程」的事实，不是被探对象的属性，不落盘（r3「过程状态不落盘」裁决）。
 * 结论从 `existing` 克隆，这三支只推 note、旧值原样留着——existing 里是 `'response'` 时 doctor 那条 headless blocker
 * 不触发，全量 doctor 退 0、blockers 与 warnings 都为空。doctor 据此出 warning、不拦（决策一：一次临时失败不该拦下全量 doctor）。
 */
export type ZcodeHeadlessUnrefreshedBranch = 'source_unreadable' | 'headless_failed' | 'no_envelope';
export interface ZcodeHeadlessUnrefreshed {
  branch: ZcodeHeadlessUnrefreshedBranch;
  /** 本轮沿用上一次结论的几项（按结论字段名） */
  carried: readonly string[];
}
/**
 * 三支的人读名、「根因在哪条 note」的定位字面、沿用旧值的几项。探针推 note 与 doctor 出 warning 引同一份，
 * 免得 warning 指向的 note 字面与 note 本身各改各的。`carried` 是代码结构决定的静态事实：
 * 前两支在 path_deny 之前就返回，第三支之后 path_deny / scratch_paths 照跑照刷。
 */
export const ZCODE_HEADLESS_UNREFRESHED: Readonly<
  Record<ZcodeHeadlessUnrefreshedBranch, { what: string; noteKey: string; carried: readonly string[] }>
> = {
  source_unreadable: {
    what: '副本源读取或解析失败',
    noteKey: '读取或解析失败',
    carried: ['response_field', 'path_deny', 'scratch_paths', 'model_id_form'],
  },
  headless_failed: {
    what: 'headless 调用失败',
    noteKey: 'ZCode headless 失败',
    carried: ['response_field', 'path_deny', 'scratch_paths', 'model_id_form'],
  },
  no_envelope: {
    what: 'headless 退 0 但 stdout 里抠不出 JSON envelope',
    noteKey: 'ZCode stdout 中抠不出 JSON envelope',
    carried: ['response_field', 'model_id_form'],
  },
};
function headlessUnrefreshed(branch: ZcodeHeadlessUnrefreshedBranch): ZcodeHeadlessUnrefreshed {
  return { branch, carried: [...ZCODE_HEADLESS_UNREFRESHED[branch].carried] };
}

/** 编排 ZCode 侧的全部探针 */
export async function probeZcode(
  configuredEntry: string | null,
  node: string,
  opts: {
    skipModelCalls?: boolean;
    existing?: ZcodeProbe;
    /**
     * 两个**测试注入口**（代码双审 r2 CODEX-01 / CODEX-04 ≡ AGY-01）。
     *
     * 不开口子的后果实测过：`preflight.test.ts` 的回归用例传 `null` 入口，`probeZcodeEntry` 回落到
     * `/Applications/...` 绝对路径候选，装了 ZCode.app 的机器上这条**单元**用例会真实拉起探针臂并读
     * 真实 `~/.zcode/cli/config.json`；而它断言的 `model_override` 此前靠写死值恒绿，实测化之后靠
     * 本机 CLI 现势恰好同值——「未判定保留旧值」的语义在本机根本没被测到。
     * `cliConfigPath` 同时喂 `cliConfigured` 判定与探针臂；`modelOverrideProbe` 替换探针臂本体，
     * 让接线（只读参数透传、`null` 不覆盖、`global` 出 ⚠️）能被桩咬住。
     */
    cliConfigPath?: string;
    modelOverrideProbe?: typeof probeModelOverride;
    /** 同形第二臂的注入口，与 `modelOverrideProbe` 同理（EV-82 小主题第一段） */
    modelOverrideFullCopyProbe?: typeof probeModelOverrideFullCopy;
    /**
     * headless 与 path_deny 两次真实调用要请求的模型（EV-194）：doctor 传 `zcodeProbeModel(config)`，
     * 与认证探活同一定义。不传等同 null——档位未给模型，走与审查运行相同的真实 HOME 退路；只有用例会不传。
     */
    launchModel?: string | null;
    /** headless 与 path_deny 两次真实调用的测试注入口（EV-194），与 `modelOverrideProbe` 同理 */
    invoke?: typeof invokeZcode;
  } = {},
): Promise<{
  probe: ZcodeProbe;
  notes: string[];
  flagsIndeterminate: string[];
  flagsZeroExit: string[];
  /** 本轮进了真实调用段却没刷新 response_field 时是哪一支（EV-196）；没进真实调用段或已刷新为 null */
  headlessUnrefreshed: ZcodeHeadlessUnrefreshed | null;
}> {
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
  /*
   * 本轮进了真实调用段、`response_field` 却没被刷新时是哪一支（EV-196）。同上两项，是过程事实、不落盘。
   * 前两支（副本源失败、headless 失败）当场返回；第三支（有拉起、无 envelope）不返回、path_deny 照跑，记在这里到末尾带出。
   */
  let unrefreshed: ZcodeHeadlessUnrefreshed | null = null;
  const { entry, version, error } = await probeZcodeEntry(configuredEntry, node);
  const providerPaths = entry ? await zcodeProviderConfigPaths(entry) : null;
  const builtin = providerPaths && await exists(providerPaths.builtin) ? providerPaths.builtin : null;
  const previous = opts.existing;
  const same = !!entry && !!version && previous?.entrypoint === entry && previous.version === version &&
    (previous.provider_config?.builtin_file ?? null) === builtin;
  const probe = same ? structuredClone(previous) : defaultProbe().cli.zcode!;
  if (!same && previous?.probed_at) notes.push('ZCode 安装或版本已变化，重新采样该入口的能力。');
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
    runner: entry && !isZcodeScript(entry) ? null : 'node',
    args: ['version'],
    extract: String.raw`(\d+\.\d+\.\d+)`,
  };
  if (!entry || !version || !providerPaths) {
    notes.push(error ?? '未找到 ZCode 审核入口');
    return { probe, notes, flagsIndeterminate, flagsZeroExit, headlessUnrefreshed: null };
  }
  notes.push('审核入口=' + entry + '，Agent ' + version);
  // 入口路径命中包内 beta 改写的 argv 判据（EV-112 计划 r3 §8 R7）：只报命中与否，不报路径全文
  if (ZCODE_BETA_ARGV_RE.test(entry)) {
    notes.push(
      'ZCode 入口在 beta 渠道路径下：旗标探针与模型覆盖探针臂的存储根会被 CLI 改写到 ~/.zcode-beta（清环境键挡不住这条 argv 触发）；' +
        '审查运行、认证探活与 doctor 的 headless / path_deny 设了存储根，不受影响（EV-112 / EV-136 / EV-194）',
    );
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
  const cliConfigPath = opts.cliConfigPath ?? ZCODE_CLI_CONFIG;
  const cliConfigured = await exists(cliConfigPath);
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
  probe.provider_config = {
    builtin_file: builtin,
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
    // 三条探针臂的临时目录删不掉时（EV-198），各自的残留提示紧跟该臂的结论 note 推进来；结论不因此改变
    if (flags.tempDirResidue) notes.push(flags.tempDirResidue);

    /*
     * 模型覆盖档位——**实测**而非写死（EV-82，r3 CODEX-04）。零配额、零真实凭据，
     * 所以 `--no-model-calls` 下照跑；只依赖 `cli/config.json` 在。
     * 判不出（目录里没有非首位模型 / 读不到文件）时保留上一次的结论、只出 note。
     */
    if (cliConfigured) {
      const arm = opts.modelOverrideProbe ?? probeModelOverride;
      const mo = await arm(entry, node, fx.root, {
        cliConfigPath,
        readonlyArgs: readonlyArgsFromProbe(probe.readonly_flags),
      });
      if (mo.override !== null) probe.model_override = mo.override;
      probe.isolation = 'home_copy';
      notes.push(
        `model_override=${mo.override ?? '未判定（保留上一次 ' + JSON.stringify(probe.model_override) + '）'} / isolation=home_copy：` +
          `${mo.why}（请求 ${mo.requested ?? '—'}，CLI 写出 ${mo.observed ?? '—'}；${describeRuntimeSelection(mo.runtimeSelected)}）。` +
          '前提：副本 HOME 下不注入个人 provider 配置，CLI 从 cli/config.json 副本 legacy 导入；' +
          '既无模型旗标也无选型环境变量，`--settings` 被拒',
      );
      if (mo.tempDirResidue) notes.push(mo.tempDirResidue);
      if (mo.override === 'global') {
        notes.push(
          '⚠️ 探针臂判 config_copy 档未生效：若审查运行也如此，模型覆盖会静默落到全局默认（guard 会播报「请求的模型没有生效」）。' +
            '成因两种都可能：CLI 改了 legacy 导入流程，或探针的白名单副本裁掉了导入需要的键——先核对 buildProbeCliConfig 的白名单，再按 P-31 复核包内字面',
        );
      }

      /*
       * 同形第二臂（EV-94 ②；EV-82 小主题第一段 r2 §3）：副本与审查臂同形，在配置读取层再判一次。
       * 与白名单臂同一门控、同样零配额（凭据写盘前换哨兵）；判不出不覆盖旧值（CODEX-06）。
       */
      const fcArm = opts.modelOverrideFullCopyProbe ?? probeModelOverrideFullCopy;
      const fc = await fcArm(entry, node, fx.root, {
        cliConfigPath,
        readonlyArgs: readonlyArgsFromProbe(probe.readonly_flags),
      });
      if (fc.override !== null) probe.model_override_full_copy = fc.override;
      notes.push(
        `model_override_full_copy=${fc.override ?? '未判定（保留上一次 ' + JSON.stringify(probe.model_override_full_copy ?? null) + '）'}（本轮${fc.override === null ? '未' : ''}产出）：` +
          `${fc.why}（请求 ${fc.requested ?? '—'}，CLI 写出 ${fc.observed ?? '—'}；替换凭据键 ${fc.replacedPaths.length} 处，另对每个 provider 的 apiKey 无条件写哨兵；` +
          `${describeRuntimeSelection(fc.runtimeSelected)}）。` +
          '配置层结论只判配置读取层；运行期选定取自 CLI 启动事件（与审查臂的生效模型同一字段）。零配额的前提是副本里所有凭据都被换掉，拉起前已做残余扫描',
      );
      if (fc.tempDirResidue) notes.push(fc.tempDirResidue);
      /*
       * 置首支（EV-82 第三段 r3 §3.3 / §4.2）：审查臂的零配额替身。显式传 variant——同形臂缺省是原样支，
       * `model_override_full_copy` 与 EV-94 ② 只取上面那一支；这一支只给 `runtime_selection` 供数。
       */
      const ro = await fcArm(entry, node, fx.root, {
        cliConfigPath,
        readonlyArgs: readonlyArgsFromProbe(probe.readonly_flags),
        variant: 'requested-first',
      });
      // 置首支没有自己的结论 note，只推残留提示
      if (ro.tempDirResidue) notes.push(ro.tempDirResidue);
      const rsel = judgeRuntimeSelection(fc, ro);
      if (rsel.value !== null) probe.runtime_selection = rsel.value;
      /*
       * 配置层写出了请求值、运行期却没选它（EV-82 第二段 r2 §3）：正是 EV-82 的形态——
       * 两臂在配置读取层都成立，真实运行却回落首位。按臂各自比 modelId 段（与配置层判据同口径）。
       *
       * 只在配置层判 `config_copy` 时对照（代码双审 r1 GLM-02）：⚠️ 的前提是「配置读取层写出了请求值」，
       * `null`（本轮未判定）与 `global`（没写出，另有配置层 ⚠️）两档下前提不成立，不叠加；运行期读数照常进上面的 note。
       * 两种情形出 ⚠️：读数 ok 且 modelId 段 ≠ 请求；读数 `no_model_field`（已拉起、启动阶段选定为空，
       * 请求值必未被采用，代码双审 r1 CODEX-03）。其余读不到的成因不算不一致。
       */
      // 新事实判出了值时，回落形态由它那条 note 说明（r3 §4.2「与运行期 ⚠️ 合并，不重复出」）
      for (const [name, a] of rsel.value === null ? ([['白名单臂', mo], ['同形臂', fc]] as const) : ([] as const)) {
        const rs = a.runtimeSelected;
        if (a.override !== 'config_copy' || !a.requested || !rs) continue;
        if (rs.cause === 'ok' && rs.model !== null && zcodeModelTail(rs.model) !== zcodeModelTail(a.requested)) {
          notes.push(
            `⚠️ ${name}：配置读取层写出了请求值 ${a.requested}，但运行期选定是 ${rs.model}——` +
              '默认选择在运行期没被采用（EV-82 形态），见 EV-82 第二段计划 §5 判读表',
          );
        } else if (rs.cause === 'no_model_field') {
          notes.push(
            `⚠️ ${name}：配置读取层写出了请求值 ${a.requested}，但启动阶段选定为空（启动事件在、context.model 缺失）——` +
              '请求值在运行期没被采用，见 EV-82 第二段计划 §5 判读表',
          );
        }
      }
      if (fc.hostCredentialEnv.length > 0) {
        notes.push(
          `⚠️ 宿主环境预置了 ${fc.hostCredentialEnv.join(' / ')}：两条探针臂都清掉了它们，审查运行不清——` +
            '若两臂与审查运行结论不同，这是一个与副本形态无关的备择成因（GLM-04）',
        );
      }
      // 落点相关的宿主预置（EV-110；EV-112 起十一键）：所有拉起路径都清，只剩信息级提示；只报键名、不打印值
      const hostLandingKeys = [...ZCODE_DIR_ENV_KEYS, ...ZCODE_LANDING_SWITCH_ENV_KEYS].filter((k) => process.env[k]);
      if (hostLandingKeys.length > 0) {
        notes.push(
          `宿主环境预置了 ${hostLandingKeys.join(' / ')}：所有拉起路径都已清掉它们（EV-110 / EV-112）。` +
            '审查运行的 CLI 日志、rollout、会话库与存储根下的 artifacts / sessions / memories / plugins 由编排器指到运行目录' +
            '（跑后只自检日志与 rollout 两类）：log / rollout 就地脱敏，db / plugins 整目录排除，其余过命中即删扫描，' +
            '幸存内容随运行目录保留期整删；认证探活与 doctor 的 headless / path_deny 落点同审查运行、产物随临时目录删除（EV-136 / EV-194），' +
            '旗标探针与模型覆盖探针臂在各自的临时 HOME 下跑，都不含送审内容',
        );
      }
      // 两臂不一致告警（EV-94 ② 触发器）：只比**本轮都产出且都非 null** 的两值，不拿新值比旧值（CODEX-06）
      if (mo.override !== null && fc.override !== null && mo.override !== fc.override) {
        notes.push(
          `⚠️ 两条探针臂在配置读取层结论不一致：白名单臂 ${mo.override}、同形臂 ${fc.override}——EV-94 ② 的触发条件成立，` +
            '差异来自副本形态（或同形臂的凭据替换），见 EV-82 小主题第一段计划 §4 判读表',
        );
      }
      notes.push(
        rsel.value === null
          ? `runtime_selection=未判定（保留上一次 ${JSON.stringify(probe.runtime_selection ?? null)}）：${rsel.why}`
          : `${rsel.value === 'reorder_ineffective' ? '⚠️ ' : ''}runtime_selection=${rsel.value}：${rsel.why}`,
      );
    }

    if (opts.skipModelCalls || !cliConfigured) {
      notes.push(
        '跳过需要真实模型调用的 ZCode 探针（配置缺失或已显式跳过）——' +
          (same ? 'response_field / path_deny / scratch_paths 保留同一入口的结论' : '当前入口的模型响应、路径限制和临时文件未测；请运行 trivium doctor --only zcode'),
      );
      // 没进真实调用段，不算「没刷新」（决策一）
      return { probe, notes, flagsIndeterminate, flagsZeroExit, headlessUnrefreshed: null };
    }

    // 只取实测被接受的只读组合，展开成 argv。
    // 取的是 `probe.readonly_flags`（本轮结论，未判定时是保留下来的旧值）而不是 `flags.accepted`：
    // 两者在正常路径上相同，而在「本轮未判定」那一支上，后者是空数组——拿它去跑真实模型调用，
    // 等于在没有任何只读参数的情况下拉起 CLI。
    const readonly = readonlyArgsFromProbe(probe.readonly_flags);
    if (!readonly.includes('--disallowed-tools')) {
      notes.push('审核入口 ' + entry + ' 缺少已核验的 --disallowed-tools，已停止真实模型探测。');
      return { probe, notes, flagsIndeterminate, flagsZeroExit, headlessUnrefreshed: null };
    }

    /*
     * 两次真实调用走审查运行那条选模路径（EV-194，与 `authProbe` 的 EV-136 同一形态）。
     *
     * 此前这里以真实 HOME 拉起、个人 provider 配置被注入，0.16.9 见它存在就用它的 `defaultModelSelection`（P-31）
     * ——探的是个人缺省模型。2026-10-02 个人缺省指向已停用的 provider，headless 连报 `Model creation failed`、
     * 失败即返回，其后 response_field / model_id_form / path_deny / scratch_paths 全都不刷新，而审查要用的 GLM 订阅完好；
     * 反过来个人缺省可用而 GLM 坏了时会误报正常。现在：mkdtemp 临时运行目录 → `prepareZcodeHome`（档位 plan 阶段的
     * glm 模型、请求置首，副本源与门控判的是同一个文件）→ 副本 HOME + 副本支不注入个人配置 + 两支都设落点根，
     * headless 与 path_deny 共用这一份；回读从落点根读；探完只删 mkdtemp 的返回值（副本里有真实凭据，
     * 2026-09-20 事故后的规矩：不拼路径、不走别的变量）。
     */
    // 走 makeTempDir（EV-251）：带时限的 doctor 经它把目录记进台账，宿主硬杀时由下一次 doctor 补删
    const runDir = await makeTempDir('trivium-zcode-doctor');
    try {
      const invoke = opts.invoke ?? invokeZcode;
      let prep: ZcodeHomePrep;
      try {
        prep = await prepareZcodeHome(runDir, opts.launchModel ?? null, { srcConfig: cliConfigPath, requestedFirst: true });
      } catch (e) {
        // 不退回真实 HOME：审查运行在同一情形下也起不来，退回去探的就又不是那条路径了
        notes.push(
          `副本源 ${tildeHome(cliConfigPath)} ${ZCODE_HEADLESS_UNREFRESHED.source_unreadable.noteKey}：${tildeHome((e as Error).message)}——` +
            'response_field / path_deny / scratch_paths / model_id_form 保留上一次的结论（请检查该文件，或在 ZCode 里重新保存一次模型配置）',
        );
        return { probe, notes, flagsIndeterminate, flagsZeroExit, headlessUnrefreshed: headlessUnrefreshed('source_unreadable') };
      }
      const landing = zcodeHomeUnder(runDir);
      const launch: ZcodeProbeLaunch = {
        homeDir: prep.homeDir,
        omitPersonalProviderConfig: prep.homeDir !== null,
        storageRedirectRoot: landing,
      };
      const probed = describeZcodeProbedPath(prep);

      const out = await invoke({
        entry,
        node,
        ...launch,
        cwd: fx.root,
        readonlyArgs: readonly,
        timeoutMs: PROBE_TIMEOUT_MS,
        prompt:
          `项目根目录是 ${fx.root} 。请读取绝对路径 ${fx.openFile} ，` +
          `并原样回显它的第一行内容。只做这一件事。`,
      });

      if (out.failureKind !== 'none') {
        /*
         * 结构化根因（`turn.failed` 的 `error.cause.message`）只在 CLI 日志里，而日志此刻在临时目录、
         * 下面 finally 就删（EV-194 编码时补）：不在这里取，RUNBOOK「先取结构化根因」那一步对 doctor 就无从做起。
         * 目录是本次独占的，sessionId 取不到时按 null 读全部行也不会混进别的会话；同样过一遍脱敏。
         */
        const failed = await readTrace(out.envelope?.sessionId ?? null, zcodeStorageRedirectEnv(landing)['ZCODE_LOG_DIR']!);
        const cause = failed?.failureCause ? `；日志根因：${redactSecrets(failed.failureCause.slice(0, 200)).content}` : '';
        notes.push(
          `${ZCODE_HEADLESS_UNREFRESHED.headless_failed.noteKey}（${out.failureKind}，${probed}）：${redactSecrets(out.stderr.slice(0, 200)).content}${cause}`,
        );
        return { probe, notes, flagsIndeterminate, flagsZeroExit, headlessUnrefreshed: headlessUnrefreshed('headless_failed') };
      }
      /*
       * headless 通过之后才说「探的是哪条路径」（代码双审 r1 CODEX-06）：此后 path_deny 必跑，这行对两次都成立；
       * 失败时只有上面那条带 probed 的失败 note。退路括注按成因分（GLM-01）：`homeDir` 为 null 有两种成因，
       * `source_missing` 只在门控与这里两次存在性读之间副本源被挪走时可达，不能一律说成「档位未给模型」。
       */
      notes.push(
        `headless / path_deny 探的是：${probed}` +
          (prep.homeDir === null
            ? (prep.cause === 'no_model' ? '（档位未给模型' : '（副本源在探测中途不见了') +
              '，退回真实 HOME 与个人配置，与审查运行在同一情形下的退路相同；CLI 产物仍落在临时目录、探完即删）'
            : '（与审查运行同一选模路径；CLI 产物落在临时目录、探完即删）'),
      );

      // 正文字段：设计记载为 .response，实测确认
      if (out.envelope) {
        probe.response_field = out.envelope.keys.includes('response') ? 'response' : null;
        notes.push(
          `envelope 字段=${JSON.stringify(out.envelope.keys)}；response_field=${probe.response_field}；` +
            `哨兵命中=${out.envelope.response.includes(SENTINEL_OPEN)}`,
        );

        /*
         * envelope 中**没有** model 字段，生效模型只能从日志/rollout 回读（AC-13）。
         * 两处都从落点根读（EV-194）：日志目录直接取递给 CLI 的那个 `ZCODE_LOG_DIR`，不在这里另拼，
         * 免得落点布局有第二份实现（计划双审 CODEX-04）；rollout 走 `readRollout` 现成的 HOME 参数。
         * 回读到的是这条路径的**生效**模型——详情那行的「模型 X」只是请求值（CODEX-02）。
         */
        const trace = await readTrace(out.envelope.sessionId, zcodeStorageRedirectEnv(landing)['ZCODE_LOG_DIR']!);
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
        const rollout = out.envelope.sessionId ? await readRollout(out.envelope.sessionId, landing) : null;
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
        notes.push(ZCODE_HEADLESS_UNREFRESHED.no_envelope.noteKey);
        unrefreshed = headlessUnrefreshed('no_envelope');
      }

      const deny = await probePathDeny(entry, node, fx, readonly, { launch, invoke });
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
    } finally {
      /*
       * 删除失败不抛（EV-194 代码双审 r1 CODEX-01）：`force` 只吞 ENOENT，ENOTEMPTY / EBUSY / EACCES 会从 finally 抛出、
       * 顶替原异常，doctor 的 checkpoint 就不执行，本轮已探的结论随之丢失。失败时说清残留在哪、里面还有没有副本凭据
       * （删除失败后现场查）；删除与措辞与认证探活共用（EV-197）。
       */
      const residue = await removeZcodeTempDir(runDir, '探针', { path: zcodeCliCopyPath(zcodeHomeUnder(runDir)), kind: 'credential' });
      if (residue) notes.push(residue);
    }

    // model_override 已由上面的 probeModelOverride 臂实测决定；`env` 档 0.16.5 已证伪（无裸 ZCODE_MODEL）
  } finally {
    // 删不掉不抛、提示进 notes（EV-199）：与上面各臂的临时目录同一处置
    const fixtureResidue = await fx.cleanup();
    if (fixtureResidue) notes.push(fixtureResidue);
  }

  return { probe, notes, flagsIndeterminate, flagsZeroExit, headlessUnrefreshed: unrefreshed };
}
