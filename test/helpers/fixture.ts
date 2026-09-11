/**
 * 集成测试共享夹具：造一个能被**真实打包 CLI** 驱动的最小项目。
 *
 * 不是单元测试的 mock 上下文——这里要的是真 git 仓库、真配置文件、真 `.reviews/` 布局，
 * 因为被测的正是「另一个进程在真实文件系统上的行为」。
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/trivium/util/exec.js';
import { initFixtureRepo } from '../../src/trivium/util/git.js';
import { encodeStubConfig, STUB_ENV_VAR, type StubConfig } from '../../src/trivium/adapters/stub.js';

/**
 * 运行时本文件位于 `dist/test/test/helpers/`，源码位于 `test/helpers/`，
 * 相对层数不同——所以向上找 package.json，而不是数 `..` 的个数。
 */
function findRepoRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`未能从 ${from} 向上定位仓库根`);
}

export const REPO_ROOT = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
export const BUNDLE = path.join(REPO_ROOT, 'skills/dual-critic/scripts/trivium.cjs');
export const ASSET_ROOT = path.join(REPO_ROOT, 'skills/dual-critic');
export const bundleMissing = !existsSync(BUNDLE);
export const bundleSkipReason = `未找到打包产物 ${BUNDLE}，请先 npm run build`;

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface FixtureOptions {
  topic: string;
  /** 是否预置待审计划草稿。置 false 用于验证「缺件即失败且零工件」 */
  draft?: boolean;
  /**
   * 追加到 `review:` **段内**的 YAML 行（如 `skip_doc_only_review: true`）。
   * 缩进由本函数补——原先让调用方自己写缩进并追加到文件末尾，
   * 结果挂到了 `verify:` 下面，配置静默不生效。
   */
  extraReview?: string[];
  /**
   * 是否预置一份假探针结论（含模型目录）。
   * 默认不置——`checkModelSlugs` 在目录为空时会**整段跳过**，
   * 要测 slug 校验真的生效就必须把目录填上。
   */
  probeModels?: { gemini: string[]; glm: string[] };
  /** 原稿落在哪个阶段目录。plan（默认）或 bug */
  draftStage?: 'plan' | 'bug';
}

export interface Fixture {
  root: string;
  archiveRoot: string;
  stageDir: string;
  topic: string;
}

/**
 * 特意放一个 `.env`：它命中 `review.sensitive_globs`，于是 `deny_paths` 非空。
 * 首轮 plan 没有对方产出，若不放它禁读清单会是空的，相关用例就成了空转。
 */
export async function makeFixture(opts: FixtureOptions): Promise<Fixture> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-fx-'));
  // macOS 的 /var 是 /private/var 的符号链接，realpath 一下免得路径前缀比对失配
  const root = await fs.realpath(raw);

  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  for (const f of ['a.ts', 'b.ts', 'c.ts']) {
    await fs.writeFile(path.join(root, 'src', f), `export const ${f[0]} = 1;\n`, 'utf8');
  }
  await fs.writeFile(path.join(root, 'README.md'), '# 夹具\n', 'utf8');
  await fs.writeFile(path.join(root, '.env'), 'FAKE_PLACEHOLDER=not-a-secret\n', 'utf8');

  await fs.mkdir(path.join(root, '.trivium'), { recursive: true });
  await fs.writeFile(
    path.join(root, '.trivium/config.yaml'),
    [
      'review:',
      '  timeout_s:',
      '    plan: 120',
      '    code: 120',
      '    bug: 120',
      '  wait_timeout_s: 30',
      ...(opts.extraReview ?? []).map((l) => `  ${l}`),
      'verify:',
      '  build: []',
      '  test: []',
      '',
    ].join('\n'),
    'utf8',
  );

  if (opts.probeModels) {
    await fs.writeFile(
      path.join(root, '.trivium/config.local.yaml'),
      [
        'probe:',
        `  generated_at: '${new Date().toISOString()}'`,
        '  agy:',
        "    bin: /bin/echo",
        "    version: 'stub/0.0.0'",
        '    models:',
        ...opts.probeModels.gemini.map((m) => `      - '${m}'`),
        '    headless_read_ok: true',
        '  zcode:',
        "    entry: /bin/echo",
        "    version: 'stub/0.0.0'",
        '    models:',
        ...opts.probeModels.glm.map((m) => `      - '${m}'`),
        '',
      ].join('\n'),
      'utf8',
    );
  }

  const archiveRoot = path.join(root, '.reviews');
  const draftStage = opts.draftStage ?? 'plan';
  const stageDir = path.join(archiveRoot, opts.topic, draftStage);
  if (opts.draft !== false) {
    await fs.mkdir(stageDir, { recursive: true });
    await fs.writeFile(
      path.join(stageDir, `${today()}-${opts.topic}-claude.md`),
      draftStage === 'bug'
        ? '# 根因分析\n\n## 一、现象\n\n某接口偶发 500。\n\n## 二、根因\n\n并发下缓存击穿。\n'
        : '# 待审计划\n\n## 一、目标\n\n验证编排器行为。\n',
      'utf8',
    );
  }

  await initFixtureRepo(root);
  return { root, archiveRoot, stageDir, topic: opts.topic };
}

/** 调用真实打包 CLI。`stub` 非空时经环境变量跨进程注入桩适配器 */
export async function cli(
  root: string,
  args: string[],
  stub: StubConfig | null = null,
  timeoutMs = 120_000,
) {
  // run() 的 env 是「叠加到 process.env 之上」，undefined 表示删除该变量
  const env: Record<string, string | undefined> = {
    TRIVIUM_ASSET_ROOT: ASSET_ROOT,
    [STUB_ENV_VAR]: stub ? encodeStubConfig(stub) : undefined,
  };
  return run(process.execPath, [BUNDLE, ...args], { cwd: root, env, timeoutMs });
}

/** 递归列出目录下所有文件的相对路径；目录不存在返回空数组 */
export async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) await walk(abs);
      else out.push(path.relative(dir, abs));
    }
  };
  await walk(dir);
  return out.sort();
}
