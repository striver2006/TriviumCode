/**
 * ZCode 适配器（设计 §11.3）。
 *
 * M0 实测把设计里的若干假设推翻了，这里按实测结论实现：
 *   - **没有裸 `ZCODE_MODEL` 环境变量**（0.16.5）。模型覆盖三档的 `env` 档作废，
 *     只能靠独立 `HOME` 下的 `<home>/.zcode/cli/config.json` 副本（`config_copy`）。
 *   - **`--settings` 参数被拒绝**，不能用它注入独立配置。
 *   - `ZCODE_HOME` / `ZCODE_DATA_BASE_DIR` / `ZCODE_STORAGE_DIR` 对 **`cli/config.json` 的解析**无效，
 *     只有 `HOME` 生效（0.16.5，C-08）。**但 0.16.9 起 `ZCODE_DATA_BASE_DIR` 决定 provider 配置根与
 *     凭据根**（包内 `FZi` / `gUs`：`dataBaseDir ?? ZCODE_DATA_BASE_DIR ?? homedir()`）——所以拉起时
 *     这三个变量连同 `ZCODE_LOG_DIR`（EV-110）、会话库与 mailbox 的路径键和四个落点开关键（EV-112）一律清掉，
 *     见 `zcodeProviderEnv`（计划双审 r3 CODEX-02）。审查运行清完再**设**其中三个，把 CLI 产物指到运行目录（EV-112，`zcodeStorageRedirectEnv`）。
 *   - **模型覆盖的落点是 `cli/config.json` 副本的 `model.main`，前提是不注入个人 provider 配置**（EV-82）：
 *     个人文件存在时 CLI 直接用它、不做 legacy 导入；不存在时才从 `cli/config.json` 导入并把
 *     `model.main` 转成默认模型选择（包内 `fpe.#f` → `importLegacy` → `Mqa`）。EV-81 注入了指向
 *     真实个人文件的变量，正是它让 `config_copy` 档失效了两天。
 *   - **`--mode plan` 不阻止命令执行**，完整 denylist 中 `Bash` 是必需项。
 *   - stdout **不是纯 JSON**（前面有 AI SDK 告警行），必须抠 envelope。
 *   - envelope **没有 model 字段**，生效模型只能从日志/rollout 回读。
 *   - 轨迹需要**两个**文件：日志给工具名与状态，rollout 给工具参数（路径）。
 *   - **0.16.9 起独立拉起要靠两个环境变量定位 provider 配置**（坑 P-28）：CLI 按**入口文件目录**
 *     推算 `zcode-builtin.json`，应用包布局下两条候选都不存在；桌面端起 CLI 时用
 *     `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` / `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 传路径。
 *     这一步**先于参数解析**：不传的话连 `Unknown option` 都报不出来（坑 P-29）。
 */
import path from 'node:path';
import os from 'node:os';
import { existsSync, promises as fs } from 'node:fs';
import { isZcodeScript, reviewEntry, standalonePackage } from '../../../extension/src/launch/zcodeInstallation.js';
import { agentConfigOf } from '../config.js';
export { isZcodeScript, reviewEntry, type ZcodeSearch } from '../../../extension/src/launch/zcodeInstallation.js';
import type { CriticRequest, CriticResult, ModelUnenforcedCause } from '../types.js';
import { runReviewProcess, type StdoutTarget } from '../live-stdout.js';
import { ensureDir, exists, sha256File, tildeHome, tryRemoveTempDir } from '../util/fsx.js';
import { IS_WIN } from '../util/platform.js';
import {
  parseZcodeEnvelope,
  parseZcodeRollout,
  parseZcodeTrace,
  summarizeZcodeMcp,
  ZCODE_MCP_EXEC_PREFIXES,
  type ZcodeEnvelope,
  type ZcodeRolloutToolCall,
} from './zcode-trace.js';
import {
  EFFORT_NO_CONCEPT,
  failedResult,
  resolveTier,
  TOOL_TRACE_CAPABILITY,
  type AdapterContext,
  type CarrierScrub,
  type CriticAdapter,
} from './base.js';
import { scanAndRemoveSecrets } from '../scrub.js';
// CLI 原话进探活详情 / 失败原因之前过一遍脱敏（r5 CODEX-06）
import { redactSecrets } from '../secrets.js';

/**
 * 把 profile 里的人类可读短名补全为 `<providerId>/<modelName>` 全限定形态。
 *
 * 为什么需要（坑 P-06 / 冲突项 C-02）：配置里写 `GLM-5.3` 更易读，但 ZCode 实测
 * 传裸模型名会落到错误 provider 并报 "Model provider is missing an API key"。
 * providerId 从探针回读的 `model_id_form` 取——不硬编码，因为它随用户的 provider 配置而变。
 *
 * **只用于 preflight 的目录比对**（`normalizeModelForCatalog`），**不再用于写副本**：
 * `model_id_form` 是 doctor 探针回读的生效模型——EV-194 之前探针走真实 HOME，记的是个人配置的默认
 * （`<providerUUID>/qwen3.8-max` 一类），与副本源 `cli/config.json` 的 provider 键**异源**；EV-194 起探针走副本，
 * 副本支下前缀取自副本源的 provider 键，退路支（档位未给模型）下仍是个人缺省。不能拿它的形态判来源；副本里的限定
 * 改由 `qualifyAgainstCliConfig` 按副本源自己的键做（计划双审 r3 CODEX-03）。目录比对仍用本函数
 * 是另一条口径问题：目录来自 `cli/config.json` 键形态而前缀来自回读形态，登记 EV-93。
 */
export function qualifyZcodeModel(model: string | null, modelIdForm: string | null): string | null {
  if (!model) return null;
  if (model.includes('/')) return model; // 已是全限定形态
  if (!modelIdForm || !modelIdForm.includes('/')) return model; // 探针没给出前缀，只能原样传
  const providerId = modelIdForm.slice(0, modelIdForm.lastIndexOf('/'));
  return `${providerId}/${model}`;
}

/**
 * 取模型 slug 的 `modelId` 段——生效模型比对的**判据面**（计划双审 CODEX-02）。
 *
 * 为什么比对不能用整串相等：P-31 亲记 `bigmodel-coding-plan/…` 与 `<providerUUID>/…`
 * **两种模型 id 形态并存**，而回读值取自日志的 `context.model`，形态由 CLI 决定，
 * 编排器无法保证它与写进副本的拼接形态同形。拿整串判等式，覆盖真生效了也会判 false，
 * 而本轮新增告警买的正是「响亮」——假阴性会当场把这条通道打成噪声。
 * 所以 `providerId` 段的差异只记 note，不参与判据。
 */
export function zcodeModelTail(model: string): string {
  // 切**第一个** `/`，与包内 `okt` 同规则（代码双审 r3 CODEX-03）：provider 段不含 `/`，model 段可含
  const cut = model.indexOf('/');
  return (cut < 0 ? model : model.slice(cut + 1)).trim();
}

/** `decideModelOverride` 的结论：产出什么值（`undefined` = 不产出该字段）与一条人读 note */
export interface ZcodeOverrideVerdict {
  applied: boolean | undefined;
  note: string | null;
}

/**
 * 模型覆盖**是否真的落实**（EV-82 的回归守卫）。
 *
 * EV-82 之所以要三轮双审才被逮到，正是因为它静默：探活能过、审查跑得起来、结论也产出了，
 * 只是跑的不是请求的那个模型。ZCode 下一次挪读取点时，没有这道比对就会原样复发。
 *
 * **抽成纯函数而不是内联在 `run()` 里**：内联的话它只能靠拉起真实 CLI 才测得到，
 * 于是三种分支实际上一条都不会被覆盖——而这正是本轮要装的那道守卫本身。
 *
 * 三种返回、四种落盘取值：
 *   - `applied: undefined` 且 note 为空——本次没有覆盖尝试（没写成副本，或没请求模型）。调用方**不产出字段**。
 *   - `applied: undefined` 且 note 说明「未回读到」——尝试了覆盖但没回读到生效模型；调用方据「尝试过」落成 `null`。
 *   - `true` / `false` ——比对过，一致 / 不一致。
 *
 * **判据只看 `modelId` 段**：P-31 记着 `bigmodel-coding-plan/…` 与 `<providerUUID>/…`
 * 两种形态并存，而回读值取自日志的 `context.model`、形态由 CLI 决定。
 * 拿整串判等式会把已生效的覆盖误报成未生效，而误报会当场把这条新通道打成噪声
 * （计划双审 CODEX-02）。`providerId` 段的差异只记 note。
 */
export function decideModelOverride(
  attempted: boolean,
  requested: string | null,
  effective: string | null,
): ZcodeOverrideVerdict {
  if (!attempted || !requested) return { applied: undefined, note: null };
  if (!effective) {
    return { applied: undefined, note: '未回读到生效模型，无法判定模型覆盖是否落实' };
  }
  const applied = zcodeModelTail(effective) === zcodeModelTail(requested);
  if (!applied) return { applied: false, note: null };

  const providerOf = (m: string): string => {
    const cut = m.lastIndexOf('/');
    return cut < 0 ? '' : m.slice(0, cut);
  };
  const want = providerOf(requested);
  const got = providerOf(effective);
  return {
    applied: true,
    note:
      want === got
        ? null
        : `模型一致但 providerId 形态不同（请求 ${want || '（无前缀）'}、回读 ${got || '（无前缀）'}）` +
          '——P-31 记载两种形态并存，不判为未生效',
  };
}

/**
 * 没做模型覆盖、而实际模型与请求不同（EV-122）。与 `decideModelOverride` 并列且**产出条件互斥**：
 * 那边要求 `attempted`，这边要求 `!attempted`。
 *
 * EV-112 E2 的实遇：副本源不在，审查运行不做覆盖，glm 侧跑在个人配置默认的 qwen 上；
 * `model_override_applied` 因「没尝试」而缺席，守卫一句没说。本函数补的就是这一格。
 *
 * 四条同时成立才产出：没做覆盖、请求非空、回读到了生效模型、modelId 段（`zcodeModelTail`）不同。
 * 判据面与 `decideModelOverride` 相同：`providerId` 段两种形态并存（P-31），整串比会误报。
 * 限定失败时副本回落的模型恰与请求同 modelId 段 ⇒ 不产出：此时跑的就是请求的模型。
 *
 * `requested` 要传**请求原值**（`req.model`），不是 `home.qualified`——后者在没做覆盖的两支恒为 null
 * （计划双审 CODEX-03 ≡ AGY-01）；原值也与 run.json 的 `model_requested` 同源，守卫文案对得上。
 * `cause` 为 `no_model` 或 null 时不产出：前者请求必为空，后者就是做了覆盖。
 */
export function decideModelUnenforced(
  attempted: boolean,
  requested: string | null,
  effective: string | null,
  cause: ZcodeHomePrep['cause'],
  reason: string | undefined,
): CriticResult['model_unenforced'] {
  if (attempted || !requested || !effective) return undefined;
  if (cause !== 'source_missing' && cause !== 'qualify_failed') return undefined;
  if (zcodeModelTail(effective) === zcodeModelTail(requested)) return undefined;
  return { requested, effective, cause, reason: reason ?? '' };
}

/** 完整只读 denylist。`Bash` 必须在列——`--mode plan` 挡不住命令执行（M0 实测） */
/** 写类工具 + shell + 出网：审查员不该把被审代码发到外部端点 */
export const ZCODE_READONLY_DENYLIST = 'Write,Edit,MultiEdit,ApplyPatch,NotebookEdit,Bash,WebFetch,WebSearch';

/**
 * 0.16.9 起 CLI 定位 provider 配置的两个环境变量（坑 P-28）。
 *
 * 两条路径都是**绝对路径**，不随 `HOME` 走：`config_copy` 档把 `HOME` 指到运行目录下的
 * 副本时，副本里没有 `.zcode/v2/`，所以个人配置必须显式给真实用户目录下那份。
 */
export const ZCODE_BUILTIN_PROVIDER_ENV = 'ZCODE_BUILTIN_PROVIDER_CONFIG_FILE';
export const ZCODE_PERSONAL_PROVIDER_ENV = 'ZCODE_PERSONAL_PROVIDER_CONFIG_FILE';

/**
 * CLI 没定位到内置 provider 配置时的 stderr 形态（0.16.9 实测原文：
 * 「无法定位 CLI ZCode Built-in Provider Config：<候选1>, <候选2>」）。
 * 只认英文片段——中文前缀随 CLI 语言设置变，英文名词是配置项本身的名字。
 */
export const ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE = /Built-in Provider Config/;

/**
 * 「参数解析**已经发生过**」的正向证据（r4 CODEX-01）。
 *
 * 全是**模型/凭据层**的停点：CLI 只有先吃完 argv 才会走到建模型、读凭据这一步，
 * 所以它们出现即证明参数解析已过。旗标探针拿它当「接受」的判据——
 * 原先的判据是否定式（没报 `Unknown option` 就算接受），把「没有证据证明被拒」
 * 当成了「有证据证明被接受」：`run()` 在 spawn 失败时 `code` 为 `null`、stderr 拼
 * `[spawn error]`，既不命中定位失败也不命中 `Unknown`，七个候选会**全部**记成接受——
 * 与 P-29 同一类结论文件污染，只是换了成因。
 *
 * 这条列表**必然是不完备的**（停点文案随版本变），所以判据的设计是：命不中就记
 * `indeterminate`、保留旧结论并告警，而不是回落成接受。漏判的代价是有人去看一眼，
 * 误放的代价是一份看起来正常的失真结论。
 *
 * `Select a model`（0.17.0，2026-10-29 Windows 真机验收 four-agent-win-20261029-211334 实测补入）：
 * 0.17.0 把「无凭据停点」从 `Model creation failed` 换成了模型选择前置——只给内置 provider、
 * 空 HOME 时停在 `Error: Select a model before sending a message`（退 1）。实测该停点仍在参数解析
 * **之后**：同环境加 `--bogus-flag` 照报 `Unknown option`、合法旗标组合才走到这条报错——
 * 与 P-29 的「provider 定位先于参数解析」不同族，属本列表要的「参数已吃完」证据。
 * 不补它时 0.17.0 上三个候选全部 `indeterminate`、`readonly_flags` 判不出，glm 侧被 fail-closed 拒入。
 */
export const ZCODE_ARGV_PARSED_RE =
  /Model creation failed|Model config is missing|provider is missing an API key|provider_not_configured|Provider authentication failed|Select a model/i;

/**
 * 内置 provider 配置定位不到时的说法，**四处同源**（r2 AGY-04 立常量，r3 AGY-03 补齐第四处）：
 * 适配器探活详情、`availability()` 的不可用原因、`critic.run()` 的失败提示、`doctor` 的布局 blocker。
 * 文案分头写过一次，于是 `run()` 落到 `stderr.slice()` 而探活给的是根因——同一现象两种说法。
 * 加消费点时记得回来改这个数字：它是本注释唯一会过期的部分。
 *
 * **适用版本前提（r5 CODEX-01）**：这段话背后的判据——「内置文件缺失 ⇒ 独立拉起必失败」——
 * 以 **0.16.9** 实测为据。0.16.5 没有这个问题（M0 报告 P-28；本仓最近一次 glm 成功留痕
 * `run-20260919T154710Z` 记的正是 0.16.5），未来某版若改回自己能定位、或把这份文件挪走，
 * 判据同样会失效并**误拦**。注入路径本身（`zcodeProviderEnv`）是版本中立的，误拦只发生在
 * `availability()` 与 doctor 的那两支。按版本门控要引入版本比较与「`version` 为 null 时怎么办」
 * 这条新语义，登记 BACKLOG **EV-85**，触发条件：下一次改动布局支，或 ZCode 跨版本升级。
 */
export const ZCODE_PROVIDER_CONFIG_UNRESOLVED_HINT =
  'CLI 未定位到所选安装的内置 provider 配置（P-28）。请核对独立包的 agent/provider/zcode-builtin.json 或桌面包的 config/provider/zcode-builtin.json。';

/**
 * ZCode headless 未跑通时的说法，`availability()` 与 `doctor` 同源（r2 AGY-04）。
 * 分头写的版本里 doctor 已补上「布局 ≠ 凭据」那句而 `availability()` 没有，
 * 于是 preflight 挡住人的那一刻给的仍是旧说法。
 */
export const ZCODE_HEADLESS_NOT_OK_HINT =
  'ZCode headless 未跑通。注意：CLI 的模型 provider 配置独立于桌面端，' +
  '「已登录」不等于「可用」——请确认 ~/.zcode/cli/config.json 存在；' +
  '若 doctor notes 里 provider_config 的内置文件为「未找到」，是 ZCode 安装布局问题（P-28），不是凭据问题。';

/**
 * 按入口派生两份 provider 配置的路径。
 *
 * 内置：`<entry 真实目录>/../config/provider/zcode-builtin.json`——应用包布局下
 * `Resources/glm/zcode.cjs` 与 `Resources/config/provider/…` 是兄弟目录，桌面端
 * （`app.asar` 内 `DC()`）取的正是 `resourcesPath/config/provider/…`。
 * 个人：`<用户目录>/.zcode/v2/provider_config.json`（0600，含凭据，**不要读内容**）。
 *
 * **入口先 `resolve` 再 `realpath`**（r2 CODEX-04 ≡ AGY-03）：`dirname` 不解软链，
 * 配置里给相对入口会落到 cwd、给 `/usr/local/bin/zcode.cjs` 这类软链会落到软链所在目录，
 * 两种形态派生出的兄弟目录都不是真实安装布局里的那个。CLI 自己按**真实**入口文件推算，
 * 这里必须跟它同一口径。入口不存在时（探针未找到 / 布局已变）回落到词法路径，
 * 交给下游的存在性门控判——软链断了不该在这里抛。
 */
export async function zcodeProviderConfigPaths(
  entry: string,
  userHome: string = os.homedir(),
): Promise<{ builtin: string; personal: string }> {
  const abs = path.resolve(entry);
  let real = abs;
  try {
    real = await fs.realpath(abs);
  } catch {
    real = abs;
  }
  return {
    builtin: builtinForEntry(real),
    personal: path.join(userHome, '.zcode/v2/provider_config.json'),
  };
}

function builtinForEntry(real: string): string {
  const pkg = existsSync(real) ? standalonePackage(real) : undefined;
  if (pkg) return path.join(pkg.root, 'agent/provider/zcode-builtin.json');
  return path.resolve(path.dirname(real), '../config/provider/zcode-builtin.json');
}

/** 在预检和 worker 入口处复核，避免同版本的另一份安装沿用旧结论。 */
function entryProblem(cfg: AdapterContext['cfg']): string | undefined {
  const probe = cfg.probe.cli.zcode;
  try {
    const selected = reviewEntry(agentConfigOf(cfg, 'glm', 'zcode').entry);
    if (!probe?.entrypoint) return '探针未找到 ZCode 入口。当前选择 ' + (selected ?? '未找到') + '，请运行 trivium doctor --only zcode。';
    if (!selected || selected !== probe.entrypoint) {
      return '当前 ZCode 审核入口 ' + (selected ?? '未找到') + '，探针记录 ' + (probe?.entrypoint ?? '无') + '。请运行 trivium doctor --only zcode。';
    }
    const measured = probe.provider_config?.builtin_file;
    if (measured && (builtinForEntry(selected) !== measured || !existsSync(measured))) {
      return 'ZCode 入口 ' + selected + ' 的内置 provider 布局已变化，请运行 trivium doctor --only zcode。';
    }
  } catch (e) { return (e as Error).message; }
}

/** JS 脚本由配置的 Node 解释，原生程序及 shell 启动器自行处理参数。 */
export function zcodeInvocation(node: string, [entry, ...args]: [string, ...string[]]): [string, string[]] {
  return isZcodeScript(entry) ? [node, [entry, ...args]] : [entry, args];
}

/**
 * 存在性门控后的 env 片段：**文件在才注入**，不在就显式置 `undefined`，让 `run()` 把宿主
 * 环境里同名的变量**删掉**，CLI 走自己的默认逻辑并把原话报出来
 * （`failureKind: 'provider_config_unresolved'`）。
 * 指向不存在的文件不会让 CLI 更早失败（实测退成「Model creation failed」），但会把
 * 「文件丢了」伪装成「模型建不出来」——所以宁可不给。
 *
 * **两个键恒定出现、缺的那个值为 `undefined`**（r2 CODEX-01 ≡ AGY-02）：`run()` 以
 * `{...process.env}` 为底再覆盖，只追加不清除的话，宿主环境里预置的
 * `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 会原样透传进空 HOME 的旗标探针——那是七次真实模型调用。
 * 「没主动注入」与「子进程拿不到」是两件事，判据只能是后者。
 *
 * 只判有无、不读内容（个人配置含凭据）。
 *
 * ## `omitPersonal`：副本 HOME 下**不注入**个人那份（EV-82 的修法本体）
 *
 * 0.16.9 的模型选择链（包内 `fpe.#m` / `#f`）：个人 provider 配置文件**存在就直接用**，
 * **不存在才 legacy 导入** `<HOME>/.zcode/cli/config.json` 并把 `model.main` 转成默认模型选择
 * （`Mqa`），再把迁移结果写成 `<HOME>/.zcode/v2/provider_config.json`。
 * 于是审查运行的模型覆盖只有一条路：副本 HOME 下**别让 CLI 看见任何个人文件**——
 * EV-81 注入了指向用户真实文件的变量，个人文件「存在」，导入被跳过，副本里的 `model.main`
 * 没人读，这就是 EV-82 静默失效两天的全部根因。
 * `omitPersonal` 为真时个人键恒 `undefined`（与旗标探针同一形态）；否则按真实用户目录派生
 * ——探活与探针的 headless 臂走后者，它们不做覆盖、在真实 HOME 下跑。
 *
 * ## `ZCODE_*` 目录 / 路径键与落点开关键恒清（计划双审 r3 CODEX-02；EV-110 加 `ZCODE_LOG_DIR`；EV-112 扩到十一键）
 *
 * 包内 `FZi(prepareCliProviderRuntimeEnv)` 在 `--prompt` 形态下按
 * `dataBaseDir ?? env.ZCODE_DATA_BASE_DIR ?? os.homedir()` 推导个人路径并写回 `process.env`，
 * 凭据根（`gUs`）与遥测状态也读它。宿主预置该变量 → 个人文件在**副本之外**「存在」→ 导入被跳过
 * ——本轮根因换个入口复发，且 CLI 自写的凭据文件落到清扫论域**之外**。
 * C-08「这三个变量对配置解析无效」是 0.16.5 对 `cli/config.json` 的结论，对 0.16.9 的 provider
 * 配置根**不成立**。判据仍是「子进程拿不到」而不是「编排器没主动给」，故目录 / 路径键（`ZCODE_DIR_ENV_KEYS`）与
 * 落点开关键（`ZCODE_LANDING_SWITCH_ENV_KEYS`）恒置 `undefined`。子进程的落点只由 `HOME` 或编排器显式指定的落点决定
 * （后者见 `invokeZcode` 的 `storageRedirectRoot`，EV-112）。
 *
 * ## 为什么门控是**逐键**而不是「两份都在才注入」
 *
 * 包内 `resolveNodeProviderRuntimePaths` 的字面是「只给一个就抛错」，据此把门控改成成对
 * 看起来天经地义。**计划双审 r1 CODEX-01 ≡ AGY-01 打掉了这条**，r3 又补出了机理：
 *
 * 1. **`FZi` 先于那条抛错运行，会为缺失的键合成派生路径**——所以 headless `--prompt` 路径上
 *    成对抛错永远撞不到；P-30 实测「只给内置那份」停在 `Model creation failed` 且参数解析已完成，
 *    正是这个机理的表现（EV-88 据此关闭）。
 * 2. **耦合面**：`probes/zcode.ts` 的旗标探针正是从本函数取内置路径、把个人那份显式置
 *    `undefined`（零配额前提，P-30）。改成成对门控，个人配置缺失的机器上内置也不会注入，
 *    CLI 自推算 → 撞 P-28 → 七个候选全记 `indeterminate`，旗标结论首轮判不成。
 */
export async function zcodeProviderEnv(
  entry: string,
  userHome: string = os.homedir(),
  opts: { omitPersonal?: boolean } = {},
): Promise<Record<string, string | undefined>> {
  const p = await zcodeProviderConfigPaths(entry, userHome);
  const env: Record<string, string | undefined> = {
    [ZCODE_BUILTIN_PROVIDER_ENV]: undefined,
    [ZCODE_PERSONAL_PROVIDER_ENV]: undefined,
    ...Object.fromEntries([...ZCODE_DIR_ENV_KEYS, ...ZCODE_LANDING_SWITCH_ENV_KEYS].map((k) => [k, undefined])),
  };
  if (await exists(p.builtin)) env[ZCODE_BUILTIN_PROVIDER_ENV] = p.builtin;
  if (!opts.omitPersonal && (await exists(p.personal))) env[ZCODE_PERSONAL_PROVIDER_ENV] = p.personal;
  return env;
}

/**
 * 0.16.9 里决定 provider 配置根 / 凭据根 / 存储根 / 日志目录 / 会话库 / mailbox 落点的**目录与路径键**。
 * 拉起时一律从子进程环境里删掉，宿主值进不了子进程——那才是副本隔离与清扫论域的边界（r3 CODEX-02）。
 * 审查运行在清完之后再**设**其中三个（`zcodeStorageRedirectEnv`，EV-112），落点由编排器指定。
 *
 * - `ZCODE_DATA_BASE_DIR` / `ZCODE_HOME` / `ZCODE_STORAGE_DIR`：计划双审 r3 CODEX-02；
 * - `ZCODE_LOG_DIR`（EV-110，EV-82 第三段 r3 §5）：CLI 的日志目录取 `logDir ?? ZCODE_LOG_DIR ?? <HOME>/.zcode/cli/log`，
 *   宿主预置它时日志（可能含送审包全文）落到清扫面之外，`modelFromLog` 也读不到；
 * - `ZCODE_SESSION_DB_PATH` / `ZCODE_SESSION_DB`（EV-112 计划 r3 §4.3）：包内 `aun` 按**后缀**把两者都映射到
 *   `storage.sessionDbPath`，包里没有完整字面，按字面 grep 找不到——EV-110 就是这样漏的。两个别名后出现的赢，
 *   而子进程环境的键序由宿主决定，清掉别名后编排器设的那个才唯一；
 * - `ZCODE_MAILBOX_ROOT`（EV-112）：mailbox 根目录，按 HOME 展开、不随存储根。
 */
export const ZCODE_DIR_ENV_KEYS: readonly string[] = [
  'ZCODE_DATA_BASE_DIR', 'ZCODE_HOME', 'ZCODE_STORAGE_DIR', 'ZCODE_LOG_DIR',
  'ZCODE_SESSION_DB_PATH', 'ZCODE_SESSION_DB', 'ZCODE_MAILBOX_ROOT',
];

/**
 * 会在 CLI 启动期**改写落点**的开关键（EV-112 计划 r3 §4.3）。与目录 / 路径键不同，它们只能清、不能设。
 * 方向都是 fail-safe；各键的副作用：
 * - `ZCODE_RUNTIME_ENV`：`development` 把 rollout 目录换成 `cli/debug`（回读与脱敏都不认），`test` 让 rollout 不写。
 *   清掉后按入口路径推断，`.cjs` 入口得 `production`；
 * - `ZCODE_BETA` / `ZCODE_ENV`：存储根为空时把它改写到 `~/.zcode-beta`。审查运行设了存储根、不受影响；探针路径靠清。
 *   `ZCODE_ENV` 另被读作测试控制面端点选择与遥测环境名，清掉即走生产控制面。
 *   **清键挡不住 argv 触发**：任一 argv 元素含 `/zcode-beta` 路径段同样会改写（计划 r3 §8 R7）；
 * - `ZCODE_MESSAGE_ENABLED`：开 mailbox。审查员用不到会话间消息，子进程里恒关。
 */
export const ZCODE_LANDING_SWITCH_ENV_KEYS: readonly string[] = ['ZCODE_RUNTIME_ENV', 'ZCODE_BETA', 'ZCODE_ENV', 'ZCODE_MESSAGE_ENABLED'];

/**
 * 包内 `RMi` 的 argv 触发判据，逐字照抄（0.16.9，EV-112 计划 r3 §8 R7）：存储根为空时，任一 argv 元素匹配它，
 * CLI 就把存储根改写到 `~/.zcode-beta`。清环境键挡不住；审查运行设了存储根、早退不受影响；探针路径会被改写。
 * 形态是「`zcode-beta` 恰为一段的末尾，或其后紧跟 `.`」：`…/zcode-beta`、`…/zcode-beta.app` 命中，`…/zcode-beta/…` 不命中。
 */
export const ZCODE_BETA_ARGV_RE = /(^|[/\\])zcode-beta(?:$|\.)/u;

/**
 * 审查运行要**设**的三个落点键（EV-112 计划 r3 §4.1）：日志目录、存储根、会话库路径，全部指到 `root` 下
 * 与「`HOME=<root>` 时 CLI 的缺省值」逐字相同的布局——副本支设了等于没改，无副本支因此与副本支同形、落进清扫面。
 *
 * **入参是与 HOME 同层的根**（`zcodeHomeUnder(sideDir)`，即 `<sideDir>/home`），不是 `.zcode`；函数内部才拼 `.zcode`。
 * 传入 basename 为 `.zcode` 的路径会得到 `.zcode/.zcode` 嵌套且不报错，所以直接抛（`resolve` 顺带去掉尾部分隔符）。
 *
 * 生效机制不对称：`ZCODE_STORAGE_DIR` / `ZCODE_SESSION_DB_PATH` 经包内 `aun` 进配置层的 Env 层（优先级 40），
 * `ZCODE_LOG_DIR` 由日志工厂直读、不进配置层。两条路径能各自漂移，落点自检因此两项分开核（`run()`）。
 */
export function zcodeStorageRedirectEnv(root: string): Record<string, string> {
  if (path.basename(path.resolve(root)) === '.zcode') {
    throw new Error(`zcodeStorageRedirectEnv 的入参应是与 HOME 同层的根，不是 .zcode 目录本身：${root}`);
  }
  const zdir = path.join(root, '.zcode');
  return {
    ZCODE_STORAGE_DIR: zdir,
    ZCODE_SESSION_DB_PATH: path.join(zdir, 'cli', 'db', 'db.sqlite'),
    ZCODE_LOG_DIR: path.join(zdir, 'cli', 'log'),
  };
}

/**
 * 宿主环境里可能带着的凭据/端点变量。**只在探针路径清**（代码双审 r1 codex 子项 03 ≡ AGY-02）：
 * 探针副本里的 apiKey 是哨兵，前提是 CLI 拿不到别的凭据通道；而审查运行继承宿主凭据 env 是应有之义。
 * `ZCODE_API_KEY` 在 0.16.9 包内已零命中（M0 §6.2 是 0.16.5 快照），`ZCODE_BASE_URL` 仍在——一并清是 fail-closed，不是断言它们生效。
 */
export const ZCODE_CREDENTIAL_ENV_KEYS: readonly string[] = ['ZCODE_API_KEY', 'ZCODE_BASE_URL'];

export function zcodeVersionEnv(): Record<string, undefined> {
  return Object.fromEntries([ZCODE_BUILTIN_PROVIDER_ENV, ZCODE_PERSONAL_PROVIDER_ENV,
    ...ZCODE_DIR_ENV_KEYS, ...ZCODE_LANDING_SWITCH_ENV_KEYS, ...ZCODE_CREDENTIAL_ENV_KEYS].map(k => [k, undefined]));
}

export interface ZcodeInvokeOptions {
  stdoutTarget?: StdoutTarget;
  entry: string;
  node: string;
  cwd: string;
  prompt: string;
  /** 探针实测被接受的只读参数（argv 形态） */
  readonlyArgs: string[];
  /** 独立 HOME：模型覆盖与配置隔离的唯一落点 */
  homeDir?: string | null;
  /**
   * 派生**个人** provider 配置路径时用的用户目录，默认 `os.homedir()`。
   *
   * 与 `homeDir` 不是一回事：那个是递给子进程的 `HOME`（副本），这个是编排器在**本机**
   * 找个人配置时用的真实用户目录，两条 provider 路径都是绝对路径、不随副本 `HOME` 走。
   *
   * 存在的理由是可测性（r3 CODEX-F01-02）：不开这个口子，用例只能吃真实 `os.homedir()`——
   * 而开发机上 `~/.zcode/v2/provider_config.json` 真实存在，于是「个人那份不在」的用例摆不出来，
   * 「两个键都被删」的断言在个人这一半是**假阴性**（它拿到的恰是真实路径）。
   */
  userHome?: string;
  /**
   * 副本 HOME 下**不注入**个人 provider 配置（EV-82）。为真时 CLI 在副本 HOME 里找不到个人文件，
   * 走 legacy 导入读 `cli/config.json` 副本的 `model.main`——这是模型覆盖生效的唯一前提。
   * 与 `zcodeProviderEnv` 的 `omitPersonal` 同构（计划双审 r3 AGY-r2-02：布尔开关，不用 null 当魔法值）。
   */
  omitPersonalProviderConfig?: boolean;
  /**
   * CLI 产物的落点根（EV-112）：给了就在清除面之后**设** `zcodeStorageRedirectEnv(storageRedirectRoot)` 的三个键。
   * 入参是与 HOME 同层的根（`zcodeHomeUnder(sideDir)`），不是 `.zcode`。
   * 审查运行传（副本 / 无副本两支都传）；认证探活自 EV-136 起、doctor 的 headless 与 path_deny 自 EV-194 起
   * 同样两支都传（它们要探的是审查运行那条路径，产物落进各自的临时目录、随之删除）；旗标探针与模型覆盖探针臂不传
   * ——它们各自在 mkdtemp 的 HOME 下拉起。
   */
  storageRedirectRoot?: string | null;
  timeoutMs: number;
}

export interface ZcodeInvokeOutcome {
  envelope: ZcodeEnvelope | null;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  commandLine: string;
  spawned?: boolean;
  durationMs: number;
  failureKind: 'none' | 'model_config_missing' | 'provider_not_configured' | 'provider_config_unresolved' | 'other';
}

/** zcode 的 argv 拼装。纯函数，与执行分离，让 M0 调用配方有回归测试 */
export function buildZcodeArgs(opts: Pick<ZcodeInvokeOptions, 'entry' | 'prompt' | 'cwd' | 'readonlyArgs'>): [string, ...string[]] {
  return [
    opts.entry,
    '--prompt', opts.prompt,
    '--cwd', opts.cwd,
    '--json', '--no-color',
    ...opts.readonlyArgs,
  ];
}

/**
 * 从探针结论构造只读参数：只传探针实测**被接受**的旗标，且 denylist 一律用完整清单
 * （探针试的是精简版，适配层要的是含 NotebookEdit / WebFetch 的全集）。
 */
export function readonlyArgsFromProbe(readonlyFlags: readonly string[]): string[] {
  const out: string[] = [];
  if (readonlyFlags.some((f) => f.startsWith('--mode plan'))) out.push('--mode', 'plan');
  if (readonlyFlags.some((f) => f.startsWith('--disallowed-tools'))) out.push('--disallowed-tools', ZCODE_READONLY_DENYLIST);
  return out;
}

/**
 * 一组只读参数里，`Bash` 是否仍被禁用。
 *
 * `command_texts` 在本侧恒记空数组，前提就是这一条——该侧跑不了命令。
 * 前提一旦不成立而这里没跟着改，措施 b（§10.1）会在本侧**静默失效**：
 * 命令照跑、扫描面却是空的。所以把它做成断言而不是注释（审查意见 GLM-05）。
 *
 * **要喂给它的是 `readonlyArgsFromProbe` 的返回值**（实际递给 CLI 的 argv），
 * 不是 `probe.readonly_flags`（探针候选串的接受记录）。两者是独立的源，
 * 拿后者当判据，`ZCODE_READONLY_DENYLIST` 的漂移就无人可察（r5 GLM-05）。
 *
 * 判据看 denylist 里有没有 `Bash` 这个**词**，而不是 `includes('Bash')` 子串——
 * 后者会被 `BashOutput` 之类的兄弟工具名蒙混过去。
 */
export function bashStillDenied(readonlyFlags: readonly string[]): boolean {
  // `=` 在前置集里：`--disallowed-tools=Bash` 是标准长参数写法，实测**认不出**（AGY-04）。
  // `=Write,Bash` 因逗号边界侥幸认得出——这种侥幸比全错更危险，它让缺陷在一半样本上隐形。
  return readonlyFlags.some((f) => /(^|[\s,"'=])Bash([\s,"']|$)/.test(f));
}

/** 子进程家目录隔离补丁：Windows 上 `os.homedir()` 认 `USERPROFILE` / `HOMEDRIVE+HOMEPATH`，只改 `HOME` 隔离不住（设计 §7.1） */
export function zcodeHomeEnv(homeDir: string): Record<string, string | undefined> {
  return IS_WIN
    ? { HOME: homeDir, USERPROFILE: homeDir, HOMEDRIVE: undefined, HOMEPATH: undefined }
    : { HOME: homeDir };
}

/** **唯一**执行 zcode 的地方 */
export async function invokeZcode(opts: ZcodeInvokeOptions): Promise<ZcodeInvokeOutcome> {
  const args = buildZcodeArgs(opts);

  // provider 配置路径先于 HOME 算：内置那份按真实安装布局取（绝对路径，不受副本 HOME 影响）；
  // 个人那份在副本 HOME 下**省略**（EV-82：让 CLI 走 legacy 导入），否则按真实用户目录取。
  const env: Record<string, string | undefined> = {
    ...(await zcodeProviderEnv(opts.entry, opts.userHome ?? os.homedir(), {
      omitPersonal: opts.omitPersonalProviderConfig === true,
    })),
  };
  // 先清后设（EV-112 计划 r3 §4.4）：上面已把全部目录 / 路径键与开关键清成 undefined，这里再覆盖三个落点键。
  // 顺序反过来，编排器的值会被清掉、子进程退回 HOME 缺省（变异 M2）
  if (opts.storageRedirectRoot) Object.assign(env, zcodeStorageRedirectEnv(opts.storageRedirectRoot));
  if (opts.homeDir) {
    Object.assign(env, zcodeHomeEnv(opts.homeDir));
  }

  const r = await runReviewProcess(opts.stdoutTarget, ...zcodeInvocation(opts.node, args), { cwd: opts.cwd, env, timeoutMs: opts.timeoutMs, killTree: true });

  /*
   * 「无法定位 Built-in Provider Config」是**布局/环境**问题而非模型问题：它要先于
   * `model_config_missing` 判，否则 preflight 给出的提示会把人引去查凭据与模型配置，根因隐形。
   *
   * 但判定放在**退出码门控之内**（r2 AGY-01）：该形态实测退 1（stdout 为空、stderr 一行），
   * 而这个正则是裸名词匹配——CLI 正常退 0 时 stderr 若出现同一名词（诊断行、告警行），
   * 一次成功的调用会被判成布局失败。退出码是免费的第一道闸，先过它再谈形态。
   */
  let failureKind: ZcodeInvokeOutcome['failureKind'] = 'none';
  if (r.code !== 0) {
    if (ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE.test(r.stderr)) failureKind = 'provider_config_unresolved';
    else if (/Model config is missing/i.test(r.stderr)) failureKind = 'model_config_missing';
    else if (/provider is missing an API key|provider_not_configured|Provider authentication failed/i.test(r.stderr))
      failureKind = 'provider_not_configured';
    else failureKind = 'other';
  }

  return {
    envelope: parseZcodeEnvelope(r.stdout),
    exitCode: r.code,
    timedOut: r.timedOut,
    stdout: r.stdout,
    stderr: r.stderr,
    commandLine: r.commandLine,
    spawned: r.spawned,
    durationMs: r.durationMs,
    failureKind,
  };
}

/** 副本 HOME 在该侧运行目录下的位置——准备（`prepareZcodeHome`）与抹除（`scrubZcodeHome`）共用同一个拼法 */
export const zcodeHomeUnder = (runDir: string): string => path.join(runDir, 'home');
const ZCODE_CLI_SUBDIR = '.zcode/cli';
/** 0.16.9 的个人 provider 配置所在目录（模型选择的读取点） */
const ZCODE_V2_SUBDIR = '.zcode/v2';

/**
 * 副本里**已知含凭据**的载体，按名整删（相对副本 HOME）。
 *
 * 三份的来历各不相同，删除理由却是同一条——跑后没有任何代码回读它们，
 * 而「脱敏保留骨架」要维护一份「哪些键是凭据」的黑名单，漏一个键就是静默残留：
 *   - `cli/config.json`：`prepareZcodeHome` 从宿主机整份抄来的，provider 段的 apiKey 原样在里面；
 *   - `v2/provider_config.json`：**编排器不写它，CLI 写**——副本 HOME 下没有个人文件时，CLI 从
 *     `cli/config.json` 副本 legacy 导入并把迁移结果写在这里，apiKey 随导入带过去（EV-82，r3 CODEX-05）；
 *   - `v2/credentials.json`：**编排器不写它，CLI 可能写**——凭据存储路径由 `homedir()` 派生
 *     （0.16.9 包内字面），副本 HOME 下正好落在这里。它本就该在这张清单上：本模块自己定的口径是
 *     「已知含凭据的载体按名整删，形态未知的过扫描器」，而扫描器认的是凭据**形态**，
 *     形态一变就漏（计划双审 AGY-05）。
 *
 * 不在就跳过——`fs.rm({force:true})` 对不存在是静默成功，列一份可能不存在的路径零成本。
 */
const ZCODE_CREDENTIAL_CARRIERS: readonly string[] = [
  `${ZCODE_CLI_SUBDIR}/config.json`,
  `${ZCODE_V2_SUBDIR}/provider_config.json`,
  `${ZCODE_V2_SUBDIR}/credentials.json`,
];

/**
 * 抹掉副本里的凭据（BACKLOG EV-20；计划双审三侧同时逮到的阻断——原稿以为只有 codex 有副本）。
 *
 * 载体见 `ZCODE_CREDENTIAL_CARRIERS`（三份，EV-82 起由一份增到三份），整份删。
 * `home/` 下其余文件过扫描器，命中即删。
 *
 * **删得安全的前提是「跑后没有任何代码回读它们」**，逐条核过：轨迹回读只碰
 * `cli/log/*.jsonl` 与 `cli/rollout/model-io-*.jsonl`（且 rollout 另拷一份进 `out_dir`）；
 * 两个准备函数的返回值只喂本次 `invokeZcode`；探活与探针走真实 HOME、真实用户目录，
 * 不碰副本。这个前提是**论域约束**，不是函数签名能表达的东西——
 * 2026-09-20 的事故正是把本函数当通用工具、用一个算出来的根目录去调它。
 * 调用方只有 `zcodeAdapter.scrubRunDir`，入参只由 `zcodeHomeUnder(sideDir)` 拼出，不要新增第二个口子。
 */
export async function scrubZcodeHome(homeDir: string, opts: { sizeCap?: number } = {}): Promise<CarrierScrub> {
  const out: CarrierScrub = {
    deleted: [], unscannableDeleted: [], scanned: 0, removedOnHit: [],
    redacted: {}, warnings: [], skipped: 0, errors: [],
  };
  if (!(await exists(homeDir))) return out;
  const dirName = path.basename(homeDir);
  /*
   * 不用 `exists()` 当门禁：它内部是 `fs.access`，**权限异常或软链损坏时同样返回 false**，
   * 于是「删不掉」会被读成「本来就没有」，载体留在盘上而结果报 ok（代码双审 r2 AGY-03）。
   * `fs.rm({ force: true })` 本身对不存在就是静默成功，直接依赖它的幂等性，只捕真异常。
   */
  for (const rel of ZCODE_CREDENTIAL_CARRIERS) {
    const carrier = path.join(homeDir, rel);
    const carrierExisted = await exists(carrier);
    try {
      await fs.rm(carrier, { force: true });
      // 三份各自计入，不合并计数——哨兵说什么删了就得真删了什么
      if (carrierExisted) out.deleted.push(`${dirName}/${rel}`); // 报告域恒 /（与 codex-home 同纪律，1.2.5；rel 是字面名不含分隔符）
    } catch (e) {
      out.errors.push(`删不掉 ${rel} 副本：${(e as Error).message}`);
    }
  }
  /*
   * 与 codex 侧同一口径（代码双审 r1 GLM-03 ≡ CODEX-05）：
   * `rollout/` 与 `log/` 是模型 I/O 日志——逐字含送审包全文，夹具密钥会误命中，且 rollout 是本侧
   * 工具参数与生效模型的回读来源——命中不删、就地脱敏；`plugins/`（实测含数千个 node_modules 文件
   * 与 16 MB 动态库）与 `db/`（sqlite）不扫。
   */
  const scan = await scanAndRemoveSecrets(homeDir, {
    exclude: [`${ZCODE_CLI_SUBDIR}/plugins`, `${ZCODE_CLI_SUBDIR}/db`],
    redactUnder: [`${ZCODE_CLI_SUBDIR}/rollout`, `${ZCODE_CLI_SUBDIR}/log`],
    sizeCap: opts.sizeCap,
  });
  out.scanned = scan.scanned;
  // 报告域恒用 /（与 codex-home 同纪律，1.2.5）：win32 的 path.join 出反斜杠
  const domainJoin = (a: string, b: string): string => `${a}/${b.replace(/\\/g, '/')}`;
  out.removedOnHit = scan.removed.map((p) => domainJoin(dirName, p));
  /*
   * 论域内扫不进去的二进制整删（EV-36）。本侧自己的 sqlite 在 `db/` 下、已按前缀排除，
   * 这一格接的是**操作系统写进假 HOME 的副产品**——实测 `Library/Caches/com.apple.python 下的 .pyc`
   * （36 份 Xcode 自带 Python 框架的字节码，HOME 被重定向后由系统写入）。
   * 它们此前让该侧 `complete` 恒为 false：一条永不收工、也无动作可消除的待办。
   */
  out.unscannableDeleted = scan.unscannableRemoved.map((p) => domainJoin(dirName, p));
  for (const [rel, n] of Object.entries(scan.redacted)) out.redacted[domainJoin(dirName, rel)] = n;
  out.warnings.push(...scan.warnings);
  out.skipped = scan.skipped;
  out.errors.push(...scan.errors);
  return out;
}

/** `prepareZcodeHome` 的结果 */
export interface ZcodeHomePrep {
  /** 副本 HOME；null 表示本次没做隔离（没指定模型或找不到 `cli/config.json`） */
  homeDir: string | null;
  /** `config_copy`：副本 `model.main` 已写成请求模型；`global`：沿用副本源里原有的默认 */
  route: 'config_copy' | 'global';
  /** 写进 `model.main` 的全限定串；`route` 为 `global` 时为 null */
  qualified: string | null;
  /** `route` 为 `global` 时**必有**——「没覆盖」和「为什么没覆盖」不能只剩前者 */
  reason?: string;
  /**
   * 没覆盖的**结构化成因**（EV-122 计划 r2 §3.1）：`route` 为 `config_copy` 时为 null。
   * 下游判定与分句只认它，不匹配 `reason` 文案（计划双审 CODEX-02）。`no_model` 在流水线里走不到（派发前即拒空模型），只为穷尽出口
   */
  cause: ModelUnenforcedCause | 'no_model' | null;
  /**
   * 置首结果（EV-82 第三段 r3 §3.2）：没请求置首（`requestedFirst` 未开）、或限定失败时为 null。
   * 挪不动**不中止**：照常写副本、照常拉起，由守卫按结果判。
   */
  reorder: VariantOutcome | null;
}

/**
 * `cli/config.json` 的 provider 段形态（只取本函数要看的键；apiKey 等一律不碰）。
 */
interface ZcodeCliConfigShape {
  provider?: Record<string, { models?: Record<string, unknown> } | undefined>;
  model?: unknown;
}

/**
 * 把请求模型限定成 `<providerKey>/<modelId>`，**providerKey 只认副本源 `cli/config.json` 自己的键**
 * （计划双审 r3 CODEX-03）。
 *
 * 为什么不再用探针的 `model_id_form` 补前缀：那个值当时记的是**上一次真实 HOME 运行回读到的生效模型**
 * ——即个人配置的默认（当时本机是 `<providerUUID>/qwen3.8-max`），而 legacy 导入后注册表里的
 * providerId 是 `cli/config.json` 的 provider **键**（`bigmodel-coding-plan`）。EV-194 起 doctor 探针改走副本，
 * 它在副本支下才与这里同源，退路支下仍不是——限定照旧只认副本源本身。两者异源时，拼出来的
 * `<UUID>/GLM-5.3-Flash` 在注册表里必验不过，CLI 静默回落到第一个模型——恰是 EV-82 的形态。
 * 注册表精确匹配（包内 `isSelectable`），所以限定的来源必须与导入的来源**同一份文件**。
 *
 * 裸名 → 找**恰好一个** provider 的 `models` 含它；带 `/` → 按最后一个 `/` 切，provider 键要存在且
 * model 在其 `models` 内。不满足一律返回 `null` 并说明理由，**不写副本**——写进去也只会换来
 * 一个与模型无关的报错或一次静默回落。
 */
/**
 * 按 CLI legacy 导入器**同一组规则**列出 `cli/config.json` 里会进注册表的 provider 与成员
 * （代码双审 r3 CODEX-02）。规则取自包内字面：
 *   - `Oqa`：键以 `builtin:` / `account:` 开头的 provider 跳过；`source` 存在且不是 `custom` 的跳过；
 *   - `Nqa`：成员 `deleted === true` 跳过；modelId 取 `(id ?? 键名).trim()`，空与重复跳过。
 * 限定与探针挑选都从这里读——此前按键名 `in models` 判，看不见这三条，限定通过、`Mqa` 只解析字符串
 * 不校目录、v2 文件照样写出请求值（探针判 `config_copy`），而运行期 `isSelectable` 在注册表里配不上。
 * 那正是 v1.3.32 引以为戒的「注册表形态异源」换了个维度。
 */
export function legacyProviderMembers(cfg: ZcodeCliConfigShape): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [key, p] of Object.entries(cfg.provider ?? {})) {
    const k = key.trim();
    if (!k || !p) continue;
    if (k.startsWith('builtin:') || k.startsWith('account:')) continue;
    const source = (p as { source?: unknown }).source;
    if (source !== undefined && source !== 'custom') continue;
    const members = new Set<string>();
    for (const [mk, mv] of Object.entries(p.models ?? {})) {
      const m = (mv ?? {}) as { deleted?: unknown; id?: unknown };
      if (m.deleted === true) continue;
      const id = (typeof m.id === 'string' ? m.id : mk).trim();
      if (id) members.add(id);
    }
    out.set(k, members);
  }
  return out;
}

export function qualifyAgainstCliConfig(
  model: string,
  cfg: ZcodeCliConfigShape,
): { qualified: string; providerKey: string; modelId: string } | { qualified: null; reason: string } {
  const providers = legacyProviderMembers(cfg);
  // 切**第一个** `/`，与包内 `okt` 同规则（r3 CODEX-03）：provider 段不含 `/`，model 段可含
  const cut = model.indexOf('/');
  if (cut >= 0) {
    const providerKey = model.slice(0, cut).trim();
    const modelId = model.slice(cut + 1).trim();
    if (!providerKey || !modelId) return { qualified: null, reason: `模型 ${JSON.stringify(model)} 切不出两个非空段` };
    const members = providers.get(providerKey);
    if (!members) {
      return {
        qualified: null,
        reason: `cli/config.json 里没有 provider ${JSON.stringify(providerKey)}（会进注册表的有：${[...providers.keys()].join(', ') || '无'}；builtin:/account: 前缀与非 custom 的不计）`,
      };
    }
    if (!members.has(modelId)) {
      return {
        qualified: null,
        reason: `provider ${JSON.stringify(providerKey)} 的 models 里没有 ${JSON.stringify(modelId)}（有：${[...members].join(', ') || '无'}；已按 id ?? 键名、跳过 deleted 计）`,
      };
    }
    return { qualified: `${providerKey}/${modelId}`, providerKey, modelId };
  }
  const owners = [...providers.entries()].filter(([, members]) => members.has(model)).map(([k]) => k);
  if (owners.length === 1) return { qualified: `${owners[0]}/${model}`, providerKey: owners[0]!, modelId: model };
  return {
    qualified: null,
    reason:
      owners.length === 0
        ? `cli/config.json 里没有任何 provider 提供模型 ${JSON.stringify(model)}（只计会进注册表的 provider 与未删成员）`
        : `模型 ${JSON.stringify(model)} 在多个 provider 下都有（${owners.join(', ')}），请写成 <provider>/<model>`,
  };
}

/**
 * 置首的结构化成因（EV-82 第三段 r3 §3.1，计划双审 r2 GLM-r2-02）：判定一律按它做，`reason` 只供人读。
 *
 * **产出面**（代码双审 r1 CODEX-01 ≡ GLM-01）：`reorderRequestedFirst` 只产出 `applied` / `identity` / `not_movable` 三档，
 * 所以审查运行的 trace 与 `CriticResult.model_override_reorder` 也只会是这三档。`qualify_failed` 只由同形臂置首支在
 * 请求模型限定失败时合成；审查运行限定失败时 `prepareZcodeHome` 走 `route: global`、`reorder` 为 null，
 * 事实在 trace 的 `modelSelection.route` 与 `reason`。
 * - `applied`：挪成功（原样支按定义也记 `applied`）；
 * - `identity`：请求本就在两级首位，不需要挪；
 * - `not_movable`：找不到 provider / 成员、provider 键 trim 后重名、重建后仍不在首位（整数样键名）；
 * - `qualify_failed`：请求模型限定失败，无从置首。
 */
export type VariantKind = 'applied' | 'identity' | 'not_movable' | 'qualify_failed';

/**
 * 置首变体是否生效（EV-82 第二段 r2 §4；第三段 r3 §3.1 从探针模块搬来，审查臂与同形臂共用）。
 * 未生效时带 `kind` 与原因。
 */
export interface VariantOutcome {
  variant: 'as-is' | 'requested-first';
  applied: boolean;
  kind: VariantKind;
  reason?: string;
}

/**
 * 「请求模型置首」（EV-82 第二段 r2 §4，第 1 轮 CODEX-04 / AGY-03 / GLM-08）：只调整副本里的**顺序**，
 * 把 `providerKey` 排到 `provider` 映射首位、把请求的成员键排到它的 `models` 映射首位；键、值、嵌套一律不变。
 *
 * - provider 与成员**两级**都按 trim 定位（代码双审 r1 CODEX-02 ≡ GLM-03）：provider 取 `键名.trim()` 与
 *   `providerKey` 相等的原始键，重建时仍用原始键；多个原始键 trim 后同名 ⇒ 挪不动（导入器取哪个未核实）；
 * - 成员定位与导入器同一规则：`(id ?? 键名).trim()` 与 `modelId` 相等，跳过 `deleted: true`，
 *   重复 id 取**第一个**匹配键（导入器先到先得）；
 * - **挪不动不当成功**：找不到对应键、请求本就在首位（恒等）、重建后目标仍不在首位
 *   （JS 对象恒把整数样键名排在前面）——一律 `applied: false` 并给原因。
 * 返回新对象，不改入参。
 *
 * 放在适配层而不是探针模块（第三段 r3 §3.1）：审查臂与同形臂的置首要走同一个构造函数、同一个选项，
 * 而探针模块依赖适配层、反过来不行。探针模块原名再导出。
 */
export function reorderRequestedFirst<T>(cfg: T, providerKey: string, modelId: string): { copy: T; outcome: VariantOutcome } {
  const fail = (reason: string, kind: VariantKind = 'not_movable') =>
    ({ copy: cfg, outcome: { variant: 'requested-first' as const, applied: false, kind, reason } });
  const c = cfg as { provider?: Record<string, { models?: Record<string, { id?: unknown; deleted?: unknown }> } | undefined> };
  const providers = c.provider ?? {};
  // provider 键也按 trim 定位（代码双审 r1 CODEX-02 ≡ GLM-03）：`providerKey` 来自 `legacyProviderMembers`，是规整形态
  const rawKeys = Object.keys(providers).filter((k) => k.trim() === providerKey);
  if (rawKeys.length === 0) return fail(`副本源里没有 provider ${providerKey}`);
  if (rawKeys.length > 1) return fail(`有 ${rawKeys.length} 个 provider 键 trim 后都是 ${providerKey}，导入器取哪个未经核实，不猜`);
  const rawKey = rawKeys[0]!;
  const p = providers[rawKey];
  if (!p) return fail(`副本源里 provider ${providerKey} 为空`);
  const models = p.models ?? {};
  let memberKey: string | null = null;
  for (const [k, m] of Object.entries(models)) {
    if (m && typeof m === 'object' && m.deleted === true) continue;
    const id = (typeof m?.id === 'string' ? m.id : k).trim();
    if (id === modelId) { memberKey = k; break; }
  }
  if (memberKey === null) return fail(`provider ${providerKey} 里没有 id 为 ${modelId} 的成员`);
  if (Object.keys(providers)[0] === rawKey && Object.keys(models)[0] === memberKey) return fail('请求本就在首位（恒等）', 'identity');

  const newModels: Record<string, unknown> = { [memberKey]: models[memberKey] };
  for (const [k, m] of Object.entries(models)) if (k !== memberKey) newModels[k] = m;
  const newProviders: Record<string, unknown> = { [rawKey]: { ...p, models: newModels } };
  for (const [k, v] of Object.entries(providers)) if (k !== rawKey) newProviders[k] = v;
  if (Object.keys(newProviders)[0] !== rawKey || Object.keys(newModels)[0] !== memberKey) {
    return fail('重建后目标仍不在首位：存在整数样键名，JS 对象恒把它们排在前面');
  }
  return { copy: { ...(cfg as object), provider: newProviders } as T, outcome: { variant: 'requested-first', applied: true, kind: 'applied' } };
}

/**
 * 落点自检（EV-112 计划 r3 §4.6）：本次会话的 CLI 产物有没有落进运行目录，以及有没有落进真实 HOME。
 *
 * 落点键被 CLI 采纳是从压缩产物读出来的厂商事实，ZCode 随桌面端自动更新。三键分属两条互不相干的代码路径
 * （日志工厂直读 `ZCODE_LOG_DIR`；存储根与会话库经 `aun` 进配置层），可以**各自**漂移——所以两项分开记、**合取**判：
 * - `log`：`cliDir/log` 下任一 `.jsonl` 里有本次 `sessionId` 的行（查全部文件，不只最新一个：跨午夜时事件分在两天的文件里）；
 * - `rollout`：`cliDir/rollout/model-io-<sessionId>.jsonl` 存在。CLI 成功返回时它必写：`recordModelIO` 只在运行档位为
 *   `test` 或请求带 `skipTranscript` 时为假，而运行档位已被清掉（`ZCODE_LANDING_SWITCH_ENV_KEYS`）；
 * - `leaked_to_home`：只在无副本支（`realHome` 非 null）核，两项与正向核同形（代码双审 r1 CODEX-01 ≡ GLM-01）：
 *   `rollout`＝真实 HOME 下有本次会话的 rollout 文件（只查文件名）；`log`＝真实 HOME 的日志目录里、修改时间不早于 `since`
 *   的文件中有本次会话的行（只输出布尔、不读出内容；`since` 限定扫描面，不读历史大文件）。日志键单独失效时日志回落的
 *   唯一去处就是 `<HOME>/.zcode/cli/log`（包内 `N6s`），只核 rollout 会把这一格记成「没泄漏」。
 *   副本支的 HOME 就是落点根，反向核无意义，字段缺席。
 *
 * 只读：不改、不删任何文件。
 */
export async function checkZcodeCarriers(
  cliDir: string,
  sessionId: string,
  realHome: string | null,
  since = 0,
): Promise<NonNullable<CriticResult['carriers_landed']>> {
  const rolloutName = `model-io-${sessionId}.jsonl`;
  const log = await logDirHasSession(path.join(cliDir, 'log'), sessionId, 0);
  const rollout = await exists(path.join(cliDir, 'rollout', rolloutName));
  if (realHome === null) return { log, rollout };
  const homeCli = path.join(realHome, ZCODE_CLI_SUBDIR);
  return {
    log,
    rollout,
    leaked_to_home: {
      log: await logDirHasSession(path.join(homeCli, 'log'), sessionId, since),
      rollout: await exists(path.join(homeCli, 'rollout', rolloutName)),
    },
  };
}

/** 日志目录里（修改时间不早于 `since` 的）任一 `.jsonl` 有顶层 `sessionId` 等于本次会话的行。字面出现不算；读不了记 false */
async function logDirHasSession(logDir: string, sessionId: string, since: number): Promise<boolean> {
  let names: string[];
  try {
    names = (await fs.readdir(logDir)).filter((n) => n.endsWith('.jsonl'));
  } catch {
    return false;
  }
  for (const f of names) {
    const file = path.join(logDir, f);
    try {
      if (since > 0 && (await fs.stat(file)).mtimeMs < since) continue;
      const text = await fs.readFile(file, 'utf8');
      if (!text.includes(sessionId)) continue;
      const hit = text.split('\n').some((line) => {
        try {
          return (JSON.parse(line) as Record<string, unknown>)['sessionId'] === sessionId;
        } catch {
          return false;
        }
      });
      if (hit) return true;
    } catch {
      /* 单个文件读不了不影响其余文件 */
    }
  }
  return false;
}

/**
 * 审查运行做模型覆盖时的**副本源**：用户的 `~/.zcode/cli/config.json`（EV-123）。
 *
 * **审查运行（适配器侧）**的唯一出处：`prepareZcodeHome` 的缺省值、`authProbe.fingerprint()`、
 * `zcodeAdapter.modelOverrideSource()` 三处都调它。此前前两处各写一遍路径字面，改一处就漏另一处。
 * 每次调用时现取 `os.homedir()`（POSIX 下读 `$HOME`），不缓存——用例靠钉 HOME 构造两种世界。
 *
 * **探针模块的 `ZCODE_CLI_CONFIG`（`probes/zcode.ts`）未并入**：它是 doctor 三条模型覆盖臂的副本源缺省值，
 * 而且在模块加载时取值——进程内钉 HOME 对它无效。并入要动探针常量（它同时服务 log / rollout / models），
 * 登记为 BACKLOG 残余（代码双审 r1 CODEX-03）。
 */
export function zcodeOverrideSourcePath(): string {
  return path.join(os.homedir(), '.zcode/cli/config.json');
}

/**
 * 家目录归一（EV-136 代码双审 r1 GLM-01）。EV-200 起定义挪到 `util/fsx.ts` 与 codex 探活共用，
 * 这里原名再导出，`probes/zcode.ts` 与测试的引用点不动。
 */
export { tildeHome };

/**
 * 某个 HOME 下 `cli/config.json` 副本的位置（EV-198 计划双审 GLM-04）：副本的写入（`prepareZcodeHome`、白名单探针臂）
 * 与删除失败后的现场查共用这一处定义。
 *
 * 只管副本这一处，不是 `.zcode/cli` 布局的单一来源（代码双审 r1 CODEX-02）：副本源 `zcodeOverrideSourcePath`、
 * 探针模块的 `ZCODE_CLI_DIR` 与日志 / rollout / 模型清单的回读点仍各写各的字面，改布局时要逐处改。
 * 传的是**那个 HOME**，
 * 不是运行目录：`prepareZcodeHome` 的 HOME 在运行目录下的 `home/`（`zcodeHomeUnder`），白名单臂的 HOME 就是它的临时目录本身。
 */
export function zcodeCliCopyPath(homeDir: string): string {
  return path.join(homeDir, ZCODE_CLI_SUBDIR, 'config.json');
}

/**
 * 残留目录里那份副本是哪一种（EV-198）：`credential` 可能含真实凭据（`prepareZcodeHome` 的整份拷贝；同形臂扫出残余或
 * 走 `apiKeyOnly` 收窄档时也按它说）；`sentinel` 是探针副本、凭据已换成哨兵（白名单臂、同形臂正常支）。
 */
export type ZcodeTempDirCopyKind = 'credential' | 'sentinel';

/**
 * 临时运行目录删不掉时的人读提示（EV-197；EV-198 起三档）：doctor 探针与认证探活同一句，只差主语与副本档位。
 *
 * `copy` 说的是**残留目录里此刻还有没有、有的是哪一种** `cli/config.json` 副本（由 `removeZcodeTempDir` 在删除失败后现场查）。
 * 退路支（副本源缺失、档位无模型）与副本源解析失败时目录里只有 CLI 产物，说「含真实凭据」不属实
 * （EV-197 计划双审 GLM-02）。没有副本时也不断言产物里没有敏感内容，只说清没有副本。
 * `credential` 与 null 两档的措辞与 EV-197 时的 `true` / `false` 逐字相同。
 */
export function zcodeTempDirResidueText(who: '探针' | '探活', runDir: string, code: string, copy: ZcodeTempDirCopyKind | null): string {
  return (
    `⚠️ ${who}临时目录删除失败（${code}）：${tildeHome(runDir)} 仍在，` +
    (copy === 'credential'
      ? '其中的 cli/config.json 副本含真实凭据，请手工删除'
      : copy === 'sentinel'
        ? '其中的 cli/config.json 是探针副本、凭据已换成哨兵，仍请手工删除'
        : '其中没有 cli/config.json 副本，是本次探测的 CLI 产物，请手工删除')
  );
}

/**
 * 删 mkdtemp 的返回值：重试三次、失败不抛，返回上面那句提示（删成功返回 null）。
 *
 * 删除与「删除失败后现场查」本身在 `util/fsx.ts` 的 `tryRemoveTempDir`（EV-200 起与 codex 认证探活共用），
 * 这里只把现场翻成 zcode 的措辞，输出与抽出前逐字相同。现场查的理由（递归删除删到一半才失败、
 * 写盘后 `chmod` 可抛，按写入时的情形推断两个方向都会说错；查不了按有副本说）见那边的文档块。
 *
 * **查哪里、有的话说哪一档由调用方给**（EV-198）：此前位置写死成 `prepareZcodeHome` 的布局，白名单探针臂的副本
 * 不在那儿，套用会把有说成没有。`copy.path` 只用于 stat、不用于删除；`copy.kind` 只决定「有副本时说哪一档」，
 * 现场查优先。`copy` 为 null 表示这个目录从不写副本（旗标探针），删除失败时不查、直接说没有。
 */
export async function removeZcodeTempDir(
  runDir: string,
  who: '探针' | '探活',
  copy: { path: string; kind: ZcodeTempDirCopyKind } | null,
): Promise<string | null> {
  const left = await tryRemoveTempDir(runDir, copy ? [copy.path] : []);
  if (left === null) return null;
  return zcodeTempDirResidueText(who, runDir, left.code, copy && left.remaining.length > 0 ? copy.kind : null);
}

/**
 * 探活与 doctor 探针要请求的模型：当前档位 plan 阶段的 glm 模型（EV-136 定、EV-194 起 doctor 共用）。
 *
 * 同一 provider 下各阶段只差模型档，取 plan 作代表；`--model-glm` 不进来——两处调用方都拿不到当轮生效模型
 * （EV-136 残余 ①②）。认证探活与 doctor 的 headless / path_deny 必须是同一个定义，改一处两处同变。
 */
export function zcodeProbeModel(cfg: AdapterContext['cfg']): string | null {
  // 档位解析不带命令行一级（M11 第 4 步取代 routeModel）：格子缺席时按 default_tier 取，与 run() 的解析同一函数
  return resolveTier(cfg, 'glm', 'plan').model;
}

/**
 * 说清一次探活 / 探针「探的是哪条路径、请求了哪个模型」（EV-136 定，EV-194 起认证探活与 doctor 探针共用）。
 *
 * 免得通过一格被读成「GLM 可用」：
 *   · 退路支：真实 HOME 下由 ZCode 自选——个人配置在就用它的缺省，不在就 legacy 导入 `cli/config.json`
 *     （EV-136 代码双审 r1 GLM-05：不能一律说成「个人缺省」）；
 *   · 限定失败：副本照建、不改 model.main（与 run() 同），CLI 用的是副本源原有的那个，不能报成请求的模型；
 *   · 置首挪不动：请求模型可能没生效，如实注明（CODEX-03）。
 * 「模型 X」是**请求**的模型，不是回读的生效模型（EV-194 计划双审 CODEX-02）；生效模型 doctor 另行回读。
 * reason 里的家目录归一成 `~`（GLM-01）：详情会进预检与 doctor 输出，而那些输出常被抄进 evidence。
 */
export function describeZcodeProbedPath(prep: ZcodeHomePrep): string {
  return prep.homeDir === null
    ? `真实 HOME 下 ZCode 自选的缺省模型（${tildeHome(prep.reason ?? '')}）`
    : prep.qualified === null
      ? `cli/config.json 原有的 model.main（${tildeHome(prep.reason ?? '')}）`
      : prep.reorder?.kind === 'not_movable'
        ? `模型 ${prep.qualified}（置首未生效：${prep.reorder.reason ?? '挪不动'}；实际生效模型未核）`
        : `模型 ${prep.qualified}`;
}

/**
 * 为一次运行准备独立 HOME 与模型覆盖（`config_copy` 档）。
 *
 * 从用户的 `~/.zcode/cli/config.json` 拷一份到运行目录下的临时 HOME，只改 `model.main` / `model.lite`。
 * **绝不改用户的全局配置**（§16.2 纪律 5）。
 *
 * 覆盖生效的前提是**拉起时不注入个人 provider 配置**（`omitPersonalProviderConfig`），
 * 让 CLI 在副本 HOME 下找不到个人文件、走 legacy 导入读这份副本（EV-82，见 `zcodeProviderEnv`）。
 * 限定失败（模型不在副本源里）时**仍建副本、不改 `model`**，`route: global` 并给理由：
 * 隔离照做，只是不覆盖。
 */
const ZCODE_BUILTIN_CACHE_FILES = new Set(['zcode-builtin.json', 'zcode-builtin-refresh.json']);

/**
 * 将 `<srcHomeDir>/.zcode/v2/runtime/provider` 下已缓存的 CDN 内置规则与刷新记录白名单同步到临时隔离 HOME。
 *
 * 原因：随包 `zcode-builtin.json` 可能滞后于 CDN 修订（如 4.0.0 随包 rev 44 中 GLM-5.4 落入 `['disabled','enabled']`，
 * 而 CDN rev 48 改为 `['low','high','max']`）；若隔离 HOME 缺失该缓存，CLI 启动先按旧修订选定 `reasoningLevel: "enabled"`，
 * 随即后台 CDN 热替换为新修订，导致 `modelFactory` 报 `Reasoning effort "enabled" is not supported`。
 * 仅复制白名单普通文件（不含凭据、跳过符号链接），不复制 `v2/provider_config.json` 或 `v2/credentials.json`。
 */
export async function seedZcodeBuiltinCache(
  targetHomeDir: string,
  srcHomeDir: string = os.homedir(),
): Promise<void> {
  const srcRoot = path.join(srcHomeDir, ZCODE_V2_SUBDIR, 'runtime/provider');
  const dstRoot = path.join(targetHomeDir, ZCODE_V2_SUBDIR, 'runtime/provider');
  async function copyDir(srcDir: string, dstDir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(srcDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const srcPath = path.join(srcDir, entry.name);
      const dstPath = path.join(dstDir, entry.name);
      if (entry.isDirectory()) {
        await copyDir(srcPath, dstPath);
      } else if (entry.isFile() && ZCODE_BUILTIN_CACHE_FILES.has(entry.name)) {
        try {
          await ensureDir(dstDir);
          await fs.copyFile(srcPath, dstPath);
        } catch {
          /* 缓存预置属最佳努力，单文件失败不阻断运行 */
        }
      }
    }
  }
  try {
    const st = await fs.lstat(srcRoot);
    if (!st.isDirectory() || st.isSymbolicLink()) return;
  } catch {
    return;
  }
  await copyDir(srcRoot, dstRoot);

  // `agent/zcode.cjs` 的编译期 ZCODE_VERSION 常为 `0.0.0-dev`，而交互端 `bin/zcode.mjs` 为发行版号（如 `4.0.0`）；
  // 若宿主机仅由交互端缓存过 `<platform>/<release>/endpoint-*/`，或 `0.0.0-dev` 修订低于其它版本，按 endpoint 补齐/升级最高 revision 的缓存。
  async function readBuiltinRevision(epDir: string): Promise<number> {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(epDir, 'zcode-builtin.json'), 'utf8')) as { revision?: unknown };
      return typeof raw.revision === 'number' ? raw.revision : -1;
    } catch {
      return -1;
    }
  }
  let platforms: string[] = [];
  try {
    platforms = (await fs.readdir(dstRoot, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.isSymbolicLink())
      .map((e) => e.name);
  } catch {
    return;
  }
  for (const plat of platforms) {
    const platDir = path.join(dstRoot, plat);
    const devDir = path.join(platDir, '0.0.0-dev');
    const bestByEndpoint = new Map<string, { rev: number; dir: string }>();
    let versions;
    try {
      versions = await fs.readdir(platDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const v of versions) {
      if (!v.isDirectory() || v.name === '0.0.0-dev') continue;
      const verDir = path.join(platDir, v.name);
      let endpoints;
      try {
        endpoints = await fs.readdir(verDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ep of endpoints) {
        if (!ep.isDirectory()) continue;
        const epDir = path.join(verDir, ep.name);
        if (!(await exists(path.join(epDir, 'zcode-builtin.json')))) continue;
        const rev = await readBuiltinRevision(epDir);
        const prev = bestByEndpoint.get(ep.name);
        if (!prev || rev > prev.rev) bestByEndpoint.set(ep.name, { rev, dir: epDir });
      }
    }
    for (const [epName, { rev, dir }] of bestByEndpoint) {
      const targetEpDir = path.join(devDir, epName);
      const hasTarget = await exists(path.join(targetEpDir, 'zcode-builtin.json'));
      if (!hasTarget || rev > (await readBuiltinRevision(targetEpDir))) {
        await copyDir(dir, targetEpDir);
      }
    }
  }
}

export async function prepareZcodeHome(
  runDir: string,
  model: string | null,
  opts: {
    // `srcConfig` 只为可测性：不开这个口子，用例只能吃真实的 `~/.zcode/cli/config.json`（含凭据）
    srcConfig?: string;
    /** 可选指定内置规则缓存源 HOME；未传时仅在默认真实 `srcConfig` 路径下取 `os.homedir()` */
    srcHome?: string | null;
    /**
     * 在**写盘之前**改写副本对象（EV-82 小主题第一段 r2 §3.1）。只给同形探针臂用：
     * 它要把凭据换成哨兵，写盘前换才没有「先写真实凭据、再覆写」的窗口（AGY-03）。
     * **审查臂不传**；不传时本函数的输出与加这个参数之前逐字相同（有用例锁住）。
     */
    transformCopy?: (cfg: ZcodeCliConfigShape) => ZcodeCliConfigShape;
    /**
     * 请求模型置首（EV-82 第三段 r3 §3.2）：限定成功时，在写 `model.main` 之后、`transformCopy` **之前**
     * 把请求的 provider / 成员排到首位，只动顺序。`transformCopy` 收到的就是置首后的对象，
     * 残余扫描面对最终落盘的那份。缺省 false：不传时输出与加这个参数之前逐字相同。
     */
    requestedFirst?: boolean;
  } = {},
): Promise<ZcodeHomePrep> {
  const srcConfig = opts.srcConfig ?? zcodeOverrideSourcePath();
  if (!(await exists(srcConfig))) {
    return {
      homeDir: null,
      route: 'global',
      qualified: null,
      reason: `未找到 ${srcConfig}，无法做模型覆盖；将沿用 ZCode CLI 的全局默认`,
      cause: 'source_missing',
      reorder: null,
    };
  }
  if (!model) return { homeDir: null, route: 'global', qualified: null, reason: '本次未指定模型', cause: 'no_model', reorder: null };

  const homeDir = zcodeHomeUnder(runDir);
  const copyPath = zcodeCliCopyPath(homeDir);
  await ensureDir(path.dirname(copyPath));

  const cfg = JSON.parse(await fs.readFile(srcConfig, 'utf8')) as ZcodeCliConfigShape;
  const q = qualifyAgainstCliConfig(model, cfg);
  // 模型 id 必须是 <providerKey>/<modelId> 全限定形态（坑 P-06），且 providerKey 与本副本同源（r3 CODEX-03）
  if (q.qualified !== null) cfg.model = { main: q.qualified, lite: q.qualified };
  let staged: ZcodeCliConfigShape = cfg;
  let reorder: VariantOutcome | null = null;
  if (q.qualified !== null && opts.requestedFirst) {
    const r = reorderRequestedFirst(cfg, q.providerKey, q.modelId);
    staged = r.copy;
    reorder = r.outcome;
  }
  const toWrite = opts.transformCopy ? opts.transformCopy(staged) : staged;

  await fs.writeFile(copyPath, JSON.stringify(toWrite, null, 2), 'utf8');
  // 配置副本含凭据，权限收紧
  await fs.chmod(copyPath, 0o600);
  const defaultSrc = zcodeOverrideSourcePath();
  const srcHome = opts.srcHome !== undefined
    ? opts.srcHome
    : (path.resolve(srcConfig) === path.resolve(defaultSrc) ? os.homedir() : null);
  if (srcHome) await seedZcodeBuiltinCache(homeDir, srcHome);

  if (q.qualified === null) {
    return {
      homeDir,
      route: 'global',
      qualified: null,
      reason: `${q.reason}；副本已建但不做模型覆盖`,
      cause: 'qualify_failed',
      reorder: null,
    };
  }
  return { homeDir, route: 'config_copy', qualified: q.qualified, cause: null, reorder };
}

export const zcodeAdapter: CriticAdapter = {
  critic: 'glm',
  versionInvocationFor(cfg) {
    return { bin: cfg.probe.cli.zcode?.entrypoint ?? null, prefix: [], env: zcodeVersionEnv(), problem: entryProblem(cfg) };
  },
  /*
   * 专用读工具带独立路径字段，被拒操作留痕。本侧 `Bash` 全禁，`command_texts`
   * 恒空（见本文件 §96 的说明），`command-trace` 的回填路径对它是空操作——
   * 但仍如实声明为 `tool-trace`：能力说的是「轨迹是什么形状」，不是「本次采到了什么」。
   */
  capability: TOOL_TRACE_CAPABILITY,

  /* 不能执行命令：`Bash` 在 `ZCODE_READONLY_DENYLIST` 里（EV-95）；`--mode plan` 本身挡不住命令执行 */
  commandExecution: 'none',

  /*
   * 没有思考等级概念（M11 第 4 步，设计 11.5「glm 无」；0.16.5 起 CLI 无 effort 旗标，EV-09 / C-07）：
   * 档位只由模型承载。schema 已在 zcode 支档位条目上拒 effort；够不着的档位表格子由预检据此拒（计划三审 AGY-02）。
   */
  reasoningLevelsFor() {
    return { kind: 'none' as const };
  },

  /* 同上：没有这个概念，生效值与来源都是 `null`（M11 第 6 步，设计 11.1 glm 一行）——不是「没读到」 */
  effortReadback: () => EFFORT_NO_CONCEPT,

  /*
   * 工具清单里经插件带进来的执行型 MCP 工具：任务书第 7 节据此点名「不要调用」（EV-191）。
   * 引用判失守的同一份名单，不另抄——通道仍开着，这里只管把后果提前告诉审查员
   */
  mcpExecPrefixes: ZCODE_MCP_EXEC_PREFIXES,

  /**
   * 目录比对前的 slug 归一（M8 第 3 步）。
   *
   * 配置里写短名 `GLM-5.3` 更易读，但实测传裸名会落到错误 provider（坑 P-06），
   * 所以适配器传参时会补成 `<providerId>/<name>`。预检要拿「补全后的形态」去比目录，
   * 否则短名恒判不在目录里。这条知识属于本侧，收敛后不再住在 `preflight` 里。
   */
  normalizeModelForCatalog(cfg, model) {
    return qualifyZcodeModel(model, cfg.probe.cli.zcode?.model_id_form ?? null) ?? model;
  },

  /** 本侧的模型覆盖靠副本 HOME 实现：副本源不在 ⇒ `prepareZcodeHome` 早退 `source_missing`（EV-123） */
  modelOverrideSource() {
    return zcodeOverrideSourcePath();
  },

  /**
   * 探活（M8 第 3 步从 `preflight` 搬来）。
   *
   * 指纹取 `~/.zcode/cli/config.json`：CLI 的 provider 配置**独立于桌面端**，
   * 「桌面端已登录」不等于 CLI 可用（M0 实测），所以判据只认这个文件。
   *
   * ## 探的是审查运行将要用的那条选模路径（EV-136）
   *
   * 此前这里以 `homeDir: null` 拉起：个人 provider 配置（`~/.zcode/v2/provider_config.json`）被注入，
   * 0.16.9 见它存在就直接用它的 `defaultModelSelection`（P-31）——探的是**个人缺省模型**。
   * 而审查运行（`run()`）自 EV-82 起走副本 HOME、不注入个人配置，用的是 `cli/config.json` 的
   * `model.main`，并按档位覆盖成请求模型。两条路径可以完全不相干：2026-09-26 个人缺省指向一个
   * 已停用的 provider（TokenPlan / qwen3.8-max），探活连续报 `Model creation failed`、把每一轮含 glm
   * 的审查都拦在预检，而审查真正要用的 GLM 订阅一切正常；反过来，个人缺省可用而 GLM 坏了时，
   * 探活会放行一轮跑不通的审查。指纹早就只认 `cli/config.json`，拉起却不走它——自相矛盾。
   *
   * 现在与 `run()` 同一形态：`prepareZcodeHome`（按当前档位 plan 阶段的 glm 模型、请求置首）→
   * 副本 HOME + 不注入个人配置。副本源缺失或档位没给模型时 `homeDir` 为 null，与 `run()` 在同一情形下的
   * 退路相同（真实 HOME、注入个人配置）。**落点根两支都设**（代码双审 r1 CODEX-02 ≡ GLM-02）：`run()` 自 EV-112
   * 起无副本支也设，把 CLI 产物拉回运行目录、并让启动期 beta 改写早退；探活照做，产物随临时目录一起删。
   *
   * ## 已知残余（代码双审 r1 CODEX-03、CODEX-04 ≡ GLM-03，BACKLOG EV-136）
   *
   * - **不分阶段**：取 plan 阶段的模型作代表（同一 provider 下各阶段只差模型档）；
   * - **不分覆盖**：`--model-glm` 不进探活与指纹——`AuthProbe` 接口拿不到当轮生效模型。
   *   档位模型坏而覆盖模型好 ⇒ 误拦；反之 ⇒ 放行。中期方向是由调用方按 `run()` 同一 `resolveTier` 式子算好传入；
   * - **不回读生效模型**：详情里的「模型 X」是请求的模型。置首挪不动时 0.16.9 会回落首个可见模型，
   *   这一格在详情里如实注明「实际生效模型未核」，但正结论照常缓存。
   *
   * 指纹带上探活模型：换档位或改档位模型后缓存失效；格式一变，按旧路径探出来的缓存也随之作废。
   */
  authProbe(ctx: AdapterContext, projectRoot: string, combination) {
    const cfg = ctx.cfg;
    const model = combination?.model ?? zcodeProbeModel(cfg);
    return {
      async fingerprint() {
        const f = zcodeOverrideSourcePath();
        const probe = cfg.probe.cli.zcode;
        // 不可读时由预检报告并跳过缓存。缺少 legacy 配置时仍区分安装与模型。
        const hash = await exists(f) ? await sha256File(f) : null;
        return JSON.stringify([hash, model, probe?.entrypoint, probe?.provider_config?.builtin_file]);
      },
      async probe() {
        const entry = cfg.probe.cli.zcode?.entrypoint ?? null;
        const problem = entryProblem(ctx.cfg);
        if (!entry || problem) return { ok: false, detail: problem ?? 'zcode 入口未记录' };
        /*
         * 临时运行目录：副本 HOME 与 CLI 产物都落在它下面，副本里有凭据，用完即删。
         * 删除只认 mkdtemp 的返回值（2026-09-20 事故后的规矩），不拼路径、不走别的变量。
         */
        const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-zcode-auth-'));
        /*
         * 删除收尾（EV-197）：结果在 `attempt` 里拼完，删除放在它外面的 finally、失败不抛。此前 finally 里裸删、
         * 结果在删除之后才拼——ENOTEMPTY / EBUSY / EACCES 会顶替探活结果，穿过无兜底的 `probeAuth` 把预检崩成内部错误，
         * 含凭据的副本留在系统临时目录无人知晓。删不掉时把残留提示接在详情末尾，结论（ok）不因此改变；
         * 提示用哪一档（还有没有副本）由删除函数在失败后现场查（代码双审 GLM-01 ≡ CODEX-03）。
         * 已知残余（EV-197 计划 r2 §3.3 / §3.4）：attempt 抛错时提示无人消费，与 doctor 侧同形；
         * 正结论入缓存后，TTL 期内的预检走缓存命中，提示只在当次可见。
         */
        let r: { ok: boolean; detail: string };
        let residue: string | null = null;
        try {
          r = await attempt(entry, runDir);
        } finally {
          residue = await removeZcodeTempDir(runDir, '探活', { path: zcodeCliCopyPath(zcodeHomeUnder(runDir)), kind: 'credential' });
        }
        return residue === null ? r : { ok: r.ok, detail: `${r.detail}；${residue}` };
      },
    };

    /** 一次探活的全部工作（EV-197 从 probe() 拆出）：结果在这里拼完，删除留给调用方的 finally */
    async function attempt(entry: string, runDir: string): Promise<{ ok: boolean; detail: string }> {
      let prep: ZcodeHomePrep;
      /*
       * 副本准备会读并解析用户的 `cli/config.json`——改动前的探活不读它的内容（代码双审 r1 CODEX-01 ≡ GLM-04）。
       * 文件损坏或不可读要落成一条可读的检查项失败，不能抛出去：`probeAuth` 没有兜底。
       */
      try {
        // 副本源走缺省 `zcodeOverrideSourcePath()`——与 doctor 探针门控用的 `ZCODE_CLI_CONFIG` 是同一个文件；
        // 日后给探活加注入口时须像 doctor 那样显式同传 `srcConfig`，否则两处会各自漂（EV-194 代码双审 r1 CODEX-05）
        prep = await prepareZcodeHome(runDir, model, { requestedFirst: true });
      } catch (e) {
        /*
         * 这句措辞独立于 doctor 侧的 `ZCODE_HEADLESS_UNREFRESHED` 表（EV-197 代码双审 CODEX-02）：那张表管的是
         * 「doctor warning 点名的 note」与 note 本身不各改各的，探活详情不被任何 warning 指向；
         * 且表在探针模块，`adapters/` 不引用 `probes/`。两处「读取或解析失败」改一处时请顺手对一眼另一处。
         */
        return {
          ok: false,
          detail: `副本源 ~/.zcode/cli/config.json 读取或解析失败：${tildeHome((e as Error).message)}（请检查该文件，或在 ZCode 里重新保存一次模型配置）`,
        };
      }
      const out = await invokeZcode({
        entry,
        node: ctx.nodePath,
        cwd: projectRoot,
        prompt: '只回复 OK 两个字母，不要调用任何工具。',
        readonlyArgs: readonlyArgsFromProbe(cfg.probe.cli.zcode?.readonly_flags ?? []),
        homeDir: prep.homeDir,
        omitPersonalProviderConfig: prep.homeDir !== null,
        storageRedirectRoot: zcodeHomeUnder(runDir),
        /*
         * 180s，与搬家前 `preflight` 里的值一致（r9 双审 GLM-07）。
         * M8 第 3 步把探活搬进适配器时手抄成了 120s——**一次搬家不该顺带改行为**。
         * 本侧要起 node 子进程再拉 CLI，比 agy 慢，那 60 秒是当初特意给的。
         */
        timeoutMs: 180_000,
      });
      const ok = out.failureKind === 'none' && !out.timedOut && out.envelope !== null;
      // 说清探的是哪条路径（四档措辞与 doctor 探针同源，EV-194）
      const probed = describeZcodeProbedPath(prep);
      const cliSays = redactSecrets(out.stderr.slice(0, 200)).content;
      return {
        ok,
        detail: ok
          ? `探活通过（${Math.round(out.durationMs / 1000)}s，${probed}）`
          : out.failureKind === 'model_config_missing'
            ? prep.homeDir === null
              ? `缺 ~/.zcode/cli/config.json（CLI 的模型配置独立于桌面端，「已登录」不等于可用；${probed}）`
              : // 副本支：文件在（刚对它算过指纹），是内容里没有可用 provider（代码双审 r1 GLM-06）
                `副本源 ~/.zcode/cli/config.json 在，但 CLI 报模型配置缺失，provider 段可能不可用（${probed}）：${cliSays}`
            : // CLI 原话过一遍脱敏再进详情（r5 CODEX-06）：这段文字会进 doctor / preflight 输出，
              // 而那些输出的实际流转方式是被人抄进 git 里的 evidence 目录，那条路上没有闸门
              out.failureKind === 'provider_config_unresolved'
              ? `${ZCODE_PROVIDER_CONFIG_UNRESOLVED_HINT}（${probed}）：${cliSays}`
              : `探活失败（${out.failureKind}，${probed}）：${cliSays}`,
      };
    }
  },

  availability(ctx: AdapterContext) {
    // 同 agy：「未探过」与「探过但没找到」要分开答，判据用 probed_at 而非 `!p`（AGY-01）。
    const p = ctx.cfg.probe.cli.zcode;
    if (!p?.probed_at) {
      return { ok: false, reason: 'zcode 尚未探测，请先运行 trivium doctor --only zcode', fix: 'doctor' };
    }
    // 入口可能挪了；真卸载了 doctor 会给出「未找到入口」的明确结论（EV-251 计划 r2 D1）
    const problem = entryProblem(ctx.cfg);
    if (problem) return { ok: false, reason: problem, fix: 'doctor' };
    /*
     * 布局判据要**先于**旗标判空（r2 CODEX-02 ≡ AGY-04）：内置 provider 配置定位不到时，
     * 参数解析根本没发生（P-29），`readonly_flags` 为空是布局失败的**后果**而不是独立结论。
     * 先判旗标，人拿到的会是「无可用只读旗标、请升级 ZCode」——往升级方向查，永远查不到。
     *
     * 判据是严格 `=== null`（探过、没找到）。旧结论文件没有这一格时值是 `undefined`，
     * 那是「未探过」，不该在这里拦人——`probed_at` 那一支已经管住它了。
     */
    if (p.provider_config?.builtin_file === null) {
      return { ok: false, reason: p.entrypoint + '：' + ZCODE_PROVIDER_CONFIG_UNRESOLVED_HINT };
    }
    if (p.readonly_flags.length === 0) {
      return {
        ok: false,
        /*
         * 后半句是 r3 CODEX-F01-03：空集**仍有**第二种成因没被这里区分开——
         * 「新结论文件 + 本轮未判定」时保留的是初始 `[]`，而「本轮未判定」这个事实不落盘
         * （它是探测过程的属性，落盘就过期），`availability()` 读不到它。
         * 不能为此把状态加进结论文件，能做的是**别把人引向唯一那个错方向**：
         * 旧文案只说「升级 ZCode」，而这一格为空最常见的原因恰恰是布局问题导致本轮没判成。
         */
        reason:
          p.entrypoint + '：探针未实测到任何可用的只读参数组合，无法保障审查员只读，该侧不可用。' +
          '若 doctor notes 里记了「本轮未判定」（provider 配置定位失败，参数解析根本没发生），' +
          '先重跑 trivium doctor --only zcode 并核对 ZCode 安装布局，而不是升级 ZCode',
      };
    }
    /*
     * `--disallowed-tools` 是硬前置：probes/zcode.ts 与 ZCODE_READONLY_DENYLIST 的注释
     * 都写明 `--mode plan` 并不阻止命令执行，完整 denylist 里的 Bash 是必需项。
     * 原先只要 readonly_flags 非空就判可用——某个版本把 --disallowed-tools 改名后，
     * 审查员会在没有任何工具级 denylist 的情况下跑起来，失守只能事后靠轨迹发现。
     */
    if (!p.readonly_flags.some((f) => f.startsWith('--disallowed-tools'))) {
      return {
        ok: false,
        reason:
          p.entrypoint + '：探针未实测到 --disallowed-tools 被接受：仅靠 --mode plan 挡不住 Bash 写入（M0 实测），' +
          '无法保障审查员只读，该侧不可用。请重跑 trivium doctor 或升级 ZCode',
      };
    }
    if (p.response_field === null) {
      return { ok: false, reason: p.entrypoint + '：' + ZCODE_HEADLESS_NOT_OK_HINT };
    }
    return { ok: true, note: p.entrypoint ?? undefined };
  },

  /** 凭据载体在 `<侧>/home/.zcode/cli/config.json`，由 `prepareZcodeHome` 写入；抹除见 `scrubZcodeHome` */
  async scrubRunDir(sideDir: string, opts?: { sizeCap?: number }) {
    return scrubZcodeHome(zcodeHomeUnder(sideDir), opts);
  },

  async run(ctx: AdapterContext, req: CriticRequest): Promise<CriticResult> {
    const probe = ctx.cfg.probe.cli.zcode;
    // 两态判据同 availability()：以 probed_at 区分（AGY-01）。
    if (!probe?.probed_at) {
      return failedResult('glm', {
        status: 'failed',
        reason: 'zcode 尚未探测，请先运行 trivium doctor --only zcode',
      });
    }
    if (!probe.entrypoint) {
      return failedResult('glm', { status: 'failed', reason: 'zcode 入口未探测到' });
    }
    const problem = entryProblem(ctx.cfg);
    if (problem) return failedResult('glm', { status: 'failed', reason: problem });
    const entry = probe.entrypoint;

    await ensureDir(req.out_dir);
    const stdoutPath = path.join(req.out_dir, 'stdout.json');
    const tracePath = path.join(req.out_dir, 'trace.json');

    // 只读参数以探针实测「实际被接受」的为准，并强制补全 denylist
    const readonlyArgs = readonlyArgsFromProbe(probe.readonly_flags);

    /*
     * 模型覆盖（EV-82）：`prepareZcodeHome` 自己按副本源 `cli/config.json` 的 provider 键限定
     * 请求模型并写进副本的 `model.main`（不再用探针的 `model_id_form`——它与副本源异源，r3 CODEX-03）。
     *
     * 覆盖生效的前提：**副本 HOME 下不注入个人 provider 配置**。个人文件存在时 CLI 直接用它、
     * 不做 legacy 导入，副本里的 `model.main` 没人读——EV-81 注入指向真实文件的变量正是这样
     * 把 `config_copy` 档关掉的。所以只要有副本 HOME 就省略个人键，与旗标探针同一形态。
     * CLI 会把导入结果写成副本 HOME 下的 `v2/provider_config.json`，已在清扫载体清单里。
     */
    /*
     * 请求模型置首（EV-82 第三段 r3 §3）：0.16.9 下副本默认在运行期被判不可选、回落「第一个可见 provider 的第一个模型」
     * （第二段实验落 (F1)），把请求排到首位，回落就落在它上面。只动顺序；挪不动照常拉起，由守卫按结果判。
     */
    const sideDir = path.dirname(req.out_dir);
    const home = await prepareZcodeHome(sideDir, req.model, { requestedFirst: true });
    /*
     * CLI 产物的落点根（EV-112 计划 r3 §4.2）：两支都指到 `zcodeHomeUnder(sideDir)`。副本支 HOME 就是它，三键取值与缺省相同；
     * 无副本支 HOME 仍是真实目录（个人配置、凭据照旧），日志 / 存储根 / 会话库由这三个键拉回运行目录、进清扫面。
     * 设了存储根还让 CLI 启动期的 beta 改写早退，副本源里的 `storage.*` 也被 Env 层压过。
     */
    const landingRoot = zcodeHomeUnder(sideDir);
    const overrideAttempted = home.route === 'config_copy';

    // 反向核只扫这之后改过的真实 HOME 日志文件（代码双审 r1 CODEX-01）；留 1 秒余量，防文件系统时间戳粒度
    const launchedAt = Date.now() - 1000;
    let out: ZcodeInvokeOutcome;
    try {
      out = await invokeZcode({
        stdoutTarget: { path: stdoutPath, attempt: ctx.attempt ?? 1 },
        entry,
        node: ctx.nodePath,
        cwd: req.project_root,
        prompt: req.brief_text,
        readonlyArgs,
        homeDir: home.homeDir,
        omitPersonalProviderConfig: home.homeDir !== null,
        storageRedirectRoot: landingRoot,
        timeoutMs: req.timeout_s * 1000,
      });
    } catch (e) {
      return failedResult('glm', { status: 'failed', reason: `拉起 zcode 失败：${(e as Error).message}` });
    }


    if (out.timedOut) {
      return failedResult('glm', {
        status: 'timeout',
        reason: `脚本级超时（${req.timeout_s}s）`,
        exitCode: out.exitCode,
        processStarted: out.spawned,
        durationS: out.durationMs / 1000,
        rawStdoutPath: stdoutPath,
        cliVersion: probe.version,
        commandLine: out.commandLine,
        sessionId: out.envelope?.sessionId ?? null,
      });
    }

    if (out.failureKind !== 'none' || !out.envelope) {
      const hint =
        out.failureKind === 'model_config_missing'
          ? '缺 ~/.zcode/cli/config.json（CLI 的模型配置独立于桌面端）'
          : out.failureKind === 'provider_not_configured'
            ? 'provider 鉴权失败，检查 config.json 里的 apiKey'
            : // 与探活、availability() 同一段文案（r2 AGY-04）：没有这一支时它落到裸 stderr，
              // 读留痕的人看到的是 CLI 的一行原话，看不出「这是安装布局问题」
              out.failureKind === 'provider_config_unresolved'
              ? `${ZCODE_PROVIDER_CONFIG_UNRESOLVED_HINT}：${redactSecrets(out.stderr.slice(0, 200)).content}`
              : redactSecrets(out.stderr.slice(0, 300)).content;
      return failedResult('glm', {
        status: 'failed',
        reason: `zcode 执行失败（${out.failureKind}）：${hint}`,
        exitCode: out.exitCode,
        processStarted: out.spawned,
        durationS: out.durationMs / 1000,
        rawStdoutPath: stdoutPath,
        cliVersion: probe.version,
        commandLine: out.commandLine,
        sessionId: out.envelope?.sessionId ?? null,
      });
    }

    // ── 轨迹：两个来源缺一不可 ──
    const sessionId = out.envelope.sessionId;
    // 两支同一个式子（EV-112）：不再回落 os.homedir()——无副本支的产物已被三键指到运行目录，读真实 HOME 只会读到别的会话
    const cliDir = path.join(landingRoot, ZCODE_CLI_SUBDIR);

    let toolCalls: CriticResult['tool_calls'] = {};
    let writeEvents: string[] = [];
    let modelFromLog: string | null = null;
    /** MCP 调用的两份来源（EV-188）：`null` = 该来源没读到，与「读到了、0 次」区分 */
    let mcpFromLog: Record<string, number> | null = null;
    let mcpIdsFromLog: Record<string, string> | null = null;
    let mcpFromRollout: ZcodeRolloutToolCall[] | null = null;
    /*
     * 日志：工具名、状态、model。仍按 sessionId 过滤。
     * 读日志目录下**全部** `.jsonl`（按文件名即日期排序后拼接），与落点自检同一个文件集合（代码双审 r1 CODEX-02）：
     * 两支的日志目录都是本次运行独占的（落点根 `zcodeHomeUnder(sideDir)`），目录里的文件全属于本次运行；
     * 只取最新一个的话，跨午夜时启动事件落在前一天的文件里，会出现「自检说日志在、回读说读不到」。
     */
    try {
      const logDir = path.join(cliDir, 'log');
      const files = (await fs.readdir(logDir)).filter((f) => f.endsWith('.jsonl')).sort();
      if (files.length > 0) {
        const texts = await Promise.all(files.map((f) => fs.readFile(path.join(logDir, f), 'utf8')));
        const t = parseZcodeTrace(texts.join('\n'), sessionId);
        toolCalls = t.toolCalls;
        writeEvents = t.writeEvents;
        modelFromLog = t.modelEffective;
        mcpFromLog = t.mcpCalls;
        mcpIdsFromLog = t.mcpCallIds;
      }
    } catch {
      /* 日志不可读不致命，交给 guard 按证据不足处置 */
    }

    // rollout：工具参数（路径）与 model.source。读取路径**只能**从这里取
    let readPathList: string[] = [];
    /*
     * 路径提取覆盖率（设计 10.1.1 第②层）。`null` = 该轮没读到 rollout，
     * 与「读到了但分母为 0」是两件事——前者该记未知，后者说明本轮没有必带路径的调用。
     */
    let coverage: { total: number; withPath: number } | null = null;
    let modelFromRollout: string | null = null;
    if (sessionId) {
      // 文件名是 `model-io-` + sessionId，sessionId 自带 sess_ 前缀（坑 P-14）
      const rolloutFile = path.join(cliDir, 'rollout', `model-io-${sessionId}.jsonl`);
      if (await exists(rolloutFile)) {
        const ro = parseZcodeRollout(await fs.readFile(rolloutFile, 'utf8'));
        readPathList = ro.readPaths;
        coverage = ro.pathCoverage;
        modelFromRollout = ro.modelEffective;
        writeEvents = [...new Set([...writeEvents, ...ro.writeEvents])];
        mcpFromRollout = ro.toolCalls;
        await fs.copyFile(rolloutFile, path.join(req.out_dir, 'rollout.jsonl'));
      }
    }

    /*
     * MCP 调用（EV-188，计划 r2 §2.2–§2.3）：只检测、不关通道。执行型（`ZCODE_MCP_EXEC_PREFIXES`）进写事件、判只读失守；
     * 名单外的进 `mcp_untrusted_tools`、由 guard 记证据不可信。`mcp` 计数键与 trace.json 的 `mcpCalls` **只在 ≥ 1 次时写**：
     * 无 MCP 调用的运行与改前逐字相同；「没读到」由路径档位 `no-counts` 与落点自检另说。
     */
    const mcp = summarizeZcodeMcp(mcpFromRollout, mcpFromLog, mcpIdsFromLog);
    if (mcp.total > 0) {
      toolCalls = { ...toolCalls, mcp: mcp.total };
      writeEvents = [...new Set([...writeEvents, ...mcp.execEvents])];
    }

    const modelEffective = modelFromLog ?? modelFromRollout;

    // 落点自检（EV-112 计划 r3 §4.6）：成功返回且有 sessionId 才核；无副本支另做反向核（真实 HOME 就是 os.homedir()）
    const carriersLanded = sessionId
      ? await checkZcodeCarriers(cliDir, sessionId, home.homeDir === null ? os.homedir() : null, launchedAt)
      : undefined;

    /*
     * ── 模型覆盖是否真的落实（EV-82 的回归守卫）──
     *
     * EV-82 之所以要三轮双审才被逮到，正是因为它**静默**：探活能过、审查跑得起来，
     * 只是跑的不是请求的那个模型。ZCode 下一次挪读取点时，没有这道比对就会原样复发。
     *
     * **判据只看 `modelId` 段**（`zcodeModelTail`）：P-31 记着
     * `bigmodel-coding-plan/…` 与 `<providerUUID>/…` 两种形态并存，而回读值取自
     * 日志的 `context.model`、形态由 CLI 决定。拿整串判等式会把已生效的覆盖误报成未生效，
     * 而误报会当场把这条新通道打成噪声。`providerId` 段的差异只落 trace.json 的 note。
     *
     * **三格之外的情形一律不产出这个字段**（`undefined`）：没做覆盖尝试就没有「是否落实」
     * 这个问题。字段缺席与 `null` 是两件事——后者的唯一含义是「尝试了、但没回读到生效模型」。
     */
    const override = decideModelOverride(overrideAttempted, home.qualified, modelEffective);
    // 没做覆盖的那一格（EV-122）：第二参是请求原值 req.model，不是恒为 null 的 home.qualified（计划双审 CODEX-03）
    const unenforced = decideModelUnenforced(overrideAttempted, req.model, modelEffective, home.cause, home.reason);
    // 置首后 true 只说明「跑的是请求模型」，说明不了「副本默认被采信」（r3 §4.1）；后者归 doctor 的 zcode.runtime_selection
    const selectionNote =
      // 只陈述可观测事实（代码双审 r1 CODEX-03）：置首之后「靠置首」与「副本默认被采信」分不开，因果不在这里下
      [
        override.note,
        home.reorder?.kind === 'applied' && override.applied === true
          ? '请求模型已置首，读回的正是它；是否靠置首不可分，见 doctor 的 zcode.runtime_selection'
          : null,
      ]
        .filter((x): x is string => x !== null)
        .join('；') || null;

    await fs.writeFile(
      tracePath,
      JSON.stringify(
        {
          toolCalls,
          readPaths: readPathList,
          writeEvents,
          sessionId,
          modelSelection: {
            requested: home.qualified,
            effective: modelEffective,
            route: home.route,
            ...(home.reason ? { reason: home.reason } : {}),
            ...(home.reorder
              ? { reorder: { applied: home.reorder.applied, kind: home.reorder.kind, ...(home.reorder.reason ? { reason: home.reorder.reason } : {}) } }
              : {}),
            ...(selectionNote ? { note: selectionNote } : {}),
          },
          ...(carriersLanded ? { carriersLanded } : {}),
          // 按工具名的 MCP 调用明细（EV-188 决策三），供排查；与 tool_calls.mcp 同口径，0 次不写
          ...(mcp.total > 0 ? { mcpCalls: { total: mcp.total, byTool: mcp.byTool, sources: mcp.sources } } : {}),
        },
        null,
        2,
      ),
      'utf8',
    );

    return {
      critic: 'glm',
      status: 'ok',
      exit_code: out.exitCode,
      process_started: out.spawned ?? out.exitCode !== null,
      duration_s: out.durationMs / 1000,
      raw_stdout_path: stdoutPath,
      trace_path: tracePath,
      review_json: null, // 由 parse 填充
      raw_response_text: out.envelope.response,
      model_effective: modelEffective,
      // envelope 没有 model 字段，因此来源只能是 trace 或 unverified，绝不用 requested 冒充
      model_effective_source: modelEffective ? 'trace' : 'unverified',
      /*
       * 同 agy：本族无这两种事实，恒 null 且说得出理由。
       * zcode 的模型 id 自带 `bigmodel-coding-plan/` 前缀，那是**套餐**不是 provider 家族；
       * 配置段 `GlmCriticConfig` 也没有 `profile` 键。
       */
      model_provider: null,
      profile_requested: null,
      /*
       * `model_route` 记的是**模型覆盖走了哪一档**。`config_copy` 在 0.16.9 下仍是生效的那一档
       * ——前提是不注入个人 provider 配置（EV-82 根因改判，见 `prepareZcodeHome`）；
       * 限定失败或没指定模型时如实记 `global`，理由在 trace.json 的 `modelSelection.reason`。
       */
      model_route: home.route,
      // 产出条件＝本次确实尝试了覆盖；值为 null 时唯一含义是「尝试了、没回读到生效模型」
      ...(overrideAttempted ? { model_override_applied: override.applied ?? null } : {}),
      /*
       * 置首结论只供 guard 当轮判定（r3 §3.4）：review.ts 不透传它，run.json 不收；持久留痕在 trace.json 的
       * modelSelection.reorder。run.v2 的 critic 段不拦多余字段，这条边界由负向用例锁住
       */
      ...(home.reorder
        ? { model_override_reorder: { applied: home.reorder.applied, kind: home.reorder.kind, ...(home.reorder.reason ? { reason: home.reorder.reason } : {}) } }
        : {}),
      // 落点自检（EV-112）：没走到自检（无 sessionId）即缺席；review.ts 条件展开写进 run.json，guard 按它播报
      ...(carriersLanded ? { carriers_landed: carriersLanded } : {}),
      // 没做覆盖而实际模型不同（EV-122）：与 model_override_applied 互斥，缺席即不成立
      ...(unenforced ? { model_unenforced: unenforced } : {}),
      tool_calls: toolCalls,
      read_paths: readPathList,
      // zcode 轨迹只有 toolCalls[].input，没有工具输出——该族无此事实
      search_hit_paths: null,
      /*
       * 覆盖率两项**恒写**（r2 代码双审 GLM-08 ≡ CODEX-10）。
       *
       * 上一版在读不到 rollout 时整体省略这两个键，判定层据此记 `unavailable`——
       * 结论是对的，可**成因丢了**：字段缺失在契约里的含义是「该族没有这个概念，
       * 或这份留痕早于本字段」，而这里的真相是「本族有这个概念、这次没采到」。
       * 两者的处置完全不同：前者没法修，后者是该查轨迹文件为什么读不到。
       *
       * 写 `null` 把这件事说清楚，判定层仍记 `unavailable`（成因 `no-counts`）。
       */
      path_bearing_reads: coverage ? coverage.total : null,
      path_bearing_reads_with_path: coverage ? coverage.withPath : null,
      write_events: writeEvents,
      // 名单外的 MCP 调用（EV-188）：只在非空时产出，guard 据此记证据不可信
      ...(mcp.untrustedTools.length > 0 ? { mcp_untrusted_tools: mcp.untrustedTools } : {}),
      /*
       * zcode 侧**恒为空数组**，而这是能说明理由的空：只读组合里 `Bash` 被整个禁掉
       * （M0 的 C-10：`--mode plan` 单独不够，denylist 必须含 `Bash`），
       * 该侧压根产生不了命令事件。空数组的含义是「**没有命令**」而不是「没采集」。
       *
       * **这个前提由 `bashStillDenied` 在运行期断言，不靠注释**（审查意见 GLM-05）：
       * 初版这里写的是「若哪天放开了 `Bash`，这一行要跟着改」——
       * 纯记性约定，而 AGENTS.md 纪律 12 明令这类纪律要换成不依赖记性的机制。
       * 真放开了 `Bash` 而这里仍恒空，措施 b 会在该侧**静默失效**。
       *
       * 断言喂的是 `readonlyArgs`——**真正递给 CLI 的那串 argv**，不是
       * `probe.readonly_flags`（r5 GLM-05）。后者只是探针那个固定候选串的
       * 「被接受」记录，与实际传参是两个源：`readonlyArgsFromProbe` 无条件
       * 把 `ZCODE_READONLY_DENYLIST` 推进 argv，所以从那个常量里删掉 `Bash`
       * 不会让探针记录有任何变化——断言照旧通过，而措施 b 已经死了。
       * 断言必须守着实际生效的东西，守候选记录等于没守。
       */
      command_texts: bashStillDenied(readonlyArgs)
        ? []
        : (() => {
            throw new Error(
              'zcode 实际递出的只读参数里不再禁用 Bash（readonlyArgs = ' +
                `${JSON.stringify(readonlyArgs)}），而适配器仍把 command_texts 恒记为空。\n` +
                '  该侧现在能跑命令了，措施 b（§10.1 命令文本扫描）会静默失效——\n' +
                '  要么在这里真从轨迹提取命令原文，要么把 Bash 加回 ZCODE_READONLY_DENYLIST。',
            );
          })(),
      evidence_ok: false, // 由 guard 判定
      fail_reason: null,
      session_id: sessionId,
      usage: out.envelope.usage,
      cli_version: probe.version,
      // M0 实测：denylist 是工具级而非路径级，此项恒为 false
      /*
       * **读 `file_shape_verified`，不读 `supported`**（BACKLOG EV-42，代码双审 r4 CODEX-03）。
       *
       * `supported` 回答「这家 CLI 有没有路径级 deny 机制」；这一格回答的是
       * **「本机曾实测该逐文件形状可拦」**——两件事。
       *
       * **措辞要准**（代码双审 r2 GLM-01）：上一版这里写的是「本次注入的那些逐文件
       * 路径真的挡住了」，那**比字段能知道的更多**——它的取值来自探针夹具里的
       * 单条 ASCII 路径，对**本次**注入的那批规则（可能含被跳过的、含 glob 元字符的）
       * 一无所知。逐条结果看 `trace.json` 的 `denySettings.skippedPaths`。
       *
       * 三态在这里天然安全：`null`（没验过）与 `false` 都判不过 `=== true`。
       */
      peer_deny_applied: probe.path_deny.file_shape_verified === true,
      /*
       * 该侧不注入 `--settings`（无路径级 deny 机制），**恒为 0 且这是能说明理由的零**：
       * 含义是「没有这种概念」，不是「注入了但一条都没跳过」。
       */
      deny_skipped: 0,
      deny_rule_count: 0,
    deny_bytes: 0,
      command_line: out.commandLine,
    };
  },
};
