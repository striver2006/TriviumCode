/**
 * EV-222：带魔法 pathspec 的 git 调用钉住 pathspec 的解释方式，不受用户环境里四个全局变量影响。
 *
 * `diffAgainst` 用 `:(exclude)<前缀>/**` 与 `:(exclude,glob)<glob>` 剔除归档根、`.trivium`、`.git` 与敏感文件的已跟踪改动；
 * `workTreeHash` 用 `:(exclude,literal)<前缀>` 排除归档根与 `.trivium`（EV-221）。用户全局设了
 * `GIT_LITERAL_PATHSPECS=1` 时魔法前缀被当字面路径、`GIT_NOGLOB_PATHSPECS=1` 时 `/**` 被当字面，`git diff` 不报错照常退 0，
 * 排除静默失效（改前实测，报告 §0）；`GIT_ICASE_PATHSPECS=1` 让排除不分大小写（本机 APFS 不分大小写，
 * 排除写 `Docs`、目录叫 `docs` 时观测得到）。修后两处都带 `PATHSPEC_ENV_DEFAULTS`（四个变量取 `0`）。
 *
 *   P：`diffAgainst` 在四个变量逐个设 `1` 时补丁与不设时逐字相同、只含业务文件；ICASE 一格单独构造。
 *   H：`workTreeHash` 在四个变量逐个设 `1` 时与不设同值；ICASE 一格单独构造。
 *   G：源码护栏——`src/` 里含 `:(` 魔法前缀的字面量按文件登记。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import ts from 'typescript';
import { PATHSPEC_ENV_DEFAULTS, diffAgainst, initFixtureRepo, workTreeHash } from '../../src/trivium/util/git.js';
import { diffExcludePrefixes } from '../../src/trivium/code-stage.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { scratchDir } from '../helpers/scratch.js';
import { REPO_ROOT } from '../helpers/fixture.js';

const VARS = ['GIT_LITERAL_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_GLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS'] as const;
const EX = diffExcludePrefixes('.reviews');
const GLOBS = defaultConfig().review.sensitive_globs;

/** 已跟踪的业务文件、归档里的计划、`.trivium/config.yaml`、`.env` 全部提交后各改一行 */
async function repo(): Promise<string> {
  const dir = await scratchDir('trivium-pse-');
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
  await fs.mkdir(path.join(dir, '.reviews/t/plan'), { recursive: true });
  await fs.mkdir(path.join(dir, '.trivium'), { recursive: true });
  await fs.writeFile(path.join(dir, 'src/a.ts'), 'export const a = 1;\n');
  await fs.writeFile(path.join(dir, '.reviews/t/plan/2026-10-06-t-claude.md'), '# 计划\n');
  await fs.writeFile(path.join(dir, '.trivium/config.yaml'), 'archive_root: .reviews\n');
  await fs.writeFile(path.join(dir, '.env'), 'FAKE_PLACEHOLDER=1\n');
  await initFixtureRepo(dir);
  await fs.writeFile(path.join(dir, 'src/a.ts'), 'export const a = 2;\n');
  await fs.writeFile(path.join(dir, '.reviews/t/plan/2026-10-06-t-claude.md'), '# 计划（改过）\n');
  await fs.writeFile(path.join(dir, '.trivium/config.yaml'), 'archive_root: .reviews\n# 改过\n');
  await fs.writeFile(path.join(dir, '.env'), 'FAKE_PLACEHOLDER=2\n');
  return dir;
}

/** 在钉住的环境变量下跑 fn，结束还原 */
async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const filesOf = (diff: string): string[] => [...diff.matchAll(/^diff --git a\/(\S+) /gm)].map((m) => m[1]!);

test('EV-222 P1：四个 pathspec 变量逐个设 1，diffAgainst 的补丁与不设时逐字相同，只含业务文件', async () => {
  const dir = await repo();
  const plain = await diffAgainst(dir, 'HEAD', EX, GLOBS);
  assert.deepEqual(filesOf(plain), ['src/a.ts'], '前提：不设变量时只有业务文件');
  for (const v of VARS) {
    const got = await withEnv({ [v]: '1' }, () => diffAgainst(dir, 'HEAD', EX, GLOBS));
    assert.deepEqual(filesOf(got), ['src/a.ts'], `${v}=1：补丁里的文件 ${filesOf(got).join(', ')}`);
    assert.equal(got, plain, `${v}=1：补丁与不设时不同`);
  }
});

test('EV-222 P2：GIT_ICASE_PATHSPECS=1 不让补丁的排除变成不分大小写（排除写 Docs、目录叫 docs，照常进补丁）', async () => {
  const dir = await scratchDir('trivium-pse-');
  await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'docs/f.md'), '1\n');
  await initFixtureRepo(dir);
  await fs.writeFile(path.join(dir, 'docs/f.md'), '2\n');
  const plain = await diffAgainst(dir, 'HEAD', ['Docs'], []);
  assert.deepEqual(filesOf(plain), ['docs/f.md'], '前提：区分大小写时 Docs 排除不到 docs');
  const got = await withEnv({ GIT_ICASE_PATHSPECS: '1' }, () => diffAgainst(dir, 'HEAD', ['Docs'], []));
  assert.equal(got, plain);
});

test('EV-222 H1：四个 pathspec 变量逐个设 1，workTreeHash（带排除）与不设时同值', async () => {
  const dir = await repo();
  const plain = await workTreeHash(dir, { exclude: EX });
  for (const v of VARS) {
    assert.equal(await withEnv({ [v]: '1' }, () => workTreeHash(dir, { exclude: EX })), plain, `${v}=1`);
  }
});

test('EV-222 H2：GIT_ICASE_PATHSPECS=1 不让工作树哈希的排除变成不分大小写（排除写 Docs、目录叫 docs，照常进哈希）', async () => {
  const dir = await scratchDir('trivium-pse-');
  await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'docs/f.md'), '1\n');
  await initFixtureRepo(dir);
  const before = await workTreeHash(dir, { exclude: ['Docs'] });
  await fs.writeFile(path.join(dir, 'docs/f.md'), '2\n');
  const plain = await workTreeHash(dir, { exclude: ['Docs'] });
  assert.notEqual(plain, before, '前提：区分大小写时 Docs 排除不到 docs');
  assert.equal(await withEnv({ GIT_ICASE_PATHSPECS: '1' }, () => workTreeHash(dir, { exclude: ['Docs'] })), plain);
});

test('EV-222 H3：钉住的是四个变量的缺省值', () => {
  assert.deepEqual({ ...PATHSPEC_ENV_DEFAULTS }, Object.fromEntries(VARS.map((v) => [v, '0'])));
});

// ─────────────────────────── G：源码护栏 ───────────────────────────

/**
 * pathspec 魔法的两种写法：长形式 `:(词[,词])`（只认 git 的魔法词，免得正则源串里的 `(?:(?:` 误报——首跑撞上 hooks.ts 一处），
 * 短形式以 `:!` / `:^`（exclude）或 `:/`（top，后面不是 `/`——首跑撞上 probes/zcode.ts 判 URL 的 `'://'`）开头。
 */
const MAGIC = /:\((?:exclude|literal|glob|icase|top|attr)\b|^:[!^]|^:\/(?!\/)/;

/** 扫一份源码里含 pathspec 魔法的字符串与模板字面量（注释不算），返回处数 */
function scanMagicPathspecs(src: string): number {
  const sf = ts.createSourceFile('scan.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let n = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (MAGIC.test(node.text)) n++;
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
      if (parts.some((p) => MAGIC.test(p))) n++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return n;
}

test('EV-222 G1（扫描器自测）：长短两种魔法写法都算，注释、正则源串里的 (?:(?: 与 URL 的 :// 不算', () => {
  assert.equal(scanMagicPathspecs([
    "const a = ':(exclude).reviews';",
    'const b = `:(exclude,literal)${p}`;',
    "const c = ':!.trivium';",
    "const t = ':/src';",
    '// 注释里的 :(exclude) 不算',
    "const d = 'plain';",
    'const e = `(?:(?:${x})\\\\s+)*`;',
    "const u = raw.includes('://');",
  ].join('\n')), 4);
});

/**
 * 登记表：含魔法 pathspec 的字面量所在文件与处数。`util/git.ts` 三处（`excludePathspecs` 一处、`diffAgainst` 两处），
 * 调用都带 `PATHSPEC_ENV_DEFAULTS`（P1 / H1 守）；`worktree-summary.ts` 一处是打印给人复制的完整列表命令，
 * 在用户自己的 shell 里跑、不经编排器，豁免（报告 §4 残余）。新增魔法 pathspec 要来这里登记并钉住环境。
 */
const REGISTERED: Record<string, number> = {
  'trivium/util/git.ts': 3,
  'trivium/worktree-summary.ts': 1,
};

test('EV-222 G2（源码护栏）：src/ 里含魔法 pathspec 的字面量与登记表一致', async () => {
  const root = path.join(REPO_ROOT, 'src');
  const seen: Record<string, number> = {};
  const walk = async (d: string): Promise<void> => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (p.endsWith('.ts')) {
        const n = scanMagicPathspecs(await fs.readFile(p, 'utf8'));
        if (n > 0) seen[path.relative(root, p).split(path.sep).join('/')] = n;
      }
    }
  };
  await walk(root);
  assert.deepEqual(seen, REGISTERED, '魔法 pathspec 字面量与登记表不一致——新增处要钉 PATHSPEC_ENV_DEFAULTS 并登记');
});
