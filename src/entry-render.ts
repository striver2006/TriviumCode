/**
 * 入口资产单源渲染（M10b 第 2 步；演进设计 §10.2，计划 r5 §5.1 / r9 §2 / r10 §2.4、§3.1.3）。
 *
 * 源在 `skills-src/`：
 *
 *   commands/<命令>.contract.md   命令契约：front-matter（产物 front-matter 与 `@` 开头的模板变量）+ 正文模板
 *   carriers/<agent>.yaml         四家载体适配层：产物落点、front-matter 键、参数写法
 *                                 （调用写法 M10b 第 3 步已迁注册表 `entryInvocation`，yaml 里再写即报错）
 *   partials/**.md                正文片段：B/C/D 共用正文、参数转抄规约、护栏注入段
 *
 * 产物：
 *
 *   layout: top    → skills/<命令名>/SKILL.md                       （claude：安装器同步到 ~/.claude/skills）
 *   layout: entry  → skills/dual-critic/entry/<agent>/<命令名>/SKILL.md （另三家：安装时拍平到各自目标根）
 *
 * 产物**进 Git**：安装器只搬运、不渲染（与 `trivium.cjs` 需先 build 同理，但产物是人要读的文本）。
 * `entry-render-parity` 契约测试守「源 → 产物」零 diff；改源后跑 `npm run render` 重写产物。
 *
 * ## 模板语法（刻意做小）
 *
 *   {{VAR}}            模板变量：契约 `@VAR`、载体派生量（`DRIVER` / `ARG_MODE` / `ARGS` …）
 *   {{fm:key}}         本命令 front-matter 的取值
 *   {{cmd:dual-xxx}}   按本载体的调用写法渲染一条命令（claude `/dual-xxx`、codex `$dual-xxx` …）
 *   {{> 片段}}          嵌入 `partials/片段.md`（去掉末尾一个换行）
 *   {{> 片段@VAR}}      嵌入 `partials/片段.<VAR 的取值>.md`——按载体或按命令选变体
 *
 * 片段标签**独占一行**时按「独立行」处理：渲染为空就连同这一行、以及紧随其后的一个空行一起去掉
 * （命令 C 没有认领步骤，`{{> review/claim@SUBJECT_KIND}}` 渲染为空，不能在正文里留下两个空行）。
 *
 * 变量取值与片段本身也按同一语法渲染。**未知变量、缺失片段一律抛错**：
 * 静默留空会让产物少一段而契约测试照绿（本仓记过多次「论域塌成空集」）。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import YAML from 'yaml';
import {
  AGENTS, CRITIC_AGENT_IDS, agentById, guardProfileOf, isAgentId, type AgentId,
} from './trivium/agents/registry.js';
import { vendorProfileAgents } from './trivium/tier-flags.js';

/** 源目录（相对仓库根） */
export const ENTRY_SRC_DIR = 'skills-src';
/** 另三家产物的仓库内落点（相对仓库根）；安装时拍平，不整树搬运（r9 §2.1） */
export const ENTRY_OUT_DIR = 'skills/dual-critic/entry';

export type ArgumentMode = 'substitute' | 'transcribe' | 'native-tail';

export interface Carrier {
  agent: AgentId;
  layout: 'top' | 'entry';
  /** 产物 front-matter 输出的键；按契约书写顺序输出，不在此列的丢弃 */
  frontmatter: readonly string[];
  arguments: ArgumentMode;
  /** 调用入口 skill 的写法，`{name}` 换成命令名 */
  invocation: string;
}

export interface Contract {
  /** 文件名去掉 `.contract.md`，如 `review-plan` */
  id: string;
  /** 产物目录名与 skill 名，如 `dual-review-plan` */
  name: string;
  frontmatter: readonly (readonly [string, string])[];
  vars: Readonly<Record<string, string>>;
  body: string;
}

export interface RenderedEntry {
  agent: AgentId;
  layout: Carrier['layout'];
  command: string;
  name: string;
  /** 相对仓库根，POSIX 分隔 */
  relPath: string;
  content: string;
}

export interface EntrySources {
  carriers: readonly Carrier[];
  contracts: readonly Contract[];
  partials: ReadonlyMap<string, string>;
}

// ─────────────────────── 读源 ───────────────────────

async function readDirSorted(dir: string): Promise<string[]> {
  return (await fs.readdir(dir)).sort();
}

function parseCarrier(file: string, raw: string): Carrier {
  const doc = YAML.parse(raw) as Record<string, unknown> | null;
  const fail = (why: string): never => {
    throw new Error(`载体适配层 ${file} 不合法：${why}`);
  };
  if (!doc || typeof doc !== 'object') fail('不是 YAML 映射');
  const agent = String(doc!['agent'] ?? '');
  if (!isAgentId(agent)) fail(`agent「${agent}」不是已登记的 Agent`);
  if (path.basename(file, '.yaml') !== agent) fail(`文件名须与 agent 同名（${agent}.yaml）`);
  const layout = doc!['layout'];
  if (layout !== 'top' && layout !== 'entry') fail('layout 只能是 top 或 entry');
  const fm = doc!['frontmatter'];
  if (!Array.isArray(fm) || fm.length === 0 || !fm.every((k) => typeof k === 'string')) {
    fail('frontmatter 须为非空字符串数组');
  }
  if (!(fm as string[]).includes('name') || !(fm as string[]).includes('description')) {
    fail('frontmatter 至少要有 name 与 description（四家 skill 加载都靠这两个键）');
  }
  const args = doc!['arguments'];
  if (args !== 'substitute' && args !== 'transcribe' && args !== 'native-tail') fail('arguments 只能是 substitute、transcribe 或 native-tail');
  /*
   * 调用写法**不在载体 yaml 里登记**（M10b 第 3 步迁入注册表 `entryInvocation`）：CLI 生成的停点话术也要用它，
   * 而运行时读不到 `skills-src/`。yaml 里若还写着就当场报错——留着它，两处迟早各改各的。
   */
  if (doc!['invocation'] !== undefined) fail('invocation 已迁入注册表（entryInvocation），载体 yaml 里不要再写');
  const inv = agentById(agent)!.entryInvocation;
  if (!inv.includes('{name}')) fail(`注册表里 ${agent} 的 entryInvocation 须含 {name}`);
  return {
    agent: agent as AgentId,
    layout: layout as Carrier['layout'],
    frontmatter: fm as string[],
    arguments: args as ArgumentMode,
    invocation: inv,
  };
}

/**
 * 契约文件：`---` 包起来的头部，逐行 `键: 值`（按第一个 `: ` 切，**不做 YAML 解析**——
 * 取值原样进产物 front-matter，YAML 往返会改写引号与转义，逐字节还原就做不到）。
 * `@` 开头的键是模板变量，其余是产物 front-matter。
 */
function parseContract(file: string, raw: string): Contract {
  const fail = (why: string): never => {
    throw new Error(`命令契约 ${file} 不合法：${why}`);
  };
  if (!raw.startsWith('---\n')) fail('须以 --- 开头');
  const end = raw.indexOf('\n---\n', 3);
  if (end === -1) fail('缺少头部结束行 ---');
  const head = raw.slice(4, end).split('\n');
  const body = raw.slice(end + 5);
  const frontmatter: [string, string][] = [];
  const vars: Record<string, string> = {};
  for (const line of head) {
    const at = line.indexOf(': ');
    if (at <= 0) fail(`头部行不是「键: 值」形态：${line}`);
    const key = line.slice(0, at);
    const value = line.slice(at + 2);
    if (key.startsWith('@')) vars[key.slice(1)] = value;
    else frontmatter.push([key, value]);
  }
  const name = frontmatter.find(([k]) => k === 'name')?.[1];
  if (!name) fail('front-matter 缺 name');
  return { id: path.basename(file, '.contract.md'), name: name!, frontmatter, vars, body };
}

async function collectPartials(dir: string, base = '', out = new Map<string, string>()): Promise<Map<string, string>> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) await collectPartials(path.join(dir, e.name), rel, out);
    else if (e.name.endsWith('.md')) out.set(rel.slice(0, -3), await fs.readFile(path.join(dir, e.name), 'utf8'));
  }
  return out;
}

/**
 * 只读载体适配层。安装器靠它知道每家的产物在仓库里的哪个布局（top / entry）——
 * 与渲染同一份源，不在安装器里另立一张「哪家装哪里」的表。
 */
export async function loadCarriers(root: string): Promise<Carrier[]> {
  const dir = path.join(root, ENTRY_SRC_DIR, 'carriers');
  const carriers: Carrier[] = [];
  for (const f of await readDirSorted(dir)) {
    if (!f.endsWith('.yaml')) continue;
    carriers.push(parseCarrier(f, await fs.readFile(path.join(dir, f), 'utf8')));
  }
  checkCarrierCoverage(carriers);
  return carriers;
}

export async function loadEntrySources(root: string): Promise<EntrySources> {
  const src = path.join(root, ENTRY_SRC_DIR);
  const carriers = await loadCarriers(root);
  const contracts: Contract[] = [];
  for (const f of await readDirSorted(path.join(src, 'commands'))) {
    if (!f.endsWith('.contract.md')) continue;
    contracts.push(parseContract(f, await fs.readFile(path.join(src, 'commands', f), 'utf8')));
  }
  const partials = await collectPartials(path.join(src, 'partials'));
  return { carriers, contracts, partials };
}

/**
 * 载体集合与注册表对账：每个**可作 Driver** 的 Agent 恰有一份载体，且 top 布局恰有一家。
 *
 * 由注册表派生而不是写死四个名字（纪律 7）：登记第五家 Driver 而不补载体，渲染当场抛错，
 * 而不是静默少渲一家、让那一家的入口资产永远停在旧版。
 */
export function checkCarrierCoverage(carriers: readonly Carrier[]): void {
  const have = new Set(carriers.map((c) => c.agent));
  const missing = AGENTS.filter((a) => a.driverEnabled && !have.has(a.id)).map((a) => a.id);
  if (missing.length > 0) {
    throw new Error(`可作 Driver 的 ${missing.join('、')} 缺少载体适配层 ${ENTRY_SRC_DIR}/carriers/<agent>.yaml`);
  }
  const tops = carriers.filter((c) => c.layout === 'top');
  if (tops.length !== 1) {
    throw new Error(`layout: top 的载体须恰有一家（它的产物就是 skills/<命令名>/），实有 ${tops.length} 家`);
  }
}

// ─────────────────────── 渲染 ───────────────────────

interface Scope {
  carrier: Carrier;
  contract: Contract;
  vars: Readonly<Record<string, string>>;
  partials: ReadonlyMap<string, string>;
}

const TAG = /\{\{\s*(>)?\s*([^{}]+?)\s*\}\}/g;
/** 独占一行的片段标签，连同其后至多一个空行 */
const STANDALONE_PARTIAL = /^[ \t]*\{\{>\s*([^{}]+?)\s*\}\}[ \t]*\n(\n)?/gm;
/** 独立行片段先渲染、占位，最后回填——回填的文本不再过一遍 TAG，免得被二次解释 */
const SLOT = /\u0000(\d+)\u0000/g;

function renderPartial(expr: string, scope: Scope, trail: string, depth: number): string {
  const [name, selector] = expr.split('@') as [string, string | undefined];
  let key = name.trim();
  if (selector !== undefined) {
    const v = scope.vars[selector.trim()];
    if (v === undefined) throw new Error(`${trail}：片段选择器引用了未定义的变量 ${selector}`);
    key = `${key}.${v}`;
  }
  const body = scope.partials.get(key);
  if (body === undefined) throw new Error(`${trail}：缺少片段 ${ENTRY_SRC_DIR}/partials/${key}.md`);
  return renderText(body.endsWith('\n') ? body.slice(0, -1) : body, scope, `${trail} → ${key}`, depth + 1);
}

function renderText(text: string, scope: Scope, trail: string, depth = 0): string {
  if (depth > 24) throw new Error(`模板嵌套过深（疑似循环引用）：${trail}`);
  const slots: string[] = [];
  const staged = text.replace(STANDALONE_PARTIAL, (_m, expr: string, blank: string | undefined) => {
    const r = renderPartial(expr, scope, trail, depth);
    slots.push(r === '' ? '' : `${r}\n${blank ?? ''}`);
    return `\u0000${slots.length - 1}\u0000`;
  });
  const done = staged.replace(TAG, (_m, isPartial: string | undefined, expr: string) => {
    if (isPartial) return renderPartial(expr, scope, trail, depth);
    if (expr.startsWith('cmd:')) return scope.carrier.invocation.replace('{name}', expr.slice(4));
    if (expr.startsWith('fm:')) {
      const hit = scope.contract.frontmatter.find(([k]) => k === expr.slice(3));
      if (!hit) throw new Error(`${trail}：front-matter 没有 ${expr.slice(3)}`);
      return renderText(hit[1], scope, `${trail} → fm:${hit[0]}`, depth + 1);
    }
    const v = scope.vars[expr];
    if (v === undefined) throw new Error(`${trail}：未定义的模板变量 ${expr}`);
    return renderText(v, scope, `${trail} → ${expr}`, depth + 1);
  });
  return done.replace(SLOT, (_m, i: string) => slots[Number(i)]!);
}

/**
 * 载体派生的模板变量。契约 `@` 变量不得与之重名（重名即抛，免得一方静默盖掉另一方）。
 *
 * 取值清单一律**由注册表派生**（EV-61：此前 `argument-hint` 与模板写死 `--model-gemini` / `--model-glm` /
 * `--only gemini|glm`，而 CLI 按注册表接受四家）：审核者 = 已启用为审核者、且不是本载体自己的那几家——
 * 当轮 Driver 不得入选（`critics.ts`），给它留 `--model-<自己>` 槽位只会引出一个必退 64 的写法。
 */
function carrierVars(carrier: Carrier): Record<string, string> {
  const self = agentById(carrier.agent)!;
  const critics = CRITIC_AGENT_IDS.filter((id) => id !== carrier.agent);
  const withProfile = new Set<string>(vendorProfileAgents());
  const profileCritics = critics.filter((id) => withProfile.has(id));
  return {
    DRIVER: carrier.agent,
    ARG_MODE: carrier.arguments,
    // 命令模板里参数的占位：claude 由载体替换 $ARGUMENTS；另三家由模型按转抄规约拼
    ARGS: carrier.arguments === 'substitute' ? '$ARGUMENTS' : '<参数>',
    // 护栏注入段（r10 §3.1.3）：按注册表的 guardLevel 与有无 Hook 配置目标派生
    GUARD: guardProfileOf(self),
    /*
     * 四条命令同一组：列**已启用审核者**减本载体（不是缺省集合）。四条命令都收 `--critics`，
     * 不在缺省集合里的一家（如非 claude 载体上的 claude）能被显式加进来，所以槽位合法——
     * 但它要与 `--critics` 同时给：单写 `--model-<该家>` 会被判「本轮没有入选」退 64，
     * 报错点名本轮入选并给出 `--critics` 出口，不是静默（代码双审 r2 CODEX-03）。
     *
     * 命令 A 曾经单用一组 `MODEL_HINT_DEFAULT` / `MODEL_FLAGS_DEFAULT`（注册表缺省集合减本载体，
     * M10b 第 2 步代码双审 CODEX-02）：那时它不收 `--critics`，缺省集合外的一家没有入选出口，
     * 给它留槽位就是引出一个必退 64 的写法。EV-125 让命令 A 也收 `--critics` 之后那条理由不再成立，
     * 两组合并——同值的两个名字留着，下一次只改其一就是分叉。
     */
    MODEL_HINT: critics.map((id) => `[--model-${id} <模型>]`).join(' '),
    MODEL_FLAGS: critics.map((id) => `\`--model-${id}\``).join(' / '),
    /*
     * 档位旗标（M11 第 5 步）：论域同 MODEL_HINT。厂商 profile 一类只对适配器实现了 `vendorProfilesFor` 的侧派生
     * 注册表 supportsProfiles 声明控制生成集合，不在此重复登记工具身份。
     * 厂商 profile 那一格给**整段括注**（计划三审 AGY-05）：模板只放变量、不写括号，免得空集时留下空括号。
     */
    TIER_HINT: critics.map((id) => `[--tier-${id} <档>]`).join(' '),
    TIER_FLAGS: critics.map((id) => `\`--tier-${id}\``).join(' / '),
    EFFORT_HINT: critics.map((id) => `[--effort-${id} <值>]`).join(' '),
    EFFORT_FLAGS: critics.map((id) => `\`--effort-${id}\``).join(' / '),
    VENDOR_PROFILE_HINT: profileCritics.map((id) => ` [--profile-${id} <名>] [--native-${id}]`).join('') + ' [--driver-model <模型>] [--driver-provider <供应商>]',
    VENDOR_PROFILE_CLAUSE:
      profileCritics.length > 0
        ? `（${profileCritics.map((id) => `\`--profile-${id}\``).join(' / ')}）`
        : '（本载体的审核者里没有带厂商 profile 概念的一家，`vendor_profiles` 恒为空）',
    ONLY_CHOICES: critics.join('|'),
  };
}

export function entryRelPath(carrier: Carrier, name: string): string {
  return carrier.layout === 'top'
    ? `skills/${name}/SKILL.md`
    : `${ENTRY_OUT_DIR}/${carrier.agent}/${name}/SKILL.md`;
}

export function renderEntry(src: EntrySources, carrier: Carrier, contract: Contract): RenderedEntry {
  const own = carrierVars(carrier);
  const clash = Object.keys(contract.vars).filter((k) => k in own);
  if (clash.length > 0) throw new Error(`${contract.id}：契约变量与载体派生量重名：${clash.join('、')}`);
  const scope: Scope = { carrier, contract, vars: { ...own, ...contract.vars }, partials: src.partials };
  const trail = `${carrier.agent}/${contract.id}`;
  const fm = contract.frontmatter
    .filter(([k]) => carrier.frontmatter.includes(k))
    .map(([k, v]) => `${k}: ${renderText(v, scope, `${trail} → fm:${k}`)}\n`)
    .join('');
  const content = `---\n${fm}---\n${renderText(contract.body, scope, trail)}`;
  return {
    agent: carrier.agent,
    layout: carrier.layout,
    command: contract.id,
    name: contract.name,
    relPath: entryRelPath(carrier, contract.name),
    content,
  };
}

export function renderAll(src: EntrySources): RenderedEntry[] {
  const out: RenderedEntry[] = [];
  for (const carrier of src.carriers) {
    for (const contract of src.contracts) out.push(renderEntry(src, carrier, contract));
  }
  return out;
}

export async function renderEntries(root: string): Promise<RenderedEntry[]> {
  return renderAll(await loadEntrySources(root));
}

// ─────────────────────── 落盘 ───────────────────────

async function listFiles(dir: string, base = ''): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(path.join(dir, e.name), rel)));
    else out.push(rel);
  }
  return out;
}

/**
 * 重写产物。`entry/` 子树整棵归渲染所有：源里已没有的产物文件一并删掉（只在 `root` 之下的
 * 这一个固定子目录里删），否则删掉一条契约后旧产物会残留并被安装器继续装出去。
 * top 布局的产物目录与 `dual-critic` 等手写 skill 同级，这里**不删**任何 top 目录——残留由契约测试报出来。
 */
export async function writeEntries(root: string): Promise<{ written: string[]; removed: string[] }> {
  const rendered = await renderEntries(root);
  const written: string[] = [];
  for (const r of rendered) {
    const abs = path.join(root, r.relPath);
    let cur: string | null = null;
    try {
      cur = await fs.readFile(abs, 'utf8');
    } catch {
      cur = null;
    }
    if (cur === r.content) continue;
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, r.content, 'utf8');
    written.push(r.relPath);
  }
  const want = new Set(rendered.map((r) => r.relPath));
  const removed: string[] = [];
  const entryAbs = path.join(root, ENTRY_OUT_DIR);
  for (const rel of await listFiles(entryAbs)) {
    const full = `${ENTRY_OUT_DIR}/${rel}`;
    if (want.has(full)) continue;
    await fs.rm(path.join(entryAbs, rel), { force: true });
    removed.push(full);
  }
  await pruneEmptyDirs(entryAbs);
  return { written, removed };
}

async function pruneEmptyDirs(dir: string): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const sub = path.join(dir, e.name);
    await pruneEmptyDirs(sub);
    if ((await fs.readdir(sub)).length === 0) await fs.rmdir(sub);
  }
}
