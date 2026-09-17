/**
 * codex 的运行隔离：独立 `CODEX_HOME` **与** 独立 `HOME`（设计 §3.6，BACKLOG EV-08）。
 *
 * ## 为什么必须双覆盖
 *
 * M6 第 4 步三条臂实测：`~/.agents/skills` 这个指令根**随 `HOME` 派生**，
 * 不随 `CODEX_HOME`。只隔离后者，宿主机上任意第三方 skill 的描述都会进入
 * 审查会话的 developer 消息——沙箱只读挡得住**写**，挡不住**指令注入**。
 *
 * ## 本步实测补出的两条（M6 没覆盖到，各自都能让方案不成立）
 *
 * **① 配置里的 `~` 跟 `HOME` 走。** 本机 `config.toml` 写着
 * `model_catalog_json = "~/.codex/models-qwen.json"`，隔离 `HOME` 之后它指向
 * fakehome 下不存在的文件，codex 直接 `Error: No such file or directory` 退出。
 * 只隔离 `CODEX_HOME` 反而正常——所以 M6 第 4 步的 B 臂恰好错过了它。
 *
 * **② 不裁剪就等于把宿主机的执行通道带进来。** 真实环境的模型可见输入里有
 * `mcp_servers.node_repl`（一个 JS REPL）、十余个 plugins、6 个 skill 根、
 * 约 25 份第三方 skill 描述（含「代码提交、推送」「浏览器自动化、发帖、登录网站」）。
 * MCP server 是独立进程通道，`-s read-only` 管的是模型生成的 shell 命令，管不到它。
 *
 * 两条的处置**合在一起才成立**：只裁剪不重写路径 ⇒ ① 退出；只重写不裁剪 ⇒ ② 泄漏。
 * 实测（裁剪 + 重写 + 双覆盖）后 skill roots 只剩副本自带的 `.system` 一个，
 * 第三方 skill 与 MCP 全部消失，模型可见输入从数倍长降到 17 KB。
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { ensureDir, exists } from '../util/fsx.js';
import { scanAndRemoveSecrets } from '../scrub.js';
import type { CarrierScrub } from './base.js';

/**
 * 副本 `config.toml` 保留的顶层键。
 *
 * **白名单而不是黑名单**：漏掉一个该剥的段会静默泄漏一条能力通道（不可见），
 * 漏掉一个该留的键只会让功能不可用（可见）。安全取向上二者不对称。
 *
 * 代价如实登记：新版本 codex 若把模型相关配置挪进新段，副本会**丢功能**。
 * 这就是下面 `strippedKeys` 存在的理由——丢了什么要说得出来，
 * 不能让「静默丢功能」成为白名单的隐性成本（计划双审 GLM-07）。
 */
const KEEP_TOP_KEYS: ReadonlySet<string> = new Set([
  'model',
  'model_provider',
  'model_reasoning_effort',
  'model_catalog_json',
]);

/** 保留的段前缀：provider 定义必须留，否则没有 base_url 与凭据 */
const KEEP_SECTION_PREFIX = '[model_providers';

export interface CodexHomePrep {
  /** 独立 `CODEX_HOME` */
  codexHome: string;
  /** 独立 `HOME`（空目录，斩断 `~/.agents/skills` 这条指令根） */
  fakeHome: string;
  /** 被剥掉的键与段，逐条留痕 */
  strippedKeys: string[];
  /** 被重写的 `~/` 路径，逐条留痕（`原值 → 新值` 或 `原值 → 跳过（原因）`） */
  rewrittenPaths: string[];
  /** 拷进副本的文件名清单——J9 的扫描面按这份清单算，不按形态枚举 */
  copiedFiles: string[];
  /** 准备过程中的非致命问题（人读） */
  warnings: string[];
}

/** `$CODEX_HOME`，未设时回落官方默认 */
export function codexHomeOf(env: NodeJS.ProcessEnv = process.env): string {
  return env['CODEX_HOME'] ?? path.join(os.homedir(), '.codex');
}

/** 副本 `CODEX_HOME` 在该侧运行目录下的位置——准备与抹除共用同一个拼法 */
export const codexHomeUnder = (runDir: string): string => path.join(runDir, 'codexhome');

/**
 * 模型 I/O 日志：生效模型的回读来源（`codex-trace.ts` 的 `findSessionFile`）、逐字含送审包全文。
 * 命中**不删、就地脱敏**——删了丢回读来源与排障证据，夹具密钥又会让它误命中（代码双审 r1 CODEX-05）。
 */
const REDACT_AFTER_RUN: readonly string[] = ['sessions'];
/** 厂商缓存：插件目录（实测 21 MB）、插件本体。编排器与排障都不需要，不扫 */
const SKIP_AFTER_RUN: readonly string[] = ['cache', 'plugins'];

/** 副本里的凭据载体：`prepareCodexHome` 写进去的那几份，按名认 */
const isCredentialCarrier = (name: string): boolean =>
  name === 'config.toml' || name.endsWith('.config.toml') || name === 'auth.json';

/**
 * 抹掉副本里的凭据（BACKLOG EV-20）。
 *
 * 三份载体**整份删除**：`config.toml`、`<profile>.config.toml`、`auth.json`——跑后没有任何
 * 代码回读它们（唯一被回读的是 `sessions/`），而「脱敏保留骨架」要维护一份「哪些键是凭据」
 * 的黑名单，漏一个键就是静默残留，正是上面 `KEEP_TOP_KEYS` 选白名单的同一个理由。
 * 其余普通文件（`models-*.json` 副本、`fakehome/` 里 codex 可能写的东西）过一遍扫描器，
 * 命中即删。`sessions/` 排除：它含送审包全文，扫描器对被审代码里的夹具密钥有误报面。
 *
 * 幂等：文件不在就跳过。目录不存在返回空结果，不抛。
 */
export async function scrubCodexHome(codexHome: string, opts: { sizeCap?: number } = {}): Promise<CarrierScrub> {
  const out: CarrierScrub = { deleted: [], scanned: 0, removedOnHit: [], redacted: {}, warnings: [], skipped: 0, errors: [] };
  if (!(await exists(codexHome))) return out;
  const dirName = path.basename(codexHome);
  let names: string[];
  try {
    names = await fs.readdir(codexHome);
  } catch (e) {
    out.errors.push(`读副本目录失败：${(e as Error).message}`);
    return out;
  }
  for (const name of names) {
    if (!isCredentialCarrier(name)) continue;
    try {
      await fs.rm(path.join(codexHome, name), { force: true });
      out.deleted.push(path.join(dirName, name));
    } catch (e) {
      out.errors.push(`删不掉 ${name}：${(e as Error).message}`);
    }
  }
  const scan = await scanAndRemoveSecrets(codexHome, {
    exclude: SKIP_AFTER_RUN, redactUnder: REDACT_AFTER_RUN, sizeCap: opts.sizeCap,
  });
  out.scanned = scan.scanned;
  out.removedOnHit = scan.removed.map((p) => path.join(dirName, p));
  for (const [rel, n] of Object.entries(scan.redacted)) out.redacted[path.join(dirName, rel)] = n;
  out.warnings.push(...scan.warnings);
  out.skipped = scan.skipped;
  out.errors.push(...scan.errors);
  return out;
}

/**
 * 按白名单裁剪一份 TOML。
 *
 * **按行处理而不是解析 TOML**：本项目只依赖 ajv 与 yaml，没有 TOML 解析库
 * （计划双审 AGY-02），而打包产物必须是单文件。半吊子的解析比不解析更危险，
 * 所以这里只做一件有明确边界的事——识别段头与顶层键，其余原样搬运或剥除。
 */
export function trimCodexToml(text: string): { kept: string; stripped: string[] } {
  const stripped: string[] = [];
  const out: string[] = [];
  let inKeptSection = false;
  let sawSection = false;

  for (const line of text.split('\n')) {
    const s = line.trim();
    if (s.startsWith('[')) {
      sawSection = true;
      inKeptSection = s.startsWith(KEEP_SECTION_PREFIX);
      if (inKeptSection) out.push(line);
      else stripped.push(s);
      continue;
    }
    if (!sawSection) {
      // 段头之前的都是顶层键
      if (s === '' || s.startsWith('#')) continue;
      const key = s.split('=')[0]?.trim() ?? '';
      if (KEEP_TOP_KEYS.has(key)) out.push(line);
      else if (key) stripped.push(key);
      continue;
    }
    if (inKeptSection) out.push(line);
  }
  return { kept: `${out.join('\n').trim()}\n`, stripped };
}

/** 一行 TOML 里的 `键 = "~/…"` 形态。只认**字符串标量** */
const HOME_VALUE_RE = /^(\s*[\w.\-]+\s*=\s*)(["'])(~\/.+?)\2(.*)$/;

/**
 * 重写副本里的 `~/` 路径，并把指向的文件拷进副本。
 *
 * **只作用于裁剪后的幸存键**（顺序由 `prepareCodexHome` 保证）：
 * 先重写再裁剪会把 `notify` 这类已剥段指向的文件也拷进来，白扩敏感面
 * （计划双审 GLM-08）。
 *
 * 非标量值（数组、内联表、多行字符串）**不处理并留痕**——它们要真正的 TOML
 * 解析才能安全改写，而本模块刻意不做解析。
 */
export async function rewriteHomePaths(
  file: string,
  destDir: string,
): Promise<{ rewritten: string[]; copied: string[]; warnings: string[] }> {
  const rewritten: string[] = [];
  const copied: string[] = [];
  const warnings: string[] = [];

  const text = await fs.readFile(file, 'utf8');
  const out: string[] = [];

  for (const line of text.split('\n')) {
    const m = HOME_VALUE_RE.exec(line);
    if (!m) {
      // 非标量但含 ~/ 的值：留痕，不猜
      if (/=\s*[[{].*~\//.test(line)) {
        const key = line.split('=')[0]?.trim() ?? '(未知键)';
        warnings.push(`${key}：值含 ~/ 但不是字符串标量，未重写（隔离下可能失效）`);
      }
      out.push(line);
      continue;
    }

    const raw = m[3]!;
    const src = path.join(os.homedir(), raw.slice(2));
    let stat: Awaited<ReturnType<typeof fs.stat>> | null = null;
    try {
      stat = await fs.stat(src);
    } catch {
      stat = null;
    }

    if (!stat) {
      out.push(line);
      rewritten.push(`${raw} → 跳过（目标不存在）`);
      continue;
    }
    if (!stat.isFile()) {
      out.push(line);
      rewritten.push(`${raw} → 跳过（目标不是普通文件）`);
      continue;
    }

    const base = path.basename(src);
    const dst = path.join(destDir, base);
    await fs.copyFile(src, dst);
    await fs.chmod(dst, 0o600);
    copied.push(base);
    out.push(`${m[1]}"${dst}"${m[4]}`);
    rewritten.push(`${raw} → ${dst}`);
  }

  await fs.writeFile(file, out.join('\n'), 'utf8');
  await fs.chmod(file, 0o600);
  return { rewritten, copied, warnings };
}

/**
 * 为一次运行准备隔离的 `CODEX_HOME` + `HOME`。
 *
 * 顺序**写死为「裁剪 → 重写 → 拷贝」**，理由见 `rewriteHomePaths`。
 *
 * `[projects.*]` 段随裁剪一并剥掉，再按当次 `projectRoot` 重新生成一条——
 * 抄宿主机整张信任表等于把「这台机器信任过哪些目录」带进审查会话。
 * 本步实测：副本里连信任记录都没有时，非交互下也不会要求信任目录，
 * 所以这一条是**保险而非必需**，写它是为了不依赖那个观察在未来版本继续成立。
 */
export async function prepareCodexHome(
  runDir: string,
  opts: { profile: string | null; projectRoot: string; sourceHome?: string },
): Promise<CodexHomePrep> {
  const src = opts.sourceHome ?? codexHomeOf();
  const codexHome = codexHomeUnder(runDir);
  const fakeHome = path.join(codexHome, 'fakehome');
  await ensureDir(codexHome);
  await ensureDir(fakeHome);

  const prep: CodexHomePrep = {
    codexHome, fakeHome, strippedKeys: [], rewrittenPaths: [], copiedFiles: [], warnings: [],
  };

  // ① 裁剪：基底 config.toml 与本次 profile 的分层文件
  const tomls = ['config.toml', ...(opts.profile ? [`${opts.profile}.config.toml`] : [])];
  for (const name of tomls) {
    const from = path.join(src, name);
    if (!(await exists(from))) {
      if (name !== 'config.toml') {
        prep.warnings.push(`profile 文件 ${name} 不存在于 ${src}——该 profile 可能未配置`);
      }
      continue;
    }
    const { kept, stripped } = trimCodexToml(await fs.readFile(from, 'utf8'));
    const to = path.join(codexHome, name);
    await fs.writeFile(to, kept, 'utf8');
    await fs.chmod(to, 0o600);
    prep.strippedKeys.push(...stripped.map((k) => `${name}:${k}`));
  }

  // ② 重写 + ③ 拷贝（只作用于幸存键）
  for (const name of tomls) {
    const f = path.join(codexHome, name);
    if (!(await exists(f))) continue;
    const r = await rewriteHomePaths(f, codexHome);
    prep.rewrittenPaths.push(...r.rewritten);
    prep.copiedFiles.push(...r.copied);
    prep.warnings.push(...r.warnings);
  }

  // 凭据：auth.json 原样拷入并收紧权限
  const auth = path.join(src, 'auth.json');
  if (await exists(auth)) {
    const to = path.join(codexHome, 'auth.json');
    await fs.copyFile(auth, to);
    await fs.chmod(to, 0o600);
    prep.copiedFiles.push('auth.json');
  } else {
    prep.warnings.push(`未找到 ${auth}——该侧可能无法通过鉴权`);
  }

  // 按当次项目根重建信任记录（不抄宿主机整张表）
  const base = path.join(codexHome, 'config.toml');
  if (await exists(base)) {
    const trust = `\n[projects."${opts.projectRoot}"]\ntrust_level = "trusted"\n`;
    await fs.appendFile(base, trust, 'utf8');
  }

  prep.copiedFiles = [...new Set(prep.copiedFiles)];
  return prep;
}
