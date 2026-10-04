/**
 * 测试临时目录的统一入口（EV-208）：按前缀在系统临时目录下 mkdtemp，**一返回就登记**，本进程退出时同步删。
 *
 * 机制原是 EV-207 只给 `makeFixture` 用的那套（`test/helpers/fixture.ts`），本题抽到这里给 `test/` 下全部用例用：
 * 此前各测试文件自己 mkdtemp、跑完不删，每跑一遍全量就在系统临时目录多留约一千个。
 * `test/` 下新写建临时目录的代码一律调这里；自带可靠收尾、确需保留裸 mkdtemp 的文件登记在
 * `test/unit/scratch-guard.test.ts` 的豁免表里，新增一处裸调用会被那条守卫当场拦下。
 *
 * **收尾挂在进程退出上，不挂 `node:test` 的 `after`**（EV-207 计划 §1.6 实测）：`fixture.ts` 也被普通的验收脚本 import
 * （`doc/05_testing/evidence/*\/acceptance*.mjs`），在那里调 `after` 会顺带起一个测试 harness、往 stdout 打汇总。
 * 代价是退出处理器里只能做同步操作。被信号杀掉时退出处理器不跑，目录照旧遗留（残余）。
 *
 * 设 `TRIVIUM_KEEP_FIXTURES=1` 时本进程经这里建的**全部**临时目录都保留（不只夹具），按调用方分组各打一行列出路径，便于排查。
 *
 * 本文件只依赖 node 内置模块：它被几乎每个测试文件 import，不拖进 `src/` 或 `typescript`。
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeSync } from 'node:fs';

/** 设为 `1` 时进程退出不删，只按调用方各打一行列出路径（EV-207 起；EV-208 起管全部经本文件建的目录） */
export const KEEP_FIXTURES_ENV = 'TRIVIUM_KEEP_FIXTURES';

/** 退出提示里的主语与名词：`makeFixture` 传「makeFixture / 夹具目录」，提示与 EV-207 逐字相同 */
export interface ScratchOwner {
  owner: string;
  noun: string;
}

const DEFAULT_OWNER: ScratchOwner = { owner: 'scratchDir', noun: '测试临时目录' };

/**
 * 前缀形如 `trivium-xxx-`：`trivium-` 之后至少一个字母、数字或下划线，只含字母、数字、下划线、连字符，以连字符结尾。
 * 挡住 `../`、绝对路径、斜杠这类让目录落到系统临时目录之外的写法；尾连字符把 mkdtemp 的随机后缀与前缀隔开，
 * 退出时的防呆按名字认目录不含糊（计划 r2 §2 第 2 条；下划线放行，计划双审 AGY-03；收紧到与文案一致，代码双审 GLM-01）。
 */
const PREFIX_RE = /^trivium-[A-Za-z0-9_-]*[A-Za-z0-9_]-$/;

interface Entry {
  /** 登记时就解析成绝对路径：`TMPDIR` 是相对路径时 mkdtemp 的返回值也是相对的，退出时 cwd 可能已变（计划双审 AGY-02） */
  dir: string;
  /** 调用时的 `os.tmpdir()`，同样解析过 */
  parent: string;
  prefix: string;
  who: ScratchOwner;
}

/** 本进程登记过的临时目录。只由下面两个函数在 mkdtemp 一返回就写入——删除只认 mkdtemp 的返回值 */
const ENTRIES: Entry[] = [];
let exitCleanupArmed = false;

function checkPrefix(prefix: string): void {
  if (!PREFIX_RE.test(prefix)) {
    throw new TypeError(
      `scratchDir：前缀必须形如 trivium-xxx-（trivium- 之后至少一个字母、数字或下划线，只含字母、数字、下划线、连字符，以连字符结尾），收到 ${JSON.stringify(prefix)}`,
    );
  }
}

function register(raw: string, parent: string, prefix: string, who: ScratchOwner): void {
  ENTRIES.push({ dir: path.resolve(raw), parent, prefix, who });
  if (!exitCleanupArmed) {
    exitCleanupArmed = true;
    process.on('exit', removeScratchDirsSync);
  }
}

/**
 * 在系统临时目录下建一个以 `prefix` 开头的临时目录并登记，本进程退出时删。
 * 返回值与 `fs.mkdtemp(path.join(os.tmpdir(), prefix))` 完全相同（不 realpath）。
 * 前缀不合规时在调用 mkdtemp 之前拒绝（返回被拒的 Promise）。
 */
export async function scratchDir(prefix: string, who: ScratchOwner = DEFAULT_OWNER): Promise<string> {
  checkPrefix(prefix);
  const parent = path.resolve(os.tmpdir());
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  // 与 await 之间没有别的 await：一返回就登记，早于调用方的任何写盘，建到一半抛出也会被收尾
  register(raw, parent, prefix, who);
  return raw;
}

/** `scratchDir` 的同步版，给模块顶层要同步拿到目录的用例（如 `report.test.ts` 的锁目录）。前缀不合规时同步抛 */
export function scratchDirSync(prefix: string, who: ScratchOwner = DEFAULT_OWNER): string {
  checkPrefix(prefix);
  const parent = path.resolve(os.tmpdir());
  const raw = mkdtempSync(path.join(os.tmpdir(), prefix));
  register(raw, parent, prefix, who);
  return raw;
}

/**
 * 退出处理器里的提示：同步写 fd 2（macOS 上 stderr 接管道时 `process.stderr.write` 是异步的，退出时会丢），
 * 且永不抛——stderr 已关闭时最多丢一行，不让异常穿出退出处理器、改写退出码或中断后面的删除（EV-207 计划双审 GLM-04）。
 */
function warnLine(text: string): void {
  try {
    writeSync(2, `${text}\n`);
  } catch {
    // 写不出去就算了
  }
}

/**
 * 删之前恢复权限：每一层（含根）**先 chmod 自身再 readdir**（EV-207 计划双审 AGY-02）——目录自身被改成只读或不可执行时，
 * 先 readdir 会当场 EACCES、子孙一个都恢复不了。软链不跟随（`isDirectory()` 对软链为假）。
 * 每一步失败都吞掉（AGY-01）：这只是删除的准备，目录已不在或读不了都照样去删，删不掉由删除报真实错误码。
 */
function unlockTreeSync(dir: string): void {
  try {
    chmodSync(dir, 0o700);
  } catch {
    // 照样往下
  }
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) if (e.isDirectory()) unlockTreeSync(path.join(dir, e.name));
}

function removeScratchDirsSync(): void {
  if (process.env[KEEP_FIXTURES_ENV] === '1') {
    // 按调用方分组、首次登记的先后：只有 makeFixture 一组时与 EV-207 的输出逐字相同
    const groups = new Map<string, { who: ScratchOwner; dirs: string[] }>();
    for (const e of ENTRIES) {
      const key = `${e.who.owner}\u0000${e.who.noun}`;
      const g = groups.get(key) ?? { who: e.who, dirs: [] };
      g.dirs.push(e.dir);
      groups.set(key, g);
    }
    for (const { who, dirs } of groups.values()) {
      warnLine(`${who.owner}：${KEEP_FIXTURES_ENV}=1，保留本进程的 ${dirs.length} 个${who.noun}：${dirs.join('、')}`);
    }
    return;
  }
  for (const { dir, parent, prefix, who } of ENTRIES) {
    // 防呆：只删 mkdtemp 在系统临时目录下直接返回的那一层。清单只由 register 写入，这一支正常不可达
    if (!path.isAbsolute(dir) || path.dirname(dir) !== parent || !path.basename(dir).startsWith(prefix)) {
      warnLine(`${who.owner}：清单里有不像${who.noun}的条目，未删：${dir}`);
      continue;
    }
    try {
      unlockTreeSync(dir);
      // force 吞 ENOENT：用例自己已删掉的目录不会被误报
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch (e) {
      warnLine(`${who.owner}：${who.noun}没删掉，请手工删除 ${dir}（${(e as NodeJS.ErrnoException).code ?? String(e)}）`);
    }
  }
}
