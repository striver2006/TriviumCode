/**
 * `trivium` 命令行入口（设计 §5.1 `cli` 模块 / §7.3 退出码约定）。
 *
 * 职责严格限定为：子命令解析、退出码约定、人读与 `--json` 机读输出。
 * **不做任何业务判定**——所有判定都在各自模块里。
 */
import path from 'node:path';
import { exists } from './util/fsx.js';
import { promises as fsp } from 'node:fs';
import { EXIT, TriviumError, usageError, missingArtifact as missingArtifactError } from './exit-codes.js';
import { applyProfileOverride, loadCtx, resolveAssetRoot, runRoot } from './config.js';
import {
  AGENTS, ALL_AGENT_IDS, CRITIC_AGENT_IDS, DEFAULT_DRIVER, DRIVER_AGENT_IDS, agentById, entryCommandOf,
} from './agents/registry.js';
import { effectiveGuardLevel, gateHoldNotice, L2_AFTER_THE_FACT } from './hook-config.js';
import {
  runDoctor,
  renderDoctorReport,
  suggestVerify,
  doctorOnlyChoices,
  isDoctorOnly,
} from './doctor.js';
import { selftestCommand } from './selftest.js';
import { runReview } from './review.js';
import { collectCommands, runVerify, summarizeVerify } from './verify.js';
import { buildTopicReport, renderTopicReport } from './report.js';
import { cancelRun, startRun, statusRun, waitRun, workerMain } from './run-protocol.js';
import {
  checkAdjudication, loadRoundReviews, renderGateResult, renderTamperedArtifacts, verifyRoundForApproval,
} from './gate.js';
import { checkStageArtifacts, listRecordedRuns, resolveRerunIndex } from './archive.js';
import { readHookInput, runHook, type HookName } from './hooks.js';
import { getGate, listOpenGates, setGateChecked } from './state.js';
import { assertGateDecidable, recordApproval } from './approval.js';
import { resolveTopic, resolveTopicReadOnly, listTopics } from './topic.js';
import { latestRunMeta, newRunId, readTask, readRunMeta } from './meta.js';
import { mergeAllHooks, runInit, renderInitReport, type InitReport } from './init.js';
import {
  commitAuthCache, parsePreflightScope, renderPreflight, runPreflight,
} from './preflight.js';
import { resolveTopicArgs } from './topic-args.js';
import { assertModelOverrideKeys, resolveCriticSelection, resolveDriver } from './critics.js';
import { scrubAllRunRoot } from './retention.js';
import { wiredAdapter } from './adapters/index.js';
import { COMMAND_ENTRIES, STAGES, type CommandEntry, type CriticId, type Stage } from './types.js';
import { emitJson, fail, isJsonMode, say, setOutputMode, step, warn } from './util/log.js';
import {
  renderWorkTreeSummary, summarizeWorkTree, summaryBudget, unavailableSummary,
  type RenderOptions, type WorkTreeSummary,
} from './worktree-summary.js';

const VERSION = '0.1.0';

interface ParsedArgs {
  command: string;
  sub: string[];
  flags: Map<string, string | boolean>;
  /**
   * `--` 之后的全部 argv **原样保留为数组**，不拼串。
   *
   * 存在的理由：`topic resolve` 要接收 skill 的 `$ARGUMENTS`，而它本身以 `--topic …`
   * 开头，不用 `--` 终止符就会被下面的旗标规则吃掉。
   *
   * **不再 `join(' ')`**（BACKLOG EV-18）：拼串会丢掉 shell 已经切好的 token 边界，
   * 下游只能再分一次词——而自写的分词器遇到正文里一个裸引号就把其后的 `--topic X`
   * 粘进同一 token，主题静默回落推断。shell 切一次、这里直接用，第二跳连同它的缺陷一起消失。
   */
  trailing: string[];
}

/**
 * 布尔旗标：**永不吞下一个 token**，`=` 传值只认 true/false 字面（BACKLOG EV-24）。
 *
 * `parseArgs` 原本按位置猜：下一个 token 不以 `--` 开头就当值。于是
 * `approve --reject 理由文字` 让 `reject` 拿到字符串，`=== true` 判假——
 * **拒绝静默变成通过**；`--json 附言` 静默关掉 JSON 模式。同族的 `--reject=true`
 * 走 `=` 分支存字符串 `'true'`，同样判假（计划双审 CODEX-07 ≡ AGY-07 ≡ GLM-04）。
 *
 * 这份集合与源码里所有「取旗标后与 true 严格相等」的判据由 `test/contract/boolean-flags-parity`
 * 对账：新增布尔旗标忘记登记这里，测试当场红，而不是回到静默吞值。
 */
const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  'allow-single', 'await-approval', 'check-artifacts', 'dry-run', 'help', 'json',
  'keep-fixture', 'no-model-calls', 'quiet', 'refresh-auth', 'reject', 'selftest',
  'skip-auth-check', 'start', 'suggest-verify', 'version',
]);

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  let trailing: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;

    // `--` 之后的一切都不再解析，整体作为 trailing
    if (a === '--') {
      trailing = argv.slice(i + 1);
      break;
    }

    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq !== -1) {
      const name = a.slice(2, eq);
      const raw = a.slice(eq + 1);
      if (BOOLEAN_FLAGS.has(name)) {
        const v = raw.trim().toLowerCase();
        if (v === 'true' || v === '1') flags.set(name, true);
        else if (v !== 'false' && v !== '0') {
          throw usageError(`--${name} 是布尔旗标，只接受 true/false，收到：${raw}`);
        }
        continue;
      }
      flags.set(name, raw);
      continue;
    }
    const name = a.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      flags.set(name, true); // 后面的 token 留给位置参数——多余的会在分发层退 64
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(name, next);
      i++;
    } else {
      flags.set(name, true);
    }
  }

  return { command: positional[0] ?? '', sub: positional.slice(1), flags, trailing };
}

/**
 * 各子命令能接受的位置参数个数（BACKLOG EV-24）。
 *
 * 缺省 0 是 fail-closed：十一条命令里只有 `topic resolve` 与 `gate hook-<name>` 合法地
 * 读 `sub[0]`，其余一律不读——多出来的位置参数此前被无声丢弃。2026-09-16 实撞：
 * 审批命令尾部跟了一串中文决策说明，命令退 0，那串文字既没报错也没落盘。
 * `help` / `version` 在分发前短路、从不看 `sub`，显式豁免（CODEX-11）。
 */
const POSITIONAL_LIMIT: Readonly<Record<string, number>> = {
  topic: 1,
  gate: 1,
  help: Number.POSITIVE_INFINITY,
  version: Number.POSITIVE_INFINITY,
};

/** 多余位置参数的写法提示，按命令给最可能的正确形态 */
function positionalHint(command: string): string {
  switch (command) {
    case 'approve':
    case 'abandon':
      return (
        '  审批附言请写 `--reason <文本>`（含空格时整段加引号），它会写进审批记录的 reason 字段；\n' +
        '  `--reject` 不接受值，拒绝理由同样走 --reason。'
      );
    case 'topic':
      return (
        '  resolve：原始参数请放在 `--` 之后：trivium topic resolve --stage <s> -- <正文> --topic <主题>\n' +
        '  claim：全部走旗标，没有位置参数：trivium topic claim --topic <主题> --stage <s> --driver <id>'
      );
    default:
      return `  用法见 trivium --help`;
  }
}

function rejectExtraPositionals(args: ParsedArgs): void {
  const limit = POSITIONAL_LIMIT[args.command] ?? 0;
  if (args.sub.length <= limit) return;
  const extra = args.sub.slice(limit);
  throw usageError(
    `${args.command} 不接受多余的位置参数，收到：${extra.map((t) => `「${t}」`).join(' ')}\n` +
      '  这些内容没有落到任何字段上——与其静默丢掉，不如在这里停下。\n' +
      positionalHint(args.command),
  );
}

// `trivium scrub` 一节的动机句（EV-164 限定、EV-166 改写主句）：遗留副本的凭据抹除与到期整删都只在那个仓库自己的会话启动时跑，不再回去就没有任何自动清理；记录里的审查员 CLI 仍在 / 判不了 / 读不懂的目录到期也保留。
// 帮助只讲自动入口，不讲 `run_dir_days <= 0` 关闭整删那一档（宽度放不下，MANUAL / RUNBOOK 写明；代码双审 r1 CODEX-02）
const USAGE = `trivium ${VERSION} — Driver-DualCritic 主攻双审流水线编排器

用法：
  trivium doctor [--json] [--no-model-calls] [--only ${doctorOnlyChoices().join('|')}]
      本机能力探针。实测各家 CLI 的真实能力并回填 .trivium/config.local.yaml 的 probe: 段。
      --no-model-calls  只做静态探测，不消耗厂商配额
      --only            只探测指定一侧（取值随注册表登记的 CLI 自动扩展）
      每段探完即中途落盘：那几步已经烧过配额，中断不该让它白费
      已登记但尚无探针实现的 CLI 会明确报「登记了、本轮无结论」，不是失败

  trivium doctor --suggest-verify
      展示探测到的编译测试命令候选与可粘贴的 YAML。**只展示不写入**——
      这些命令会被真实执行，是否执行由你确认（§14.1）。

  trivium doctor --selftest [--keep-fixture] [--asset-root <路径>]
      在临时夹具仓库里**真跑**一遍整条流水线：双审 → 闸门拦截 → 补裁决 →
      闸门放行 → 编译测试 → 复盘 → 重跑不覆盖，逐步核对退出码与落盘结果。
      两侧走桩适配器，**零配额消耗**；因此它证明不了两家 CLI 可用——
      那是 doctor 与 preflight 的职责，输出里会写明这条边界。

  trivium review --stage plan|code|bug --topic <主题> --focus <提示语> [选项]
      **同步**跑一次双审。仅供手工调试：一次运行墙钟可达 30~40 分钟，
      远超 Driver 的 Bash 工具超时，从 skill 里必须改用 --start/--wait。
      --focus     审查焦点提示语：这次重点看什么，进 BRIEF 第 2 段（FR-20 / AC-09）。
                  除 --entry A 外必填；缺失退 64
      --goal      任务目标原文：这次想达成什么，进 BRIEF 第 4 段（§9.4）。
                  与 --focus 是两回事，不可互相顶替。省略时回退 task.json / plan 原稿
      --entry A|B|C|D  发起本次运行的斜杠命令，记入 run.json 留痕。
                  只有 A（全流程）的焦点是可选补充；手工调用可省略，按 B/C/D 规则校验
      --context   被审对象涉及的代码路径与相关文档，逗号分隔；并入必读清单
      --plan-file / --rca-file  显式指定被审对象
      --base <ref>  仅 code 阶段：diff 比较基线，默认 HEAD
      ${CRITIC_AGENT_IDS.map((id) => `--model-${id}`).join(' / ')} <模型>
                  本次模型覆盖（取值清单随注册表；只对本轮入选的审核者有效，
                  给没入选的一家指定模型退 64，不静默丢弃）
      --profile <名称>  本次改用另一档模型（config.yaml 的 profiles）。
                  与 --model-* 不冲突：那个指定具体模型、优先级更高，
                  这个只换默认值表。档位不存在则退 64 并列出可用值
      --critics <id,…>  本轮入选的审核者，逗号分隔（1～review.max_critics 个）。
                  缺省取 review.default_critics。选 1 个是配置意图、不标降级；
                  含当轮 Driver、含未启用为审核者的 Agent、或重复项一律退 64
      --only ${CRITIC_AGENT_IDS.join('|')}  仅跑一侧。**--critics 的单元素旧写法**，两者不能同时给
      --driver <id>  当轮 Driver（执笔者），缺省 ${DEFAULT_DRIVER}。
                  取值须为**可用作 Driver 的 Agent**（${DRIVER_AGENT_IDS.join(' | ')}）——
                  未登记、或已登记但尚未启用为 Driver 的一律退 64（M10a 第 3 步起）。
                  它决定谁不得入选（自己不能审自己）与原稿是谁的后缀
      --allow-single  一侧失败时不中止，产出单审结果并留痕（§12.4）。
                      受配置 review.allow_partial_flag 约束（旧名 allow_single_flag 仍可用）；默认 strict

  trivium review --start --entry <A|B|C|D> --stage <s> --topic <主题> --focus <提示语> [同上选项] [--json]
      冻结送审包 → 派生工作进程 → **立即返回** run_id 与 max_waits。
      返回的 bash_timeout_ms 是 skill 必须为每次 --wait 设置的工具级超时。

  trivium review --wait <run_id> [--timeout <秒>] [--json]
      轮询到完成或本次窗口用尽。退出码 73 表示仍在运行（**不是失败**），
      打印进度后继续下一次 --wait。

  trivium review --status <run_id> [--json]    只读一次状态，不等待
  trivium review --cancel <run_id>             取消运行、回收主题锁与闸门；工作进程确认退出后，
                                               把仍为 running 的归档 run.json 标为 cancelled。
                                               --wait 判心跳失联（heartbeat_stale）而工作进程仍在时：
                                               结束它与它拉起的审查员 CLI、确认退出后把 run.json 补收为 failed、
                                               回收主题锁；status.json 与闸门不动

  trivium preflight --stage plan|code|bug|all [--json] [--critics <id,…>] [--profile <名称>] [--model-<id> <模型>] [--skip-auth-check] [--refresh-auth]
      启动预检（FR-18 / AC-16）。失败时**不产生任何工件**。
      --stage all   命令 A 用：校验全部三阶段的模型 slug + 编译测试命令已配置
      --critics <id,…>  本次要用哪几侧。只读能力、模型 slug、探活都只查这几侧；
                        缺省取 review.default_critics。下一步 review --start 选了谁，
                        这里就要传谁——否则那一侧的可用性在预检阶段不被检查
      --profile <名称>  按该档位预检——要校验的是本次实际会用的模型
      ${CRITIC_AGENT_IDS.map((id) => `--model-${id}`).join(' / ')} <模型>
                  按该模型预检（口径同 review：只对本轮入选的审核者有效，未入选退 64）。
                  命令 A 在解析之后预检（EV-125），把 resolve 输出的 models 原样带来
      --driver <id>  当轮 Driver，缺省 ${DEFAULT_DRIVER}。与 review --start 传同一个值：
                  它参与选侧判定，非缺省时预检会多打一行标注
      --refresh-auth  强制重新探活，穿透 TTL 缓存

  trivium topic resolve --stage <s> -- '<正文>' [--topic <主题>] [其余旗标]   [--json]
      解析主题、提示语、被审对象与模型覆盖。**纯只读**，不创建任何目录。
      -- 之后按 argv 逐个 token 解析、不再分词：正文整段放进一个单引号参数，
      旗标放在引号之外。正文里的引号、$、反引号、--xxx 都逐字进入焦点。

  trivium topic claim --topic <主题> --stage <s> --driver <id> [--session-id <id>] [--json]
      为该阶段**声明**当轮 Driver。plan / bug 原稿写在 review --start 之前，
      那一刻该阶段零留痕、判定回落缺省 Driver，非缺省 Driver 写不出自己的原稿。
      --stage 必填不默认：声明直接决定 Write / Edit 侧的保护集。
      留痕优先——该阶段已有运行留痕且不同，退 64；
      该阶段子树里已有他家角色后缀的文件时同样退 64（终端清理后可重试）。
      --session-id 落进 claimed_by，供事后对账；缺省取 CLAUDE_SESSION_ID。
      声明之后 review --start / topic resolve 省略 --driver 即继承该阶段的值。

  trivium verify --topic <主题> [--only build|test] [--timeout <秒>] [--json]
      执行 .trivium/config.yaml 中 verify.build / verify.test **显式声明**的命令，
      落盘 verify/<日期>-<主题>-verify.md 与 _meta/verify-<run_id>.json（FR-21 / AC-10）。
      两组都没配时退 64——「什么都没跑」不是「通过」。
      构建失败即不再跑测试：测试几乎必然连带失败，只会埋掉真正的根因。

  trivium report --topic <主题> [--out <路径>] [--json]
      依据 .reviews/ 生成人读复盘：时间线、每轮意见数与严重度分布、采纳率、
      被驳回项与理由、生效模型核对、降级与告警清单、多审退化指标、耗时汇总。
      只读归档，不重新调用任何 Agent；默认打到 stdout，--out 写文件。

  trivium init [--dry-run] [--asset-root <路径>]
      在本项目布置运行时：.trivium/（config.yaml + bin/trivium wrapper）、
      合并 Hook 进每一家登记了 Hook 目标的项目配置（${AGENTS.filter((a) => a.hookConfigTarget).map((a) => a.hookConfigTarget!.path).join('、')}）、
      幂等追加 .gitignore 与协议片段。全部操作幂等，重复运行不重复追加、不覆盖用户内容。

  trivium hooks --agent <id> [--dry-run] [--asset-root <路径>] [--json]
      只把 TriviumCode Hook 渲染并合并进该家的项目配置（只增不删、不覆盖用户已有 Hook）。
      只做渲染与安装，不参与任何判定。可用：${AGENTS.filter((a) => a.hookConfigTarget).map((a) => a.id).join(' | ')}；
      没有 Hook 机制的家退 64。ZCode 形态写入后要在桌面端重新信任该工作区，信任前 Hook 不跑；
      .zcode/ 被 .gitignore 忽略时这份 Hook 只对本机生效、不随仓库分发（输出里会提示）。

  trivium gate --stage <s> --topic <主题> --check [--run-id <id>] [--json]
      裁决完整性硬校验（§8.6）。返回 2 表示未通过，stdout 给出缺口清单供直接修补。
      --check-artifacts [--run-id <id>]
                          改为校验该阶段最低工件集（§6.3）。审核者集合取自该轮
                          run.json 的实际登记，单侧轮次不会被误报缺件
      --await-approval    置闸门为 awaiting_approval 并输出停点话术
      校验通过后闸门去哪由 run.json 的 entry 决定：B/C/D 直接立起 awaiting_approval
      （停点是这三条命令的定义），A 与无 entry 的调用回 idle。

  trivium gate hook-pre-write | hook-pre-bash | hook-pre-commit | hook-stop | hook-session-start
      Claude Code Hook 入口，从 stdin 读事件。**不应由人直接调用。**
      退出码：0 放行或判定不了 ｜ 2 明确判定拦截 ｜ 1 程序缺陷（非阻断）

  trivium approve --topic <主题> --stage <s> [--reason <附言>] [--reject --reason <理由>]
  trivium abandon --topic <主题> [--stage <s>] [--reason <理由>]
      人工审批 / 放弃闸门。三种结论均解除业务写锁，工件一律保留。
      通过（approve 不带 --reject）前复核本轮：裁决齐备 + 本轮 run.json 登记工件的 sha256。
      不通过退 2；推断不出 run_id 或运行元数据读不出退 65。拒绝与放弃不复核。
      通过时先打印自审查收尾以来的工作树改动摘要（被 .gitignore 忽略的看不见），只告知、不影响审批结论。
      复核保的是「裁决齐备、本轮工件未被改」，不保「审批来自人」。
      通过必须带 --stage（一次放行哪一道要说清楚）；拒绝与放弃可以省略。
      审批附言一律走 --reason（写进审批记录）；多余的位置参数退 64，不会静默丢掉。
      **审批不校验调用来源**：它靠提示词约束，审批记录里留会话来源供事后对账。

  trivium status [--topic <主题>] [--json]
      打印闸门、运行、降级与争议。

  trivium scrub [--dry-run] [--json]
      对**整个运行根**做一次凭据清扫：只抹凭据、**不删任何目录**（BACKLOG EV-33）。
      会话启动清扫只覆盖本项目的桶，别的仓库遗留的副本要等它自己再开一次会话；
      到期整删也只在它的会话启动时跑（记录里的审查员 CLI 仍在、判不了或读不懂时到期也不删）；不再回到那个仓库就没有任何自动清理，这条命令只补抹凭据。
      --dry-run  列出「侧层本会抹哪些运行目录」，不动盘上任何文件。
                 **只预测侧层**：运行目录那一层（request.json 等）没有哨兵、每轮都复查，
                 有没有活取决于正文是否命中密钥，不读正文答不了——预览不该为此整份读它们。
      判据与会话启动清扫同源：worker 现势活着的不动，status.json 读不到的一律跳过并计数
      （抹除不可逆，读不到状态就没有证据说它已经跑完）；准入未过而状态读得到的单列一格，
      不让任何一类看过的目录哪一格都不进。

  trivium --version
  trivium --help

退出码：0 成功 / 1 一般失败 / 2 闸门阻断 / 64 参数错误 / 65 前置产物缺失
        69 环境或预检失败 / 70 主题被锁 / 73 运行仍在进行 / 75 严格模式中止
`;

/**
 * 逐 Agent 的模型覆盖：`--model-<id>`，`<id>` 的**收集面是全部已登记 Agent**。
 *
 * 此前只解析 `--model-gemini` / `--model-glm` 两个写死的旗标，第三家**无法覆盖模型**。
 * 泛化后旗标名对既有两侧**逐字不变**（id 就是 `gemini` / `glm`，
 * 拼出来还是同样两个名字），因此不需要别名表，也不存在兼容断点。
 *
 * ## 收集面为什么是 `ALL_AGENT_IDS` 而不是 `CRITICS`（第 3 轮 CODEX-03）
 *
 * 上一版遍历 `CRITICS`（已启用为审核者的那几家），而 `topic-args.ts` 遍历
 * `ALL_AGENT_IDS`（全部已登记）。判定虽然收口成了一份（`assertModelOverrideKeys`），
 * **收集面却仍是两份**：「已登记但未启用为审核者」的 `--model-<id>` 在这条路上
 * 根本进不了返回值，判定函数看不见它 → 不退 64、不留痕、不告警——
 * 正是 EV-53 原文的症状，而当时的注释还宣称两个入口已同口径。
 *
 * 今天不可达（四家全启用 ⇒ 两个集合元素相同），**登记第五家而暂不启用它时立刻可达**，
 * 且症状无声。所以口径统一成：**收集＝全部已登记，判定＝本轮实际能入选谁。**
 * 返回值因此用宽类型，收窄交给判定函数——调用方在 `assertModelOverrideKeys`
 * 通过之后才把它当审核者键集使用。
 */
function collectModelOverrides(args: ParsedArgs): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ALL_AGENT_IDS) {
    const v = flagString(args, `model-${id}`);
    if (v) out[id] = v;
  }
  return out;
}

/**
 * 取一个**取值旗标**的值。
 *
 * 值为 `true` 说明 `parseArgs` 没能给它取到值——要么后面什么都没有，要么下一个 token 以 `--` 开头
 * 被当成了另一个旗标。此前这种情形返回 null，于是命令照常退 0 而字段为空：
 * `approve --reason '--focus 的默认取值说明不准'` 的附言就此消失，而 `dual-approve` 的指引
 * 恰恰教用户把原文整段传给 `--reason`（代码双审 r2 CODEX-03）。这是 EV-24 同一族的第三格，
 * 与多余位置参数、布尔旗标吞值一样，一律响亮失败。
 */
function flagString(args: ParsedArgs, name: string): string | null {
  const v = args.flags.get(name);
  if (v === true) {
    throw usageError(
      `--${name} 需要一个值，但它后面跟的是另一个旗标（或什么都没有）。\n` +
        `  值本身以 -- 开头时，写成 --${name}=<值>；含空格时整段加引号。`,
    );
  }
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function parseStage(args: ParsedArgs): Stage {
  const raw = flagString(args, 'stage');
  if (!raw) throw usageError(`缺少 --stage，取值范围：${STAGES.join(' | ')}`);
  if (!(STAGES as readonly string[]).includes(raw)) {
    throw usageError(`--stage 只接受 ${STAGES.join(' | ')}，收到：${raw}`);
  }
  return raw as Stage;
}

/**
 * `--wait` 与 `--status` 共用的进度字段组装。
 *
 * 两条命令的 JSON 必须是同一组字段——设计 7.5 表里 `--status` 行的返回写的就是
 * 「同上」（审查意见 AGY-03 ≡ GLM-02）。组装只在这里做一次，也就不会长出第三份真相。
 *
 * `progress` 的语义**保持不变**：三个 skill 已约定原样转述它，改语义会静默破坏
 * 既有行为，新字段一律并列增加。
 *
 * `status` 为 null 时（尚无有效心跳、或状态文件不存在）新字段**存在但取值为 null**，
 * 不是省略——省略会让调用方分不清「没有」和「读不到」。
 */
function progressFields(out: {
  progress: string;
  progressBrief: string;
  budget: { stageTimeoutS: number; maxWaits: number } | null;
  view: { elapsed_s: number; pct: number; waits_done: number } | null;
  status: { sides: unknown } | null;
}): Record<string, unknown> {
  return {
    progress: out.progress,
    // ↓ skill 要原样念给用户的一行
    progress_brief: out.progressBrief,
    elapsed_s: out.view?.elapsed_s ?? null,
    budget_s: out.view ? (out.budget?.stageTimeoutS ?? null) : null,
    pct: out.view?.pct ?? null,
    waits_done: out.view?.waits_done ?? null,
    max_waits: out.budget?.maxWaits ?? null,
    sides: out.status?.sides ?? {},
  };
}

async function cmdReview(args: ParsedArgs): Promise<number> {
  const ctx = await loadCtx();

  // ── 工作进程模式：不应由人直接调用 ──
  const workerId = flagString(args, 'worker');
  if (workerId) return workerMain(ctx, workerId);

  /*
   * `--profile` 换本次运行的模型档位。放在 worker 分支**之后**：工作进程按
   * request.json 重建，档位已在派生时定死，再覆盖一次只会引入不一致。
   */
  ctx.config = applyProfileOverride(ctx.config, flagString(args, 'profile'));

  // ── 只读/控制类子命令：只需要 run_id ──
  const waitId = flagString(args, 'wait');
  if (waitId) {
    // 与 verify 一致（GLM-r2-07）：拼错的 --timeout 报错，不静默回落默认值——skill 是按
    // --start 返回的 wait_timeout_s 设 Bash 超时的，静默换值会让两者对不上
    const timeoutStr = flagString(args, 'timeout');
    let timeoutS = ctx.config.review.wait_timeout_s;
    if (timeoutStr !== null) {
      const n = Number(timeoutStr);
      if (!Number.isFinite(n) || n <= 0) throw usageError(`--timeout 需要一个正数秒数，收到「${timeoutStr}」。`);
      timeoutS = n;
    }
    const out = await waitRun(ctx, waitId, timeoutS);
    if (isJsonMode()) {
      emitJson({
        ok: out.exitCode === EXIT.OK,
        still_running: out.exitCode === EXIT.STILL_RUNNING,
        run_id: waitId,
        phase: out.status?.phase ?? null,
        artifacts: out.status?.artifacts ?? [],
        message: out.status?.message ?? null,
        ...progressFields(out),
      });
    } else {
      say(out.progress);
    }
    return out.exitCode;
  }

  const statusId = flagString(args, 'status');
  if (statusId) {
    const out = await statusRun(ctx, statusId);
    if (isJsonMode()) {
      emitJson({
        ok: out.exitCode === EXIT.OK,
        run_id: statusId,
        phase: out.status?.phase ?? null,
        status: out.status,
        ...progressFields(out),
      });
    } else {
      say(out.progress);
    }
    return out.exitCode;
  }

  const cancelId = flagString(args, 'cancel');
  if (cancelId) return cancelRun(ctx, cancelId);

  // ── 启动类：需要完整参数 ──
  const stage = parseStage(args);

  const topic = flagString(args, 'topic');
  if (!topic) throw usageError('缺少 --topic。主题名规则见设计 §6.1');

  /*
   * `--entry`：发起本次运行的斜杠命令。记入 run.json 留痕之外，它决定焦点是否必填——
   * FR-20 / §7.3 要求 B/C/D 缺提示语一律拒绝启动（退 64），而命令 A 的焦点只是可选补充
   * （PRD 第 8 章）。省略时按 B/C/D 规则校验：手工调用也不该带着空焦点跑完。
   */
  const entryRaw = flagString(args, 'entry');
  if (entryRaw && !(COMMAND_ENTRIES as readonly string[]).includes(entryRaw)) {
    throw usageError(`--entry 只接受 ${COMMAND_ENTRIES.join(' | ')}，收到：${entryRaw}`);
  }
  const entry = (entryRaw as CommandEntry | null) ?? null;

  const focus = flagString(args, 'focus');
  if (!focus && entry !== 'A') {
    throw usageError(
      '缺少 --focus：命令 B/C/D 必须携带审查焦点提示语（FR-20）。' +
        '提示语会逐字进入两侧送审材料，是 AC-09 的验收落点。' +
        (entry === null ? '（只有 --entry A 的全流程可以省略焦点。）' : ''),
    );
  }

  const onlyRaw = flagString(args, 'only');
  /*
   * 入选集合的解析与校验交给 `resolveCriticSelection`——**与 `topic resolve` 同一个判定处**。
   *
   * 此前这里和 `topic-args.ts` 各实现了一遍 `--only` 的字面校验，两处一度不一致：
   * 启用第三家时这边会**先于**那边拒掉合法取值，而错误信息还振振有词地只列两家。
   * 校验逻辑分两处实现是改一漏二的典型形态，M7b 第 5 步收敛成一处。
   */
  /*
   * ── 当轮 Driver：显式旗标优先，缺席则**继承该阶段的权威值**（M10a 第 1 步）──
   *
   * `resolveDriver` 对「没传」与「传了缺省值」返回同一个结果，所以要先把原始旗标值
   * 留在手里（`explicitDriver`）：交叉校验只对**显式传的**值比对，缺席时不比对。
   * 上一版没分开，后果是任何非缺省 Driver 的主题上每一次省略该旗标的运行都退 64
   * （代码双审 r1 CODEX-01）。
   *
   * 主题先归一化再用：`validateTopic` 会 trim 并把内部空白折成 `-`，
   * 而 `--topic 'M10 任意'` 时声明落在 `M10-任意`、校验若读 `M10 任意` 就目录不存在、
   * 于是零留痕零声明、**静默通过**（代码双审 r1 GLM-04）。
   */
  const driverRaw = flagString(args, 'driver');
  // 仍然过一次 resolveDriver：非法取值要在这里退 64，不能等到继承判定之后
  const explicitDriver = driverRaw?.trim() ? resolveDriver(driverRaw).driver : null;

  const { resolveStageDriver, crossCheckDriver, declaredStageDriver, stageDriverInvariant } =
    await import('./driver-claim.js');
  const { resolveTopicName } = await import('./topic.js');
  const { readTask } = await import('./meta.js');
  const layout = { archiveRoot: ctx.archiveRoot, topic: resolveTopicName(ctx, topic) };

  const resolution = await resolveStageDriver(layout, stage);
  if (resolution.kind === 'corrupt') {
    /*
     * **不降级到声明**：`corrupt` 的含义是「锚本身坏了」，而本入口会冻结送审包
     * 并写下**新一份留痕**。此时退到一个由被保护方自己写的声明值，
     * 正好是把权威排序倒过来用——那也是 Hook 侧同状态的结论（同一个判定函数）。
     */
    throw new TriviumError(
      EXIT.GATE_BLOCK,
      `无法判定当轮 Driver：${layout.topic} / ${stage} 的运行留痕读不出来` +
        `（${resolution.unreadable.join('、')}）。\n` +
        '  这里**不**按缺省 Driver 继续，**也不**退回声明——前者把「留痕坏了」判成「按缺省算」，\n' +
        '  后者让被保护方自己的声明在锚损坏时反超留痕。\n' +
        `  出口是**重跑一次 ${stage} 阶段双审**：新运行会先落一份可读的留痕，判定随即恢复。`,
    );
  }

  const declared = declaredStageDriver(await readTask(layout), stage);
  // 先问「这份留痕本身自洽吗」，再问「你传的对不对」——顺序反了会用一个坏基准去判对错
  const broken = stageDriverInvariant({
    topic: layout.topic, stage, runDriver: resolution.source === 'run' ? resolution.driver : null,
    declared,
  });
  if (broken) throw usageError(broken);
  const conflict = crossCheckDriver({
    topic: layout.topic, stage, driver: explicitDriver,
    runDriver: resolution.source === 'run' ? resolution.driver : null,
    declared,
  });
  if (conflict) throw usageError(conflict);

  // 校验通过后：显式值优先，缺席即继承权威值
  const driver = explicitDriver ?? resolution.driver;
  /*
   * 按**最终**的 driver 再过一次 `resolveDriver`，不能只信旗标那次解析：
   * 继承来的值（运行留痕或 claim 声明）没经过它，未启用为 Driver 的要在这里退 64
   * （M10a 第 3 步；此前这里只取 `enabledAsDriver` 打一行标注后放行）。
   */
  resolveDriver(driver);

  const critics = resolveCriticSelection(ctx.config, {
    critics: flagString(args, 'critics'),
    only: onlyRaw,
    driver,
  });

  /*
   * ── 交叉校验：`--driver` 与该阶段的权威值（M10a 第 1 步，EV-72）──
   *
   * 与 `topic resolve` 共用 `driver-claim.crossCheckDriver`。**两个入口都要有**：
   * 技能侧先走 resolve 会被挡住，而本入口才是真正烧配额的那条——
   * 只落一处就是 EV-53 那族缺口的形状（手工 CLI 绕过校验、审的不是用户以为的那家）。
   *
   * 位置在冻结送审包**之前**：判错身份的那一轮跑完才发现，代价是整轮作废。
   */
  const contextRaw = flagString(args, 'context');
  // 任务目标与审查焦点分开传（RV-19）：前者说「要达成什么」，后者说「这次重点看什么」
  const goal = flagString(args, 'goal');
  const modelOverrides = collectModelOverrides(args);
  /*
   * `--model-<id>` 的键必须是本轮**实际入选**的那几家（EV-53，第 2 轮 CODEX-05；
   * M10b 第 2 步代码双审 CODEX-02 从「能入选」收紧到「实际入选」，收 EV-67）。
   *
   * 这一条此前**只落在 `topic resolve`**，而本入口才是真正烧配额的那条：
   * `collectModelOverrides` 的论域是全部已登记 Agent，下游 `checkModelSlugs` 只遍历入选侧，
   * 判据若窄于入选集合之外的任何一格，那一格的覆盖就是**解析成功后被悄悄丢弃**——
   * 留痕与告警都看不出用户指定过模型。
   *
   * 判定共用 `critics.ts` 的那一份，不在此处复制；入选集合就是上面刚解析出的 `critics`。
   */
  assertModelOverrideKeys(ctx.config, driver, Object.keys(modelOverrides), critics);
  // 判定通过 ⇒ 键集必然是本轮入选的审核者，这里才收窄（收集面见 collectModelOverrides）
  const models = modelOverrides as Partial<Record<CriticId, string>>;

  const reviewOpts = {
    ctx,
    stage,
    topic,
    promptHint: focus ?? null,
    taskGoal: goal ?? null,
    entry,
    contextPaths: contextRaw ? contextRaw.split(',').map((c) => c.trim()).filter(Boolean) : [],
    subjectFile: flagString(args, 'plan-file') ?? flagString(args, 'rca-file'),
    diffBase: flagString(args, 'base'),
    modelOverrides: models,
    command: `trivium review --stage ${stage}`,
    critics,
    driver,
    // 闸门写锁默认按会话作用域（RV-05）。拿不到会话 id 时闸门记 null，
    // 写锁按「本会话」保守处理（state.ts GateEntry.session_id）
    sessionId: flagString(args, 'session-id') ?? process.env['CLAUDE_SESSION_ID'] ?? null,
    allowSingle: args.flags.get('allow-single') === true,
  };

  // ── --start：派生后立即返回 ──
  if (args.flags.get('start') === true) {
    const st = await startRun({ ...reviewOpts, command: `trivium review --start --stage ${stage}` });

    // FR-23 纯文档跳过：同步窗口内已收口，没有 worker，skill 不该再进 --wait 循环
    if (st.finishedInline) {
      if (isJsonMode()) {
        emitJson({
          ok: true, run_id: st.runId, finished_inline: true,
          max_waits: 0, skipped: true, notice: st.inlineNotice ?? '',
          // 键恒在：没有审查员会被拉起，不计算（EV-123）
          warnings: st.warnings,
        });
      } else {
        say(st.inlineNotice ?? `运行 ${st.runId} 已在同步窗口内完成，无需 --wait。`);
      }
      return EXIT.OK;
    }

    if (isJsonMode()) {
      emitJson({
        ok: true,
        run_id: st.runId,
        max_waits: st.maxWaits,
        wait_timeout_s: st.waitTimeoutS,
        // skill 必须用这个值设置每次 --wait 的 Bash 工具超时（GLM-02）
        bash_timeout_ms: st.bashTimeoutMs,
        // ↓ 开场播报要用：两侧是谁、预算多久。只有编排器知道生效值
        stage_timeout_s: st.stageTimeoutS,
        models: st.models,
        worker_pid: st.workerPid,
        run_dir: st.runDir,
        // 拉起前按当轮入选侧复查的只警告项，键恒在；skill 在开场播报里逐条念出（EV-123）
        warnings: st.warnings,
      });
    } else {
      say(`已启动运行 ${st.runId}（工作进程 pid ${st.workerPid}）`);
      // detail 自带 ⚠️ 前缀（与预检同一个函数产出），这里不再叠一个符号
      for (const w of st.warnings) say(`  ${w.detail}`);
      say(`  请循环调用：trivium review --wait ${st.runId} --timeout ${st.waitTimeoutS}`);
      say(`  循环上限 ${st.maxWaits} 次；每次调用的 Bash 工具超时须设为 ${st.bashTimeoutMs}ms`);
      say(`  运行目录 ${st.runDir}`);
    }
    return EXIT.OK;
  }

  // ── 同步路径（手工调试）──
  warn(
    '同步模式：一次运行墙钟可达 30~40 分钟，会超出 Driver 的 Bash 工具超时。' +
      '从 skill 调用请改用 --start / --wait。',
  );
  const out = await runReview(reviewOpts);

  if (isJsonMode()) {
    emitJson({
      ok: out.exitCode === EXIT.OK,
      run_id: out.runId,
      rerun_index: out.rerunIndex,
      artifacts: out.artifacts,
      meta: out.metaPaths,
      warnings: out.warnings,
    });
  }
  return out.exitCode;
}

async function cmdDoctor(args: ParsedArgs): Promise<number> {
  /*
   * --selftest 不读当前项目的配置：它在自己的临时夹具里跑。
   * 因此放在 loadCtx 之前——装完还没 init 的项目里也该能自检，
   * 那正是「非作者 15 分钟装好」最需要它的时刻。
   */
  if (args.flags.get('suggest-verify') === true) {
    const ctx = await loadCtx({ allowUninitialized: true });
    return suggestVerify(ctx.projectRoot);
  }

  if (args.flags.get('selftest') === true) {
    return selftestCommand({
      keepFixture: args.flags.get('keep-fixture') === true,
      assetRoot: flagString(args, 'asset-root'),
    });
  }

  // doctor 要能在尚未 init 的项目里跑——它本来就是 init 的前置
  const ctx = await loadCtx({ allowUninitialized: true });

  const onlyRaw = args.flags.get('only');
  const only =
    // 取值集合由注册表派生（`doctorOnlyChoices`），不在此处枚举——
    // 原先写死的三值会让 `doctor --only codex` 在进 doctor 之前就退 64，
    // 而 codex 明明已在注册表登记（审查意见 AGY-03 / GLM-06）。
    typeof onlyRaw === 'string' && isDoctorOnly(onlyRaw) ? onlyRaw : null;
  if (onlyRaw !== undefined && only === null) {
    throw usageError(
      `--only 只接受 ${doctorOnlyChoices().join(' | ')}，收到：${String(onlyRaw)}`,
    );
  }

  const report = await runDoctor({
    projectRoot: ctx.projectRoot,
    triviumDir: ctx.triviumDir,
    config: ctx.config,
    skipModelCalls: args.flags.get('no-model-calls') === true,
    only,
  });

  if (isJsonMode()) {
    emitJson({
      ok: report.blockers.length === 0,
      probe: report.probe,
      notes: report.notes,
      blockers: report.blockers,
      warnings: report.warnings,
    });
  } else {
    renderDoctorReport(report);
  }

  return report.blockers.length === 0 ? EXIT.OK : EXIT.ENV;
}

async function cmdPreflight(args: ParsedArgs): Promise<number> {
  const ctx = await loadCtx();
  // 预检要校验的是**本次实际会用**的档位，所以同样受 --profile 影响
  ctx.config = applyProfileOverride(ctx.config, flagString(args, 'profile'));
  const scope = parsePreflightScope(flagString(args, 'stage'));

  const modelOverrides = collectModelOverrides(args);

  /*
   * **本次入选的审核者要传进预检**（M8 第 3 步）。
   *
   * 不传的后果：预检按 `default_critics` 检查，而用户下一步 `review --start --critics
   * codex,glm` 选的是另一组——于是**被选中那一侧的可用性在预检阶段根本不被检查**，
   * 要等运行期 `availability()` 才发现。AC-20 明写「家族未配置 ⇒ 预检即拒绝启动」，
   * 拦不住就是那条验收不成立。
   *
   * 解析走 `resolveCriticSelection`——与 `topic resolve` / `review --start` 同一处判定，
   * 不在这里再实现一遍（M7b 第 5 步的教训：两处各写一份，启用第三家时会先后不一致）。
   */
  // 未启用为 Driver 的在 `resolveDriver` 里就退 64（M10a 第 3 步），这里只取 driver
  const { driver } = resolveDriver(flagString(args, 'driver'));
  const critics = resolveCriticSelection(ctx.config, {
    critics: flagString(args, 'critics'),
    only: flagString(args, 'only'),
    driver,
  });
  /*
   * 同一条判定也要落在这个入口（第 2 轮 CODEX-05 的同族）。
   * 意见点名的是 `review --start`，但 `runPreflight` 内部同样只遍历传进去的
   * `critics`——只修一个入口，剩下那个就是下一次的「改一漏二」。
   */
  assertModelOverrideKeys(ctx.config, driver, Object.keys(modelOverrides), critics);
  // 判定通过 ⇒ 键集必然是本轮入选的审核者，这里才收窄（收集面见 collectModelOverrides）
  const models = modelOverrides as Partial<Record<CriticId, string>>;

  const r = await runPreflight({
    ctx,
    scope,
    modelOverrides: models,
    critics,
    driver,
    skipAuthCheck: args.flags.get('skip-auth-check') === true,
    refreshAuth: args.flags.get('refresh-auth') === true,
  });
  // 只有通过才写探活缓存——否则「预检失败」会留下写入，AC-16 字面不成立（GLM-05）
  await commitAuthCache(ctx, r);

  if (isJsonMode()) {
    emitJson({
      ok: r.ok,
      scope: r.scope,
      // `warn` 只在为真时带上：与既有输出逐字兼容（EV-123）
      checks: r.checks.map((c) => ({ name: c.name, ok: c.ok, ...(c.warn ? { warn: true } : {}), detail: c.detail })),
      // 恒在（无警告时为 []）：skill 按它转述，键缺席会让转述句静默不触发
      warnings: r.warnings,
      exit_code: r.exitCode,
    });
  } else {
    say(renderPreflight(r));
  }
  return r.ok ? EXIT.OK : r.exitCode;
}

/**
 * `topic claim`：为某一阶段**声明**当轮 Driver（M10a 第 1 步，EV-72）。
 *
 * `--stage` **必填、不给默认值**：一次认领哪一道闸门要说清楚，
 * 与 `approve --stage` 同一条理由。默认到 plan 会让「我以为认的是 code」
 * 这类错认领悄悄成功，而声明直接决定 Write / Edit 侧的保护集。
 *
 * 判定分支与出口全在 `driver-claim.ts`，本函数只做三件事：
 * 取三个输入（留痕 / 既有声明 / 会话来源）、落盘、把结果说清楚。
 */
async function cmdTopicClaim(args: ParsedArgs): Promise<number> {
  const ctx = await loadCtx();
  const stage = parseStage(args);
  const topic = flagString(args, 'topic');
  if (!topic) throw usageError('topic claim 需要 --topic');

  const rawDriver = flagString(args, 'driver');
  if (!rawDriver) throw usageError('topic claim 需要 --driver');
  /*
   * 取值合法性走 `resolveDriver` 这**唯一一处**判定，不在这里重写一遍（critics.ts 头注释）。
   * 未启用为 Driver 的在这里退 64（M10a 第 3 步）；此前这一格是「放行 + 标注」（代码双审 r1 GLM-06
   * 补的那行 warn），随收紧一并删除——它预告过这一点。
   */
  const { driver } = resolveDriver(rawDriver);

  const ref = await resolveTopic(ctx, topic, stage);
  const { updateTaskAsync } = await import('./meta.js');
  const { claimStageDriver, claimRejectionMessage, resolveStageDriver } =
    await import('./driver-claim.js');
  type ClaimOutcome = Awaited<ReturnType<typeof claimStageDriver>>;

  const resolution = await resolveStageDriver(ref.layout, stage);
  if (resolution.kind === 'corrupt') {
    throw new TriviumError(
      EXIT.GATE_BLOCK,
      `无法判定 ${ref.topic} / ${stage} 的当轮 Driver：运行留痕读不出来` +
        `（${resolution.unreadable.join('、')}）。\n` +
        '  留痕坏了就判不了「这一阶段归谁」，此时接受任何认领都是让声明在锚损坏时反超留痕。\n' +
        `  出口是重跑一次 ${stage} 阶段双审：新运行会先落一份可读的留痕。`,
    );
  }
  const runDriver = resolution.source === 'run' ? resolution.driver : null;
  const claimedBy =
    flagString(args, 'session-id') ?? process.env['CLAUDE_SESSION_ID'] ?? 'unknown-session';

  /*
   * ── 判定与落盘在**同一个临界区**内（代码双审 r1 CODEX-06 ≡ GLM-02）──
   *
   * 上一版把 `readTask` / 目录扫描 / 分支判定全放在锁外，`mutate` 回调再把锁外算好的
   * `outcome.claim` 整块写回。两个会话并发认领同一阶段时，后写者直接覆盖前者，
   * **且前者既不在当前值也不进任何人的 `history`**——`history` 是从锁外的 stale
   * `existing` 派生的。这正是 `updateTask` 头注释自己列的丢更新形态，只是这次丢的是
   * 自声明边界的审计面。
   *
   * 现在 `existing` 取自锁内刚读到的那份，判定随之在锁内做。
   * `outcome` 用外层变量带出来，供后面的输出与拒绝分支使用。
   */
  let outcome!: ClaimOutcome;
  await updateTaskAsync(ref.layout, async (task) => {
    outcome = await claimStageDriver({
      layout: ref.layout,
      stage,
      driver,
      claimedBy,
      runDriver,
      existing: task.drivers?.[stage] ?? null,
    });
    // 被拒与幂等都是「读了、判了、不改」——回调返回 false 即不写盘。
    // 幂等档若照写，`claimed_at` 会随每次重跑往后推，审计事实跟着漂。
    if (outcome.kind !== 'claimed' && outcome.kind !== 'revoked') return false;
    task.drivers = { ...(task.drivers ?? {}), [stage]: outcome.claim };
    return;
  }, { triviumDir: ctx.triviumDir, heartbeatStaleMs: ctx.config.review.heartbeat_stale_s * 1000 });

  if (outcome.kind === 'blocked-by-run' || outcome.kind === 'blocked-by-usage') {
    throw usageError(claimRejectionMessage(outcome, stage, driver));
  }

  if (isJsonMode()) {
    emitJson({
      ok: true,
      topic: ref.topic,
      stage,
      driver,
      outcome: outcome.kind,
      claimed_at: outcome.claim.claimed_at,
      claimed_by: outcome.claim.claimed_by,
      ...(outcome.kind === 'revoked' ? { revoked: outcome.previous } : {}),
      history_len: outcome.claim.history?.length ?? 0,
    });
  } else {
    const verb = { noop: '已声明（幂等，未改动）', revoked: '已改写声明', claimed: '已声明' }[
      outcome.kind
    ];
    say(`${verb}：${ref.topic} / ${stage} → ${driver}`);
    if (outcome.kind === 'revoked') {
      step(`原声明 ${outcome.previous} 已撤回并入声明史（共 ${outcome.claim.history?.length ?? 0} 条）`);
    }
    step(`声明来源 ${outcome.claim.claimed_by}`);
    step('留痕一旦产生即以留痕为准；声明用来写出文件之后不可再撤回');
  }
  return EXIT.OK;
}

async function cmdTopic(args: ParsedArgs): Promise<number> {
  if (args.sub[0] === 'claim') return cmdTopicClaim(args);
  if (args.sub[0] !== 'resolve') {
    throw usageError(`topic 只支持 resolve / claim 子命令，收到：${args.sub[0] ?? '(空)'}`);
  }
  const ctx = await loadCtx();
  const scope = parsePreflightScope(flagString(args, 'stage'));
  /*
   * 只认 `--` 终止符之后的 argv，逐个 token 交给解析器（EV-18）。
   * `--args <值>` 传法已删：它是「整串再切」的另一个入口，全仓只有本文件自己提过它。
   */
  const rawArgs = args.trailing;
  if (rawArgs.length === 0) {
    throw usageError(
      'topic resolve 需要 -- 之后的原始参数。推荐写法：\n' +
        "  trivium topic resolve --stage plan -- '<正文>' --topic <主题> [其余旗标]\n" +
        '  正文整段放进一个单引号参数，旗标放在引号之外。',
    );
  }

  const r = await resolveTopicArgs({ ctx, scope, rawArgs });
  if (isJsonMode()) {
    emitJson({ ok: true, ...r });
  } else {
    say(`主题 ${r.topic}${r.topic_inferred ? '（由任务目标推导，请确认）' : ''}`);
    say(`提示语 ${r.prompt_hint ?? '(无)'}`);
    say(`被审对象 ${r.subject_path ?? (r.base ? `git diff ${r.base}` : '(本阶段无单一被审文件)')}`);
    if (r.context_paths.length > 0) say(`必读路径 ${r.context_paths.join(', ')}`);
    if (r.only) say(`只跑一侧 ${r.only}`);
    if (r.allow_single) say('允许单审降级 --allow-single');
    for (const n of r.notes) step(n);
  }
  return EXIT.OK;
}

async function cmdInit(args: ParsedArgs): Promise<number> {
  const ctx = await loadCtx({ allowUninitialized: true });
  const dryRun = args.flags.get('dry-run') === true;
  const report = await runInit({
    ctx,
    dryRun,
    ...(flagString(args, 'asset-root') ? { assetRoot: flagString(args, 'asset-root')! } : {}),
  });
  if (isJsonMode()) emitJson({ ok: true, dry_run: dryRun, ...report });
  else renderInitReport(report, dryRun);
  return EXIT.OK;
}

/**
 * `trivium hooks --agent <id>`：只把本仓 Hook 渲染并合并进该家的项目配置（M10b 第 3 步，r5 §6.1、r10 §3.1.2）。
 *
 * **只做渲染 / 安装，不参与任何判定**：拦不拦由 `gate hook-*` 决定。与 `init` 共用 `mergeAllHooks`，
 * 区别只在范围——`init` 合并全部登记了 Hook 目标的家，这里只合并指定的一家（改了一家的配置、要单独刷新时用）。
 */
async function cmdHooks(args: ParsedArgs): Promise<number> {
  const ctx = await loadCtx({ allowUninitialized: true });
  const withHook = AGENTS.filter((a) => a.hookConfigTarget !== null);
  const id = (flagString(args, 'agent') ?? '').trim();
  if (!id) {
    throw usageError(`hooks 需要 --agent <id>。登记了 Hook 目标的：${withHook.map((a) => a.id).join(' | ')}`);
  }
  const agent = agentById(id);
  if (!agent) throw usageError(`未登记的 Agent「${id}」。可用：${ALL_AGENT_IDS.join(' | ')}`);
  if (!agent.hookConfigTarget) {
    throw usageError(
      // 事后覆盖面与 describeGuard 同一句（EV-132 计划 r2 D7：不再把审批前复核列成业务写入越界的兜底）
      `${id} 没有 Hook 机制，无从渲染（护栏等级 L2：写入没有事前拦截；${L2_AFTER_THE_FACT}）。\n` +
        `  登记了 Hook 目标的：${withHook.map((a) => a.id).join(' | ')}`,
    );
  }
  const dryRun = args.flags.get('dry-run') === true;
  const assetRoot = resolveAssetRoot(flagString(args, 'asset-root') ?? undefined);
  const report: InitReport = { created: [], updated: [], skipped: [], notes: [] };
  await mergeAllHooks(ctx.projectRoot, path.join(assetRoot, 'hooks/hooks.json'), report, dryRun, [agent]);
  if (!(await exists(path.join(ctx.triviumDir, 'config.yaml')))) {
    // Hook 命令外面的守卫在「没有 config.yaml」时一律放行：配置写进去了，但在 init 之前它一条都不拦
    report.notes.push('本项目尚未 `trivium init`：Hook 守卫在没有 .trivium/config.yaml 时一律放行，init 之后才会生效');
  }
  if (isJsonMode()) emitJson({ ok: true, dry_run: dryRun, agent: agent.id, ...report });
  else renderInitReport(report, dryRun);
  return EXIT.OK;
}

/** 停点「不得修改业务文件」那一句：按当轮 Driver 本次的有效护栏等级措辞（M10b 第 3 步） */
async function holdNoticeFor(projectRoot: string, driverId: string): Promise<string> {
  const agent = agentById(driverId) ?? agentById(DEFAULT_DRIVER)!;
  return gateHoldNotice(await effectiveGuardLevel(projectRoot, agent));
}

/**
 * 审批时的工作树改动摘要（EV-132 候选 ② 折中版；计划 `.reviews/审批前工作树摘要/plan/` r2 §2.4）。
 *
 * **隔离块**（计划双审 AGY-03）：`readRunMeta` 与摘要计算整段在内，任何异常都转成 `available: false`，
 * 不外溢到调用点——审批的落笔、退出码、闸门迁移、JSON 的其余字段都不受它影响。
 * 基线取 run.json 的 `snapshot.after_tree_hash`；run.json 读不出时按「没有基线」报。
 */
async function workTreeSummaryFor(
  ctx: Awaited<ReturnType<typeof loadCtx>>,
  layout: Parameters<typeof readRunMeta>[0],
  stage: Stage,
  runId: string,
): Promise<WorkTreeSummary> {
  const archiveRootRel = path.relative(ctx.projectRoot, ctx.archiveRoot) || ctx.config.archive_root;
  const budget = summaryBudget();
  try {
    const meta = await readRunMeta(layout, stage, runId);
    return await summarizeWorkTree({
      projectRoot: ctx.projectRoot,
      archiveRootRel,
      runId,
      afterTreeHash: meta?.snapshot.after_tree_hash,
      budgetMs: budget.ms,
      budgetOverridden: budget.overridden,
    });
  } catch (e) {
    return unavailableSummary(runId, archiveRootRel, e, budget);
  }
}

/** 打印摘要：取不到时走 warn（stderr），其余走 say。渲染本身出错也只告警一行 */
function printWorkTreeSummary(s: WorkTreeSummary, opts: RenderOptions): void {
  try {
    const r = renderWorkTreeSummary(s, opts);
    if (r.warning) warn(r.text);
    else say(r.text);
  } catch (e) {
    warn(`工作树改动摘要渲染失败：${e instanceof Error ? e.message : String(e)}。这不影响审批；请自行 git status 核对。`);
  }
}

const HOOK_NAMES: readonly HookName[] = [
  'hook-pre-write', 'hook-pre-bash', 'hook-pre-commit', 'hook-stop', 'hook-session-start',
];

async function cmdGate(args: ParsedArgs): Promise<number> {
  // ── Hook 入口 ──
  const sub = args.sub[0];
  if (sub && (HOOK_NAMES as readonly string[]).includes(sub)) {
    const input = await readHookInput();
    const out = await runHook(sub as HookName, () => loadCtx({ allowUninitialized: true }), input);
    if (out.json) process.stdout.write(JSON.stringify(out.json) + '\n');
    if (out.stderr) process.stderr.write(out.stderr + '\n');
    return out.exitCode;
  }

  const ctx = await loadCtx();
  const stage = parseStage(args);
  const topic = flagString(args, 'topic');
  if (!topic) throw usageError('gate 需要 --topic');
  const ref = await resolveTopic(ctx, topic, stage);

  /*
   * ── 当轮 Driver 与轮次：**直读运行元数据**，不从工件后缀反推（M9 第 5 步）──
   *
   * M9 第 5 步之前闸门区靠后缀反推，而后缀反推有循环依赖：当时的 `inferLatestRunId`
   * （M10a 第 4 步按 EV-64 删除）与仍在 `archive.ts` 的 `resolveRerunIndex` 都要先知道 driver
   * 才能跳过 Driver 自己的产出，而 driver 只记在留痕里。非缺省 Driver 且
   * `--critics claude` 时，本轮审查件全是 `-claude.md`，按缺省 Driver 推会把它们
   * 整批跳过——`gate --check` 以「请先跑一次双审」硬失败，而双审明明跑完了。
   *
   * `latestRunMeta` 直接给出权威的 `driver` 与 `rerun_index`（run.v2 里两者都必填），
   * 一次到位。`cmdGate` **不加 `--driver` 旗标**：事实来源是留痕不是旗标，
   * 与下面「事实来源是 critics_selected 不是键集」同一条原则。
   */
  const pinnedId = flagString(args, 'run-id');
  const pinned = pinnedId ? await readRunMeta(ref.layout, stage, pinnedId) : null;
  if (pinnedId && !pinned) {
    // 不静默回落：--run-id 是用户显式指定的，读不出来要说清是哪一种，别按缺省继续
    throw missingArtifactError(
      `--run-id ${pinnedId} 的运行元数据读不出来（文件缺失、内容损坏，或 schema 不识）。\n` +
        `  请确认该 run_id 属于主题「${topic}」的 ${stage} 阶段。`,
    );
  }
  const scan = pinned
    ? { meta: pinned, scanned: 1, unreadable: [] as string[] }
    : await latestRunMeta(ref.layout, stage);
  const latest = scan.meta;

  /*
   * ── 留痕读不出来时的分档（代码双审 AGY-01 / CODEX-01 / GLM-02）──
   *
   * 「一份都没有」与「有但全读不出」是两回事，三条子命令必须同一个口径：
   * 前者是正常的「还没跑过」，后者说明留痕被搅坏——**静默按缺省 Driver 继续，
   * 正是本批改动要消灭的形态**（plan/bug 阶段会把 `…-claude.md` 当缺件点名，
   * 而真 Driver 的原稿就躺在目录里，人读与 --json 两条输出都没有迹象）。
   *
   * 上一版只有 `--check` 与 `--await-approval` 硬失败，`--check-artifacts`
   * 这一格漏了；而且这里的注释写着「一条留痕都没有时才退回旧口径」，
   * 与 `latestRunMeta` 文档块的承诺互相矛盾——两句都是同一次改动写的。
   */
  if (!latest && scan.scanned > 0) {
    /*
     * ── 出口必须是走得通的那条（第 2 轮 CODEX-03 ≡ AGY-01 ≡ GLM-01）──
     *
     * 上一版这句写的是「请修复或移除这些文件，或用 --run-id 指定一份可读的运行」。
     * 两条路**在本状态的定义下都不成立**：
     *
     *   1. `--run-id` 同样走 `readRunMeta`（见上面 :762），而本状态的定义就是
     *      「扫到的全都读不出」——它必然返回 null 并撞上 pinned 那条硬失败。
     *      按构造不可实现。
     *   2. 「修复或移除」会撞上本仓自己的提交锚：`run-*.json` 一经 `registerRun`
     *      即不可删（`checkRunManifests` 报 manifest_missing），已提交版本也不可改
     *      （`hooks.ts` 的 `immutableChangeReason`：「运行清单是留痕核对的锚，
     *      改锚即可整枝绕过」）。照做会把提交永久拦下。
     *
     * 真正可用的那条是**重跑该阶段**：`prepareRun` 会先落一份 status: running 的
     * 骨架，其 run_id 最新，`latestRunMeta` 取首个可读项即返回它，闸门当场恢复。
     *
     * `cmdGate` 依然**不加** `--driver` / `--force` 覆盖旗标（第 2 轮 AGY-01 的建议
     * 未采纳）：允许人工声明一个与留痕不符的 Driver，闸门就失去了它唯一的事实锚，
     * 那正是本批改动要消灭的形态。与下面「事实来源是 critics_selected 不是键集」同源。
     */
    throw missingArtifactError(
      `${stage} 阶段扫到 ${scan.scanned} 份运行元数据，但**一份都读不出来**` +
        `（文件损坏、schema 不识，或不合 run.v1/v2 契约）：${scan.unreadable.join('、')}\n` +
        '  无法确定当轮 Driver 与轮次，不能按缺省 Driver 继续——那会把「留痕坏了」判成「按 claude 判」。\n' +
        `  出口是**重跑一次 ${stage} 阶段双审**：新运行会落一份可读的运行元数据，闸门随即恢复。\n` +
        '  不要删除或改写这些 run-*.json——它们是提交时留痕核对的锚，动了会让 git commit 被拦下。\n' +
        '  （--run-id 在这一格没有用：它读的是同一批文件，同样读不出来。）',
    );
  }

  const gateDriver = latest?.driver ?? DEFAULT_DRIVER;
  /*
   * 轮次优先取留痕的 `rerun_index`。注意它是**最新一次运行声明的轮次**，
   * 不是「工件实际落在第几轮」（代码双审 GLM-03）：`prepareRun` 会先落一份
   * `status: running` 的骨架，worker 在产出任何工件前崩溃时那份骨架就是 latest，
   * 记的是**意图轮次**。指向最新一次运行本身说得通，但别把它说成工件事实。
   *
   * 扫到 0 份时才退回「`resolveRerunIndex - 1`」这个旧口径——那时确实没有更好的依据。
   */
  const rerunIndex = latest?.rerun_index
    ?? Math.max(1, (await resolveRerunIndex(ref.layout, stage, gateDriver)) - 1);
  if (!latest) {
    // 扫到 0 份：可以继续，但要让人看见 driver 与轮次是按缺省算的
    warn(
      `${stage} 阶段没有任何运行元数据：当轮 Driver 按缺省「${gateDriver}」、` +
        `轮次按工件反推为第 ${rerunIndex} 轮。若这不是你要的，请先跑一次双审或用 --run-id 指定。`,
    );
  }

  // ── --check-artifacts ──
  if (args.flags.get('check-artifacts') === true) {
    /*
     * 传入全部 run.json 的工件登记，让 checkStageArtifacts 能查出「没登记却混在
     * 阶段目录里」的审查件（审查意见 GLM-03）——搬运进来的伪审查件在此暴露。
     */
    const recorded = new Set<string>();
    for (const r of await listRecordedRuns(ref.layout)) {
      for (const a of r.artifacts) recorded.add(a.path);
    }
    /*
     * 传本轮**实际入选**的审核者，不再让它回落到当前启用集合。
     *
     * 回落的后果是**单侧轮次被误报缺件**：`--only gemini` 跑完后，
     * 校验仍按两侧找工件，glm 那份永远不存在，于是一个完全合规的轮次
     * 被判成缺件。读不到 run.json 时才回落到默认集合——那时没有更好的依据。
     *
     * 事实来源是 `critics_selected`（「本该跑谁」），**不是 `critics` 的键集**
     * （「实际产出了结果的」）。第 2 步只能读键集，因为那时还没有这个字段，
     * 而键集在一种形态下会漏判：某侧入选却整侧失联、连一条结果都没记上，
     * 键集里就没有它——于是工件校验压根不去找那一侧的审查文档，
     * **一个真实的缺件被静默放过**。它与「单侧轮次误报」是同一枚硬币的两面，
     * 只有同时知道「本该跑谁」和「跑出了什么」才能两头都判对。
     * 历史 v1 记录经 `readRunMeta` 迁移后，该字段正是由键集推导，判读结论不变。
     */
    // 上面已经直读到留痕；`latest` 就是这一轮的权威记录，不必再按后缀反推一次
    const artifactMeta = latest;
    const roundCritics = artifactMeta ? artifactMeta.critics_selected : undefined;
    // driver 位补上：它决定去找谁的原稿与谁的裁决件（此前空着，非缺省 Driver 下必判缺件）
    const c = await checkStageArtifacts(ref.layout, stage, rerunIndex, roundCritics, gateDriver, recorded);
    if (isJsonMode()) {
      emitJson({ ok: c.ok, stage, rerun_index: rerunIndex, present: c.present, missing: c.missing });
    } else if (c.ok) {
      say(`✓ ${stage} 阶段第 ${rerunIndex} 轮工件齐备：${c.present.join(' / ')}`);
    } else {
      /*
       * 给出 `--run-id` 出口（代码双审 GLM-03）：轮次取自「最新一次运行」，
       * 而那可能是一份 worker 崩溃前落下的、什么工件都没有的骨架——
       * 此时更早的完整轮次仍在目录里，用户需要知道怎么指到它。
       * `--check` 那条早有同款提示，这一条此前漏了。
       *
       * 按 `--run-id` 是否给过分两句（第 2 轮 CODEX-06）：给了的时候 rerunIndex
       * 恰恰来自那份被钉住的留痕，再劝他「可用 --run-id 指定更早的轮次」与事实相反，
       * 会把排障的人推去用已经用过的旗标。
       */
      fail(
        `${stage} 阶段第 ${rerunIndex} 轮缺件：${c.missing.join(' / ')}\n` +
          (pinnedId
            ? `  轮次取自 --run-id 指定的运行 ${pinnedId}。换一个 run_id 可查看别的轮次。`
            : '  轮次取自最新一次运行。若那一轮尚未产出工件（例如 worker 中途崩溃），' +
              '可用 --run-id <id> 指定更早的完整轮次。'),
      );
    }
    return c.ok ? EXIT.OK : EXIT.MISSING_ARTIFACT;
  }

  // ── --await-approval ──
  if (args.flags.get('await-approval') === true) {
    /*
     * ── 先校验裁决完整性，再置闸门（审查意见 AGY-02）──
     *
     * 原先这里只 setGate、不做任何前置检查。于是「直接 --await-approval 再 approve」
     * 就能把逐条裁决与工件核验**整段跳过**——闸门从 review_done_awaiting_disposition
     * 被覆写成 awaiting_approval，`approve` 再把它放行，全程没人检查过裁决件。
     *
     * 人工审批是在「机器已确认裁决齐备」之上再加一道，不是它的替代品。
     *
     * M10a 第 3 步：判定抽成 `verifyRoundForApproval`，与 `approve` 共用一份，并补上本轮
     * 登记工件的 sha256 抽核（此前这里只核裁决齐备，审查工件被改而结构化原文还在时照常通过）。
     * 「推断不出 runId 就拒绝」随抽取搬进该函数，判定与注释原样保留；这里只给出口文案。
     * `latest.run_id` 直读留痕，不按后缀反推。
     */
    const v = await verifyRoundForApproval({
      cfg: ctx.config, layout: ref.layout, stage,
      runId: latest?.run_id ?? null,
      runIdPinned: Boolean(pinnedId),
      runIdSource: pinnedId ? '--run-id' : '最新一次运行',
      recovery: {
        missingRunId: '用 --run-id <id> 显式指定，或先跑一次双审。',
        unreadableRunMeta: `出口是重跑一次 ${stage} 阶段双审：新运行会落一份可读的运行元数据。`,
      },
    });
    const runId = v.runId;
    if (!v.ok) {
      if (!v.result.ok) say(renderGateResult(v.result));
      if (v.tampered.length > 0) say(renderTamperedArtifacts(v.tampered, gateDriver));
      fail(
        (v.result.ok ? '本轮登记的审查工件与留痕不符' : '裁决尚未齐备') + '，不能置为等待人工审批。\n' +
          (v.result.ok
            ? '  先恢复上面列出的工件（或作废这一轮）再重试。'
            : `  先补齐裁决件并通过 \`trivium gate --stage ${stage} --topic ${topic} --check\`。`),
      );
      return EXIT.GATE_BLOCK;
    }
    /*
     * 校验通过时的告警也要带到停点上（代码双审 r3 CODEX-03 ≡ GLM-04）：审批停点正是
     * 最该看见「本轮原稿不在保护集」这类运行期事实的地方，只在失败分支渲染会让它
     * 在人要表态的那一格消失。
     */
    const preWarnings: Array<{ code: string; message: string }> = v.result.warnings;
    /*
     * 条件迁移，与本批刚确立的「非覆盖场合一律条件迁移」保持一致（GLM-03）。
     *
     * 允许的来源含 `idle`：命令 B/C/D 的正常序列是 `--check`（通过后闸门回 idle）
     * → `--await-approval`。把 idle 排除在外会把这条正常路径堵死。
     * 真正要挡的是 `running`——那是**另一次运行**的护栏，不能被它清掉；
     * 加上 runId 比对，别的 run 的闸门也动不了。
     */
    /*
     * **本轮人已表态就不再立停点**——这是「校验/停点命令撤销人的审批」的
     * 第二个入口：白名单里含三个终态，重跑一次 `--await-approval` 同样能把
     * 已放行的闸门打回等待。与 `--check` 那两个分支是同一缺陷的三处落点，
     * 判据同样以归档里的审批记录为正本。
     */
    const { humanDecidedThisRound } = await import('./approval.js');
    if (await humanDecidedThisRound(ref.layout, stage, runId)) {
      const msg =
        `本轮（第 ${rerunIndex} 轮）已有人工审批记录，闸门状态保持不变。\n` +
        `  要重新走停点，请先对本轮重新表态，或另起一轮审查。`;
      if (isJsonMode()) emitJson({ ok: true, state: 'unchanged', stage, rerun_index: rerunIndex, message: msg });
      else say(msg);
      return EXIT.OK;
    }

    const g = await setGateChecked({
      triviumDir: ctx.triviumDir, topic, stage, state: 'awaiting_approval',
      runId, rerunIndex,
      // 设计 §5.2 / §9.2 的三处留痕面之一，只记不读（代码双审 CODEX-06）
      driver: gateDriver,
      sessionId: flagString(args, 'session-id') ?? process.env['CLAUDE_SESSION_ID'] ?? null,
      heartbeatStaleMs: ctx.config.review.heartbeat_stale_s * 1000,
      expect: {
        state: ['idle', 'review_done_awaiting_disposition', 'awaiting_approval', 'approved', 'rejected', 'abandoned'],
        runId,
        allowMissing: false,
      },
    });
    if (!g.applied) {
      fail(`闸门未置为等待审批：${g.skipped ?? '当前状态不允许此迁移'}`);
      return EXIT.GATE_BLOCK;
    }
    /*
     * 停点话术按**当轮 Driver** 措辞（M10b 第 3 步；第 2 步薄冒烟核出）：调用写法取该载体的
     * （codex 上是 `$dual-approve`），「不得修改业务文件」的后半句按本次运行时的有效护栏等级说。
     * 此前写死 `/dual-approve` 与「（Hook 会拦下）」，对 L2 载体后半句不成立。
     */
    const approveCmd = entryCommandOf(gateDriver, 'dual-approve');
    const msg =
      `已置为等待人工审批：${topic} / ${stage}（第 ${rerunIndex} 轮）\n` +
      `  通过：${approveCmd} --topic ${topic} --stage ${stage} [--reason <附言>]\n` +
      `  拒绝：${approveCmd} --topic ${topic} --stage ${stage} --reject --reason <理由>\n` +
      `  放弃：${entryCommandOf(gateDriver, 'dual-abandon')} --topic ${topic}\n` +
      `  ${await holdNoticeFor(ctx.projectRoot, gateDriver)}` +
      preWarnings.map((w) => `\n  ⚠️ [${w.code}] ${w.message}`).join('');
    // 停点上的工作树改动摘要：闸门已迁移完才算，只告知（审批前工作树摘要计划 r2 §2.4）
    const wts = await workTreeSummaryFor(ctx, ref.layout, stage, runId);
    if (isJsonMode()) {
      emitJson({
        ok: true, state: 'awaiting_approval', stage, rerun_index: rerunIndex, message: msg, warnings: preWarnings,
        worktree_summary: wts,
      });
    } else {
      say(msg);
      printWorkTreeSummary(wts, { exit: 'hold', driver: gateDriver, topic });
    }
    return EXIT.OK;
  }

  // ── --check（默认）──
  // 直读留痕：这条路径最常用，也正是「裁决件尚未写出」的那一格——
  // 按后缀反推时第一趟恒为 null，整条命令会以「请先跑一次双审」硬失败
  const runId = latest?.run_id ?? null;
  if (!runId) {
    throw missingArtifactError(
      `找不到 ${stage} 阶段的运行元数据。请先跑一次双审，或用 --run-id 指定。`,
    );
  }
  const { reviews, notes, expectedFallbackIds, missingSides, degraded, voidedSides, readonlyBreach, runWarnings, reviewDocs } =
    await loadRoundReviews(ref.layout, stage, runId);
  for (const n of notes) step(n);

  const result = await checkAdjudication({
    cfg: ctx.config, layout: ref.layout, stage, rerunIndex, reviews,
    driver: gateDriver,
    runIdPinned: Boolean(pinnedId),
    degraded, voidedSides, readonlyBreach, runWarnings,
    expectedFallbackIds, missingSides, runId, reviewDocs,
  });

  if (isJsonMode()) {
    emitJson({
      ok: result.ok,
      stage, rerun_index: rerunIndex, run_id: runId,
      failures: result.failures,
      warnings: result.warnings,
      structured_ids: result.structuredIds,
      fallback_ids: result.fallbackIds,
      disposition: result.dispositionPath,
    });
  } else {
    say(renderGateResult(result));
  }

  /*
   * 双方共同 blocker 被驳回且策略为 warn：设计 §6.6 规则 7 / §8.6 判据 g 要求
   * 「输出警告**并在 task.json 记 disputed: true**」。原先只 push 进 warnings，
   * disputed 初始化为 false 后再无写入点，status / report 的「有争议项」永不触发。
   */
  /*
   * 共同阻断三态落持久面（r2 代码双审 GLM-02 ≡ CODEX-04）。
   *
   * run.json 只到 `pending`——运行期读不到裁决表。最终结论在这里产生，
   * 不落盘的话 `checked-found` 永久只存在于本次进程的内存里。
   *
   * 与下面的 `disputed` 分开写：那一条只在「共同项被驳回」时才写，
   * 而三态**每次 check 都要写**——「查过、没有共同项」同样是要留的结论。
   */
  const { updateTask } = await import('./meta.js');
  const taskOpts = {
    triviumDir: ctx.triviumDir,
    heartbeatStaleMs: ctx.config.review.heartbeat_stale_s * 1000,
  };
  const jc = result.jointCheck;
  if (jc) {
    await updateTask(ref.layout, (t) => {
      const entry = {
        run_id: runId,
        stage,
        rerun_index: rerunIndex,
        state: jc.state,
        effective_sides: jc.effective_sides,
        ...(jc.reason ? { reason: jc.reason } : {}),
        at: new Date().toISOString(),
      };
      // 同一轮重跑 --check 覆盖，不堆积
      t.joint_checks = [...(t.joint_checks ?? []).filter((x) => x.run_id !== runId), entry];
    }, taskOpts);
  }

  if (result.warnings.some((w) => w.code === 'joint_blocker_rejected')) {
    await updateTask(ref.layout, (t) => {
      t.disputed = true;
    }, taskOpts);
    warn('双方共同提出的 blocker 被驳回：已在 task.json 记为有争议项（disputed），status / report 会显示');
  }

  /*
   * 校验通过后闸门去哪，取决于**本次运行由哪条命令发起**（审查意见 AGY-02）。
   *
   * 原先一律落回 `idle`，把「推进到人工审批态」整个交给随后那一步
   * `--await-approval`。可那一步是 skill 文档里的一行字，不是机制：Driver 只要
   * 省略它，闸门就停在 idle，四个 Hook 全部视为无闸门放行，人工审批被静默旁路；
   * 而此时用户再跑 /dual-approve 反而会因为状态是 idle 被拒。护栏的存续
   * 不该取决于执笔者记不记得走完流程。
   *
   * 现在按 run.json 记下的 `entry` 分流：
   *   · B/C/D（/dual-review-*）→ 停点是它们的定义，直接立起 `awaiting_approval`；
   *     即便 Driver 省略随后的 `--await-approval`，闸门也已经拦着。
   *   · A（/dual-run）→ 按 PRD 4.4 不设人工闸门，维持原来的 `idle`。
   *   · 读不到 entry（旧 run.json、或手工调用）→ 同样回 idle，保持向后兼容：
   *     这条路径上没人声称过有停点，不能凭空造一个出来拦住用户。
   */
  const entry = result.ok ? (await readRunMeta(ref.layout, stage, runId))?.entry ?? null : null;
  const stopsForApproval = entry === 'B' || entry === 'C' || entry === 'D';

  /*
   * 本轮人已经表过态了就**不推进状态**——`--check` 是校验命令，没资格撤销审批。
   *
   * 这条判断必须盖住**下面两个**迁移分支（B/C/D 推等待审批、A/无 entry 推 idle）：
   * 两处都只带 `expect: { runId }`，只挂一个，重跑 `--check` 仍会把已放行的闸门
   * 改写成 idle。判据以归档里的审批记录为正本，理由见 `humanDecidedThisRound`。
   */
  const { humanDecidedThisRound } = await import('./approval.js');
  const alreadyDecided = result.ok ? await humanDecidedThisRound(ref.layout, stage, runId) : false;
  if (alreadyDecided) {
    say('· 本轮已有人工审批记录，闸门状态保持不变（校验命令不撤销审批）');
    /*
     * **对账本机状态，不一致就如实报告**（上一轮裁决件 §2.2 #12 承诺、未兑现，
     * 这一轮由 CODEX-11 逐条对账查出来）。
     *
     * 归档里的审批记录是正本，`state.json` 的闸门是本机副本。两者会分叉——
     * 审批在另一台机器/另一个克隆上做的，或本机 `state.json` 被删被改。
     * 分叉时上面那句「闸门状态保持不变」是**误导**：它让人以为本机护栏
     * 已经按审批结果就位，而实际可能仍拦着（Hook 照拦，人查不出为什么），
     * 或早已放行（审批其实是拒绝，而本机什么都不拦）。
     *
     * 只报告不修复：这里是校验命令，没资格改闸门——那正是上面那条纪律。
     */
    const { readState, gateKey } = await import('./state.js');
    const local = (await readState(ctx.triviumDir)).gates[gateKey(topic, stage)];
    if (!local) {
      warn(
        `归档记着本轮已审批，但本机 state.json 里没有 ${topic} / ${stage} 的闸门——` +
        '可能是审批在别处做的，或本机状态被清过。Hook 据本机状态判，请人工确认护栏是否如你所想。',
      );
    } else if (local.run_id !== runId) {
      warn(
        `归档记着本轮（${runId}）已审批，而本机闸门指向另一次运行（${local.run_id ?? '无'}）。` +
        '两者不是同一轮，本机护栏的状态与本轮审批无关，请人工核对。',
      );
    } else if (
      /*
       * 审批之后闸门的正常去向：`approved` / `rejected` / `abandoned`（人表过态了），
       * 或 `idle`（`/dual-run` 一族本就不设人工闸门，放行后回落）。
       * 其余取值都意味着本机还停在审批**之前**的某一步。
       */
      !['idle', 'approved', 'rejected', 'abandoned'].includes(local.state)
    ) {
      warn(
        `归档记着本轮已审批，而本机闸门仍是 ${local.state}。` +
        'Hook 按本机状态判，因此写入可能仍被拦着；这是状态分叉，不是审批没生效。',
      );
    }
  }

  if (result.ok && stopsForApproval && !alreadyDecided) {
    const g = await setGateChecked({
      triviumDir: ctx.triviumDir, topic, stage, state: 'awaiting_approval',
      runId, rerunIndex,
      // 设计 §5.2 / §9.2 的三处留痕面之一，只记不读（代码双审 CODEX-06）
      driver: gateDriver,
      sessionId: flagString(args, 'session-id') ?? process.env['CLAUDE_SESSION_ID'] ?? null,
      heartbeatStaleMs: ctx.config.review.heartbeat_stale_s * 1000,
      expect: { runId },
    });
    if (!g.applied && g.entry) {
      warn(`裁决已通过，但闸门未推进到等待审批：${g.skipped}。该闸门属于另一次运行，本次不动它。`);
    } else {
      const msg =
        `裁决齐备，已置为等待人工审批：${topic} / ${stage}（第 ${rerunIndex} 轮）\n` +
        `  停点话术：trivium gate --stage ${stage} --topic ${topic} --await-approval\n` +
        `  ${await holdNoticeFor(ctx.projectRoot, gateDriver)}`;
      if (!isJsonMode()) {
        say(msg);
        // 停点上的工作树改动摘要（计划 r2 §2.4）：JSON 模式本就不输出停点文字，这里同样不加
        printWorkTreeSummary(await workTreeSummaryFor(ctx, ref.layout, stage, runId), { exit: 'hold', driver: gateDriver, topic });
      }
      const { resetStopBlockCount } = await import('./lock.js');
      await resetStopBlockCount(ctx.triviumDir, topic, stage);
    }
    return EXIT.OK;
  }

  /*
   * 以下是 entry A 与无 entry 的路径：校验通过即把闸门从
   * `review_done_awaiting_disposition` 放行回 idle。
   *
   * 不这样做的话，`hook-pre-commit` / `hook-stop` 会在裁决**已经补齐之后**
   * 继续拦人，用户唯一的出路是去改配置关掉 Hook——护栏一旦开始误伤，
   * 第一个被关掉的就是它自己。
   */
  if (result.ok && !alreadyDecided) {
    /*
     * 只放行**本轮**的闸门（审查意见 GLM-r2-01 ①）。
     *
     * 无条件覆盖时，对旧一轮补完裁决跑 `--check`，会把已经接管的新一轮
     * `running` 覆写成 `idle`——新一轮审查期内的业务写锁就此静默失效。
     *
     * `!alreadyDecided`：本轮人已表态时同样不推进。这个分支容易被忘——
     * 它把闸门推回 `idle` 而不是 `awaiting_approval`，症状是「审批记录还在、
     * 闸门却成了无闸门」，比上一个分支更隐蔽。
     */
    const g = await setGateChecked({
      triviumDir: ctx.triviumDir, topic, stage, state: 'idle',
      runId, rerunIndex,
      sessionId: flagString(args, 'session-id') ?? process.env['CLAUDE_SESSION_ID'] ?? null,
      heartbeatStaleMs: ctx.config.review.heartbeat_stale_s * 1000,
      expect: { runId },
    });
    if (!g.applied && g.entry) {
      warn(`裁决已通过，但闸门未放行：${g.skipped}。该闸门属于另一次运行，本次不动它。`);
    }
    // 阻断计数只在审批时归零会跨轮累积：走 --check 放行的轮次不归零，下一轮首次 Stop 就超限放行
    if (g.applied) {
      const { resetStopBlockCount } = await import('./lock.js');
      await resetStopBlockCount(ctx.triviumDir, topic, stage);
    }
  }

  // 返回 2 让调用方（skill / Hook）能按闸门语义处理
  return result.ok ? EXIT.OK : EXIT.GATE_BLOCK;
}

async function cmdApproval(
  args: ParsedArgs,
  fallbackDecision: 'approved' | 'abandoned',
): Promise<number> {
  const ctx = await loadCtx();
  const topic = flagString(args, 'topic');
  if (!topic) throw usageError('需要 --topic');

  const decision =
    fallbackDecision === 'approved' && args.flags.get('reject') === true ? 'rejected' : fallbackDecision;

  // abandon 不带 --stage 时，放弃该主题下全部未关闭闸门——但 running 的不动：
  // 那是别的运行正在用的护栏，要先 --cancel（recordApproval 也会拒绝）
  const stageRaw = flagString(args, 'stage');
  const open = (await listOpenGates(ctx.triviumDir)).filter((g) => g.topic === topic);

  /*
   * 「通过」必须显式指定阶段（审查意见 AGY-05）。
   *
   * 省略 --stage 时下面会枚举该主题全部非 running 的开放闸门，其中可能有
   * `review_done_awaiting_disposition`——而 recordApproval 对 approved 严格要求
   * `awaiting_approval`，于是抛 MISSING_ARTIFACT 中断，用户看到的是一个异常
   * 而不是一句人话。abandon 的批量语义是合理的（放弃整个主题很自然），
   * approve 不是：一次放行哪一道闸门，本来就该说清楚。
   */
  if (decision === 'approved' && !stageRaw) {
    const candidates = open.filter((g) => g.state === 'awaiting_approval').map((g) => g.stage);
    throw usageError(
      '通过审批必须显式指定 --stage。\n' +
        (candidates.length > 0
          ? `  主题「${topic}」当前等待审批的阶段：${candidates.join('、')}\n`
          : `  主题「${topic}」当前没有等待审批的阶段。\n`) +
        '  （放弃可以不带 --stage，那会放弃该主题下全部闸门；通过不行——一次放行哪一道要说清楚。）',
    );
  }
  const running = stageRaw ? [] : open.filter((g) => g.state === 'running');
  for (const g of running) {
    warn(`${g.topic}/${g.stage} 双审进行中（run ${g.run_id ?? '未知'}），本次不放弃它；如需中止请 trivium review --cancel ${g.run_id ?? '<run_id>'}`);
  }
  const stages: Stage[] = stageRaw
    ? [parseStage(args)]
    : open.filter((g) => g.state !== 'running').map((g) => g.stage);

  if (stages.length === 0) {
    throw missingArtifactError(
      `主题「${topic}」没有可${fallbackDecision === 'approved' ? '审批' : '放弃'}的闸门` +
        (running.length > 0 ? '（进行中的运行请先 --cancel）' : ''),
    );
  }

  /*
   * ── 通过前复核（M10a 第 3 步，M10 计划 r7 §4.3 / §4.4，演进设计 §9.4）──
   *
   * 只对 approved 做；拒绝与放弃不复核、也不加确认码（v1.2.3 ② 撤销过，见 approval.ts 头注释）。
   * 判定与 `gate --await-approval` 共用 `verifyRoundForApproval` 一份：裁决齐备 + 本轮登记工件的
   * sha256 抽核。它挡的是「停点之后裁决件被删改、审查工件被改」这类形态，
   * **不挡「审批不是人发起的」**——approve 不校验调用来源。
   *
   * **先全部复核、再逐一落审批**：不留「一个阶段已放行、另一个阶段复核失败」的半截态。
   * approved 今天强制 `--stage`、实际只有一个阶段，这样写是为了不依赖这个前提。
   */
  const verified = new Map<Stage, string>();
  // 复核时已拿到的主题定位与闸门项 Driver，留给下面的工作树摘要用，免得在隔离块外再取一次
  const verifiedCtx = new Map<Stage, { layout: Parameters<typeof readRunMeta>[0]; driver: string | null }>();
  if (decision === 'approved') {
    for (const stage of stages) {
      const gate = await getGate(ctx.triviumDir, topic, stage);
      // 状态不对先报状态（无闸门 / running / 非待批），别让 running 的闸门去跑复核、报一串误导的缺口
      assertGateDecidable(gate, { topic, stage, decision, reason: flagString(args, 'reason') });
      const ref = await resolveTopicReadOnly(ctx, topic, stage);
      /*
       * 出口单独写，不沿用 `--await-approval` 那两条（计划 r3 §3.2，计划双审 r1 CODEX-02）：
       * approve 没有 `--run-id`；`review --start` 抢占时不接受 awaiting_approval 的槽位；
       * `--check` / `--await-approval` 带 expect.runId、不改写属于别的运行的闸门项。
       * 走得通的只有 abandon（它以闸门自己的 run_id 做比较-交换）之后重跑。两个分支同一段文案。
       */
      /*
       * 调用写法按闸门项记下的 Driver（代码双审 r3 GLM-03）。闸门项的 `driver` 不作当轮**身份**来源（EV-68：
       * 同槽位重跑换 Driver 时它留着上一轮的值），这里只拿它**选写法**；这一支本就是「留痕读不出」的分叉现场，
       * 拿不到更可信的来源。最坏情况是给出上一轮 Driver 的写法。
       */
      const abandonCmd = entryCommandOf(gate.driver, 'dual-abandon');
      const exit =
        '本机闸门项没有指向一份可读的运行留痕：归档是正本、本机闸门是副本，两者已经分叉。\n' +
        '  approve 不接受 --run-id；--check 与 --await-approval 不会改写属于别的运行的闸门项。\n' +
        `  出口：${abandonCmd} --topic ${topic} --stage ${stage} --reason '<说明分叉>'，然后重跑该阶段双审。\n` +
        '  这会留下一条 run_id 为空（或为那个读不出的值）的放弃记录，请在 reason 里写明缘由。';
      const v = await verifyRoundForApproval({
        cfg: ctx.config, layout: ref.layout, stage,
        runId: gate.run_id ?? null,
        runIdPinned: true,
        runIdSource: '本机闸门记录',
        recovery: { missingRunId: exit, unreadableRunMeta: exit },
      });
      if (!v.ok) {
        if (!v.result.ok) say(renderGateResult(v.result));
        if (v.tampered.length > 0) say(renderTamperedArtifacts(v.tampered, gate.driver));
        fail(
          `${topic} / ${stage}（第 ${v.rerunIndex} 轮）通过前复核未过，本次不放行，闸门保持等待审批。\n` +
            (v.result.ok
              ? `  先恢复上面列出的工件（或 ${abandonCmd} 作废这一轮）再审批。`
              : `  先补齐裁决件并通过 \`trivium gate --stage ${stage} --topic ${topic} --check\`，再审批。`),
        );
        return EXIT.GATE_BLOCK;
      }
      verified.set(stage, v.runId);
      verifiedCtx.set(stage, { layout: ref.layout, driver: gate.driver ?? null });
    }
  }

  /*
   * ── 审批时的工作树改动摘要（EV-132 候选 ② 折中版，计划 r2 §2.4）──
   *
   * 只告知：复核**之后**另算，不进上面的判定；每阶段一个隔离块（`workTreeSummaryFor`）。
   * **先打印、再落审批**（计划双审 CODEX-03）：摘要有总预算，被载体超时或 Ctrl-C 砍在这一段时
   * 审批还没记录、闸门仍在等待，重跑即可；反过来先落审批，砍在打印段时审批已记录而 Driver 拿不到输出。
   * run id 取复核所用的那个（闸门项 run_id，与 `verified` 同值）。
   */
  const summaries: Partial<Record<Stage, WorkTreeSummary>> = {};
  for (const [stage, runId] of verified) {
    const vc = verifiedCtx.get(stage)!;
    const s = await workTreeSummaryFor(ctx, vc.layout, stage, runId);
    summaries[stage] = s;
    if (!isJsonMode()) printWorkTreeSummary(s, { exit: 'approval', driver: vc.driver, topic });
  }

  for (const stage of stages) {
    const out = await recordApproval({
      ctx, topic, stage, decision,
      reason: flagString(args, 'reason'),
      sessionId: flagString(args, 'session-id') ?? process.env['CLAUDE_SESSION_ID'] ?? null,
      verifiedRunId: verified.get(stage) ?? null,
    });
    say(out.message);
  }
  if (isJsonMode()) {
    emitJson({
      ok: true, topic, stages, decision,
      ...(decision === 'approved' ? { worktree_summary: summaries } : {}),
    });
  }
  return EXIT.OK;
}

async function cmdVerify(args: ParsedArgs): Promise<number> {
  const ctx = await loadCtx();
  const topic = flagString(args, 'topic');
  if (!topic) throw usageError('verify 需要 --topic');
  /*
   * 只读定位**且**先确认主题存在（审查意见 GLM-05）。
   * 上一轮只把 `resolveTopic` 换成只读版，但 `runVerify` 自己仍会为任意主题名
   * 建出 `verify/` 与 `_meta/`——只读化做了一半。
   */
  const ref = await resolveTopicReadOnly(ctx, topic, 'plan');
  if (!(await exists(path.join(ctx.archiveRoot, ref.topic)))) {
    const all = await listTopics(ctx);
    throw missingArtifactError(
      `主题「${topic}」在 ${path.relative(ctx.projectRoot, ctx.archiveRoot)} 下不存在。` +
        (all.length > 0 ? `\n  现有主题：${all.join('、')}` : '\n  该归档根下还没有任何主题。'),
    );
  }

  const onlyRaw = flagString(args, 'only');
  if (onlyRaw && onlyRaw !== 'build' && onlyRaw !== 'test') {
    throw usageError(`--only 只接受 build 或 test，收到「${onlyRaw}」`);
  }
  const only = (onlyRaw as 'build' | 'test' | null) ?? null;

  const planned = collectCommands(ctx.config, only);
  if (planned.length === 0) {
    /*
     * 不直接抛 usageError：§14.2 要求把「未配置」也落成一份记录，
     * 否则事后看归档会以为这一步从未发生过。落盘后再以 64 退出。
     */
    warn('verify.build 与 verify.test 均未配置，本次什么也不会执行——这不等于通过。');
  }

  /*
   * `--timeout` 解析失败必须报错（审查意见 GLM-r2-07）。
   * 原先 `Number.isFinite` 守卫只做静默回落：`--timeout abc` 得 NaN、`--timeout 0`
   * 得 0，两者都悄悄用了默认值，用户拼错参数**零提示**。
   */
  const timeoutStr = flagString(args, 'timeout');
  let timeoutS: number | null = null;
  if (timeoutStr !== null) {
    const n = Number(timeoutStr);
    if (!Number.isFinite(n) || n <= 0) {
      throw usageError(`--timeout 需要一个正数秒数，收到「${timeoutStr}」。`);
    }
    timeoutS = n;
  }
  const runId = newRunId();
  const out = await runVerify({
    ctx,
    layout: ref.layout,
    runId,
    only,
    ...(timeoutS !== null ? { timeoutS } : {}),
    onProgress: (l) => say(l),
  });

  if (isJsonMode()) {
    emitJson({
      ok: out.exitCode === EXIT.OK,
      run_id: runId,
      status: out.record.status,
      unconfigured: out.record.unconfigured,
      commands: out.record.commands.map((c) => ({
        cmd: c.cmd, group: c.group, exit_code: c.exit_code, duration_s: c.duration_s,
      })),
      artifact: out.artifactPath,
      meta: out.metaPath,
    });
  } else {
    say('');
    say(`编译测试：${summarizeVerify(out.record)}`);
    say('已落盘：');
    say(`  ${path.relative(ctx.projectRoot, out.artifactPath)}`);
    say(`  ${path.relative(ctx.projectRoot, out.metaPath)}`);
    if (out.record.unconfigured) {
      fail('未配置编译测试命令：请运行 `trivium init` 或 `trivium doctor --suggest-verify` 后重试。');
    }
  }
  return out.exitCode;
}

async function cmdReport(args: ParsedArgs): Promise<number> {
  const ctx = await loadCtx();
  const topic = flagString(args, 'topic');
  if (!topic) throw usageError('report 需要 --topic');

  /*
   * USAGE 承诺 report「只读归档」，而 `resolveTopic` 会无条件 `ensureDir`——
   * 对拼错的主题名跑 report 会**凭空建出** `.reviews/<拼错名>/plan/`，
   * 既违背文档承诺，也让拼错名得不到报错（只得到一份空报告加一个新目录）。
   */
  const ref = await resolveTopicReadOnly(ctx, topic, 'plan');
  if (!(await exists(path.join(ctx.archiveRoot, ref.topic)))) {
    const all = await listTopics(ctx);
    throw missingArtifactError(
      `主题「${topic}」在 ${path.relative(ctx.projectRoot, ctx.archiveRoot)} 下不存在。` +
        (all.length > 0 ? `\n  现有主题：${all.join('、')}` : '\n  该归档根下还没有任何主题。'),
    );
  }

  const report = await buildTopicReport(ref.layout);
  if (isJsonMode()) {
    emitJson({ ok: true, ...report });
    return EXIT.OK;
  }

  const md = renderTopicReport(report);
  const out = flagString(args, 'out');
  if (out) {
    const dest = path.isAbsolute(out) ? out : path.join(ctx.projectRoot, out);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, md, 'utf8');
    say(`复盘已写入 ${path.relative(ctx.projectRoot, dest)}`);
  } else {
    process.stdout.write(md);
  }
  return EXIT.OK;
}

async function cmdStatus(args: ParsedArgs): Promise<number> {
  const ctx = await loadCtx();
  const only = flagString(args, 'topic');
  const gates = await listOpenGates(ctx.triviumDir);
  const topics = only ? [only] : await listTopics(ctx);

  const payload: Record<string, unknown>[] = [];
  for (const t of topics) {
    const task = await readTask({ archiveRoot: ctx.archiveRoot, topic: t });
    const g = gates.filter((x) => x.topic === t);
    payload.push({
      topic: t,
      open_gates: g.map((x) => ({ stage: x.stage, state: x.state, since: x.since })),
      runs: task.runs.length,
      degradations: task.degradations.length,
      disputed: task.disputed,
      approvals: task.approvals.length,
    });
  }

  if (isJsonMode()) {
    emitJson({ ok: true, topics: payload });
  } else if (payload.length === 0) {
    say('归档根下还没有任何主题。');
  } else {
    for (const p of payload) {
      const gs = p['open_gates'] as { stage: string; state: string; since: string }[];
      say(`主题 ${String(p['topic'])}`);
      say(
        `  运行 ${String(p['runs'])} 次 ｜ 降级 ${String(p['degradations'])} 次 ｜ ` +
          `审批记录 ${String(p['approvals'])} 条${p['disputed'] ? ' ｜ ⚠️ 有争议项' : ''}`,
      );
      if (gs.length === 0) say('  无未关闭闸门');
      else for (const x of gs) say(`  · ${x.stage}: ${x.state}（自 ${x.since}）`);
    }
  }
  return EXIT.OK;
}

/**
 * 跨仓凭据清扫（BACKLOG EV-33）。判定全在 `retention.ts`，这里只负责出参与人读渲染。
 *
 * **退出码取 0 而不是按「有没有残留」分档**：这条命令的职责是「把能抹的抹掉」，
 * 抹不动的两类（status 读不到、扫不完）都要人工看一眼，用非零码把它们说成失败，
 * 会让它在任何 `set -e` 的脚本里变成阻断——而它本该是可以随手跑的运维命令。
 * 真出错（抹除失败）走 `scrubFailed`，人读与 JSON 都报得出来。
 */
async function cmdScrub(args: ParsedArgs): Promise<number> {
  const ctx = await loadCtx();
  const dryRun = args.flags.get('dry-run') === true;
  const r = await scrubAllRunRoot(ctx.config, { adapters: wiredAdapter, dryRun });

  if (isJsonMode()) {
    emitJson({
      ok: r.scrubFailed.length === 0,
      dry_run: dryRun,
      buckets: r.buckets,
      visited: r.visited,
      alive: r.alive,
      eligible: r.eligible,
      settled: r.settled,
      scrubbed: r.scrubbed,
      run_dir_redacted: r.runDirRedacted,
      scrub_failed: r.scrubFailed,
      unknown: r.unknown,
      deferred: r.deferred,
      deferred_cli: r.deferredCli,
      incomplete: r.incomplete,
      unreadable_buckets: r.unreadableBuckets,
    });
    return EXIT.OK;
  }

  say(`运行根：${runRoot(ctx.config)}`);
  say(`项目桶 ${r.buckets.length} 个 ｜ 运行目录 ${r.visited} 个 ｜ 进行中跳过 ${r.alive} 个`);
  /*
   * 「侧层」这个限定词不能省（代码双审 CODEX-03 ≡ AGY-01）：运行目录那一层没有哨兵、
   * 每轮都复查，所以「真跑会跳过」只对侧层成立。省掉限定词就是第二个「真跑不成立的数」。
   */
  say(`  · 侧层已收工 ${r.settled} 个（哨兵已记完成；运行目录层仍会复查，那层不写哨兵）`);
  if (dryRun) {
    say(`  · 侧层本会抹 ${r.eligible.length} 个运行目录（--dry-run，盘上什么都没动）`);
    for (const d of r.eligible.slice(0, 10)) say(`      ${d}`);
    if (r.eligible.length > 10) say(`      …另 ${r.eligible.length - 10} 个`);
    say('    预览只预测侧层：运行目录层是否有活取决于交接包正文是否命中，不读正文答不了');
  } else {
    if (r.scrubbed.length > 0) say(`  · 已抹除 ${r.scrubbed.length} 个运行目录的凭据副本`);
    else say('  · 没有需要抹的凭据副本');
    // 一份载体都没抹、只脱敏了交接包的单列一格，否则「已抹除凭据副本」话比事实强（GLM-06）
    if (r.runDirRedacted.length > 0) {
      say(`  · 另 ${r.runDirRedacted.length} 个运行目录只做了交接包脱敏（未发现待抹的凭据副本）`);
    }
  }
  const cliHeld = new Set(r.deferredCli.map((x) => x.dir));
  const deferredWorker = r.deferred.filter((d) => !cliHeld.has(d));
  if (deferredWorker.length > 0) {
    say(
      `  · ${deferredWorker.length} 个运行目录准入未过（正在启动／状态判不了／进程仍在），未动——` +
        `多为瞬态，下次再跑会重判；持续出现请人工检查，首个：${deferredWorker[0]}`,
    );
  }
  // 第四格：审查员 CLI 进程组记录（EV-154 / EV-38，代码双审 r1 CODEX-01），逐条带成因
  // 提示行只给走得通的出口（EV-164）：「记录读不懂」到期整删也保留（EV-157），出口只有把该侧 cli 改回 null
  for (const x of r.deferredCli) say(`  · 因审查员 CLI 未动：${x.dir}（${x.detail}）`);
  if (r.deferredCli.length > 0) say('    CLI 结束后再跑会重判；「记录读不懂」不会自愈，需把该侧 cli 改回 null（到期整删也会保留它）');
  if (r.unknown.length > 0) {
    say(
      `  · ${r.unknown.length} 个运行目录的状态读不到（缺失或损坏），未处理——` +
        `抹除不可逆，读不到状态就没有证据说它已跑完；请人工检查后删除，首个：${r.unknown[0]}`,
    );
  }
  if (r.incomplete.length > 0) {
    // 取证路径按成因分流：运行目录层不写哨兵，指着 scrub.json 会一无所获（CODEX-04 ≡ AGY-02 ≡ GLM-03）
    const first = r.incomplete[0]!;
    say(
      `  · ${r.incomplete.length} 个运行目录抹除后仍有文件未扫描，那几份未脱敏——首个：${first.dir}` +
        (first.detail ? `（运行目录层：${first.detail}；该层不写哨兵）` : '（详见该侧的 scrub.json）'),
    );
  }
  for (const b of r.unreadableBuckets) {
    // 整桶没进论域＝其中未抹的副本不出现在任何一格，而命令照常报 ok（CODEX-01）
    say(`  · 项目桶读不了，整棵未清扫：${b.bucket}——${b.reason}`);
  }
  for (const f of r.scrubFailed) say(`  · 抹除失败：${f.dir}——${f.reason}`);
  return EXIT.OK;
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  setOutputMode({ json: args.flags.get('json') === true, quiet: args.flags.get('quiet') === true });

  if (args.flags.get('version') === true || args.command === 'version') {
    say(VERSION);
    return EXIT.OK;
  }
  if (args.flags.get('help') === true || args.command === '' || args.command === 'help') {
    say(USAGE);
    return EXIT.OK;
  }
  rejectExtraPositionals(args);

  switch (args.command) {
    case 'doctor':
      return cmdDoctor(args);
    case 'review':
      return cmdReview(args);
    case 'hooks':
      return cmdHooks(args);
    case 'init':
      return cmdInit(args);
    case 'preflight':
      return cmdPreflight(args);
    case 'topic':
      return cmdTopic(args);
    case 'gate':
      return cmdGate(args);
    case 'approve':
      return cmdApproval(args, 'approved');
    case 'abandon':
      return cmdApproval(args, 'abandoned');
    case 'verify':
      return cmdVerify(args);
    case 'report':
      return cmdReport(args);
    case 'status':
      return cmdStatus(args);
    case 'scrub':
      return cmdScrub(args);
    default:
      throw usageError(`未知子命令：${args.command}\n\n${USAGE}`);
  }
}

// esbuild 打包为 CJS 后作为脚本直接执行
main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    if (err instanceof TriviumError) {
      fail(err.message);
      process.exitCode = err.code;
    } else {
      fail(`内部错误：${(err as Error).message}`);
      if (process.env['TRIVIUM_DEBUG']) console.error(err);
      process.exitCode = EXIT.FAIL;
    }
  });
