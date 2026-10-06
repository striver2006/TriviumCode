/**
 * 构建标识（EV-82 小主题第一段 r2 §2）：让「安装副本就是当前工作树构建的」有机器证据。
 *
 * ## 为什么要有它
 *
 * EV-82 在 2026-09-21 判失效的那次运行，`snapshot.git_head` 就是结案提交、工作树 dirty，
 * 而当时全局安装副本是哪一版构建出来的，留痕里钉不住（M10b r5 §1.4 ⑤）。
 * `snapshot.git_head` 记的是**被审项目**的 HEAD（`freeze.ts` 的 `headSha(projectRoot)`），
 * 不是运行中的编排器本体——编排器装在用户级、在任意项目里跑，两者只在「被审项目就是本仓」时才可比。
 *
 * ## 三件事
 *
 * - **写入**：`scripts/build.mjs` 构建主包前调 {@link computeBuildStamp}，经 esbuild `define` 注入常量；
 * - **读出**：运行时 {@link embeddedBuildStamp} 取回，记进 `snapshot.build`；
 * - **比对**：{@link buildStampWarnings} 只在**本仓模式**下比，其余项目只当自述指纹记录（r2 CODEX-01）；
 *   作用面指纹已判定一致时不比 HEAD（EV-111：构建后只有作用面外的提交，HEAD 不同不说明副本过期）。
 *
 * 算法只有这一份：构建脚本与运行时收尾重算都调 {@link computeInputsSha256}，口径不会漂。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { headSha, isDirtyWithin, isShallowRepo, rootCommit, treeEntryIds, workTreeHash } from './util/git.js';
import { sha256 } from './util/fsx.js';
import { diffExcludePrefixes } from './code-stage.js';

/**
 * 影响安装产物内容的路径集（r2 §2 作用面，CODEX-07 ≡ AGY-01 ≡ GLM-03）。
 *
 * `skills/` 整树由安装器同步进用户级 skill 目录，`skills/dual-critic/schema/*.json` 还经 import 内联进 bundle；
 * `tsconfig.json` 影响构建。`test/`、`doc/` 不进安装产物，故不在内。
 * 生成物 `skills/dual-critic/scripts/trivium.cjs` 已被 `.gitignore` 覆盖，`workTreeHash` 的 `add -A` 不会收它。
 */
export const INSTALL_INPUT_PATHS: readonly string[] = [
  'src',
  'scripts',
  'skills',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
];

/**
 * 算作用面指纹时不收进工作树哈希的前缀（EV-221）：与送审冻结同源的 `diffExcludePrefixes`，归档根取缺省值 `.reviews`。
 *
 * 作用面（{@link INSTALL_INPUT_PATHS}）与这几处不相交，排除不改 `inputs_sha256`（单测守着不相交）；排除只为让
 * 另一个主题正往归档根、`.trivium/` 原子写的临时文件不再把临时索引的 `add -A` 弄失败。
 * 指纹只在本仓重算（构建时、本仓模式的收尾与 doctor），本仓 config 钉的归档根就是缺省值；
 * 不经 `config.ts` 取缺省值，是因为构建脚本把本文件单独打包，引它会把 yaml / schema 一并拉进去。归档根改到别处时只是少排除一处，结果仍不变。
 */
export const INPUT_HASH_EXCLUDES: readonly string[] = diffExcludePrefixes('.reviews');

/** 本仓的包名：构建标识缺失时，用它兜底判定「被审项目就是本仓」 */
export const SELF_PACKAGE_NAME = 'triviumcode';

export interface BuildStamp {
  /** 构建来源仓的根提交，作仓库身份 */
  repo_root_commit: string;
  git_head: string;
  /** 构建时作用面内有未提交改动（含未跟踪文件） */
  dirty: boolean;
  /** 作用面在构建时工作树上的指纹，见 {@link computeInputsSha256} */
  inputs_sha256: string;
  built_at: string;
}

/**
 * 作用面指纹：对工作树（含未跟踪文件，经临时索引、不碰真实索引；{@link INPUT_HASH_EXCLUDES} 不收进 tree）的 tree，
 * 逐项取作用面路径的对象 id，按路径排序拼接后取 sha256。
 *
 * 作用面外的改动不影响结果；取不到（非 git、`write-tree` 失败）返回 null。
 * 自定义 `paths` 不得与 {@link INPUT_HASH_EXCLUDES} 相交，否则被排除的部分取的是 HEAD 的版本（生产只用缺省作用面）。
 */
export async function computeInputsSha256(root: string, paths: readonly string[] = INSTALL_INPUT_PATHS): Promise<string | null> {
  let tree: string;
  try {
    tree = await workTreeHash(root, { exclude: INPUT_HASH_EXCLUDES });
  } catch {
    return null;
  }
  const entries = await treeEntryIds(root, tree, [...paths].sort());
  return sha256(entries.map(([p, id]) => `${p} ${id}`).join('\n'));
}

/** 构建时算一份标识；取不到 git（例如 `git archive` 导出的树）返回 null，不抛 */
export async function computeBuildStamp(root: string): Promise<BuildStamp | null> {
  const [repoRoot, head, dirty, inputs] = await Promise.all([
    rootCommit(root),
    headSha(root),
    isDirtyWithin(root, INSTALL_INPUT_PATHS),
    computeInputsSha256(root),
  ]);
  if (repoRoot === null || head === null || dirty === null || inputs === null) return null;
  return { repo_root_commit: repoRoot, git_head: head, dirty, inputs_sha256: inputs, built_at: new Date().toISOString() };
}

declare const __TRIVIUM_BUILD__: BuildStamp | null | undefined;

/**
 * 运行中的编排器自带的构建标识。
 *
 * 打包产物由 `scripts/build.mjs` 经 esbuild `define` 注入；逐文件转译的测试构建没有注入，
 * `typeof` 判为 undefined，按「标识缺失」处理（null）。
 *
 * **这是对 r2 §2「测试构建注入固定测试值」的有意偏离**（代码双审 r1 GLM-01）：告警逻辑是纯函数，
 * 用例都显式传入 stamp；若给测试构建注入固定值，所有端到端用例（外部夹具项目）都会带一份
 * 与真实构建无关的标识。理由登记在本段收口报告。
 */
export function embeddedBuildStamp(): BuildStamp | null {
  return typeof __TRIVIUM_BUILD__ === 'undefined' ? null : (__TRIVIUM_BUILD__ ?? null);
}

/** 四条告警文案（r2 §2，AGY-05）。导出供用例按常量断言，不抄字面 */
export const BUILD_WARN_MISSING = '构建标识缺失：本编排器的构建没有记录来源（取不到 git 的构建），无法判定安装副本是哪一版';
export const BUILD_WARN_DIRTY = '构建时工作树有未提交改动：安装副本不对应任何一个提交';
export const BUILD_WARN_STALE_INPUTS = '安装副本不是当前工作树构建的：构建之后作用面内的文件又改过，改动未生效，需重新构建并安装';
export const BUILD_WARN_HEAD = '安装副本与仓库 HEAD 不同版';
/** 比对本身出错时的文案（代码双审 r1 GLM-03）：不重抛，但留痕 */
export const BUILD_WARN_CHECK_FAILED = '构建标识比对失败';
/**
 * 判据的输入取不到时的文案（代码双审 r2 CODEX-05）：「查不出」不得与「查过、没问题」同形。
 * 调用方拼上是哪一项取不到。
 */
export const BUILD_WARN_INCOMPLETE = '构建标识比对未能完成';

export interface BuildStampCheckInput {
  build: BuildStamp | null;
  /** 被审项目的根提交；非 git 项目为 null */
  projectRootCommit: string | null;
  projectHead: string | null;
  /** 被审项目根目录下 package.json 的 name；读不到为 null */
  projectPackageName: string | null;
  /**
   * 本仓模式下由调用方用同一作用面重算。本仓模式且 `build` 非 null 时，null 表示**重算取不到**，
   * 出一条「比对未能完成」（r2 CODEX-05）；非本仓模式根本不读它。
   */
  currentInputsSha256: string | null;
}

/**
 * 本仓模式判定：被审项目就是编排器本仓。
 *
 * - **两边根提交都可得**：只比根提交（标识里带着构建来源仓的根提交），包名不作数；
 * - **任一边取不到**（构建标识缺失、被审项目是浅克隆或非 git）：退到包名兜底。
 *   不兜底的话，「构建标识缺失」永远判定不了本仓模式、永远不会出现；浅克隆的本仓会
 *   **静默**落成「不是本仓」，与真的不是本仓不可区分（代码双审 r1 CODEX-03）。
 *
 * **兜底的代价**（CODEX-02）：它不看根提交，任何 `package.json` 的 `name` 也叫 `triviumcode` 的
 * 第三方项目都会进本仓模式，收到一两条与它无关的告警。无害、不阻断，接受。
 * `SELF_PACKAGE_NAME` 与 `package.json` 的一致性由用例对账，改名当场红。
 */
export function isSelfRepo(i: Pick<BuildStampCheckInput, 'build' | 'projectRootCommit' | 'projectPackageName'>): boolean {
  if (i.build !== null && i.projectRootCommit !== null) return i.projectRootCommit === i.build.repo_root_commit;
  return i.projectPackageName === SELF_PACKAGE_NAME;
}

/**
 * 比对并给出告警（纯函数）。**非本仓模式恒返回空**：外部项目里 HEAD 恒不等，告警会常亮（r2 CODEX-01）。
 * 只告警、不阻断，调用方写进 `meta.gate.warnings`。
 *
 * **HEAD 只在作用面指纹未判定一致时才比**（EV-111）：指纹一致即构建输入与当前工作树一致，
 * HEAD 不同只剩「构建于哪个提交」的出处信息，而那两个字段 run.json 本来就照记。
 * 不这样做，构建后哪怕只有一次纯文档提交也会报「不同版」。指纹不等时 HEAD 那条照出，作排查线索；
 * 指纹取不到时 HEAD 是唯一剩下的版本信号，照比、取不到照记「未能完成」。
 * 指纹一致时 HEAD 不参与判定，它取不到也不记——那一格结论已由指纹给全，不是「查不出」。
 */
export function buildStampWarnings(i: BuildStampCheckInput): string[] {
  if (!isSelfRepo(i)) return [];
  if (i.build === null) return [BUILD_WARN_MISSING];
  const out: string[] = [];
  if (i.build.dirty) out.push(BUILD_WARN_DIRTY);
  const inputsMatch = i.currentInputsSha256 !== null && i.currentInputsSha256 === i.build.inputs_sha256;
  if (i.currentInputsSha256 === null) out.push(`${BUILD_WARN_INCOMPLETE}：作用面指纹重算取不到，无法判定安装副本是否为当前工作树构建`);
  else if (!inputsMatch) out.push(BUILD_WARN_STALE_INPUTS);
  if (!inputsMatch) {
    if (i.projectHead === null) out.push(`${BUILD_WARN_INCOMPLETE}：仓库 HEAD 取不到，无法比对版本`);
    else if (i.projectHead !== i.build.git_head) out.push(`${BUILD_WARN_HEAD}（构建于 ${i.build.git_head.slice(0, 7)}，仓库 HEAD ${i.projectHead.slice(0, 7)}）`);
  }
  return out;
}

/**
 * 收尾用：调比对并把**比对本身的异常**转成一条告警，不重抛（代码双审 r1 GLM-03）。
 * `check` 只为可测性开口，生产路径恒用 {@link checkBuildStamp}。
 */
export async function collectBuildStampNotices(
  projectRoot: string,
  build: BuildStamp | null,
  check: typeof checkBuildStamp = checkBuildStamp,
): Promise<string[]> {
  try {
    return await check(projectRoot, build);
  } catch (e) {
    return [`${BUILD_WARN_CHECK_FAILED}：${(e as Error).message}`];
  }
}

/** doctor 一行人读描述：编排器是哪一版构建的，以及当前项目是否本仓模式、比对结论 */
export async function describeBuildStamp(projectRoot: string, build: BuildStamp | null = embeddedBuildStamp()): Promise<string> {
  const head = build === null
    ? '编排器构建标识：缺失（取不到 git 的构建，或测试构建）'
    : `编排器构建标识：${build.git_head.slice(0, 7)}${build.dirty ? '（构建时作用面有未提交改动）' : ''}，inputs ${build.inputs_sha256.slice(0, 12)}，构建于 ${build.built_at}`;
  const [projectRootCommit, projectPackageName, shallow] = await Promise.all([
    rootCommit(projectRoot), readPackageName(projectRoot), isShallowRepo(projectRoot),
  ]);
  if (!isSelfRepo({ build, projectRootCommit, projectPackageName })) return `${head}；当前项目不是编排器本仓，只记不比`;
  const how = build !== null && projectRootCommit !== null ? '按根提交' : shallow ? '浅克隆，按包名' : '按包名';
  const w = await checkBuildStamp(projectRoot, build);
  if (w.length > 0) return `${head}；本仓模式（${how}判定）：${w.join('；')}`;
  // 零告警 ⇒ 标识非空且指纹一致。HEAD 若已前进（EV-111 那一格），补一句出处：不告警，但人读时看得到
  const projectHead = build === null ? null : await headSha(projectRoot);
  const since = build !== null && projectHead !== null && projectHead !== build.git_head
    ? `（构建于 ${build.git_head.slice(0, 7)}，仓库 HEAD 已到 ${projectHead.slice(0, 7)}，作用面与构建时一致）`
    : '';
  return `${head}；本仓模式（${how}判定）：安装副本与当前工作树一致${since}`;
}

/** 读被审项目根的 package.json 的 name；读不到返回 null */
export async function readPackageName(projectRoot: string): Promise<string | null> {
  try {
    const j = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8')) as { name?: unknown };
    return typeof j.name === 'string' ? j.name : null;
  } catch {
    return null;
  }
}

/**
 * 收尾时的一站式检查：取被审项目的根提交、HEAD、包名；本仓模式下重算作用面指纹。
 * 非本仓模式不重算（省一次 `workTreeHash`）。
 */
export async function checkBuildStamp(projectRoot: string, build: BuildStamp | null = embeddedBuildStamp()): Promise<string[]> {
  const [projectRootCommit, projectHead, projectPackageName] = await Promise.all([
    rootCommit(projectRoot),
    headSha(projectRoot),
    readPackageName(projectRoot),
  ]);
  const self = isSelfRepo({ build, projectRootCommit, projectPackageName });
  const currentInputsSha256 = self && build !== null ? await computeInputsSha256(projectRoot) : null;
  return buildStampWarnings({ build, projectRootCommit, projectHead, projectPackageName, currentInputsSha256 });
}
