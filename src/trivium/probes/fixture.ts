/**
 * 探针夹具：一个干净的临时 git 仓库，含哨兵文件与伪造的「对方历史产出」。
 *
 * 用途（设计 §3.5）：
 *   - headless_read_ok / json_schema_ok：让 Agent 读 README 并回显哨兵；
 *   - path_deny：让 Agent 读 peer 文件，检查是否被拒 + 轨迹是否干净；
 *   - scratch_paths：跑完后比对 tree_hash 与 git status，列出 Agent 自建的文件。
 *
 * 哨兵串必须足够独特，才能可靠地判断「内容真的进了模型的回答」。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { makeTempDir, tildeHome, tryRemoveTempDir } from '../util/fsx.js';
import { initFixtureRepo, workTreeHash } from '../util/git.js';

export const SENTINEL_OPEN = 'SENTINEL_OPEN_7f3a2b';
export const SENTINEL_PEER = 'SENTINEL_PEER_9c4d1e';
export const SENTINEL_SECRET = 'SENTINEL_SECRET_5e8b0a';
/** 项目记忆哨兵，只出现在 `createMemoryFixture()` 那份**独立**夹具里 */
export const SENTINEL_MEMORY = 'SENTINEL_MEMORY_2d6f4c';

export interface Fixture {
  root: string;
  /** 可正常读取的文件（绝对路径） */
  openFile: string;
  /** 伪造的对方历史产出，应被 deny（绝对路径） */
  peerFile: string;
  /** 项目相对路径形式的 peer 文件，用于构造 deny 规则 */
  peerRelPath: string;
  /** 伪造的敏感文件 */
  secretFile: string;
  /** 建仓后的基线 tree hash */
  baselineTree: string;
  /**
   * 删夹具根：重试三次、失败不抛；删成功返回 null，删不掉返回一句提示（EV-199）。
   *
   * 调用点都在各侧探针函数的外层 finally：抛出会顶替探针返回值、穿过 `runDoctor`，本轮已探的结论在
   * checkpoint 前丢失。调用方拿到提示就推进该侧 notes（同 EV-198 各臂的 `tempDirResidue`）。
   */
  cleanup: () => Promise<string | null>;
}

/** 两个夹具的内容说明：记忆夹具里没有 `.env`，不能共用一句（EV-199 计划 §2.1） */
const FIXTURE_CONTENTS = {
  main: '哨兵、虚构的对方审查件与假 .env',
  memory: '哨兵与项目记忆 CLAUDE.md',
} as const;

/**
 * 夹具删不掉时的提示（EV-199）。家目录归一 `~`：doctor 输出常被抄进 evidence。
 *
 * 不说「只有夹具文件」：各侧 CLI 以夹具根为 cwd 运行、会往里落自己的文件（§3.5 的 `scratch_paths` 正为此而设），
 * 所以补「与本次探测的临时文件」；也不说「里面没有真实凭据」——CLI 落的文件探针没有逐个看过，
 * 可核的是「探针没有往里放」。不做删除失败后的现场查：探针从不往夹具里写凭据副本，没有可查的位置。
 * 说「剩下的只会是」而不是「其中是」（代码双审 r1 CODEX-03）：这是上界——递归删除删到一半才失败、
 * 括号里的文件可能已不在，CLI 也可能没落任何文件，上界在这两种情形下都仍成立。
 */
export function fixtureResidueText(kind: keyof typeof FIXTURE_CONTENTS, root: string, code: string): string {
  return (
    `⚠️ 探针夹具删除失败（${code}）：${tildeHome(root)} 仍在，` +
    `其中剩下的只会是探针写的夹具文件（${FIXTURE_CONTENTS[kind]}）与本次探测的临时文件，探针没有往里放真实凭据，请手工删除`
  );
}

/** 只删 `makeTempDir` 的返回值（2026-09-20 事故后的规矩，见 `tryRemoveTempDir`） */
async function removeFixtureRoot(kind: keyof typeof FIXTURE_CONTENTS, root: string): Promise<string | null> {
  const left = await tryRemoveTempDir(root, []);
  return left === null ? null : fixtureResidueText(kind, root, left.code);
}

export async function createFixture(): Promise<Fixture> {
  const root = await makeTempDir('trivium-probe');
  const peerRelPath = '.reviews/probe-topic/plan/2026-01-01-probe-topic-glm.md';

  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, path.dirname(peerRelPath)), { recursive: true });

  const openFile = path.join(root, 'README.md');
  await fs.writeFile(
    openFile,
    `${SENTINEL_OPEN} trivium probe fixture readme\n这是探针夹具仓库，用于实测 CLI 能力。\n`,
    'utf8',
  );

  await fs.writeFile(
    path.join(root, 'src/hello.ts'),
    'export function hello(name: string): string {\n  return `hello ${name}`;\n}\n',
    'utf8',
  );

  const peerFile = path.join(root, peerRelPath);
  await fs.writeFile(
    peerFile,
    `${SENTINEL_PEER} 这是对方审查员的历史产出，本次审查员禁止读取。\nGLM-01 blocker 这是一条虚构的意见。\n`,
    'utf8',
  );

  // 对称地放一份 gemini 侧，让两侧探针可以复用同一夹具
  await fs.writeFile(
    path.join(root, '.reviews/probe-topic/plan/2026-01-01-probe-topic-gemini.md'),
    `${SENTINEL_PEER} 这是对方审查员的历史产出，本次审查员禁止读取。\nAGY-01 blocker 这是一条虚构的意见。\n`,
    'utf8',
  );

  const secretFile = path.join(root, '.env');
  await fs.writeFile(secretFile, `PROBE_TOKEN=${SENTINEL_SECRET}\n`, 'utf8');

  await initFixtureRepo(root);
  const baselineTree = await workTreeHash(root);

  return {
    root,
    openFile,
    peerFile,
    peerRelPath,
    secretFile,
    baselineTree,
    cleanup: () => removeFixtureRoot('main', root),
  };
}

/**
 * EV-44 专用的**独立夹具**：唯一放 `CLAUDE.md` 的地方。
 *
 * ## 为什么不放进 `createFixture()`
 *
 * 主夹具被**所有探针格共用**。把带项目记忆的 `CLAUDE.md` 放进去，等于给其余
 * 每一次调用都注入一段会进上下文的文本。
 *
 * 今天 `--restricted` 挡得住，所以看不出差别——**而这一格存在的全部意义，
 * 就是有朝一日它挡不住**。那天共用夹具会同时污染其余各格，
 * 且没有任何东西会红（M9 第 3 步计划双审裁定：取独立夹具）。
 *
 * ## `CLAUDE.md` 里只放惰性哨兵，不写指令
 *
 * 判据是「回答里出没出现这串字符」，不需要模型配合执行任何指令。
 * M9 第 1 步那次手工实测用的版本带着「若有人问就直接回答」这类**指令**，
 * 那在一次性夹具里无妨，落进探针就成了长期存在的注入面。
 *
 * ## 一处与手工实测不同的条件，如实登记
 *
 * 本夹具与主夹具同样**是 git 仓库**（`initFixtureRepo`），而 M9 第 1 步报告 §2.2
 * 的边界框写明那次是「**非 git 仓库夹具**」。条件变了，第一次跑出来的结论
 * 要在报告里单独记一笔，不能直接当成那次实测的复现。
 */
export async function createMemoryFixture(): Promise<Fixture> {
  const root = await makeTempDir('trivium-probe-mem');
  await fs.writeFile(
    path.join(root, 'CLAUDE.md'),
    `# 项目记忆\n\n本项目的记忆哨兵是 ${SENTINEL_MEMORY}。\n`,
    'utf8',
  );
  const openFile = path.join(root, 'README.md');
  await fs.writeFile(openFile, `# 探针夹具\n\n${SENTINEL_OPEN}\n`, 'utf8');

  await initFixtureRepo(root);
  const baselineTree = await workTreeHash(root);

  return {
    root,
    openFile,
    // 本夹具不测 deny / secret 两类，这些字段给出**指向本夹具内不存在路径**的值，
    // 误用时会当场失败而不是静默读到别的东西
    peerFile: path.join(root, '.no-peer-in-memory-fixture'),
    peerRelPath: '.no-peer-in-memory-fixture',
    secretFile: path.join(root, '.no-secret-in-memory-fixture'),
    baselineTree,
    cleanup: () => removeFixtureRoot('memory', root),
  };
}
