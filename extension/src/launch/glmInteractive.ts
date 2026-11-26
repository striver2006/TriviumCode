// 驾驶舱使用所选发行包的交互入口。
import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { checkedZcodeFile, isZcodeScript, standaloneCommand, standalonePackage, type ZcodeSearch } from './zcodeInstallation';
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

interface Options extends ZcodeSearch {
  trusted: boolean;
  configuredPath?: string;
  configuredNode?: string;
  cli?: Record<string, unknown>;
  wrapper: string;
}

async function accessibleFile(file: string, mode: number): Promise<boolean> {
  try {
    if (!path.isAbsolute(file) || !(await stat(file)).isFile()) return false;
    await access(file, mode);
    return true;
  } catch { return false; }
}

async function desktopWithoutTui(file: string): Promise<boolean> {
  if (!/[\\/]resources[\\/]glm[\\/]zcode\.cjs$/i.test(file)) return false;
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
  const found = o.configuredPath ? undefined : standaloneCommand(o);
  const candidate = o.configuredPath || found || o.cli?.entrypoint;
  const source = o.configuredPath ? '设置' : found ? '自动发现' : '探针';
  const fix = '请安装独立 ZCode CLI，或将可执行启动器或 bin/zcode.mjs 的绝对路径填入 trivium.launch.glmInteractivePath。';
  if (typeof candidate !== 'string' || !candidate) throw new Error('未找到可用的 GLM 交互入口。' + fix);
  if (!path.isAbsolute(candidate)) throw new Error('GLM 交互入口需要绝对路径：' + candidate + '。' + fix);
  try {
    let file = checkedZcodeFile(candidate);
    const pkg = standalonePackage(file);
    // 后台探针登记的是 Agent。交互终端使用该发行包自己的启动脚本。
    if (source === '探针' && pkg) file = checkedZcodeFile(path.join(pkg.root, 'bin/zcode.mjs'));
    if (await desktopWithoutTui(file)) throw new Error('桌面脚本 ' + file + ' 缺少 @zcode/tui。');
    const waitForStartup = !!pkg;
    if (!isZcodeScript(file)) return { source, launchMode: 'direct', entrypoint: candidate, waitForStartup };
    return { source, launchMode: 'shellCommand', entrypoint: file, waitForStartup, nodePath: await interpreter(o),
      scriptEnv: source === '探针' && !pkg ? scriptProviderEnv(o.cli?.provider_config) : undefined };
  } catch (e) { throw new Error('GLM 交互入口 ' + candidate + '：' + (e as Error).message + ' ' + fix); }
}
