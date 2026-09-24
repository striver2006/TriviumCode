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
 *     三个变量一律清掉，见 `zcodeProviderEnv`（计划双审 r3 CODEX-02）。
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
import { promises as fs } from 'node:fs';
import type { CriticRequest, CriticResult } from '../types.js';
import { run } from '../util/exec.js';
import { ensureDir, exists, sha256File } from '../util/fsx.js';
import {
  parseZcodeEnvelope,
  parseZcodeRollout,
  parseZcodeTrace,
  type ZcodeEnvelope,
} from './zcode-trace.js';
import {
  failedResult,
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
 * `model_id_form` 记的是上一次真实 HOME 运行回读的生效模型——即个人配置的默认（本机此刻是
 * `<providerUUID>/qwen3.8-max`），与副本源 `cli/config.json` 的 provider 键**异源**；副本里的限定
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
 */
export const ZCODE_ARGV_PARSED_RE =
  /Model creation failed|Model config is missing|provider is missing an API key|provider_not_configured|Provider authentication failed/i;

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
  `CLI 未定位到内置 provider 配置（坑 P-28）：0.16.9 起 CLI 按入口目录推算 zcode-builtin.json，` +
  `应用包布局下推算不到；编排器按 ${ZCODE_BUILTIN_PROVIDER_ENV} 注入 ` +
  `<入口目录>/../config/provider/zcode-builtin.json，本机该文件不存在或 ZCode 安装布局已变。` +
  `这是**安装布局**问题而非凭据问题，请核对 ZCode 安装布局`;

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
    builtin: path.resolve(path.dirname(real), '../config/provider/zcode-builtin.json'),
    personal: path.join(userHome, '.zcode/v2/provider_config.json'),
  };
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
 * ## 三个 `ZCODE_*` 目录变量恒清（计划双审 r3 CODEX-02）
 *
 * 包内 `FZi(prepareCliProviderRuntimeEnv)` 在 `--prompt` 形态下按
 * `dataBaseDir ?? env.ZCODE_DATA_BASE_DIR ?? os.homedir()` 推导个人路径并写回 `process.env`，
 * 凭据根（`gUs`）与遥测状态也读它。宿主预置该变量 → 个人文件在**副本之外**「存在」→ 导入被跳过
 * ——本轮根因换个入口复发，且 CLI 自写的凭据文件落到清扫论域**之外**。
 * C-08「这三个变量对配置解析无效」是 0.16.5 对 `cli/config.json` 的结论，对 0.16.9 的 provider
 * 配置根**不成立**。判据仍是「子进程拿不到」而不是「编排器没主动给」，故三键恒置 `undefined`。
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
    ...Object.fromEntries(ZCODE_DIR_ENV_KEYS.map((k) => [k, undefined])),
  };
  if (await exists(p.builtin)) env[ZCODE_BUILTIN_PROVIDER_ENV] = p.builtin;
  if (!opts.omitPersonal && (await exists(p.personal))) env[ZCODE_PERSONAL_PROVIDER_ENV] = p.personal;
  return env;
}

/**
 * 0.16.9 会改变 provider 配置根 / 凭据根 / 存储根的三个目录变量。拉起时一律从子进程环境里删掉，
 * 让根目录只由 `HOME` 决定——那才是副本隔离与清扫论域的边界（r3 CODEX-02）。
 */
export const ZCODE_DIR_ENV_KEYS: readonly string[] = ['ZCODE_DATA_BASE_DIR', 'ZCODE_HOME', 'ZCODE_STORAGE_DIR'];

/**
 * 宿主环境里可能带着的凭据/端点变量。**只在探针路径清**（代码双审 r1 codex 子项 03 ≡ AGY-02）：
 * 探针副本里的 apiKey 是哨兵，前提是 CLI 拿不到别的凭据通道；而审查运行继承宿主凭据 env 是应有之义。
 * `ZCODE_API_KEY` 在 0.16.9 包内已零命中（M0 §6.2 是 0.16.5 快照），`ZCODE_BASE_URL` 仍在——一并清是 fail-closed，不是断言它们生效。
 */
export const ZCODE_CREDENTIAL_ENV_KEYS: readonly string[] = ['ZCODE_API_KEY', 'ZCODE_BASE_URL'];

export interface ZcodeInvokeOptions {
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
  timeoutMs: number;
}

export interface ZcodeInvokeOutcome {
  envelope: ZcodeEnvelope | null;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  commandLine: string;
  durationMs: number;
  failureKind: 'none' | 'model_config_missing' | 'provider_not_configured' | 'provider_config_unresolved' | 'other';
}

/** zcode 的 argv 拼装。纯函数，与执行分离，让 M0 调用配方有回归测试 */
export function buildZcodeArgs(opts: Pick<ZcodeInvokeOptions, 'entry' | 'prompt' | 'cwd' | 'readonlyArgs'>): string[] {
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
  if (opts.homeDir) env['HOME'] = opts.homeDir;

  const r = await run(opts.node, args, { cwd: opts.cwd, env, timeoutMs: opts.timeoutMs, killTree: true });

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
      if (carrierExisted) out.deleted.push(path.join(dirName, rel));
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
  out.removedOnHit = scan.removed.map((p) => path.join(dirName, p));
  /*
   * 论域内扫不进去的二进制整删（EV-36）。本侧自己的 sqlite 在 `db/` 下、已按前缀排除，
   * 这一格接的是**操作系统写进假 HOME 的副产品**——实测 `Library/Caches/com.apple.python 下的 .pyc`
   * （36 份 Xcode 自带 Python 框架的字节码，HOME 被重定向后由系统写入）。
   * 它们此前让该侧 `complete` 恒为 false：一条永不收工、也无动作可消除的待办。
   */
  out.unscannableDeleted = scan.unscannableRemoved.map((p) => path.join(dirName, p));
  for (const [rel, n] of Object.entries(scan.redacted)) out.redacted[path.join(dirName, rel)] = n;
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
 * 为什么不再用探针的 `model_id_form` 补前缀：那个值记的是**上一次真实 HOME 运行回读到的生效模型**
 * ——即个人配置的默认（本机此刻是 `<providerUUID>/qwen3.8-max`），而 legacy 导入后注册表里的
 * providerId 是 `cli/config.json` 的 provider **键**（`bigmodel-coding-plan`）。两者异源，拼出来的
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
export async function prepareZcodeHome(
  runDir: string,
  model: string | null,
  opts: {
    // `srcConfig` 只为可测性：不开这个口子，用例只能吃真实的 `~/.zcode/cli/config.json`（含凭据）
    srcConfig?: string;
    /**
     * 在**写盘之前**改写副本对象（EV-82 小主题第一段 r2 §3.1）。只给同形探针臂用：
     * 它要把凭据换成哨兵，写盘前换才没有「先写真实凭据、再覆写」的窗口（AGY-03）。
     * **审查臂不传**；不传时本函数的输出与加这个参数之前逐字相同（有用例锁住）。
     */
    transformCopy?: (cfg: ZcodeCliConfigShape) => ZcodeCliConfigShape;
  } = {},
): Promise<ZcodeHomePrep> {
  const srcConfig = opts.srcConfig ?? path.join(os.homedir(), '.zcode/cli/config.json');
  if (!(await exists(srcConfig))) {
    return {
      homeDir: null,
      route: 'global',
      qualified: null,
      reason: `未找到 ${srcConfig}，无法做模型覆盖；将沿用 ZCode CLI 的全局默认`,
    };
  }
  if (!model) return { homeDir: null, route: 'global', qualified: null, reason: '本次未指定模型' };

  const homeDir = zcodeHomeUnder(runDir);
  const dstDir = path.join(homeDir, ZCODE_CLI_SUBDIR);
  await ensureDir(dstDir);

  const cfg = JSON.parse(await fs.readFile(srcConfig, 'utf8')) as ZcodeCliConfigShape;
  const q = qualifyAgainstCliConfig(model, cfg);
  // 模型 id 必须是 <providerKey>/<modelId> 全限定形态（坑 P-06），且 providerKey 与本副本同源（r3 CODEX-03）
  if (q.qualified !== null) cfg.model = { main: q.qualified, lite: q.qualified };
  const toWrite = opts.transformCopy ? opts.transformCopy(cfg) : cfg;

  await fs.writeFile(path.join(dstDir, 'config.json'), JSON.stringify(toWrite, null, 2), 'utf8');
  // 配置副本含凭据，权限收紧
  await fs.chmod(path.join(dstDir, 'config.json'), 0o600);

  if (q.qualified === null) {
    return { homeDir, route: 'global', qualified: null, reason: `${q.reason}；副本已建但不做模型覆盖` };
  }
  return { homeDir, route: 'config_copy', qualified: q.qualified };
}

export const zcodeAdapter: CriticAdapter = {
  critic: 'glm',
  /*
   * 专用读工具带独立路径字段，被拒操作留痕。本侧 `Bash` 全禁，`command_texts`
   * 恒空（见本文件 §96 的说明），`command-trace` 的回填路径对它是空操作——
   * 但仍如实声明为 `tool-trace`：能力说的是「轨迹是什么形状」，不是「本次采到了什么」。
   */
  capability: TOOL_TRACE_CAPABILITY,

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

  /**
   * 探活（M8 第 3 步从 `preflight` 搬来）。
   *
   * 指纹取 `~/.zcode/cli/config.json`：CLI 的 provider 配置**独立于桌面端**，
   * 「桌面端已登录」不等于 CLI 可用（M0 实测），所以判据只认这个文件。
   */
  authProbe(ctx: AdapterContext, projectRoot: string) {
    const cfg = ctx.cfg;
    return {
      async fingerprint() {
        const f = path.join(os.homedir(), '.zcode/cli/config.json');
        return (await exists(f)) ? sha256File(f) : null;
      },
      async probe() {
        const entry = cfg.probe.cli.zcode?.entrypoint ?? null;
        if (!entry) return { ok: false, detail: 'zcode 入口未记录' };
        const out = await invokeZcode({
          entry,
          node: ctx.nodePath,
          cwd: projectRoot,
          prompt: '只回复 OK 两个字母，不要调用任何工具。',
          readonlyArgs: readonlyArgsFromProbe(cfg.probe.cli.zcode?.readonly_flags ?? []),
          homeDir: null,
          /*
           * 180s，与搬家前 `preflight` 里的值一致（r9 双审 GLM-07）。
           * M8 第 3 步把探活搬进适配器时手抄成了 120s——**一次搬家不该顺带改行为**。
           * 本侧要起 node 子进程再拉 CLI，比 agy 慢，那 60 秒是当初特意给的。
           */
          timeoutMs: 180_000,
        });
        const ok = out.failureKind === 'none' && !out.timedOut && out.envelope !== null;
        return {
          ok,
          detail: ok
            ? `探活通过（${Math.round(out.durationMs / 1000)}s）`
            : out.failureKind === 'model_config_missing'
              ? '缺 ~/.zcode/cli/config.json（CLI 的模型配置独立于桌面端，「已登录」不等于可用）'
              : // CLI 原话过一遍脱敏再进详情（r5 CODEX-06）：这段文字会进 doctor / preflight 输出，
                // 而那些输出的实际流转方式是被人抄进 git 里的 evidence 目录，那条路上没有闸门
                out.failureKind === 'provider_config_unresolved'
                ? `${ZCODE_PROVIDER_CONFIG_UNRESOLVED_HINT}：${redactSecrets(out.stderr.slice(0, 200)).content}`
                : `探活失败（${out.failureKind}）：${redactSecrets(out.stderr.slice(0, 200)).content}`,
        };
      },
    };
  },

  availability(ctx: AdapterContext) {
    // 同 agy：「未探过」与「探过但没找到」要分开答，判据用 probed_at 而非 `!p`（AGY-01）。
    const p = ctx.cfg.probe.cli.zcode;
    if (!p?.probed_at) {
      return { ok: false, reason: 'zcode 尚未探测，请先运行 trivium doctor --only zcode' };
    }
    if (!p.entrypoint) return { ok: false, reason: '探针未找到 zcode.cjs 入口，请先运行 trivium doctor' };
    /*
     * 布局判据要**先于**旗标判空（r2 CODEX-02 ≡ AGY-04）：内置 provider 配置定位不到时，
     * 参数解析根本没发生（P-29），`readonly_flags` 为空是布局失败的**后果**而不是独立结论。
     * 先判旗标，人拿到的会是「无可用只读旗标、请升级 ZCode」——往升级方向查，永远查不到。
     *
     * 判据是严格 `=== null`（探过、没找到）。旧结论文件没有这一格时值是 `undefined`，
     * 那是「未探过」，不该在这里拦人——`probed_at` 那一支已经管住它了。
     */
    if (p.provider_config?.builtin_file === null) {
      return { ok: false, reason: ZCODE_PROVIDER_CONFIG_UNRESOLVED_HINT };
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
          '探针未实测到任何可用的只读参数组合，无法保障审查员只读，该侧不可用。' +
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
          '探针未实测到 --disallowed-tools 被接受：仅靠 --mode plan 挡不住 Bash 写入（M0 实测），' +
          '无法保障审查员只读，该侧不可用。请重跑 trivium doctor 或升级 ZCode',
      };
    }
    if (p.response_field === null) {
      return { ok: false, reason: ZCODE_HEADLESS_NOT_OK_HINT };
    }
    return { ok: true };
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
    const home = await prepareZcodeHome(path.dirname(req.out_dir), req.model);
    const overrideAttempted = home.route === 'config_copy';

    let out: ZcodeInvokeOutcome;
    try {
      out = await invokeZcode({
        entry,
        node: ctx.nodePath,
        cwd: req.project_root,
        prompt: req.brief_text,
        readonlyArgs,
        homeDir: home.homeDir,
        omitPersonalProviderConfig: home.homeDir !== null,
        timeoutMs: req.timeout_s * 1000,
      });
    } catch (e) {
      return failedResult('glm', { status: 'failed', reason: `拉起 zcode 失败：${(e as Error).message}` });
    }

    await fs.writeFile(stdoutPath, out.stdout, 'utf8');

    if (out.timedOut) {
      return failedResult('glm', {
        status: 'timeout',
        reason: `脚本级超时（${req.timeout_s}s）`,
        exitCode: out.exitCode,
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
        durationS: out.durationMs / 1000,
        rawStdoutPath: stdoutPath,
        cliVersion: probe.version,
        commandLine: out.commandLine,
        sessionId: out.envelope?.sessionId ?? null,
      });
    }

    // ── 轨迹：两个来源缺一不可 ──
    const sessionId = out.envelope.sessionId;
    const cliDir = path.join(home.homeDir ?? os.homedir(), '.zcode/cli');

    let toolCalls: CriticResult['tool_calls'] = {};
    let writeEvents: string[] = [];
    let modelFromLog: string | null = null;
    // 日志：工具名、状态、model。共享 HOME 时必须按 sessionId 过滤
    try {
      const logDir = path.join(cliDir, 'log');
      const files = (await fs.readdir(logDir)).filter((f) => f.endsWith('.jsonl')).sort();
      const latest = files.at(-1);
      if (latest) {
        const t = parseZcodeTrace(await fs.readFile(path.join(logDir, latest), 'utf8'), sessionId);
        toolCalls = t.toolCalls;
        writeEvents = t.writeEvents;
        modelFromLog = t.modelEffective;
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
        await fs.copyFile(rolloutFile, path.join(req.out_dir, 'rollout.jsonl'));
      }
    }

    const modelEffective = modelFromLog ?? modelFromRollout;

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
            ...(override.note ? { note: override.note } : {}),
          },
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
