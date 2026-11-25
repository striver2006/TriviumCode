// 仅供驾驶舱 M1 使用。核心审核者始终从自己的探针取入口。
import { constants } from 'node:fs';
import { access, open, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseWrapperNodePath, scriptProviderEnv } from './carriers';

export interface InteractiveProgram {
  entrypoint: string;
  launchMode: 'direct' | 'shellCommand';
  source: '设置' | '自动发现' | '探针';
  nodePath?: string;
  waitForStartup?: boolean;
  scriptEnv?: Record<string, string>;
}

/** 能力查询与终端点火使用同一可执行文件、解释器和参数边界。 */
export function nativeCommand(program: Pick<InteractiveProgram, 'entrypoint' | 'launchMode'> & { nodePath?: string | null }, args: readonly string[]) {
  if (program.launchMode === 'direct') return { shellPath: program.entrypoint, shellArgs: [...args] };
  if (!program.nodePath) throw new Error('脚本入口需要 Node 解释器路径');
  return { shellPath: program.nodePath, shellArgs: [program.entrypoint, ...args] };
}

interface Options {
  trusted: boolean;
  configuredPath?: string;
  configuredNode?: string;
  cli?: Record<string, unknown>;
  wrapper: string;
  searchDirs?: string[];
}

async function accessibleFile(file: string, mode: number): Promise<boolean> {
  try {
    if (!path.isAbsolute(file) || !(await stat(file)).isFile()) return false;
    await access(file, mode);
    return true;
  } catch { return false; }
}

async function desktopWithoutTui(file: string): Promise<boolean> {
  if (!file.endsWith('/ZCode.app/Contents/Resources/glm/zcode.cjs')) return false;
  // 已实测的桌面脚本在普通 Node 下动态导入外部 TUI。允许将来内置该模块的版本。
  if (!/import\(\s*['"]@zcode\/tui['"]\s*\)/.test(await readFile(file, 'utf8'))) return false;
  let dir = path.dirname(file);
  for (;;) {
    if (await stat(path.join(dir, 'node_modules/@zcode/tui')).then(s => s.isDirectory(), () => false)) return false;
    const parent = path.dirname(dir);
    if (parent === dir) return true;
    dir = parent;
  }
}

/** 3.18.2 的启动页会忽略提交。只对实测发行脚本及其官方安装器生成的命令等待启动事件。 */
async function hasStartupEvent(file: string, script: boolean): Promise<boolean> {
  let launcher = file;
  if (!script) {
    // 只读包装命令的首段。二进制或其它包装方式继续使用载体就绪延迟。
    const handle = await open(file, 'r').catch(() => null);
    if (!handle) return false;
    try {
      const prefix = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
      const match = /^#![^\n]*\nexec node "([^"\n]+\/bin\/zcode\.mjs)" "\$@"\s*$/.exec(prefix.toString('utf8', 0, bytesRead));
      if (!match || !path.isAbsolute(match[1]!)) return false;
      launcher = match[1]!;
    } finally { await handle.close(); }
  }
  if (!launcher.endsWith('/bin/zcode.mjs')) return false;
  try {
    const pkg = JSON.parse(await readFile(path.resolve(path.dirname(launcher), '../package.json'), 'utf8'));
    return pkg?.name === 'zcode-runtime' && pkg.version === '3.18.2';
  } catch { return false; }
}

async function interpreter(o: Options): Promise<string> {
  if (o.configuredNode) {
    if (await accessibleFile(o.configuredNode, constants.X_OK)) return o.configuredNode;
    throw new Error('请修正 trivium.launch.glmNodePath，须填写可执行 Node 的绝对路径：' + o.configuredNode);
  }
  const runner = (o.cli?.version_probe as {runner?: unknown} | undefined)?.runner;
  if (typeof runner === 'string' && await accessibleFile(runner, constants.X_OK)) return runner;
  const wrapper = await readFile(o.wrapper, 'utf8').catch(() => '');
  const node = parseWrapperNodePath(wrapper);
  if (node && await accessibleFile(node, constants.X_OK)) return node;
  throw new Error('请在终端运行 command -v node，将绝对路径填入 trivium.launch.glmNodePath。');
}

export async function resolveGlmInteractive(o: Options): Promise<InteractiveProgram> {
  if (!o.trusted) throw new Error('请先确认当前工作区可信，再启动 GLM 交互终端。');
  const dirs = o.searchDirs ?? [...(process.env.PATH ?? '').split(path.delimiter),
    path.join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  const candidates: [string, InteractiveProgram['source']][] = [];
  if (o.configuredPath) candidates.push([o.configuredPath, '设置']);
  else {
    for (const dir of new Set(dirs.filter(p => path.isAbsolute(p)))) candidates.push([path.join(dir, 'zcode'), '自动发现']);
    if (typeof o.cli?.entrypoint === 'string') candidates.push([o.cli.entrypoint, '探针']);
  }
  let reason = '';
  const fix = '请在终端运行 command -v zcode，将绝对路径填入 trivium.launch.glmInteractivePath，或填写独立发行目录的 bin/zcode.mjs。';
  for (const [candidate, source] of candidates) {
    const file = path.isAbsolute(candidate) ? await realpath(candidate).catch(() => '') : '';
    const script = /\.[cm]?js$/i.test(file);
    if (!file || !await accessibleFile(file, script ? constants.R_OK : constants.X_OK)) {
      if (source === '设置') throw new Error('GLM 交互入口无效：' + candidate + '。' + fix);
      continue;
    }
    if (await desktopWithoutTui(file)) {
      reason = '桌面脚本 ' + file + ' 缺少 @zcode/tui。';
      if (source === '设置') break;
      continue;
    }
    const waitForStartup = await hasStartupEvent(file, script);
    if (!script) return { source, launchMode: 'direct', entrypoint: candidate, waitForStartup };
    return { source, launchMode: 'shellCommand', entrypoint: file, waitForStartup, nodePath: await interpreter(o),
      scriptEnv: source === '探针' ? scriptProviderEnv(o.cli?.provider_config) : undefined };
  }
  throw new Error((reason || '未找到可用的 GLM 交互入口。') + fix);
}
