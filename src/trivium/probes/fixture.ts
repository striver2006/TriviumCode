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
