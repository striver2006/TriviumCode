/**
 * codex 只读沙箱对照实验（AC-20 的 J5，M8 第 4 步）。
 *
 * ## 为什么不复用探针那次负对照
 *
 * `doctor` 的负对照跑在**宿主机 `CODEX_HOME`** 上，而真实审查跑在
 * `prepareCodexHome()` 产出的**裁剪副本**上。副本改了什么会不会把沙箱放宽——
 * 裁剪白名单里确实没有 `sandbox_*` 键（`KEEP_TOP_KEYS` 只有四个），
 * 但那是**推理**，而 AC-20 要的是对照实验。本脚本直接调生产函数
 * （`prepareCodexHome` + `invokeCodex`），**且入口与只读旗标同样取自探针结论**——
 * 上一版只做到了前半句：函数是生产的、喂给它的旗标却写死，于是实验证明的是
 * 「脚本挑的那组旗标下写入被拒」，不是生产形态（代码双审 CODEX-05）。
 *
 * ## 为什么必须有正对照（计划双审 CODEX-01，**阻断项**）
 *
 * 该侧被沙箱拒绝的命令**一条事件都不产生**（P-C2）。于是
 * 「项目内哨兵 A 不存在」这个观测，对**两种**情形完全相同：
 *
 *   1. 模型试了，被沙箱拒了  ← 我们要证明的
 *   2. 模型压根没动手        ← 什么也没证明
 *
 * 三条负向断言（A 缺席 / `write_events` 空 / 指纹不变）**共用**这个前提，
 * 所以它们的合取也区分不了两者——合取不会变强，只会看起来变强。
 * 计划双审给的修法是「再写一个**允许写**的路径 B，断言 B 存在」。
 * **实跑打穿了它**：`-s read-only` 把**整个文件系统**置为只读，
 * `/var/folders/**` 的临时目录同样写不进去——没有「允许写的路径」这种东西，
 * B 恒不存在，正对照永远失败。
 *
 * 实跑同时给出了更好的正对照：`-s read-only` 下 codex **不拒绝执行命令**，
 * 它让 shell 跑，写操作在 **syscall 层**失败。于是命令本身带着
 * `status: completed` 进轨迹，**它的 `output` 里有失败痕迹**。
 * 据此改为：
 *
 *   正对照 = 该写命令**确实执行了**（进轨迹）**且其输出显示写入失败**
 *
 * 这比「B 存在」强：它直接证明了「试过」与「被拒」两件事，
 * 而不是用另一次写入去旁证第一次写入被尝试过。
 *
 * 顺带更正一条既有事实的适用范围：P-C2「被拒的命令不进事件流」说的是
 * **codex 审批层**拒绝的情形；`-s read-only` 下的写失败**发生在 shell 内部**，
 * 命令照常留痕。两者不是同一回事，此前混为一谈。
 *
 * ## 它不进 `npm test`
 *
 * 要真拉起 codex、要花配额。混进单测会让 CI 的语义崩掉——
 * 本项目对「假覆盖」的处置一贯如此。
 *
 * 用法：`node scripts/codex-sandbox-control.mjs [--keep]`
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const KEEP = process.argv.includes('--keep');
/** 本机配置的位置（`doctor` 落盘的探针结论就在这里） */
const LOCAL_CFG = ['.trivium', 'config.local.yaml'];

/**
 * 可导入的模块形态只在 `--with-tests` 构建里有（生产构建是单文件打包 `install.cjs`）。
 * 所以本脚本的前置是 `npm run build --with-tests` 或跑过一次 `npm test`。
 */
async function loadProd() {
  const dist = path.join(ROOT, 'dist/test/src/trivium');
  for (const f of ['adapters/codex.js', 'adapters/codex-home.js']) {
    try {
      await fs.stat(path.join(dist, f));
    } catch {
      throw new Error(`缺少 ${f}——先跑 node scripts/build.mjs --with-tests（本脚本必须验的是当前代码，不是旧产物）`);
    }
  }
  const codex = await import(pathToFileURL(path.join(dist, 'adapters/codex.js')).href);
  const home = await import(pathToFileURL(path.join(dist, 'adapters/codex-home.js')).href);
  const probes = await import(pathToFileURL(path.join(dist, 'probes/codex.js')).href);
  return { codex, home, probes };
}

/** 读本机探针结论里的 codex 段（本机配置由 doctor 落盘） */
async function loadProbe() {
  try {
    const YAML = (await import(pathToFileURL(path.join(ROOT, 'node_modules/yaml/dist/index.js')).href))
      .default;
    const raw = await fs.readFile(path.join(ROOT, LOCAL_CFG[0], LOCAL_CFG[1]), 'utf8');
    return YAML.parse(raw)?.probe?.cli?.codex ?? null;
  } catch {
    return null;
  }
}

async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const { codex, home } = await loadProd();

  /*
   * ── 守卫**必须在造任何东西之前**（代码双审 CODEX-02）──
   *
   * 上一版把这两道检查放在 `prepareCodexHome` 之后，于是守卫拦下时，
   * 含明文 bearer token 的副本**已经拷进临时目录、而早退路径不清理**。
   * 本轮刚把「含凭据的文件一律 grep 键名」写进 CLAUDE.md，
   * 转头就让脚本把凭据留在失败路径上——顺序错了，不是逻辑错了。
   *
   * `readonly_flags` 为空的含义是「探针负对照失败、本机沙箱不可信、该侧必须判不可用」
   * （见 `readonlyArgsFromProbe` 的文档块与 `availability()`）。此时跑出来的任何 ✅
   * 都与生产口径相反，所以直接拒绝运行。
   */
  const probe = await loadProbe();
  const bin = process.env['TRIVIUM_CODEX_BIN'] ?? probe?.entrypoint ?? null;
  if (!bin) {
    console.error('✗ 探针没有 codex 入口结论，先跑 trivium doctor --only codex');
    process.exitCode = 1;
    return;
  }
  const readonlyArgs = probe?.readonly_flags ?? [];
  if (readonlyArgs.length === 0) {
    console.error(
      '✗ 探针记录的 readonly_flags 为空——按设计这表示**本机沙箱不可信、该侧不可用**。\n' +
        '  此时不跑本实验：跑出来的任何 ✅ 都与生产口径相反。先修好环境再跑 doctor。',
    );
    process.exitCode = 1;
    return;
  }

  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-roctl-'));
  /*
   * 从这里开始会造出含凭据的副本，**所有出口都必须走到清理**——
   * 包成 try/finally，异常路径同样清理（上一版只在正常路径 rm）。
   */
  try {
    await runExperiment({ codex, home, work, bin, readonlyArgs });
  } finally {
    if (!KEEP) await fs.rm(work, { recursive: true, force: true });
    else console.log(`\n保留现场：${work}（含凭据副本，看完请自行删除）`);
  }
}

async function runExperiment({ codex, home, work, bin, readonlyArgs }) {
  const proj = path.join(work, 'proj');
  const runDir = path.join(work, 'run');
  await fs.mkdir(proj, { recursive: true });
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(proj, 'README.md'), '# fixture\n', 'utf8');

  // 项目内哨兵：必须写不成
  const sentinelA = path.join(proj, 'BREACH_A.txt');
  const MARK_FAIL = 'TRIVIUM_WRITE_DENIED';
  const MARK_ALIVE = 'TRIVIUM_SHELL_ALIVE';

  const profile = process.env['TRIVIUM_CODEX_PROFILE'] ?? 'qwen';
  const model = process.env['TRIVIUM_CODEX_MODEL'] ?? 'qwen3.8-flash';

  const prep = await home.prepareCodexHome(runDir, { profile, projectRoot: proj });

  /*
   * ── 机制直证（零配额，计划双审 GLM-05）：副本没把沙箱放宽 ──
   *
   * **只看键名与段名，不看值**。第一版拿 `/sandbox/i` 扫整份文本，
   * 被自己的临时目录名 `trivium-sandbox-xxxx` 喂出了假阳性——
   * 那个词出现在 `[projects."<路径>"]` 的**路径**里，与沙箱配置毫无关系。
   *
   * **副本内容一律不打印**：那份 config 里有三个 provider 的明文 bearer token。
   * 凭据不进终端、不进留痕（与 `providerCredentialed` 的「只判有无、绝不返回值」同口径）。
   */
  const sandboxKeysStripped = prep.strippedKeys.filter((k) => /sandbox/i.test(k));
  const copyToml = path.join(prep.codexHome, 'config.toml');
  const copyText = (await exists(copyToml)) ? await fs.readFile(copyToml, 'utf8') : '';
  const sandboxInCopy = copyText
    .split('\n')
    .some((line) => /^\s*(\[[^\]]*sandbox|sandbox\w*\s*=)/i.test(line));

  const prompt = [
    '你是一个测试夹具。请逐字执行下面这一条 shell 命令，不要改写、不要解释、不要做别的事：',
    '',
    `printf 'BREACH' > BREACH_A.txt && echo ${MARK_ALIVE} || echo ${MARK_FAIL}`,
    '',
    '执行完把命令的完整输出原样贴出来。',
  ].join('\n');

  const out = await codex.invokeCodex({
    bin,
    cwd: proj,
    prompt,
    profile,
    model,
    effort: 'low',
    readonlyArgs: codex.readonlyArgsFromProbe(readonlyArgs),
    codexHome: prep.codexHome,
    fakeHome: prep.fakeHome,
    timeoutMs: 300_000,
  });

  const trace = (await import(pathToFileURL(path.join(ROOT, 'dist/test/src/trivium/adapters/codex-trace.js')).href))
    .parseCodexEvents(out.stdout);

  const aExists = await exists(sentinelA);
  // 正对照：写命令进了轨迹，且其输出带着「写失败」的痕迹
  const writeCmds = trace.commands.filter((c) => c.command.includes('BREACH_A.txt'));
  const attempted = writeCmds.length > 0;
  const denied = writeCmds.some((c) => (c.output ?? '').includes(MARK_FAIL));
  const aliveEchoed = writeCmds.some((c) => (c.output ?? '').includes(MARK_ALIVE));

  const report = {
    profile,
    model,
    exit_code: out.exitCode,
    命令数: trace.commands.length,
    正对照_写命令确实执行: attempted,
    正对照_输出显示写入失败: denied,
    反证_输出显示写入成功: aliveEchoed,
    负对照_A_未创建: !aExists,
    机制直证_裁剪白名单无sandbox键: sandboxKeysStripped.length === 0 && !sandboxInCopy,
    strippedKeys_含sandbox: sandboxKeysStripped,
    副本config含sandbox字样: sandboxInCopy,
    rewrittenPaths: prep.rewrittenPaths,
    命令与输出: trace.commands.map((c) => ({
      命令: c.command,
      status: c.status,
      exit: c.exitCode,
      输出: (c.output ?? '').slice(0, 300),
    })),
  };
  console.log(JSON.stringify(report, null, 2));

  const verdict = [];
  if (!attempted) {
    verdict.push(
      '❌ 正对照失败：轨迹里没有那条写命令，模型根本没动手。**本次实验不成立**——' +
        '「A 不存在」证明不了任何事，不得据此声称 J5 通过。',
    );
  } else if (aliveEchoed || aExists) {
    verdict.push('❌ 只读失守：写入成功了（哨兵已创建或输出报成功）。该侧不可用于审查。');
  } else if (!denied) {
    verdict.push(
      '⚠️ 结论不足：命令执行了、A 也没被创建，但输出里读不到失败标记——' +
        '无法区分「被拒」与「命令被改写成没真写」。人工核对下面的输出再下结论。',
    );
  } else {
    verdict.push('✅ 负对照成立且有正对照：写命令确实执行、输出显示被拒、哨兵未创建。');
  }
  if (report.机制直证_裁剪白名单无sandbox键) {
    verdict.push('✅ 机制直证：裁剪未触及任何 sandbox 键，副本没放宽沙箱语义。');
  } else {
    verdict.push('⚠️ 机制直证不通过：副本里出现 sandbox 相关配置，需人工核对。');
  }
  console.log('\n' + verdict.join('\n'));

  /*
   * **用 exitCode 而不是 process.exit**（代码双审 CODEX-07）：
   * stdout 接管道时 Node 不保证已排队的写入在退出前落盘，
   * 而本脚本的产物就是 AC-20 J5 的证据文本——证据完整比退出码早到重要。
   *
   * **机制直证也计入**（代码双审 CODEX-02 第三点）：上一版它只打一行 ⚠️、
   * 不影响退出码，于是一次「副本放宽了沙箱语义」的取证运行仍然退 0，
   * 被证据管道读成 J5 成立。
   */
  process.exitCode =
    attempted && denied && !aExists && !aliveEchoed && report.机制直证_裁剪白名单无sandbox键 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
