/**
 * 变异验证装置（代码双审 r1 CODEX-06 ≡ GLM-06 ≡ AGY-03）。
 *
 * ## 为什么要有它
 *
 * M9 第 3 步的变异验证**第一批全部作废**，两次失败形态见
 * `doc/05_testing/REPORT_2026-09-18_m9_claude_admission.md` §5.1：
 *
 *   1. 备份按 `basename` 命名，而 `adapters/claude.ts` 与 `probes/claude.ts`
 *      **同名**——后者覆盖前者，恢复时把探针内容写进了适配器；
 *   2. 此后构建一直失败，而失败被 `>/dev/null 2>&1` **吞掉**，
 *      于是每一条变异跑的都是**陈旧产物**；
 *   3. 第二份备份又是在改过文件**之后**才建的，**把变异版当成了干净基线**。
 *
 * 当时补的三条对策是**人工步骤**，而这批失败的本质恰恰是
 * 「脚本静默地没做我以为它做的事」——本仓纪律 12 的原话是
 * **「靠记性的纪律要换成不依赖记性的机制」**。所以它们必须是装置的默认行为。
 *
 * ## 七道闸，缺一不可
 *
 * 原题写「五道闸」，是闸 6、闸 7 补入之前的数；两次补闸都没跟着改标题，
 * M10a 第 4 步代码双审 r5 GLM-02 指出后改正。
 *
 * | 闸 | 防的是 |
 * | :--- | :--- |
 * | 备份按**全路径**命名（且单射） | 同名文件互相覆盖（失败 1） |
 * | 构建失败**非零退出并打印**，**包括收尾那次** | 跑陈旧产物（失败 2） |
 * | 前置**上次已善终**（哨兵） + **基线全绿** | 坏基线下「条条都红」被误读成「条条咬住」（失败 3） |
 * | 变异后断言**被测产物确实变了** | 变异 no-op（replace 没匹配上）而我以为它生效了 |
 * | 每条跑完**恢复件与基线逐字节比对** | 恢复本身失败（写半截、路径再错） |
 * | 开跑前断言 **cases ⊆ targets** | 规格写漏 ⇒ 变异留在工作树上（恢复面够不到） |
 * | 开跑前断言 **每条 find 在目标文件中恰好命中一处**（闸 7） | 只替换首处 ⇒ 同形文本处变异落错位置，而装置照报「咬住」 |
 *
 * 第四道是 codex 建议的形态：**用指纹证明身份**，本仓 `TRIVIUM_STUB_CRITIC` 桩有先例。
 * 没有它，一条 `replace` 悄悄没匹配上就会产出「变异了、没红」的假阴性。
 *
 * ## r2 补的四处（代码双审 r2：AGY-01 ≡ CODEX-04、AGY-02 ≡ GLM-06 ≡ CODEX-05、GLM-05、CODEX-06）
 *
 * 上一版**自己就有两条「声称强于事实」**，正是它要防的那个形状：
 *
 * 1. 闸 4 写「断言**产物**确实变了」，实现比的是**源文件**哈希。两者不等价：
 *    文件没进 build 图、产物被缓存、构建静默降级时，源文件变了而产物没变，
 *    这道闸照样判「变异生效」，随后「没红」会被归因成「守卫无效」——
 *    而真因是变异没进被测产物。**现改为比对被测产物**。
 * 2. 闸 2 写「绝不吞」，而 `finally` 的收尾重建是 `.catch(() => {})`：失败被静默吞掉，
 *    且此时若全部 case 已咬住就**退 0，dist 停在陈旧产物上**——失败 2 的复现通道，
 *    只是挪到了收尾。**现改为打印 + 置 dirty 标志 + 非零退出**。
 *
 * 另有一个**不设防的入口**（三侧全中）：`case.file ∉ spec.targets` 时，
 * 变异照写、恢复时 ENOENT、而 `finally` 只遍历 `targets` ⇒ **变异留在工作树里**。
 * 「残留变异版被当成下一轮干净基线」恰是本装置要防的第二类失败——
 * **它在自己的入口上复现了自己要防的东西**。现加闸 6 拦在任何写盘之前。
 *
 * 还有一处：闸 3 只验「**测得出的**坏基线」。工作树若残留一个测不出来的变异
 * （恰是那些判「没红」的），闸 3 照样放行。报告 §5.3 第 3 条纪律（「建基线前先确认
 * 工作树干净」）此前**没有进装置**，现补成**哨兵**前置检查——
 * 不是 `git status --porcelain`，理由见 `SENTINEL` 上方的注释块。
 *
 * ## r3 补的三处（代码双审 r3：AGY-01 ≡ GLM-02 ≡ CODEX-01、GLM-07）
 *
 * **上一版的哨兵闸只生效一次**，而它是三条闸里唯一能抓「测不出来的残留」的那条：
 * stale 拒绝在 `try` 内 throw ⇒ 照常进 `finally` ⇒ 恢复与重建都成功 ⇒
 * `dirtyExit` 恒 false ⇒ 收尾把**那个 stale 哨兵删掉**。装置一边告诉操作者
 * 「确认工作树无误后删掉它」，一边自己抢先删了，而人还没核实。
 *
 * 1. **闸 6 与闸 3 前半一并挪到 `try` 之外**：两者都在任何写盘之前，
 *    本就没有恢复面可走。拒绝路径从此不触碰清理逻辑（AGY-01、GLM-02）。
 * 2. **哨兵改独占创建**（`flag: 'wx'`）：检查与写入合成原子动作，
 *    顺带堵上并发窗口——上一版是 check-then-write，两次并行开跑会互相覆盖变异（CODEX-01）。
 * 3. **恢复面只覆盖真备份过的文件**（`backedUp`）：上一版闸 6 在 `try` 内拒绝时，
 *    `finally` 会从空备份目录逐条 ENOENT，逐条打印「工作树可能已脏」——
 *    而树从未被碰过。**装置在自己的告警上说过头话，会训练操作者无视它的告警**（GLM-07）。
 *
 * ## M10a 第 4 步补的闸 7 与哨兵拆分（该步计划双审 r1 CODEX-01、r2 CODEX-05）
 *
 * **闸 7：每条 case 的 find 在目标文件中必须恰好命中一处。** `String.replace` 只替换首处，
 * 此前也不查唯一性：同一文本出现两次时（第 4 步两个写点改完后逐字相同），标称改「写点 B」
 * 的变异会落在写点 A，装置照报「✓ 咬住」，归因记到错的位置上——又一处「声称强于事实」。
 * 零命中也一并在开跑前拒绝（此前记一条「未命中」、跑完再退 1），规格写错时不白跑构建。
 *
 * **哨兵拆成两段：只读预检 → 闸 7 → 独占创建。** 闸 7 若早于哨兵检查，上次异常退出
 * 留下的残留变异常让 find 命中 0，闸 7 先开口，读起来是「规格写错」，而修规格正好会把
 * 残留固化下来。所以先只读看一眼哨兵；`wx` 独占创建保留，兜住预检与创建之间的并发窗口。
 *
 * ## 装置自身的锁例与它的边界
 *
 * `test/unit/mutation-device.test.ts` 锁住上面的拒绝路径（它们不写盘、不花配额）。
 * **但装置验证不了对自己的变异**：闸 4 比的是 `artifactOf()` 给出的被测产物，
 * 而本文件是 `.mjs`、不进构建，`dist/test/scripts/…` 根本不存在。
 * 所以 D1/D2 两条的「能不能红」是**手工变异 + 哈希比对**验的，记在报告 §5.2；
 * D3/D4（闸 7 与哨兵预检的顺序）同样手工验，记在 M10a 第 4 步的测试报告里。
 *
 * ## 用法
 *
 *   node scripts/mutation-check.mjs <规格文件.json>
 *
 * 规格文件形如：
 *   { "targets": ["src/a.ts"], "suites": ["dist/test/test/unit/x.test.js"],
 *     "cases": [{ "id": "M1", "desc": "…", "file": "src/a.ts",
 *                 "find": "原文", "replace": "变异", "expect": "dist/…/y.test.js" }] }
 *
 * 每条 case 的 `expect` 是**期望变红的套件**（省略则用全部 `suites`）。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 备份键：**全路径**扁平化，不用 basename（失败 1 就出在这里）。
 *
 * **必须单射**（代码双审 r2 CODEX-05）：上一版把 `/` 直接换成 `_`，于是
 * `a/b_c.ts` 与 `a_b/c.ts` 同键——恢复会把一份文件的内容写进另一份，
 * 而闸 5 的哈希比对随后才抛错，那时 `finally` 已经写进去了。
 * 先转义已有的 `_` 再换分隔符，映射即单射。
 */
const backupKey = (rel) => rel.replace(/_/g, '__').replace(/[\\/]/g, '_S_');

async function sha(file) {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

/**
 * 源文件 → **被测产物**路径（`src/a.ts` → `dist/test/src/a.js`）。
 *
 * 闸 4 要比的是它，不是源文件（代码双审 r2 AGY-01 ≡ CODEX-04）：
 * 源文件变了而产物没变的情形是真实存在的（文件没进 build 图、产物被缓存、
 * 构建静默降级），那时这道闸会判「变异生效」，而随后的「没红」会被归因成
 * 「守卫无效」——真因却是变异压根没进被测产物。
 */
function artifactOf(rel) {
  return path.join('dist/test', rel.replace(/\.ts$/, '.js'));
}

/**
 * 上次运行有没有异常退出（闸 3 的前半，代码双审 r2 CODEX-06）。
 *
 * ## 为什么不是 `git status --porcelain`
 *
 * CODEX-06 的建议字面是「对 targets 做 `git status --porcelain`，非空即拒」。
 * **照字面实现会误伤到不可用**：本装置的典型使用场景就是**一批尚未提交的改动**
 * （M9 第 3 步全程 19 个文件 M/??），那样它永远拒跑。实测确认过——
 * 第一版就是这么写的，第一次跑就拦住了自己。
 *
 * 它真正要防的是「**本装置上次异常退出留下的残留**」被当成干净基线，
 * 而那与「有没有未提交改动」是两回事。所以判据换成一个**装置自己的哨兵**：
 * 开跑时落一个标记，正常结束（含 `finally` 恢复完成）时删掉。
 * 下次开跑发现它还在 ⇒ 上次没善终 ⇒ 工作树可能带着变异 ⇒ 拒绝。
 *
 * 这比 git 判据更精确：它只对本装置的失败形态说话，不管人的提交习惯。
 */
const SENTINEL = path.join(ROOT, '.mutation-check-running');

async function staleRun() {
  try {
    return await fs.readFile(SENTINEL, 'utf8');
  } catch {
    return null;
  }
}

async function build() {
  // **绝不吞错**：构建失败要带着 stderr 抛出来（失败 2 就出在这里）
  try {
    await run('node', [path.join(ROOT, 'scripts/build.mjs'), '--with-tests'], { cwd: ROOT });
  } catch (e) {
    throw new Error(`构建失败，变异未生效——本次结果不可信：\n${e.stderr ?? e.message}`);
  }
}

/** 跑一组套件，返回失败数（`node --test` 失败时退出码非 0，这里只数 fail 行） */
async function runSuites(suites) {
  let out = '';
  try {
    const r = await run('node', ['--test', ...suites], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    out = r.stdout;
  } catch (e) {
    out = (e.stdout ?? '') + (e.stderr ?? '');
  }
  const m = /^ℹ fail (\d+)$/m.exec(out);
  if (!m) throw new Error(`读不出测试结果（套件路径写错了？）：\n${out.slice(-600)}`);
  return Number(m[1]);
}

async function main() {
  const specPath = process.argv[2];
  if (!specPath) {
    console.error('用法：node scripts/mutation-check.mjs <规格文件.json>');
    process.exit(64);
  }
  const spec = JSON.parse(await fs.readFile(specPath, 'utf8'));
  const bak = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-mut-'));

  const results = [];

  /*
   * ── 闸 6：`cases ⊆ targets`，拦在**任何工作树写盘之前** ──
   *
   * 「工作树」是限定语，不是修辞：临时备份目录（`bak`）的 `mkdtemp` 排在本闸之前，
   * 拒绝时即删（代码双审 r5 CODEX-02）。
   *
   * 不校验的话：变异照写 → 恢复时备份不存在抛 ENOENT → `finally` 只遍历 targets
   * ⇒ **变异留在工作树里**，而错误信息是裸 ENOENT、不提「树已脏」。
   * 「残留变异版被当成下一轮干净基线」恰是本装置要防的第二类失败——
   * 规格写错是本装置的第一类用户输入，这个入口此前不设防（三侧全中）。
   *
   * **r3 GLM-07：它必须在 `try` 之外。** 上一版拦在 try 内，于是 `finally` 照样对每个
   * target 从**空备份目录** `copyFile` ⇒ 逐条 ENOENT ⇒ 逐条打印「工作树可能已脏」，
   * 而工作树从未被碰过。装置在自己的告警上说了过头话，正是它要防的那个形状。
   */
  const missing = [...new Set(spec.cases.map((c) => c.file))].filter(
    (f) => !spec.targets.includes(f),
  );
  if (missing.length > 0) {
    console.error(
      `规格错误：这些 case 的 file 不在 targets 里，恢复面够不到它们：\n  ${missing.join('\n  ')}\n` +
        '  （在任何工作树写盘之前拦下——否则变异会留在工作树上）',
    );
    await fs.rm(bak, { recursive: true, force: true });
    process.exit(1);
  }

  /*
   * ── 闸 3 前半：上次运行必须善终过（r2 CODEX-06）──
   *
   * **r3 AGY-01 ≡ GLM-02 ≡ CODEX-01（三侧独立命中）：这道闸此前只生效一次。**
   * 上一版把 stale 检查放在 `try` 内，于是拒绝路径照常走 `finally`：
   * 恢复用的正是本次刚建的备份、必然成功 ⇒ `dirtyExit` 保持 false ⇒ 收尾
   * `if (!dirtyExit) rm(SENTINEL)` **把那个 stale 哨兵删掉**。而错误信息还在叮嘱
   * 操作者「确认工作树无误后删掉它再来」——文件已经被本轮删了，人还没核实。
   * 第二次开跑于是在可能带残留变异的树上静默开始，恰是这道闸要防的那件事。
   *
   * 两处结构性修正：
   *   1. **挪到 `try` 之前**——此时尚未写任何盘，本就无须恢复/重建，
   *      拒绝路径不再有任何清理面可走（gemini / glm 两侧给的同一个方向）；
   *   2. **独占创建**（`flag: 'wx'`）把「检查」与「写入」合成一个原子动作，
   *      顺带堵上 codex 指出的并发窗口：上一版是 check-then-write，
   *      两次并行开跑都能读到 null 并各自写成功，互相覆盖彼此的变异。
   *
   * 走到 `try` 就意味着**哨兵是本次创建的**，所以收尾删它无须再加归属判据。
   *
   * **M10a 第 4 步：拆成「只读预检 → 闸 7 → 独占创建」**（头注释「闸 7 与哨兵拆分」一节）。
   * 预检先于闸 7，残留变异才会被诊断成「上次没善终」而不是「规格写错」；
   * 独占创建原样保留，兜住预检与创建之间另一次开跑抢先的那一格。
   */
  const rejectStale = async () => {
    const stale = (await staleRun())?.trim() || '(哨兵内容读不出来)';
    console.error(
      `上一次运行没有善终，或另有一次正在跑（哨兵还在）：\n  ${stale}\n` +
        '  工作树可能带着上次的变异——基线全绿只能验出「**测得出的**」坏基线，\n' +
        '  而一个测不出来的残留（恰是那些判「没红」的）会让本轮所有结论\n' +
        '  都相对被污染过的基线算出，备份还会把污染一路带着。\n' +
        `  **哨兵已原样保留**（本轮不动它）。确认工作树无误后手动删掉\n` +
        `  ${path.relative(ROOT, SENTINEL)} 再来；若是并行开跑，等那一次跑完即可。`,
    );
    await fs.rm(bak, { recursive: true, force: true });
    process.exit(1);
  };

  if ((await staleRun()) !== null) await rejectStale();

  /*
   * ── 闸 7：每条 find 在目标文件中恰好命中一处，拦在**任何工作树写盘之前** ──
   *
   * 数的是基线文件：每条 case 跑完都由闸 5 恢复到基线，所以「跑前唯一」在一次运行内不会失效。
   * 零处与多处都拦，并逐条报出命中数——报一条「不唯一」而不给数，排查时还得自己再数一遍。
   */
  const badFind = [];
  for (const c of spec.cases) {
    const text = await fs.readFile(path.join(ROOT, c.file), 'utf8').catch(() => null);
    if (text === null) {
      badFind.push(`${c.id}（${c.file}）：目标文件读不出来`);
      continue;
    }
    const hits = typeof c.find === 'string' && c.find !== '' ? text.split(c.find).length - 1 : 0;
    if (hits !== 1) badFind.push(`${c.id}（${c.file}）：find 命中 ${hits} 处`);
  }
  if (badFind.length > 0) {
    console.error(
      `规格错误：这些 case 的 find 串在目标文件中不是恰好命中一处：\n  ${badFind.join('\n  ')}\n` +
        '  装置只替换首处：多处命中时变异会落在第一处，未必是你要改的那一处，而结果照样报「咬住」；\n' +
        '  零处命中则这条变异根本不生效。给 find 补足区分上下文后再来。\n' +
        '  （在任何工作树写盘之前拦下，工作树未被碰过）',
    );
    await fs.rm(bak, { recursive: true, force: true });
    process.exit(1);
  }

  try {
    await fs.writeFile(
      SENTINEL,
      `started_at=${new Date().toISOString()}\nspec=${specPath}\npid=${process.pid}\n`,
      { flag: 'wx' },
    );
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    await rejectStale();
  }

  /** 收尾重建失败时置位——绝不静默吞（GLM-05） */
  let dirtyExit = false;
  /** 实际备份成功的 target（恢复面只覆盖它们，r3 GLM-07） */
  const backedUp = [];
  try {
    // ── 闸 1：备份按全路径命名 ──
    for (const rel of spec.targets) {
      await fs.copyFile(path.join(ROOT, rel), path.join(bak, backupKey(rel)));
      backedUp.push(rel);
    }
    const baseHash = {};
    const baseArt = {};
    for (const rel of spec.targets) baseHash[rel] = await sha(path.join(ROOT, rel));

    // ── 闸 3 后半：基线全绿 ──
    await build();
    const baseFail = await runSuites(spec.suites);
    if (baseFail !== 0) {
      throw new Error(
        `基线不是全绿（fail=${baseFail}）——拒绝开跑。\n` +
          '  坏基线下每条变异都会「红」，而那与「变异被咬住」不是一回事：\n' +
          '  M9 第 3 步第二次事故正是这个形态。先把基线修绿再来。',
      );
    }
    // 基线产物哈希要在**构建之后**取（闸 4 拿它作比较基准）
    for (const rel of spec.targets) {
      baseArt[rel] = await sha(path.join(ROOT, artifactOf(rel))).catch(() => null);
    }
    console.error(`✓ 工作树干净、基线全绿（${spec.suites.length} 个套件）`);

    for (const c of spec.cases) {
      const abs = path.join(ROOT, c.file);
      const before = await fs.readFile(abs, 'utf8');
      // 命中数已由闸 7 在开跑前保证恰为 1（原先这里的「未命中」软判定随之删除：留着就是一段
      // 永不执行、却读起来像有效防线的代码）
      await fs.writeFile(abs, before.replace(c.find, c.replace), 'utf8');

      // ── 闸 4：断言**被测产物**确实变了 ──
      await build();
      const art = path.join(ROOT, artifactOf(c.file));
      const nowArt = await sha(art).catch(() => null);
      if (nowArt === null) {
        results.push({ id: c.id, desc: c.desc, verdict: `✖ 找不到被测产物 ${artifactOf(c.file)}——无法证明变异进了产物` });
      } else if (nowArt === baseArt[c.file]) {
        results.push({
          id: c.id,
          desc: c.desc,
          verdict: '✖ **产物哈希未变**——变异没进被测产物（no-op / 未进 build 图 / 构建降级）',
        });
      } else {
        const fail = await runSuites(c.expect ? [c.expect] : spec.suites);
        results.push({
          id: c.id,
          desc: c.desc,
          verdict: fail > 0 ? `✓ 咬住（fail=${fail}）` : '✖ **没红**——该守卫对这条变异无效',
          fail,
        });
      }

      // ── 闸 5：恢复并逐字节比对 ──
      await fs.copyFile(path.join(bak, backupKey(c.file)), abs);
      if ((await sha(abs)) !== baseHash[c.file]) {
        throw new Error(`恢复 ${c.file} 后哈希与基线不符——工作树已脏，停下来人工处理`);
      }
      console.error(`  ${c.id} ${results.at(-1).verdict}`);
    }
  } finally {
    /*
     * 原子清理：异常/中断退出时也把文件恢复回去（AGY-03）。
     * **恢复失败要说出来**——上一版是 `.catch(() => {})`，于是中途异常时工作树
     * 可能带着变异退出，而外层打印的是原始错误、不提树已脏（GLM-05）。
     */
    for (const rel of backedUp) {
      try {
        await fs.copyFile(path.join(bak, backupKey(rel)), path.join(ROOT, rel));
      } catch (e) {
        dirtyExit = true;
        console.error(`✖ 恢复 ${rel} 失败：${e.message}——**工作树可能已脏，下一轮基线不可信**`);
      }
    }
    await fs.rm(bak, { recursive: true, force: true });
    /*
     * 收尾重建同样**不吞**：上一版是 `.catch(() => {})`，于是全部 case 咬住时
     * 会退 0 而 dist 停在陈旧产物上——下一个人直接 `node --test dist/…`
     * 跑的又是旧产物，正是闸 2 声称「绝不」放过的失败 2，只是挪到了收尾。
     */
    try {
      await build();
    } catch (e) {
      dirtyExit = true;
      console.error(`✖ 收尾重建失败：${e.message}——**dist 停在陈旧产物上**`);
    }
    /*
     * **哨兵只在善终时删**：恢复或重建出过错就留着它，
     * 下次开跑会被闸 3 前半拦下并说明原因。
     *
     * 走到这个 `finally` 就意味着哨兵是**本次**独占创建的（闸 3 前半在 `try` 之外，
     * 拒绝路径根本进不来），所以这里不必再判归属——r3 那个自解除 bug 的修法
     * 是**把拒绝路径挪出清理面**，不是给清理面加判据。
     */
    if (!dirtyExit) await fs.rm(SENTINEL, { force: true });
  }

  const bad = results.filter((r) => r.verdict.startsWith('✖'));
  console.log(JSON.stringify({ 总数: results.length, 咬住: results.length - bad.length, 逐条: results }, null, 2));
  if (bad.length > 0 || dirtyExit) process.exit(1);
}

main().catch((e) => {
  console.error(e.stack ?? String(e));
  process.exit(1);
});
