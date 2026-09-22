/**
 * `driver-claim`：**按阶段的 Driver 声明**（M10a 第 1 步，EV-72）。
 *
 * ## 这个模块解决什么
 *
 * plan / bug 原稿写在 `review --start` **之前**。那一刻该阶段零留痕，
 * `resolveRoundDriver` 只能回落 `DEFAULT_DRIVER`，于是非缺省 Driver 连自己的原稿
 * 都写不出来——`isForgedRoleFile` 把它判成伪造件。声明补的正是这一段。
 *
 * ## 权威排序：**留痕不可改、声明可撤回**
 *
 * `runs[].driver` / `run.json.driver` 是**留痕**（跑过了，是事实）；
 * `drivers[<阶段>]` 是**声明**（打算这么跑）。二者冲突时留痕永远赢。
 * 判定顺序自上而下、首个命中生效，见 {@link claimStageDriver}。
 *
 * ## 撤回权为什么会消失（计划双审 r6 CODEX-02）
 *
 * 最初的设计只以「该阶段零 **run** 留痕」为撤回前置。但**写一份带后缀的原稿
 * 不产生 run 留痕**——零留痕窗口不会因为写了文件而关闭。于是同一个会话可以：
 *
 *   `claim glm` ⇒ 以「glm 是当轮 Driver」的身份写 `…-glm.md`
 *   ⇒ 撤回改 `claim codex` ⇒ 再写 `…-codex.md` ⇒ …
 *
 * **在首份 run 留痕诞生前依次拿到每一家的后缀豁免**——而保护集正是「全集减当轮
 * Driver」，当轮 Driver 的取值又来自这个自声明。这是一条真的绕过路径。
 *
 * 两个看起来更直接的修法都不成立，这里记下来免得下一个人再试一遍：
 *
 *   · **比对会话 id 与 `claimed_by`**——防的是「别的会话搭车」，而威胁模型里
 *     执笔者**就是同一个会话**，它自己反复翻转声明，会话 id 全程一致。
 *   · **限制撤回次数 ≤ 1**——只是把能拿到的后缀数从 N 降到 2。量变不是质变。
 *
 * 实际采用的是**把「留痕」的论域从 `run.json` 扩到「该阶段子树里带角色后缀的文件」**：
 * 某一家的后缀一旦被**使用**（产出了带它的文件），换手就不再是「尚无留痕的改写」，
 * 随之被拒。方向与权威排序完全同向，改的只是「什么算留痕」。
 *
 * **镜像死锁仍然堵着**——那条序列要求的是「声明了但还没动手」
 * （`claim glm` ⇒ 发现该用 claude ⇒ 此时尚未写任何 `-glm.md`），
 * 而那正是撤回仍然覆盖的区间。
 *
 * ## 论域的两次补齐（代码双审 r1，两条都是实测打穿的）
 *
 * - **深度**（CODEX-04）：上一版只扫阶段目录**第一层**，而 Hook 的
 *   `stageSegmentsUnder` 只设段数下界、不设上界，`<主题>/plan/sub/x-glm.md`
 *   照样定位到该阶段、按它的 Driver 放行。于是嵌套一层就能逃出论域、再换一个后缀。
 *   现在递归整棵阶段子树，命中条件也与保护集同源（不再另写 `endsWith`）——
 *   **两份判据不同宽正是那条逃逸路径的成因**。
 * - **分支**（GLM-05）：上一版只有「已有声明」那一格查文件，于是有一条**不经撤回**
 *   的序列漏了过去——无声明期缺省 Driver 先写 `-claude.md`（第 3 级下合法，
 *   保护集不含 claude）→ 首次 `claim glm` 走分支 4、不做任何检查 → 再写 `-glm.md`。
 *   现在分支 4 同样查。上一版头注释写的「顺带关掉了孤儿原稿」当时**并不成立**。
 *
 * ## 残余面（如实登记，计划 §7.3 R-l）
 *
 * 「一个后缀都还没用过」的窗口内认领与撤回次数不设上限。该窗口里执笔者拿到的是
 * 「可以**选**一个后缀」而不是「可以依次拿到**所有**后缀」——用掉即锁死。
 * **不假装这是机械边界**：终端里直接写文件同样绕过整条链路（与提交锚的
 * 强制力单向同源）。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { AgentId, Stage } from './types.js';
import type { StageDriverClaim, TaskMeta } from './meta.js';
import { stageDir, type ArchiveLayout } from './archive.js';
import { ALL_AGENT_IDS, DEFAULT_DRIVER } from './agents/registry.js';

/**
 * 读出该阶段的声明值。**读侧唯一入口**——别处直接摸 `task.drivers?.[stage]?.driver`
 * 会让「缺字段 = 未声明」这条约定散落到每个调用点。
 */
export function declaredStageDriver(task: TaskMeta, stage: Stage): AgentId | null {
  return task.drivers?.[stage]?.driver ?? null;
}

// ══════════════════════════════════════════════════════════════
// 一、三级判定：**全仓唯一一处**
// ══════════════════════════════════════════════════════════════

/**
 * 当轮 Driver 的解析结果。`source` 说明这一档从哪来——三级之后布尔值说不清来源，
 * 而拦截与拒绝文案都必须说得出「凭什么判成这一家」。
 */
export type StageDriverResolution =
  | { kind: 'ok'; driver: AgentId; source: 'run' | 'claim' | 'default' }
  | { kind: 'corrupt'; unreadable: string[] };

/**
 * **三级判定，四个消费点共用**（`hook-pre-write`、`topic resolve`、`review --start`、
 * `topic claim`）：
 *
 *   1. 该**阶段**最新一份**可读**的 `run.json.driver`（**留痕**）；
 *   2. `task.json` 的 `drivers[<该阶段>].driver`（**声明**）；
 *   3. `DEFAULT_DRIVER`。
 *
 * ## 为什么必须只有一处（代码双审 r1 CODEX-03 ≡ GLM-01）
 *
 * 上一版把这段逻辑写在 `hooks.ts` 里，另外三个消费点各自写
 * `latestRunMeta(...).meta?.driver ?? null`——**把三元组压成了一个值**。
 * 后果是同一条语义有两份实现且**结论相反**：
 *
 * - `hooks.ts` 对「留痕在场但读不出来」判 `corrupt` 硬失败；
 * - 三个入口把它折成 `null`，于是落到「零留痕」那一档、改用**由被保护方自己写的声明**当权威。
 *
 * 而 `review --start` 恰恰是会冻结送审包并**写下新一份留痕**的那个入口——
 * 「不把权威排序倒过来用」这条理由，在最该成立的地方不成立。
 * glm 另指出一格：部分损坏时 `meta` 是**较旧**那份，而文案自称「最新一份」，文案在说假话。
 *
 * 所以判定收成这一个函数，`corrupt` 一档由调用方各自决定怎么拒（Hook 拦写、入口拒启动），
 * **但没有谁可以把它降级成第 2 级**。
 */
export async function resolveStageDriver(
  layout: ArchiveLayout,
  stage: Stage,
): Promise<StageDriverResolution> {
  const { latestRunMeta, readTask } = await import('./meta.js');
  const r = await latestRunMeta(layout, stage);

  if (r.meta && r.unreadable.length === 0) {
    return { kind: 'ok', driver: r.meta.driver, source: 'run' };
  }
  /*
   * `unreadable` 非空即判坏，**即使已经取到了一份可读的 meta**。
   * `latestRunMeta` 是 newest-first 且命中即返回，所以 `unreadable` 里装的恰好全是
   * **比 `meta` 更新**的那几份。只判 `!r.meta` 会让「最新那份读不出、较旧一份可读」
   * 静默降级成**上一轮**的 Driver。
   */
  if (r.meta || r.scanned > 0) return { kind: 'corrupt', unreadable: r.unreadable };

  /*
   * 第 2 级用宽松版 `readTask` 而不是 `readTaskStrict`：这一级问的是「有没有人声明过」，
   * 而主题元数据读不出来时**没有可信的声明**，与「没声明」在判定上同档——都该落第 3 级。
   * 在这里硬失败会把 Driver 自己写原稿的路一并堵死，而那不是安全收益是噪声；
   * 第 3 级是常量，只会收窄不会放大权限。
   *
   * 主题元数据损坏本身另有两个锚在管：**提交侧**的 `checkArchiveIntegrity`
   * （经 `readTaskStrict` 的 unreadable 分支判坏）与 `gate` 读取处的严格版。
   * 上一版这里点名「预检」，而 `preflight` 根本不读它（全文件零命中，代码双审 r1 CODEX-08）——
   * 引一个不存在的锚会让下一个人以为预检兜得住。
   */
  const declared = declaredStageDriver(await readTask(layout), stage);
  if (declared) return { kind: 'ok', driver: declared, source: 'claim' };

  return { kind: 'ok', driver: DEFAULT_DRIVER, source: 'default' };
}

// ══════════════════════════════════════════════════════════════
// 二、「声明是否被使用过」的论域
// ══════════════════════════════════════════════════════════════

/**
 * 一个文件名是不是带了**某个已登记角色**的后缀；带了就返回那一家。
 *
 * 模式由注册表派生、**逐个 id 交替**，不写成 `-([a-z0-9-]+)\.md$` 那种通配捕获——
 * 后者会被日期前缀吃掉：`2026-09-22-t-claude.md` 里 `[a-z0-9-]+` 含数字与连字符，
 * 贪婪匹配从第一个 `-` 起捕到 `09-22-t-claude`，于是任何带日期的工件都判不出归属。
 * 起草时就是这么写的，用例当场红。与 `hasProtectedRoleSuffix` 同款写法才对得上。
 */
const ROLE_SUFFIX_RE = new RegExp(`-(${ALL_AGENT_IDS.join('|')})\\.md$`);

function roleSuffixOwner(fileName: string): AgentId | null {
  return (ROLE_SUFFIX_RE.exec(path.basename(fileName))?.[1] as AgentId | undefined) ?? null;
}

/**
 * 该阶段子树里带角色后缀的文件，按归属分组（**「声明是否被使用过」的判据**）。
 *
 * ## 为什么是递归而不是一层（代码双审 r1 CODEX-04）
 *
 * 上一版只 `readdir` 阶段目录的**第一层**，而 Hook 的保护论域是**任意深度**——
 * `stageSegmentsUnder` 的 `segs.length < 3` **只设下界不设上界**，
 * `<主题>/plan/sub/x-glm.md` 照样定位到 plan 阶段、按该阶段的 Driver 放行。
 * 于是零留痕窗口内仍能逃逸：`claim glm` → 写 `plan/sub/x-glm.md`（当轮是 glm，放行；
 * 且不在第一层、不进论域）→ `claim codex` 判为「未被使用」→ 再写一个后缀。
 *
 * **两份判据不同宽正是那条逃逸路径的成因**，所以这里的命中条件也不再另写
 * `endsWith('-<driver>.md')`，改用与保护集同源的角色后缀判据。
 *
 * ## errno 不再一律折成空集（代码双审 r1 CODEX-05）
 *
 * 上一版 `catch { return [] }` 把 EACCES / ELOOP 等都折成「该阶段没有任何文件」——
 * **安全收紧分支在 I/O 异常时 fail-open**。现在只有「目录不存在」这一档算空，
 * 其余一律抛给调用方，由它保守处理。
 */
export async function roleSuffixedFiles(
  layout: ArchiveLayout,
  stage: Stage,
): Promise<Map<AgentId, string[]>> {
  const root = stageDir(layout, stage);
  const out = new Map<AgentId, string[]>();

  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      // 「还没有这个目录」是正常态；其余（EACCES / ENOTDIR / ELOOP…）不得当成「没有文件」
      if (code === 'ENOENT' || code === 'ENOTDIR') return;
      throw e;
    }
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(abs);
        continue;
      }
      const owner = roleSuffixOwner(ent.name);
      if (!owner) continue;
      const rel = path.relative(root, abs);
      out.set(owner, [...(out.get(owner) ?? []), rel]);
    }
  };
  await walk(root);
  for (const v of out.values()) v.sort();
  return out;
}

/** 该阶段子树里带 `-<driver>.md` 后缀的文件（保留给调用方做单家查询） */
export async function filesBearingSuffix(
  layout: ArchiveLayout,
  stage: Stage,
  driver: AgentId,
): Promise<string[]> {
  return (await roleSuffixedFiles(layout, stage)).get(driver) ?? [];
}

/** {@link claimStageDriver} 的输入 */
export interface ClaimInput {
  layout: ArchiveLayout;
  stage: Stage;
  /** 要认领成哪一家 */
  driver: AgentId;
  /** 谁在声明（会话来源），落进 `claimed_by` */
  claimedBy: string;
  /** 该阶段最新一份**可读**留痕里的 driver；无留痕传 `null` */
  runDriver: AgentId | null;
  /** 现有声明（`task.drivers?.[stage]`），无则 `null` */
  existing: StageDriverClaim | null;
  now?: string;
}

/**
 * 判定分支。**与计划 §2.3 的表逐行对应**，改这里请同步改那张表。
 *
 * `blocked-by-run` / `blocked-by-usage` 两档都是退 64——它们分开是因为
 * **出口不同**：前者只能新开主题或换阶段，后者在终端清理后可重试。
 * 合并成一个 `blocked` 会让错误文案说不清该干什么。
 */
export type ClaimOutcome =
  /** 分支 1：该阶段已有 run 留痕且与 `--driver` 不同 */
  | { kind: 'blocked-by-run'; runDriver: AgentId }
  /** 分支 3′：零 run 留痕、但旧声明已被使用（产出过带其后缀的文件） */
  | { kind: 'blocked-by-usage'; previous: AgentId; files: string[] }
  /** 分支 2：已声明且相同，幂等 */
  | { kind: 'noop'; claim: StageDriverClaim }
  /** 分支 3：零 run 留痕、旧声明未被使用 ⇒ 撤回改写 */
  | { kind: 'revoked'; claim: StageDriverClaim; previous: AgentId }
  /** 分支 4：其余合法认领 */
  | { kind: 'claimed'; claim: StageDriverClaim };

/**
 * 纯判定 + 构造新声明，**不落盘**。落盘由调用方经 `updateTask` 在**同一个临界区内**完成，
 * 且会在锁内复核 `existing` 未变（见 `cmdTopicClaim`）。
 *
 * 判定与写入仍分成两个函数，是为了让分支表可以被单元测试直接喂构造好的输入，
 * 不必先摆出一整个归档；**但调用方不得把判定留在锁外**——那样并发认领会互相覆盖，
 * 且被覆盖的那条既不在当前值也不进任何人的 `history`（代码双审 r1 CODEX-06 ≡ GLM-02）。
 *
 * 唯一的 I/O 是扫该阶段子树（`roleSuffixedFiles`），分支 3′ 与分支 4 都要用。
 */
export async function claimStageDriver(input: ClaimInput): Promise<ClaimOutcome> {
  const now = input.now ?? new Date().toISOString();
  const { driver, existing, runDriver } = input;

  // ── 分支 1：留痕优先。**必须排在「已声明」判定之前** ──
  /*
   * 排序理由（计划双审 r5 GLM-08）：把它放在「已声明」之后，
   * 「已声明 X 且留痕 Y≠X」这个非法态会被幂等分支与拒绝分支给出**相反答案**。
   * 提到首位后留痕永远优先，与本模块头部的权威排序一致。
   */
  if (runDriver !== null && runDriver !== driver) {
    return { kind: 'blocked-by-run', runDriver };
  }

  // ── 分支 2：幂等 ──
  if (existing && existing.driver === driver) {
    return { kind: 'noop', claim: existing };
  }

  /*
   * ── 「已被使用」的论域：该阶段子树里**除认领目标之外**任意已登记角色的后缀文件 ──
   *
   * 分支 3′ 与分支 4 共用它。**分支 4 也要查**（代码双审 r1 GLM-05）：
   * 上一版只在「已有声明」那一格查，于是有一条**不经撤回**的序列漏了过去——
   * 无声明期缺省 Driver 先写 `-claude.md`（第 3 级判定下合法，保护集不含 claude）
   * → `claim glm` 走分支 4、不做任何检查 → 再写 `-glm.md`。
   * 同一会话在首份 run 留痕诞生前照样留下两个后缀的文件。
   *
   * 取「拒绝」而不是「如实登记残余面」：真关掉比解释为什么这一格不算用过更省事，
   * 代价只是「同一阶段已有他人后缀的原稿时，首次认领要先在终端清理」——
   * 与分支 3′ 的出口同形。跨阶段不受影响（论域按阶段分）。
   */
  const byOwner = await roleSuffixedFiles(input.layout, input.stage);
  const usedByOthers = [...byOwner.entries()].filter(([owner]) => owner !== driver);

  // ── 分支 3 / 3′：撤回既有声明 ──
  if (existing && existing.driver !== driver) {
    const used = byOwner.get(existing.driver) ?? [];
    if (used.length > 0) {
      return { kind: 'blocked-by-usage', previous: existing.driver, files: used };
    }
    const { history: _drop, ...revoked } = existing;
    return {
      kind: 'revoked',
      previous: existing.driver,
      claim: {
        driver,
        claimed_at: now,
        claimed_by: input.claimedBy,
        // 追加不覆盖：旧声明整条入史，含撤回时刻
        history: [...(existing.history ?? []), { ...revoked, revoked_at: now }],
      },
    };
  }

  // ── 分支 4：其余合法认领（新阶段首次声明、与既有留痕一致） ──
  if (usedByOthers.length > 0) {
    const [owner, files] = usedByOthers[0]!;
    return { kind: 'blocked-by-usage', previous: owner, files };
  }
  return {
    kind: 'claimed',
    claim: { driver, claimed_at: now, claimed_by: input.claimedBy },
  };
}

/**
 * **不变量**：同一阶段的「留痕」与「声明」不一致**没有合法来源**（计划 §2.4）。
 *
 * `claimStageDriver` 的分支 1 就是为了让这个状态造不出来（留痕在场时拒绝异声明），
 * 所以真撞上它只可能来自**手改 `task.json`** 或历史遗留数据。
 * 它比 `crossCheckDriver` 更靠前：后者问「你传的对不对」，本函数问「这份留痕本身自洽吗」。
 *
 * **落点与计划 §2.4 的字面有偏差，如实记在这里**：计划写的是「预检报错」，
 * 而 `trivium preflight` **只接 `--stage` 不接 `--topic`**——它根本不知道要检查哪个主题，
 * 这条在那里落不下去。改落在两个选侧入口（`topic resolve` 与 `review --start`），
 * 它们每轮必经且拿得到主题。给 preflight 加 `--topic` 是另一件事，不在本步范围。
 */
export function stageDriverInvariant(args: {
  /** **必填**：出口命令要带上它，缺了照抄即退 64（代码双审 r1 CODEX-02） */
  topic: string;
  stage: Stage;
  runDriver: AgentId | null;
  declared: AgentId | null;
}): string | null {
  if (args.runDriver === null || args.declared === null) return null;
  if (args.runDriver === args.declared) return null;
  return (
    `${args.stage} 阶段的留痕与声明不一致：留痕记 ${args.runDriver}，声明记 ${args.declared}。\n` +
    '  这个状态没有合法来源——topic claim 在留痕在场时会拒绝异声明，\n' +
    '  所以它只可能来自手改主题元数据或历史遗留数据。\n' +
    `  **以留痕为准**，出口是把声明改回留痕值：\n` +
    `    ${claimCommand(args.topic, args.stage, args.runDriver)}\n` +
    '  这条命令走得通——分支 1「留痕优先」只拒绝**与留痕不同**的认领，改回同值不触发它；\n' +
    `  旧声明会整条进 drivers.${args.stage}.history 留档。\n` +
    `  唯一的例外是该阶段已存在带旧声明后缀的文件，那时撤回权已消失，需在终端清理后重试。`
  );
}

/**
 * 拼一条**可直接敲**的 `topic claim`。
 *
 * 存在的理由是一次实测打脸（代码双审 r1 CODEX-02）：上一版两处文案手写
 * `topic claim --stage X --driver Y`，**漏了必填的 `--topic`**，用户照抄第一次就退 64——
 * 而这正是本步计划 §3.2.2 整节在处理的「报错教的命令当场被拒」。
 * 配的用例还是子串匹配，那个子串在缺 `--topic` 的错误命令里同样存在，
 * 于是判据零鉴别力、反倒把错文案钉成了期望值。
 *
 * 所以命令形态收在这一个函数里，并由一条**真跑一次 CLI 并断言退 0**的用例守着。
 */
export function claimCommand(topic: string, stage: Stage, driver: AgentId): string {
  return `trivium topic claim --topic ${topic} --stage ${stage} --driver ${driver}`;
}

/**
 * **交叉校验**：用户**显式传的** `--driver` 与该阶段的权威值是否一致（计划 §2.4）。
 *
 * 基准是 {@link resolveStageDriver} 的结论（留痕 > 声明 > 缺省），两档会报错：
 * 与留痕不符、与声明不符。零留痕且无声明时不校验——首次认领本来就该放行。
 *
 * ## `driver` 为什么可空（代码双审 r1 CODEX-01）
 *
 * 上一版形参是非空的 `AgentId`，而两个入口都传
 * `resolveDriver(旗标值 ?? null).driver`——**`resolveDriver` 对「没传」与「传了缺省值」
 * 返回同一个结果**（`critics.ts`：`raw?.trim() ?? ''` 为空即返回 `DEFAULT_DRIVER`）。
 * 于是任何非缺省 Driver 的主题上，**每一次省略该旗标的运行都退 64**；
 * 而文案还建议「去掉 --driver」——去掉之后仍解析成缺省值、仍不等于留痕值，
 * 照文案做第二次仍然被拒。那不是防住误传，是把常规用法全量拒掉。
 *
 * 现在缺席即传 `null`：**不比对，改为继承该阶段的权威值**。这才是 `topic claim`
 * 应有的语义——认领一次之后无须每条命令重复写旗标。
 *
 * 两个入口（`topic resolve` 与 `review --start`）共用本函数。
 * **判定只此一处**——同一条校验实现两遍就是改一漏二，`--only` 那次已经演过一回。
 *
 * 返回 `null` 表示通过；返回字符串即错误文案（调用方决定用哪个退出码）。
 * 本函数**纯只读**，`topic resolve` 的「不创建任何目录」承诺不受影响。
 */
export function crossCheckDriver(args: {
  topic: string;
  stage: Stage;
  /** 用户**显式**传的值；**旗标缺席时传 `null`**，此时不比对 */
  driver: AgentId | null;
  /** 该阶段最新一份可读留痕的 driver；无留痕传 `null` */
  runDriver: AgentId | null;
  /** 该阶段的声明值；未声明传 `null` */
  declared: AgentId | null;
}): string | null {
  if (args.driver === null) return null; // 没传 = 继承，不存在「传错」
  if (args.runDriver !== null) {
    if (args.runDriver === args.driver) return null;
    return (
      `--driver ${args.driver} 与 ${args.stage} 阶段的运行留痕不符：` +
      `该阶段最新一份**可读**留痕记的是 ${args.runDriver}。\n` +
      '  留痕是事实、声明只是打算，冲突时以留痕为准。\n' +
      `  要按 ${args.runDriver} 继续：改传 --driver ${args.runDriver}，或**省略该旗标**` +
      '（省略即继承该阶段的权威值）。\n' +
      '  要换 Driver，请新开主题或在尚无留痕的阶段认领。'
    );
  }
  if (args.declared !== null) {
    if (args.declared === args.driver) return null;
    return (
      `--driver ${args.driver} 与 ${args.stage} 阶段的声明不符：该阶段已声明为 ${args.declared}。\n` +
      `  改声明：${claimCommand(args.topic, args.stage, args.driver)}\n` +
      '  该阶段尚无运行留痕，若声明还没用来写出任何带后缀的文件，上面这条命令可直接改写它。\n' +
      `  或者省略 --driver 以按声明的 ${args.declared} 继续。`
    );
  }
  return null;
}

/**
 * 分支 1 / 3′ 的错误文案。**出口写在文案里**——两档的出口不同，见 {@link ClaimOutcome}。
 *
 * 这两档都**不**以 `topic claim` 作为出口（一个是换主题/换阶段，一个是终端清理），
 * 所以不需要 `topic`——{@link claimCommand} 只给那些真的要教用户再敲一次 claim 的地方用。
 */
export function claimRejectionMessage(o: ClaimOutcome, stage: Stage, driver: AgentId): string {
  if (o.kind === 'blocked-by-run') {
    return (
      `${stage} 阶段已由 ${o.runDriver} 执笔（该阶段最新一份运行留痕如此记录），` +
      `不能改声明为 ${driver}。\n` +
      '  留痕不可改。换 Driver 请新开主题，或在尚无留痕的阶段认领。'
    );
  }
  if (o.kind === 'blocked-by-usage') {
    const list = o.files.map((f) => `    · ${f}`).join('\n');
    return (
      `${stage} 阶段的 ${o.previous} 后缀**已被使用**，不能把声明改成 ${driver}。\n` +
      '  该阶段子树里已存在带该后缀的文件：\n' +
      `${list}\n` +
      '  声明一旦用来写出文件，它就等同于留痕。这条限制是刻意的：\n' +
      '  否则同一个会话可以在首份运行留痕诞生前反复翻转声明、依次拿到每一家的后缀豁免。\n' +
      '  出口：在**终端**里清理上列文件后重试（会话内删不掉同样是刻意的——\n' +
      '  Bash 守卫按命令文本的角色后缀字面拦截，不区分「写它」与「说它」）。'
    );
  }
  return '';
}
