/**
 * 接入套件验收：**新增一家审核者，核心代码要改多少**（M7b 第 6 步）。
 *
 * 这是前五步的验收装置。前五步分别让契约就位（run.v2、config v2、`--critics`），
 * 但「多一家 Agent 就能跑起来」这句话在此之前**没有任何机器可判的依据**——
 * 一直靠人读代码判断。本文件把它变成三条断言：
 *
 *   ① overlay **实际**触及的路径 ⊆ 接入套件白名单（自报清单与全树哈希差集互证）；
 *   ② 三审全链路在**重打包产物**上跑通：typecheck → preflight → topic resolve
 *      → review --start/--wait → gate --check → gate --check-artifacts；
 *   ③ 三审的重合度**逐对**计算，三对齐备（第 2 步把它从「只比一对」改成逐对，
 *      而 n=3 在此之前只有纯函数用例，真实链路零覆盖）。
 *
 * ## 证明边界
 *
 * 桩不调用任何厂商 CLI。所以这里证明的是「注册表追加 + 套件补丁 ⇒ 三审全链路可跑」，
 * **不**证明真实适配器路径（参数构造、只读旗标、轨迹解析、模型覆盖生效档位）
 * 无需核心改动，也**不**证明探活与 CLI 版本校验容得下第三家——那两项在 preflight
 * 里仍是按厂商写死的编排，桩侧根本没被检查（见 `overlay.ts` 的证明边界段与 BACKLOG EV-05）。
 * 对真检验要等 M8 / M9。
 *
 * ## 为什么要重打包，而不是在本仓库里直接跑
 *
 * 生产注册表**不接受任何环境变量改写**（计划 §3.5 撤回了 `TRIVIUM_TEST_AGENTS`：
 * 给唯一事实源开环境变量入口，就是在制造第二事实源）。所以桩只能以「改注册表 +
 * 重新打包」的形态存在，而且必须走**同一个** `scripts/build.mjs`——
 * 换一套构建就等于换了被验收的对象。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { REPO_ROOT, today } from '../helpers/fixture.js';
import { run } from '../../src/trivium/util/exec.js';
import { initFixtureRepo } from '../../src/trivium/util/git.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { encodeStubConfig, STUB_ENV_VAR } from '../../src/trivium/adapters/stub.js';
import { IS_WIN } from '../../src/trivium/util/platform.js';
import {
  KIT_WHITELIST,
  STUB_ID,
  STUB_MODEL,
  STUB_PREFIX,
  applyOverlay,
  copyProductionTree,
  diffTrees,
  hashTree,
  linkDependencies,
  symlinksIn,
} from '../fixtures/stub-agent-kit/overlay.js';
import type { RunMeta } from '../../src/trivium/types.js';

const TOPIC = '接入套件验收';
const FAKE_CLI_VERSION = '9.9.9';
/** 夹具里各处时间戳取同一个值：探针段的 probed_at 要与 generated_at 一致才像真盘面 */
const NOW = new Date().toISOString();

interface Kit {
  /** 打过 overlay 的临时构建树 */
  root: string;
  /** overlay 自报的触及路径 */
  reported: string[];
  /** 全树哈希前后比对算出的**真实**触及路径 */
  actual: string[];
  /** overlay 之后树内的全部软链条目——第②层判据的论域边界 */
  symlinks: string[];
  bundle: string;
  assetRoot: string;
}

let kit: Kit | null = null;
let setupError: unknown = null;
const temps: string[] = [];

async function mkTemp(tag: string): Promise<string> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), `trivium-kit-${tag}-`));
  // macOS 的 /var 是 /private/var 的软链，realpath 一下免得路径前缀比对失配
  const dir = await fs.realpath(raw);
  temps.push(dir);
  return dir;
}

before(async () => {
  try {
    const root = await mkTemp('tree');
    await copyProductionTree(REPO_ROOT, root);
    await linkDependencies(REPO_ROOT, root);

    const beforeHashes = await hashTree(root);
    const reported = await applyOverlay(root);
    const afterHashes = await hashTree(root);

    kit = {
      root,
      reported,
      actual: diffTrees(beforeHashes, afterHashes),
      symlinks: symlinksIn(afterHashes),
      bundle: path.join(root, 'skills/dual-critic/scripts/trivium.cjs'),
      assetRoot: path.join(root, 'skills/dual-critic'),
    };
  } catch (e) {
    // before 里抛异常会让全部用例以一条晦涩的信息失败。存下来，由每条用例自己报。
    setupError = e;
  }
});

after(async () => {
  // 跑完即删（AGY-06）。构建树里有一个指向仓库 node_modules 的软链，
  // 必须 force 且不跟随——`fs.rm` 删软链本身，不会碰到目标目录。
  for (const d of temps) await fs.rm(d, { recursive: true, force: true });
});

function theKit(): Kit {
  if (setupError) throw setupError;
  assert.ok(kit, '夹具未建立');
  return kit;
}

// ─────────────────────────── 断言 ① ───────────────────────────

test('接入套件 ①：overlay 自报的触及路径与全树哈希差集逐项相等', () => {
  const k = theKit();
  /*
   * 这一条是断言①的**守卫**，不是断言①本身。
   *
   * 若只比对自报清单与白名单，overlay 少记一笔就能让验收凭空变绿——
   * 而「少记一笔」正是最可能发生的事（写文件的地方多加一处，忘了走记录器）。
   * 全树哈希差集是从**未改动的生产检出**算出来的，不受 overlay 自述影响。
   */
  assert.deepEqual(
    k.reported,
    k.actual,
    'overlay 的自报清单与它实际改动的文件对不上——自报清单不可信，断言① 随之失效',
  );
});

test('接入套件 ①：新增一家 Agent 只触及接入套件白名单内的路径', () => {
  const k = theKit();
  const allowed = new Set(KIT_WHITELIST.map((w) => w.path));
  const outside = k.actual.filter((p) => !allowed.has(p));

  assert.deepEqual(
    outside,
    [],
    '这些路径不在接入套件白名单里——要么它们本该被泛化掉，要么接入成本比登记的更高。\n' +
      '  **不要靠往白名单里加一条来让这条断言变绿**：那等于把「核心要改」重新定义成「不算改」。\n' +
      `  越界路径：\n${outside.map((p) => `    ${p}`).join('\n')}`,
  );
});

test('接入套件 ①：第②层判据的论域边界——树内软链恰好只有依赖树那一条', () => {
  const k = theKit();
  /*
   * 全树哈希对**软链目标树**不做内容比对（那是整个 node_modules）。
   * 所以一条落在软链下的写入会同时穿过两层判据，还会污染开发者的真实仓库
   * ——`after` 的清理只删软链本身，不跟随（审查意见 GLM-01）。
   *
   * 第一版用一句注释「它不会被 overlay 碰」封住这个洞。那句话与第②层要取代的
   * 「自报可信」结构完全相同：**用一个同样没有断言支撑的假设去封口**。
   *
   * 现在的守法有三道，这是其中一道：软链作为条目进哈希表（替换/新增/删除即进差集），
   * 这里再断言豁免面没有变宽。另两道在 `Recorder`（按 realpath 拦逃逸）
   * 与 `hashTree` 的说明里（残留边界如实登记，不冒充成保证）。
   */
  assert.deepEqual(
    k.symlinks,
    ['node_modules'],
    '夹具树里出现了预期之外的软链——第②层的内容哈希对软链目标树是盲的，' +
      '每多一条软链就多一条能同时穿过两层判据的路径',
  );
});

test('接入套件 ①：白名单不得留空头支票（每一条都要被真正用到）', () => {
  const k = theKit();
  const touched = new Set(k.actual);
  const unused = KIT_WHITELIST.filter((w) => !touched.has(w.path));
  /*
   * 与白名单纪律同构（见 registry-parity 的「不得留过期条目」）：
   * 只守上界的话，白名单可以随便变长而不被察觉，
   * 「接入套件有几件」这个数字就失去意义。
   */
  assert.deepEqual(
    unused.map((w) => `${w.path}（${w.piece}）`),
    [],
    '白名单里这些条目本轮根本没被 overlay 碰过——要么该删，要么 overlay 漏做了那一件',
  );
});

// ─────────────────────────── 断言 ② ───────────────────────────

test('接入套件 ②：加桩之后类型层依然自洽（tsc --noEmit）', { timeout: 180_000 }, async () => {
  const k = theKit();
  /*
   * **必须真的 typecheck**。`scripts/build.mjs` 走 esbuild，只转译不查类型——
   * 只跑构建的话，`CriticId` 收窄成两值、`Lenses` 是封闭两键接口这类问题
   * 一个都不会暴露，而它们恰恰是「新增一家就编译不过」的主要形态
   * （计划双审 GLM-03 的原话：零改动验收会被自己的判据打红）。
   */
  // win32：.bin/tsc 是无扩展名的 sh 脚本（CreateProcess 不认），取 .cmd 垫片（参数无元字符，§7.1 支持面内）
  const tsc = path.join(k.root, IS_WIN ? 'node_modules/.bin/tsc.cmd' : 'node_modules/.bin/tsc');
  const r = await run(tsc, ['--noEmit', '-p', path.join(k.root, 'tsconfig.json')], {
    cwd: k.root,
    timeoutMs: 170_000,
  });
  assert.equal(r.code, 0, `加桩后的树 typecheck 不过：\n${r.stdout}\n${r.stderr}`);
});

test('接入套件 ②：三审全链路在重打包产物上跑通', { timeout: 300_000 }, async () => {
  const k = theKit();
  await buildBundle(k);
  const fx = await makeStubFixtureRepo();

  // ── 环节 1/5：preflight ──
  const pre = await cliIn(k, fx, ['preflight', '--stage', 'code', '--skip-auth-check']);
  assert.equal(pre.code, EXIT.OK, `preflight 未通过：\n${pre.stdout}\n${pre.stderr}`);
  assert.match(
    pre.stdout,
    new RegExp(`未实际校验[^\\n]*${STUB_ID}`),
    'preflight 必须把「桩侧没有模型目录可比对」说出来——' +
      '静默通过会让「校验了」和「没得校验」看起来一模一样',
  );

  // ── 环节 2/5：topic resolve ──
  // `--` 之后按 argv 逐个 token 解析（EV-18）：旗标各自独立，正文是一个元素
  const res = await cliIn(k, fx, [
    'topic', 'resolve', '--stage', 'code', '--json',
    '--', '--topic', TOPIC, '--critics', `gemini,glm,${STUB_ID}`, '看三审链路',
  ]);
  assert.equal(res.code, EXIT.OK, `topic resolve 未通过：\n${res.stdout}\n${res.stderr}`);
  const resolved = JSON.parse(extractJson(res.stdout)) as { critics: string[]; prompt_hint: string };
  assert.deepEqual(
    resolved.critics,
    ['gemini', 'glm', STUB_ID],
    'resolve 必须原样解析出三侧——它是 Driver 拼装 --start 的唯一依据',
  );

  // ── 环节 3/5：review --start → --wait ──
  const meta = await runThreeSided(k, fx, resolved.critics, resolved.prompt_hint);
  assert.equal(meta.review_mode, 'full', '三侧全成功应记 full，不是降级');
  assert.deepEqual([...meta.critics_selected].sort(), ['gemini', 'glm', STUB_ID].sort());
  assert.equal(
    meta.critics[STUB_ID as 'gemini']?.cli_version,
    'stub/0.0.0',
    '桩侧的指纹必须出现在 run.json——它只可能由执行适配器的 worker 写入',
  );

  // ── 环节 4/5：gate --check（裁决完整性）──
  await writeDisposition(fx, meta);
  const gate = await cliIn(k, fx, ['gate', '--stage', 'code', '--topic', TOPIC, '--check', '--json']);
  assert.equal(
    gate.code,
    EXIT.OK,
    `gate --check 未通过——三侧的意见编号必须都进裁决差集：\n${gate.stdout}\n${gate.stderr}`,
  );

  // ── 环节 5/5：gate --check-artifacts（工件齐备）──
  const arts = await cliIn(k, fx, ['gate', '--stage', 'code', '--topic', TOPIC, '--check-artifacts', '--json']);
  assert.equal(
    arts.code,
    EXIT.OK,
    `gate --check-artifacts 未通过——它按本轮真实入选集合判缺件：\n${arts.stdout}\n${arts.stderr}`,
  );
});

// ─────────────────────────── 断言 ③ ───────────────────────────

test('接入套件 ③：三审的重合度逐对算，三对齐备', { timeout: 300_000 }, async () => {
  const k = theKit();
  await buildBundle(k);
  const fx = await makeStubFixtureRepo();
  const sides = ['gemini', 'glm', STUB_ID];
  await runThreeSided(k, fx, sides, '看逐对重合度');

  const rep = await cliIn(k, fx, ['report', '--topic', TOPIC, '--json']);
  assert.equal(rep.code, EXIT.OK, `report 失败：\n${rep.stdout}\n${rep.stderr}`);
  const json = JSON.parse(extractJson(rep.stdout)) as {
    rounds: { divergences?: { a: string; b: string }[] }[];
  };
  const pairs = (json.rounds[0]?.divergences ?? []).map((d) => [d.a, d.b].sort().join('+')).sort();
  /*
   * 三侧产三对。这条断言在第 2 步就该有，但那时只有纯函数用例——
   * 真实链路上 n=3 从来没跑过，因为在第 6 步之前根本凑不出第三侧。
   */
  assert.deepEqual(
    pairs,
    [`gemini+glm`, `gemini+${STUB_ID}`, `glm+${STUB_ID}`].sort(),
    '三侧应产生全部三种两两组合——少一对就意味着有一侧在重合度上被静默丢掉',
  );
});

// ─────────────────────────── 断言 ④ ───────────────────────────

/*
 * **第五家登记而未启用为 Driver ⇒ 各入口退 64**（M10a 第 3 步，代码双审 r4 CODEX-01）。
 *
 * 本夹具的桩在**真实注册表**里是 `driverEnabled: false`（overlay 追加、重打包），
 * 正是 `resolveDriver` 那条 64 分支守的「第五家」形态——四家翻开之后，这是全仓唯一
 * 能在打包 CLI 上构造它的地方（单测靠注入表，见 critics.test.ts）。
 * 上一版测试报告写「集成层注入不了注册表、构造不出来」，那句不成立，这一格因此漏了。
 *
 * 三格：显式 `--driver` 两个入口；以及**继承**——claim 声明里是桩、不传 `--driver`，
 * 靠「定下最终值之后那一次再解析」拦下（cli.ts / topic-args.ts 各一处，
 * driver-wiring.test.ts 另有源码级判据钉住调用点）。
 */
test('接入套件 ④：登记而未启用为 Driver 的第五家——显式与继承两条路都退 64', { timeout: 300_000 }, async () => {
  const k = theKit();
  await buildBundle(k);
  const fx = await makeStubFixtureRepo();
  const usableTail = (out: string) => out.slice(out.indexOf('可用作 Driver'));

  // ── 显式：topic resolve 与 topic claim ──
  const res = await cliIn(k, fx, [
    'topic', 'resolve', '--stage', 'code', '--json', '--', '--topic', TOPIC, '--driver', STUB_ID, '看边界',
  ]);
  const resOut = res.stdout + res.stderr;
  assert.equal(res.code, EXIT.USAGE, `--driver ${STUB_ID} 应退 64：\n${resOut}`);
  assert.match(resOut, /尚未启用为 Driver/);
  assert.doesNotMatch(usableTail(resOut), new RegExp(`\\b${STUB_ID}\\b`), '清单不该列未启用的桩');

  const claim = await cliIn(k, fx, ['topic', 'claim', '--stage', 'code', '--topic', TOPIC, '--driver', STUB_ID, '--session-id', 'S']);
  assert.equal(claim.code, EXIT.USAGE, `认领未启用的桩应退 64：\n${claim.stdout}${claim.stderr}`);

  // ── 继承：先合法认领一家已启用的，得到一份合法的声明，再把声明里的 driver 换成桩 ──
  const ok = await cliIn(k, fx, ['topic', 'claim', '--stage', 'code', '--topic', TOPIC, '--driver', 'gemini', '--session-id', 'S']);
  assert.equal(ok.code, EXIT.OK, `前提：认领已启用的一家应成功：\n${ok.stdout}${ok.stderr}`);
  const taskPath = path.join(fx.archiveRoot, TOPIC, 'task.json');
  const task = JSON.parse(await fs.readFile(taskPath, 'utf8')) as { drivers: Record<string, { driver: string }> };
  assert.equal(task.drivers['code']?.driver, 'gemini', '前提：声明已落盘');
  task.drivers['code']!.driver = STUB_ID;
  await fs.writeFile(taskPath, JSON.stringify(task, null, 2), 'utf8');

  /*
   * **显式给 `--critics gemini,glm`，并断言报错文案**（变异 M6c 实测出的掩盖）：
   * （M10b 第 2 步起缺省集合会先减去当轮 Driver，下面这句的「同样退 64」已不再发生；
   *  显式给 `--critics` 与钉文案的做法照旧有效，它们排除的防线少了一道而已。）
   * 本夹具的 `default_critics` 含桩，继承到的 driver 也是桩时，选侧会以「含当轮 Driver」
   * 同样退 64——删掉那次再解析，本格照样绿。排除选侧这道防线、再钉住「尚未启用」的文案，
   * 退 64 才只可能来自再解析。
   */
  const inherit = await cliIn(k, fx, [
    'topic', 'resolve', '--stage', 'code', '--json', '--', '--topic', TOPIC, '--critics', 'gemini,glm', '看边界',
  ]);
  assert.equal(
    inherit.code, EXIT.USAGE,
    `topic resolve 继承到未启用的桩却没退 64——定下最终 driver 之后那次再解析没接上：\n${inherit.stdout}${inherit.stderr}`,
  );
  assert.match(inherit.stdout + inherit.stderr, /尚未启用为 Driver/, '退 64 必须来自 Driver 判定，不是别的防线');
  const start = await cliIn(k, fx, [
    'review', '--start', '--stage', 'code', '--topic', TOPIC, '--focus', '看边界', '--critics', 'gemini,glm', '--json',
  ]);
  assert.equal(
    start.code, EXIT.USAGE,
    `review --start 继承到未启用的桩却没退 64：\n${start.stdout}${start.stderr}`,
  );
  assert.match(start.stdout + start.stderr, /尚未启用为 Driver/);
});

// ─────────────────────────── 夹具搭建 ───────────────────────────

let built = false;
/** 用**同一个** scripts/build.mjs 重打包（只打一次，三条用例共用） */
async function buildBundle(k: Kit): Promise<void> {
  if (built) return;
  const r = await run(process.execPath, [path.join(k.root, 'scripts/build.mjs')], {
    cwd: k.root,
    timeoutMs: 180_000,
  });
  assert.equal(r.code, 0, `夹具重打包失败：\n${r.stdout}\n${r.stderr}`);
  built = true;
}

interface FixtureRepo {
  root: string;
  archiveRoot: string;
  stageDir: string;
  home: string;
}

/**
 * 造一个能让**真实 preflight** 通过的三审目标项目。
 *
 * 与 `test/helpers/fixture.ts` 的 `makeFixture` 不复用：那份夹具从不跑 preflight，
 * 因此不需要假 CLI、不需要隔离 HOME、也不需要完整探针段。硬塞进去只会让
 * 一个被十几条用例共用的助手多出三个只服务本文件的分支。
 */
async function makeStubFixtureRepo(): Promise<FixtureRepo> {
  // 父目录登记进 temps，夹具仓库与运行根都在其下，after 删父目录就一起带走（EV-207；此前运行根是兄弟目录 `<root>-runs`，无人删）
  const base = await mkTemp('proj');
  const root = path.join(base, 'repo');
  const runRoot = path.join(base, 'runs');
  const home = await mkTemp('home');

  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  for (const f of ['a.ts', 'b.ts', 'c.ts']) {
    await fs.writeFile(path.join(root, 'src', f), `export const ${f[0]} = 1;\n`, 'utf8');
  }
  await fs.writeFile(path.join(root, 'README.md'), '# 三审夹具\n', 'utf8');
  // 命中 sensitive_globs，使禁读清单非空（首轮没有对方产出时它才不是空转）
  await fs.writeFile(path.join(root, '.env'), 'FAKE_PLACEHOLDER=not-a-secret\n', 'utf8');

  /*
   * 假 CLI：preflight 的 checkCliVersions 会真的执行它们并比对版本号。
   *
   * **这要求探针段写成新形状并带上 `version_probe`**（审查意见 GLM-01）。
   * M6 第 1 步之前这里写的是旧平铺形状（`agy.bin` / `zcode.entry`）；改动落地后，
   * 旧形状经 `migrateProbeSection` 迁移时不会被凭空补上 `version_probe`（刻意的保守选择），
   * 于是 `readCliVersion` 走「无从查」第三态——**假 CLI 从此再没被执行过，而本用例照样全绿**。
   * 这是全仓唯一端到端跑通「取版本 + 比对」的地方，那次静默降级把它变成了空转。
   *
   * 另有一条用例专门覆盖「旧盘迁移后走第三态」，见文件末尾——
   * 两条各守一边：这条守版本比对真的发生，那条守第三态真的被点名。
   */
  const fakeAgy = IS_WIN ? path.join(root, 'fake/agy.cmd') : path.join(root, 'fake/agy');
  await fs.mkdir(path.dirname(fakeAgy), { recursive: true });
  // win32 无 shebang 执行：写 .cmd 垫片（run() 对 .cmd 经 cmd.exe 间接执行，设计 §7.1）
  await fs.writeFile(fakeAgy, IS_WIN ? `@echo ${FAKE_CLI_VERSION}\r\n` : `#!/bin/sh\necho ${FAKE_CLI_VERSION}\n`, { mode: 0o755 });
  const fakeZcode = path.join(root, 'fake/zcode.js');
  await fs.writeFile(fakeZcode, `console.log('zcode ${FAKE_CLI_VERSION}');\n`, 'utf8');

  // 隔离 HOME：checkReadonlyCapability 要读 ~/.gemini/... 的只读 Agent 定义。
  // 不隔离的话这条用例的成败取决于跑它的人装没装 Antigravity。
  await fs.mkdir(path.join(home, '.gemini/config/agents/trivium-critic'), { recursive: true });
  await fs.writeFile(
    path.join(home, '.gemini/config/agents/trivium-critic/agent.md'),
    '# 假的只读审查 Agent 定义\n',
    'utf8',
  );
  await fs.mkdir(path.join(home, '.zcode/cli'), { recursive: true });
  await fs.writeFile(path.join(home, '.zcode/cli/config.json'), '{}\n', 'utf8');

  await fs.mkdir(path.join(root, '.trivium'), { recursive: true });
  await fs.writeFile(
    path.join(root, '.trivium/config.yaml'),
    [
      'runtime:',
      `  run_root: ${runRoot}`,
      'review:',
      /*
       * **夹具钉住自己考的那三侧**：gemini + glm + 新接入的桩。
       *
       * 本用例验的是「新增一家 Agent 只需接入套件、核心流程零改动」，
       * 它在 `topic resolve` 那步已经显式写了 `--critics`。但**预检那步没有**——
       * 预检按缺省集合查，而 D4-4 把 codex 纳入缺省后，夹具里根本没有 codex 的探针结论，
       * 「只读能力可用」当场失败，与被考的事毫无关系。
       *
       * 钉住之后，「默认跑几侧」归生产配置管，本夹具只管三审链路本身。
       */
      `  default_critics: [gemini, glm, ${STUB_ID}]`,
      '  timeout_s:',
      '    plan: 120',
      '    code: 120',
      '    bug: 120',
      '  wait_timeout_s: 30',
      'agents:',
      // 接入套件第 ⑦ 件的配置面：形状由 overlay 加进 config.v2.json 的 oneOf
      `  ${STUB_ID}:`,
      `    vendor: ${STUB_ID}`,
      'profiles:',
      '  default:',
      // 接入套件第 ⑥ 件：模型路由。缺了它档位解析取不到模型，review 准备阶段的 slug 校验当场退 64（M11 第 4 步前误记为 69）
      `    ${STUB_ID}:`,
      `      plan: ${STUB_MODEL}`,
      `      code: ${STUB_MODEL}`,
      `      bug: ${STUB_MODEL}`,
      'verify:',
      '  build: []',
      '  test: []',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(root, '.trivium/config.local.yaml'),
    [
      'probe:',
      `  generated_at: '${NOW}'`,
      '  cli:',
      '    agy:',
      `      entrypoint: ${fakeAgy}`,
      `      version: '${FAKE_CLI_VERSION}'`,
      `      probed_at: '${NOW}'`,
      '      version_probe:',
      '        runner: null',
      '        args:',
      "          - '--version'",
      '        extract: null',
      '      models:',
      "        - 'gemini-3.8-flash-high'",
      '      headless_read_ok: true',
      // M8 第 3 步：只读能力检查改为遍历适配器 availability()，判据比原先严——
      // agy 侧要求探针记下**当时实际验证过**的只读 Agent 名，zcode 侧要求
      // --disallowed-tools 与 response_field 都在。夹具据此补齐。
      `      agent: 'trivium-critic'`,
      '    zcode:',
      `      entrypoint: ${fakeZcode}`,
      `      version: '${FAKE_CLI_VERSION}'`,
      `      probed_at: '${NOW}'`,
      '      version_probe:',
      "        runner: 'node'",
      '        args:',
      "          - 'version'",
      // 假 zcode 输出 `zcode 9.9.9`，与真实 zcode 一样要抠正则才拿得到纯版本号；
      // 写 null 取全文会与 version 字段对不上，被误报成版本漂移。
      "        extract: '(\\d+\\.\\d+\\.\\d+)'",
      '      readonly_flags:',
      "        - '--mode plan'",
      "        - '--disallowed-tools Write,Edit'",
      "      response_field: '.response'",
      '      models:',
      "        - 'GLM-5.3'",
      '',
    ].join('\n'),
    'utf8',
  );

  const archiveRoot = path.join(root, '.reviews');
  const stageDir = path.join(archiveRoot, TOPIC, 'code');
  await fs.mkdir(stageDir, { recursive: true });

  await initFixtureRepo(root);
  // code 阶段审的是 git diff：初始化之后再改一笔，补丁才非空
  await fs.writeFile(path.join(root, 'src/a.ts'), 'export const a = 2;\n', 'utf8');

  return { root, archiveRoot, stageDir, home };
}

/** 用夹具产物跑 CLI：资产根、HOME、桩注入三件套都在这里统一 */
async function cliIn(k: Kit, fx: FixtureRepo, args: string[], timeoutMs = 120_000) {
  return run(process.execPath, [k.bundle, ...args], {
    cwd: fx.root,
    timeoutMs,
    env: {
      TRIVIUM_ASSET_ROOT: k.assetRoot,
      HOME: fx.home,
      // 既有两侧用故障注入桩顶掉，避免真的去调厂商 CLI。
      // 桩 **Agent** 不在这里——它有自己的适配器，那正是本轮要验的东西。
      [STUB_ENV_VAR]: encodeStubConfig({ gemini: { mode: 'ok' }, glm: { mode: 'ok' } }),
    },
  });
}

/** 跑一轮三侧 review，返回 run.json */
async function runThreeSided(
  k: Kit,
  fx: FixtureRepo,
  sides: string[],
  focus: string,
): Promise<RunMeta> {
  const started = await cliIn(k, fx, [
    'review', '--start', '--entry', 'C', '--stage', 'code', '--topic', TOPIC,
    '--focus', focus, '--base', 'HEAD', '--critics', sides.join(','), '--json',
  ]);
  assert.equal(started.code, EXIT.OK, `--start 失败：\n${started.stdout}\n${started.stderr}`);
  const runId = (JSON.parse(extractJson(started.stdout)) as { run_id: string }).run_id;
  assert.ok(runId, '--start 必须回 run_id');

  let code: number = EXIT.STILL_RUNNING;
  let out = started.stdout + started.stderr;
  for (let i = 0; i < 12 && code === EXIT.STILL_RUNNING; i++) {
    const w = await cliIn(k, fx, ['review', '--wait', runId, '--timeout', '20'], 60_000);
    code = w.code ?? EXIT.FAIL;
    out += w.stdout + w.stderr;
  }
  assert.equal(code, EXIT.OK, `--wait 未以成功收敛：\n${out}`);

  const metaPath = path.join(fx.stageDir, '_meta', `run-${runId}.json`);
  return JSON.parse(await fs.readFile(metaPath, 'utf8')) as RunMeta;
}

/** 写一份覆盖全部三侧意见编号的裁决件，供 gate --check 校验 */
async function writeDisposition(fx: FixtureRepo, meta: RunMeta): Promise<void> {
  const ids = [`AGY-01`, `GLM-01`, `${STUB_PREFIX}-01`];
  const rows = ids
    .map((id) => `| ${id} | ${id.split('-')[0]} | nit | 接受 | 桩数据，照单接受 | 无需改动 |`)
    .join('\n');
  const doc = [
    '---',
    'schema: trivium.disposition.v1',
    `topic: ${TOPIC}`,
    'stage: code',
    'role: claude',
    'kind: response',
    `run_id: ${meta.run_id}`,
    // EV-134：addresses 列本轮审查文档的文件名（不是意见编号）。取自 run.json 登记的阶段根工件，
    // 测试自己筛、不借 gate 的派生函数——否则这一格与被测判据同义反复
    `addresses: [${meta.artifacts
      .map((a) => a.path.split(path.sep).join('/'))
      .filter((p) => path.posix.dirname(p) === `${TOPIC}/code` && !/-response-/.test(p))
      .map((p) => path.posix.basename(p))
      .join(', ')}]`,
    '---',
    '',
    '# 逐条裁决',
    '',
    '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |',
    '| :--- | :--- | :--- | :--- | :--- | :--- |',
    rows,
    '',
  ].join('\n');
  await fs.writeFile(
    path.join(fx.stageDir, `${today()}-${TOPIC}-response-claude.md`),
    doc,
    'utf8',
  );
}

/** `--json` 输出里夹着人读日志，挑出那一段 JSON */
function extractJson(stdout: string): string {
  const start = stdout.indexOf('{');
  assert.ok(start >= 0, `输出里没有 JSON：\n${stdout}`);
  const end = stdout.lastIndexOf('}');
  return stdout.slice(start, end + 1);
}
