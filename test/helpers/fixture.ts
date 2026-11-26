/**
 * 集成测试共享夹具：造一个能被**真实打包 CLI** 驱动的最小项目。
 *
 * 不是单元测试的 mock 上下文——这里要的是真 git 仓库、真配置文件、真 `.reviews/` 布局，
 * 因为被测的正是「另一个进程在真实文件系统上的行为」。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import YAML from 'yaml';
import { fileURLToPath } from 'node:url';
import { run } from '../../src/trivium/util/exec.js';
import { IS_WIN } from '../../src/trivium/util/platform.js';
import { initFixtureRepo } from '../../src/trivium/util/git.js';
import { encodeStubConfig, STUB_ENV_VAR, type StubConfig } from '../../src/trivium/adapters/stub.js';
import { scratchDir } from './scratch.js';
import { ENTRY_SCAN_HOME_ENV } from '../../src/trivium/entry-collisions.js';
import { emptyEntryScanHome } from './entry-scan-home.js';
import { fixtureCodexHome } from './codex-home-fixture.js';

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
  /** 覆盖 verify 段的 YAML 行（默认两组皆空） */
  extraVerify?: string[];
}

export interface Fixture {
  root: string;
  /** 本夹具的运行根：与 `root` 同在一个 mkdtemp 父目录下（EV-207），不预建、由编排器按需建 */
  runRoot: string;
  archiveRoot: string;
  stageDir: string;
  topic: string;
}

/** 设为 `1` 时进程退出不删夹具（EV-208 起管全部经 `scratch.ts` 建的测试临时目录），只打一行列出路径，便于排查（EV-207） */
export { KEEP_FIXTURES_ENV } from './scratch.js';

/** 夹具父目录的退出提示主语：与 EV-207 的三句提示逐字相同（「makeFixture：…夹具目录…」） */
const FIXTURE_OWNER = { owner: 'makeFixture', noun: '夹具目录' };

/**
 * 特意放一个 `.env`：它命中 `review.sensitive_globs`，于是 `deny_paths` 非空。
 * 首轮 plan 没有对方产出，若不放它禁读清单会是空的，相关用例就成了空转。
 *
 * mkdtemp 建的是**父目录**，夹具仓库在其下 `repo/`、运行根在其下 `runs/`（EV-207）。此前运行根是兄弟目录
 * `<夹具根>-runs`、夹具根本身也从不删，系统临时目录里堆了几万个。父目录一建好就登记，本进程退出时整个删掉；
 * 登记在任何可能抛出的写盘之前，建到一半抛出也会被收尾。
 */
export async function makeFixture(opts: FixtureOptions): Promise<Fixture> {
  // mkdtemp 一返回就由 scratchDir 登记、本进程退出时删（EV-207 的机制，EV-208 抽到 scratch.ts）
  const raw = await scratchDir('trivium-fx-', FIXTURE_OWNER);
  // macOS 的 /var 是 /private/var 的符号链接，realpath 一下免得路径前缀比对失配
  const base = await fs.realpath(raw);
  const root = path.join(base, 'repo');
  const runRoot = path.join(base, 'runs');

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
      // 运行目录放进同一个父目录：默认 ~/.trivium/runs 会让每个夹具在真实用户目录里
      // 留一个桶，审核时那里已堆了 3000 多个 trivium-fx-*（M20）；放在父目录下随夹具一起删（EV-207）
      'runtime:',
      `  run_root: ${runRoot}`,
      'review:',
      /*
       * **夹具显式钉两侧，不跟生产默认值漂移**（D4-4 翻 `defaultSelected` 时暴露）。
       *
       * 这些集成用例考的是闸门、工件落位、补丁冻结、漂移判定——**与几侧参审无关**。
       * 而它们的桩注入写死了 `{gemini, glm}`，于是生产默认值一变成三侧，
       * 103 条当场红在「codex 没有桩」上：测试对象没变，环境前提被别处的一行开关改了。
       *
       * 钉住之后，「默认跑几侧」这个决定归生产配置管，这些用例只管自己那件事。
       * **三侧的默认路径另有覆盖**：接入套件验收（`stub-agent-kit.test.ts`）走的就是三审全链路。
       */
      '  default_critics: [gemini, glm]',
      '  timeout_s:',
      '    plan: 120',
      '    code: 120',
      '    bug: 120',
      '  wait_timeout_s: 30',
      ...(opts.extraReview ?? []).map((l) => `  ${l}`),
      'verify:',
      ...(opts.extraVerify ?? ['  build: []', '  test: []']),
      '',
    ].join('\n'),
    'utf8',
  );

  if (opts.probeModels) {
    // win32 没有 /bin/echo：probeModels 只需要「存在的可执行文件」，用本机 node 路径（YAML 里反斜杠要引号）
    const fakeBin = IS_WIN ? JSON.stringify(process.execPath) : '/bin/echo';
    await fs.writeFile(
      path.join(root, '.trivium/config.local.yaml'),
      [
        'probe:',
        `  generated_at: '${new Date().toISOString()}'`,
        '  agy:',
        `    bin: ${fakeBin}`,
        "    version: 'stub/0.0.0'",
        '    models:',
        ...opts.probeModels.gemini.map((m) => `      - '${m}'`),
        '    headless_read_ok: true',
        '  zcode:',
        `    entry: ${fakeBin}`,
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
  return { root, runRoot, archiveRoot, stageDir, topic: opts.topic };
}

/** 调用真实打包 CLI。`stub` 非空时经环境变量跨进程注入桩适配器 */
export async function cli(
  root: string,
  args: string[],
  stub: StubConfig | null = null,
  timeoutMs = 120_000,
  /** 再叠加一层环境变量（EV-158：让写者与读者的 TZ / 区域设置不同）；undefined 值表示删除该变量 */
  extraEnv: Record<string, string | undefined> = {},
) {
  // run() 的 env 是「叠加到 process.env 之上」，undefined 表示删除该变量
  const env: Record<string, string | undefined> = {
    TRIVIUM_ASSET_ROOT: ASSET_ROOT,
    [STUB_ENV_VAR]: stub ? encodeStubConfig(stub) : undefined,
    // doctor / preflight 的共享读取面扫描读空夹具，不读真实家目录（EV-240，计划双审 CODEX-01）
    [ENTRY_SCAN_HOME_ENV]: emptyEntryScanHome(),
    // codex 的 profile 名单与原生路线判据读夹具家，不读真实 ~/.codex（1.2.7，与上一条同族泄漏）
    CODEX_HOME: fixtureCodexHome(),
    ...extraEnv,
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

export const FAKE_CLI_VERSION = '9.9.9';

/**
 * 往夹具的本机配置里塞一整份「已探过」的探针结论。
 *
 * **三侧都要塞**：预检第一步是探针新鲜度，缺任何一侧都会**快速失败**，
 * 后面的检查根本不执行——那时断言「只读能力这一项在不在」验的就不是接线了。
 * 假 CLI 用真文件：`checkCliVersions` 会 `exists()` 并真取一次版本，
 * 写个不存在的路径会让预检死在版本检查而不是我们要测的那一项。
 *
 * `over` 叠加到 codex 那一段（`codex-wiring.test.ts` 用它构造各种探针读数）。
 * 原是 `codex-wiring.test.ts` 的私有夹具；EV-160 的集成测试与验收脚本要同一份，代码双审 r1 CODEX-02 起收进这里。
 */
export async function seedFakeProbes(root: string, over: Record<string, unknown> = {}): Promise<void> {
  const fakeDir = path.join(root, 'fake');
  await fs.mkdir(fakeDir, { recursive: true });
  // win32 无 shebang 执行：假 CLI 写 .cmd 垫片（编排器的 run() 对 .cmd/.bat 经 cmd.exe 间接执行，设计 §7.1）
  const fakeAgy = IS_WIN ? path.join(fakeDir, 'agy.cmd') : path.join(fakeDir, 'agy');
  await fs.writeFile(fakeAgy, IS_WIN ? `@echo ${FAKE_CLI_VERSION}\r\n` : `#!/bin/sh\necho ${FAKE_CLI_VERSION}\n`, { mode: 0o755 });
  const fakeZcode = path.join(fakeDir, 'zcode.js');
  await fs.writeFile(fakeZcode, `console.log('zcode ${FAKE_CLI_VERSION}');\n`, 'utf8');
  const fakeCodex = IS_WIN ? path.join(fakeDir, 'codex.cmd') : path.join(fakeDir, 'codex');
  await fs.writeFile(fakeCodex, IS_WIN ? `@echo codex-cli ${FAKE_CLI_VERSION}\r\n` : `#!/bin/sh\necho codex-cli ${FAKE_CLI_VERSION}\n`, { mode: 0o755 });

  const now = new Date().toISOString();
  const common = (entrypoint: string) => ({
    entrypoint,
    version: FAKE_CLI_VERSION,
    probed_at: now,
    path_deny: { supported: false, rule_syntax: null },
    scratch_paths: [],
    isolation: 'home_copy',
  });

  const p = path.join(root, '.trivium', 'config.local.yaml');
  const raw = await fs.readFile(p, 'utf8').catch(() => '');
  const doc = (YAML.parse(raw) ?? {}) as Record<string, any>;
  doc['agents'] = { ...doc['agents'], glm: { vendor: 'zcode', entry: fakeZcode } };
  doc['probe'] = {
    generated_at: now,
    cli: {
      agy: {
        ...common(fakeAgy),
        version_probe: { runner: null, args: ['--version'], extract: null },
        models: ['gemini-3.8-flash-high'],
        headless_read_ok: true,
        agent: 'trivium-critic',
      },
      zcode: {
        ...common(await fs.realpath(fakeZcode)),
        version_probe: { runner: 'node', args: ['version'], extract: String.raw`(\d+\.\d+\.\d+)` },
        models: ['GLM-5.3'],
        readonly_flags: ['--mode plan', '--disallowed-tools Write,Edit'],
        response_field: '.response',
      },
      codex: {
        ...common(fakeCodex),
        version_probe: { runner: null, args: ['--version'], extract: String.raw`(\d+\.\d+\.\d+)` },
        models: ['qwen3.8-max'],
        exec_headless_read_ok: true,
        json_event_types: [],
        json_item_types: [],
        trace_path_structured: false,
        rejected_command_in_trace: false,
        readonly_flags: ['-s', 'read-only'],
        profile_flag: true,
        unknown_profile_rejected: false,
        profiles: ['qwen'],
        providers: [{ profile: 'qwen', provider: 'qwen', model: 'qwen3.8-max', credentialed: true }],
        config_override: true,
        effort_validated: false,
        model_catalog_path: null,
        ...over,
      },
    },
  };
  // 模型档位也得给 codex 配上，否则档位解析取不到值、slug 校验先失败
  doc['profiles'] = {
    default: {
      gemini: { plan: 'gemini-3.8-flash-high' },
      glm: { plan: 'GLM-5.3' },
      codex: { plan: 'qwen3.8-max' },
    },
  };
  await fs.writeFile(p, YAML.stringify(doc), 'utf8');
}
