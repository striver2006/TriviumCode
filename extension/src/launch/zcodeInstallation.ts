// 核心探针、审核适配器与驾驶舱共享。只解析安装文件，不执行启动器或读取账号配置。
import { accessSync, closeSync, constants, lstatSync, openSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const isZcodeScript = (file: string): boolean => /\.[cm]?js$/i.test(file);

export interface ZcodeSearch {
  searchDirs?: string[];
  home?: string;
  desktopEntries?: string[];
}

/** 第一条已安装的候选即为选定入口。断链或权限错误交给核验报告。 */
function present(file: string): boolean {
  try { lstatSync(file); return true; } catch (e) {
    return !['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '');
  }
}

export function standaloneCommand(search: ZcodeSearch = {}): string | undefined {
  const home = search.home ?? homedir();
  const dirs = search.searchDirs ?? [...(process.env.PATH ?? '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin'];
  const commands = (dir: string) => (process.platform === 'win32' ? ['zcode.exe', 'zcode'] : ['zcode']).map(n => path.join(dir, n));
  const candidates = search.searchDirs === undefined || search.home !== undefined
    ? [...commands(path.join(home, '.local/bin')), path.join(home, '.zcode/runtime/current/bin/zcode.mjs')]
    : [];
  for (const dir of new Set(dirs.filter(p => path.isAbsolute(p)))) candidates.push(...commands(dir));
  return candidates.find(present);
}

function desktopCommand(search: ZcodeSearch): string | undefined {
  const dirs = process.platform === 'win32'
    ? [process.env.ProgramFiles, process.env.ProgramW6432, process.env['ProgramFiles(x86)']].filter((p): p is string => !!p)
      .map(dir => path.join(dir, 'ZCode/resources/glm/zcode.cjs'))
    : ['/Applications', path.join(search.home ?? homedir(), 'Applications')].map(dir => path.join(dir, 'ZCode.app/Contents/Resources/glm/zcode.cjs'));
  return (search.desktopEntries ?? dirs).find(present);
}

export function checkedZcodeFile(candidate: string): string {
  try {
    const file = realpathSync(candidate);
    if (!statSync(file).isFile()) throw new Error('需要普通文件');
    accessSync(file, isZcodeScript(file) ? constants.R_OK : constants.X_OK);
    return file;
  } catch (e) { throw new Error('ZCode 入口 ' + candidate + ' 不可用：' + (e as Error).message); }
}

/** 官方 sh 包装器只读首段，识别裸 node 或带空格的绝对 Node 路径。其它程序保持直接执行。 */
function wrappedLauncher(file: string): string | undefined {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const size = readSync(fd, buf, 0, buf.length, 0);
    const match = /^#![^\n]*\nexec (?:node|"[^"\n]+[/\\]node(?:\.exe)?") "([^"\n]+\/bin\/zcode\.mjs)" "\$@"\s*$/.exec(buf.toString('utf8', 0, size));
    return match && path.isAbsolute(match[1]!) ? match[1] : undefined;
  } finally { closeSync(fd); }
}

export function standalonePackage(file: string): { root: string; version: string } | undefined {
  let script = file;
  if (!isZcodeScript(file)) {
    const target = wrappedLauncher(file);
    if (!target) return undefined;
    script = checkedZcodeFile(target);
  }
  if (!/(?:[/\\]bin[/\\]zcode\.mjs|[/\\]agent[/\\]zcode\.cjs)$/.test(script)) return undefined;
  const root = path.dirname(path.dirname(script));
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (pkg.name === 'zcode-runtime' && typeof pkg.version === 'string') return { root, version: pkg.version };
  } catch { /* 自定义脚本也可使用相同文件名。 */ }
  return undefined;
}

export function reviewEntry(configured: string | null, search: ZcodeSearch = {}): string | undefined {
  const candidate = configured ?? standaloneCommand(search) ?? desktopCommand(search);
  if (!candidate) return undefined;
  const file = checkedZcodeFile(candidate);
  if (configured !== null) return file;
  const pkg = standalonePackage(file);
  return pkg ? checkedZcodeFile(path.join(pkg.root, 'agent/zcode.cjs')) : file;
}
