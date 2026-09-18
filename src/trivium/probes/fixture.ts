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
import { makeTempDir } from '../util/fsx.js';
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
  cleanup: () => Promise<void>;
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
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
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
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}
