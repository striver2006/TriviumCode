/**
 * 桩 Agent 接入套件的 **overlay 装置**（M7b 第 6 步）。
 *
 * ## 它要回答的问题
 *
 * 「新增一家审核者时，核心代码到底要改多少？」——设计把答案定为一份**接入套件**：
 * 注册表加一条，外加几件该 Agent 自己的东西。本装置把这个答案变成可执行的：
 * 从**未改动的生产检出**出发，只按套件清单打补丁，然后用**同一个**
 * `scripts/build.mjs` 重打包，看三审全链路能不能跑起来。
 *
 * ## 为什么不能拿「夹具树 vs 夹具树」的 diff 当验收
 *
 * 计划双审 GLM-07 点破过一次同义反复：若比对的是「手工搭好的夹具树」与「生产树」，
 * 那个 diff **按构造**就等于套件补丁，断言恒真、不构成验收。
 *
 * 所以这里的判据是**两层**：
 *   ① `applyOverlay` 自报的触及路径 ⊆ 套件白名单；
 *   ② 自报的那份清单，必须与**整棵树逐文件哈希前后比对**算出来的真实差集**逐项相等**。
 *
 * 第 ② 层是第 ① 层的守卫：只有第 ① 层的话，overlay 少记一笔就能让断言凭空变绿。
 * 两层都在 `stub-agent-kit.test.ts` 里执行。
 *
 * 第 ② 层自己也有论域边界——树根挂着一条指向真实仓库依赖树的软链。
 * 那条边界现在由三处机制守着（软链入哈希表、调用方断言软链集合、`Recorder`
 * 按 realpath 拦逃逸），而不是像第一版那样只由一句注释断言，见 `hashTree` 的说明。
 *
 * ## 证明边界（必须先读这一段再看结论）
 *
 * 本装置证明的是：**注册表追加 + 套件补丁 ⇒ 三审全链路可跑**。
 *
 * 它**不**证明真实适配器路径无需核心改动——桩不调用任何厂商 CLI，参数构造、
 * 只读旗标、轨迹解析、模型覆盖生效档位、思考等级透传一概不经过。
 *
 * 环境检查那一侧的边界**在 M6 第 1 步变了**，原文已不准（代码双审 GLM-02）：
 * `checkCliVersions` 已按注册表遍历、不再写死两家，所以桩侧不被版本校验的原因
 * 不再是「编排写死了厂商」，而是**桩从没探过**（`probed_at` 为空即跳过）——
 * 那是正确行为，不是缺口。真正仍按厂商写死的只剩 `checkReadonlyCapability`
 * 与探活编排两项，见 BACKLOG EV-05②。
 * 对真检验要等 M8 / M9 接入真实的第三家。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { REPO_ROOT } from '../../helpers/fixture.js';

/** 桩 Agent 的 id / 厂商 / 意见编号前缀。三者在整套夹具里只写这一遍 */
export const STUB_ID = 'stub';
export const STUB_VENDOR = 'stub';
export const STUB_PREFIX = 'STUB';
/** 与 `pieces/stub-probe.ts.txt` 的 `STUB_MODEL` 必须一致 */
export const STUB_MODEL = 'stub-model-v0';

/**
 * 接入套件白名单：新增一家 Agent **允许**触及的全部路径。
 *
 * 每一条都要写明它是套件里的哪一件。**这张表不是用来让断言变绿的**——
 * 往里加一条就等于承认「接入成本又多了一件」，所以加之前先问：
 * 这条路径真的是「该 Agent 自己的东西」，还是一处本该泛化掉的核心硬编码？
 *
 * 计划稿定的是「六件套」。第 7 条（配置形状）是本步实测**补出来的**：
 * 入选审核者必须在 `agents` 段里有条目（`critics.ts` 的最后一道校验），
 * 而配置段要先在 `config.v2.json` 的 `oneOf` 里有形状才过得了 ajv。
 * 计划稿第一版漏了模型路由、第二版补成六件，这里是第三次补。
 */
export const KIT_WHITELIST: readonly { path: string; piece: string }[] = [
  { path: 'src/trivium/agents/registry.ts', piece: '① 注册项：身份、后缀、前缀、厂商、能力开关' },
  { path: 'src/trivium/adapters/stub-agent.ts', piece: '② 适配器本体：该 Agent 的执行者' },
  { path: 'src/trivium/adapters/index.ts', piece: '② 适配器接线：唯一的 id → 执行者登记处，加一行' },
  { path: 'src/trivium/probes/stub.ts', piece: '③ 探针：可用性与版本' },
  { path: 'skills/dual-critic/lenses.yaml', piece: '④ 镜头：该 Agent 的审查侧重' },
  { path: 'STUB.md', piece: '⑤ 入口资产：该 Agent 读的协议片段' },
  { path: 'skills/dual-critic/schema/config.v2.json', piece: '⑦ 配置形状：agents 段的 oneOf 分支' },
];
/*
 * 第 ⑥ 件（模型路由：`profiles.<档位>.<id>`）不在这张表里，因为它**不是代码路径**——
 * 它落在目标项目的 `.trivium/config.yaml`，属测试配置面。漏了它的症状是
 * `routeModel` 取不到模型、`review.ts` 当场退 69，把它写进计划是为了避免排障时
 * 把这个 69 误判成泛化失败。夹具在 `makeStubFixtureRepo` 里配它。
 */

/*
 * 套件桩件按**源码路径**定位，不按本模块的运行位置。
 *
 * 测试是从 `dist/test/` 跑的，而 `pieces/` 下是 `.ts.txt` 与 `.md`——
 * 转译不会把它们带过去。它们是源码资产而不是构建产物，直接读源码树才对：
 * 从 dist 读的话，改完桩件忘了重建就会拿到上一版，而症状会出现在别的地方。
 */
const PIECES = path.join(REPO_ROOT, 'test/fixtures/stub-agent-kit/pieces');

/**
 * 生产树里要拷进夹具的部分。
 *
 * **不拷 `node_modules`**（AGY-06）：依赖树由 `linkDependencies` 软链到仓库根，
 * 既省时间也保证夹具用的就是本仓库的依赖版本。
 * 也不拷 `skills/dual-critic/scripts/`——那是上一次构建的产物，夹具要自己重打包。
 */
const COPY_SPEC: readonly string[] = [
  'src',
  'scripts/build.mjs',
  'skills/dual-critic',
  'package.json',
  'tsconfig.json',
];

/** 记录式写入：**所有**落盘都必须经这里，否则触及清单就不再可信 */
class Recorder {
  readonly touched = new Set<string>();
  constructor(private readonly root: string) {}

  /**
   * 落点必须**真的**落在夹具树内（审查意见 GLM-01）。
   *
   * 树根挂着一条指向真实仓库 `node_modules` 的软链（见 `linkDependencies`），
   * 而 `hashTree` 对软链目标树不做内容比对。所以一条 `node_modules/…` 的写入会
   * **同时穿过两层判据**，还会把污染留在开发者的真实环境里——`after` 的清理
   * 只删软链本身，不跟随。
   *
   * 这里按 realpath 判定而不是按字面前缀：`../` 与软链两种逃逸都拦得住。
   */
  private async resolveInside(rel: string): Promise<string> {
    const abs = path.join(this.root, rel);
    const rootReal = await fs.realpath(this.root);
    // 目标文件可能还不存在，所以解析它**所在目录**的 realpath
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const dirReal = await fs.realpath(path.dirname(abs));
    if (dirReal !== rootReal && !dirReal.startsWith(`${rootReal}${path.sep}`)) {
      throw new Error(
        `overlay 想写的路径解析到夹具树之外：${rel} → ${dirReal}\n` +
          '  这会同时穿过「自报清单」与「全树哈希」两层判据，并污染真实仓库环境。',
      );
    }
    return abs;
  }

  async write(rel: string, content: string): Promise<void> {
    const abs = await this.resolveInside(rel);
    await fs.writeFile(abs, content, 'utf8');
    this.touched.add(rel);
  }

  async edit(rel: string, fn: (src: string) => string): Promise<void> {
    const abs = await this.resolveInside(rel);
    const before = await fs.readFile(abs, 'utf8');
    const after = fn(before);
    if (after === before) {
      // 锚点没命中却静默写回原文，会让「补丁已应用」成为假象，
      // 而后续失败会指向一个完全无关的地方。就地炸掉。
      throw new Error(`overlay 对 ${rel} 的改写没有产生任何变化——锚点多半已经漂移`);
    }
    await fs.writeFile(abs, after, 'utf8');
    this.touched.add(rel);
  }
}

/** 锚点替换：命中不到就抛，绝不静默跳过 */
function anchor(src: string, from: string, to: string, what: string): string {
  if (!src.includes(from)) {
    throw new Error(`overlay 找不到锚点（${what}）：\n---\n${from}\n---`);
  }
  return src.replace(from, to);
}

/** 把生产检出拷成一棵可构建的临时树 */
export async function copyProductionTree(repoRoot: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  for (const rel of COPY_SPEC) {
    await fs.cp(path.join(repoRoot, rel), path.join(dest, rel), {
      recursive: true,
      // 上一次构建的产物不拷：夹具必须用自己重打包出来的那一份
      filter: (src) => !src.includes(`${path.sep}skills${path.sep}dual-critic${path.sep}scripts`),
    });
  }
}

/** 依赖树软链到仓库根，而不是复制（AGY-06 的依赖闭环要求） */
export async function linkDependencies(repoRoot: string, dest: string): Promise<void> {
  await fs.symlink(path.join(repoRoot, 'node_modules'), path.join(dest, 'node_modules'), 'dir');
}

/**
 * 应用接入套件补丁，返回**自报的**触及路径。
 *
 * 自报清单只是第 ① 层判据；它是否诚实由调用方用全树哈希差集核对（第 ② 层）。
 */
export async function applyOverlay(dest: string): Promise<string[]> {
  const rec = new Recorder(dest);

  // ── ① 注册项 ──
  await rec.edit('src/trivium/agents/registry.ts', (src) => {
    let s = src;
    s = anchor(
      s,
      "export type AgentId = 'claude' | 'codex' | 'gemini' | 'glm';",
      `export type AgentId = 'claude' | 'codex' | 'gemini' | 'glm' | '${STUB_ID}';`,
      'AgentId union',
    );
    s = anchor(
      s,
      "export type AgentVendor = 'anthropic' | 'openai' | 'antigravity' | 'zcode';",
      `export type AgentVendor = 'anthropic' | 'openai' | 'antigravity' | 'zcode' | '${STUB_VENDOR}';`,
      'AgentVendor union',
    );
    s = anchor(
      s,
      "    instructionFiles: ['AGENTS.md'],\n  },\n];",
      `    instructionFiles: ['AGENTS.md'],
  },
  {
    id: '${STUB_ID}',
    display: '桩 Agent',
    label: 'Critic-S · 接入验收桩',
    vendor: '${STUB_VENDOR}',
    cliName: '${STUB_ID}',
    suffix: '${STUB_ID}',
    findingPrefix: '${STUB_PREFIX}',
    criticEnabled: true,
    driverEnabled: false,
    guardLevel: 'L2',
    instructionFiles: ['STUB.md'],
  },
];`,
      'AGENTS 末项',
    );
    return s;
  });

  // ── ② 适配器本体 + 接线 ──
  await rec.write(
    'src/trivium/adapters/stub-agent.ts',
    await fs.readFile(path.join(PIECES, 'stub-agent.ts.txt'), 'utf8'),
  );
  await rec.edit('src/trivium/adapters/index.ts', (src) => {
    let s = anchor(
      src,
      "import { zcodeAdapter } from './zcode.js';",
      "import { zcodeAdapter } from './zcode.js';\nimport { stubAgentAdapter } from './stub-agent.js';",
      '适配器 import',
    );
    s = anchor(
      s,
      '  glm: zcodeAdapter,\n};',
      `  glm: zcodeAdapter,\n  ${STUB_ID}: stubAgentAdapter,\n};`,
      'WIRED 接线表',
    );
    return s;
  });

  // ── ③ 探针 ──
  await rec.write(
    'src/trivium/probes/stub.ts',
    await fs.readFile(path.join(PIECES, 'stub-probe.ts.txt'), 'utf8'),
  );

  // ── ④ 镜头 ──
  await rec.edit('skills/dual-critic/lenses.yaml', (src) =>
    `${src.replace(/\s*$/, '')}\n\n${STUB_ID}:\n` +
    '  plan: "桩镜头：不做实际分析，仅用于验证多审链路。"\n' +
    '  code: "桩镜头：不做实际分析，仅用于验证多审链路。"\n' +
    '  bug: "桩镜头：不做实际分析，仅用于验证多审链路。"\n',
  );

  // ── ⑤ 入口资产 ──
  await rec.write('STUB.md', await fs.readFile(path.join(PIECES, 'STUB.md'), 'utf8'));

  // ── ⑦ 配置形状 ──
  await rec.edit('skills/dual-critic/schema/config.v2.json', (src) => {
    const schema = JSON.parse(src) as {
      properties: { agents: { additionalProperties: { oneOf: unknown[] } } };
    };
    schema.properties.agents.additionalProperties.oneOf.push({
      type: 'object',
      additionalProperties: false,
      required: ['vendor'],
      properties: { vendor: { const: STUB_VENDOR } },
      description: '接入验收桩：没有任何可配置项，vendor 只作形状判别式。',
    });
    return `${JSON.stringify(schema, null, 2)}\n`;
  });

  return [...rec.touched].sort();
}

/** `hashTree` 给软链条目打的前缀：值记软链**目标**，不递归目标树 */
export const SYMLINK_MARK = '@symlink -> ';

/**
 * 逐文件哈希整棵树，用于算 overlay 的**真实**触及差集。
 *
 * ## 软链怎么处理，以及为什么不是「跳过」
 *
 * 第一版写的是 `if (e.isSymbolicLink()) continue`，配一句注释
 * 「它不属于生产检出，也不会被 overlay 碰」。审查意见 GLM-01 指出：
 * **后半句是未经任何断言保证的假设**——而这一层判据存在的全部理由，
 * 正是「第①层的自报不可信」。用一个同构的假设去封口，等于把洞挪了个位置。
 *
 * 现在软链**作为条目入表**（值是它的目标路径），于是「软链被替换 / 新增 / 删除」
 * 都会进差集；调用方另外断言树内软链恰好只有依赖树那一条。
 *
 * **残留边界，如实记**：绕开 `Recorder` 且直接写进软链目标树的操作，
 * 本函数仍看不见（不递归目标树，那是整个 `node_modules`）。
 * 这条路径在本夹具里无代码可达——唯一应当写文件的入口 `Recorder` 已按 realpath
 * 拦住逃逸——但它是**边界**，不是保证。
 */
export async function hashTree(root: string): Promise<Map<string, string>> {
  const { createHash } = await import('node:crypto');
  const out = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs);
      if (e.isSymbolicLink()) {
        out.set(rel, SYMLINK_MARK + (await fs.readlink(abs)));
        continue;
      }
      if (e.isDirectory()) await walk(abs);
      else {
        out.set(rel, createHash('sha256').update(await fs.readFile(abs)).digest('hex'));
      }
    }
  };
  await walk(root);
  return out;
}

/** 树内的全部软链条目（相对路径 → 目标），供调用方断言豁免面没有变宽 */
export function symlinksIn(hashes: Map<string, string>): string[] {
  return [...hashes.entries()]
    .filter(([, v]) => v.startsWith(SYMLINK_MARK))
    .map(([k]) => k)
    .sort();
}

/** 前后哈希表的差集 = overlay **实际**触及的路径（新增 + 改写） */
export function diffTrees(before: Map<string, string>, after: Map<string, string>): string[] {
  const touched: string[] = [];
  for (const [rel, h] of after) if (before.get(rel) !== h) touched.push(rel);
  for (const rel of before.keys()) if (!after.has(rel)) touched.push(`（被删除）${rel}`);
  return touched.sort();
}
