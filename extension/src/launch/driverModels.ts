// M1 只询问即将启动的交互程序。返回 Webview 的数据仅含模型、强度和提示。
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { AgentId } from './carriers';
import { nativeCommand, type InteractiveProgram } from './glmInteractive';

export interface DriverChoice {
  driverModel?: string;
  driverEffort?: string;
}
export interface DriverModel { id: string; label: string; efforts: string[] }
export interface DriverCatalog {
  models: DriverModel[];
  defaultEfforts: string[];
  note: string;
  /** 原生供应商与 CLI 缺省声明，用于区分入口相同、供应商已切换的两次点火。 */
  provider?: string;
  defaultModel?: string;
  defaultEffort?: string;
}

export const emptyCatalog = (note: string): DriverCatalog => ({ models: [], defaultEfforts: [], note });
const identifier = (s: unknown): s is string => typeof s === 'string' && /^[\p{L}\p{N}_][\p{L}\p{N}_./:@+\[\]-]*$/u.test(s);
const levels = (v: unknown): string[] => Array.isArray(v) ? [...new Set(v.filter(identifier))] : [];
const timeoutMs = 15_000;

/** AbortSignal 先发 TERM，给原生程序收尾时间。仍未退出才强制结束。 */
function killAfterGrace(child: ChildProcess, signal: AbortSignal): void {
  let grace: NodeJS.Timeout | undefined;
  const onAbort = () => { grace = setTimeout(() => child.kill('SIGKILL'), 1_500); grace.unref(); };
  signal.addEventListener('abort', onAbort, { once: true });
  child.once('close', () => { signal.removeEventListener('abort', onAbort); clearTimeout(grace); });
}

export function driverArgs(agent: AgentId, catalog: DriverCatalog, choice: DriverChoice): string[] {
  const { driverModel, driverEffort } = choice;
  const model = catalog.models.find(m => m.id === driverModel);
  if (driverModel !== undefined && !model) {
    throw new Error((catalog.models.length ? '' : catalog.note + ' ') + '所选模型在当前交互入口的目录中不可用。请刷新环境后重新选择。');
  }
  if (driverEffort !== undefined && !(model?.efforts ?? catalog.defaultEfforts).includes(driverEffort)) {
    throw new Error('所选思考强度与当前模型不匹配，请重新选择。');
  }
  const args = driverModel ? [agent === 'codex' ? '-m' : '--model', driverModel] : [];
  if (driverEffort) {
    if (agent === 'codex') args.push('-c', 'model_reasoning_effort=' + driverEffort);
    else if (agent === 'claude') args.push('--effort', driverEffort);
    else throw new Error('当前交互入口没有独立的强度覆盖参数。');
  }
  return args;
}

type Query = (args: string[], input?: string) => Promise<string>;

function queryProgram(program: InteractiveProgram, cwd: string, env: NodeJS.ProcessEnv): Query {
  return (args, input) => new Promise((resolve, reject) => {
    const { shellPath, shellArgs } = nativeCommand(program, args);
    const signal = AbortSignal.timeout(args[0] === 'models' ? 90_000 : timeoutMs);
    const child = execFile(shellPath, shellArgs, { cwd, env, signal, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
    (err, stdout, stderr) => {
      // 部分 CLI 将帮助打印到 stderr。错误输出可能含有账号信息，不交给 Webview。
      if (err) reject(new Error('交互入口的能力查询失败或超时。'));
      else resolve(args.includes('--help') ? stdout + '\n' + stderr : stdout);
    });
    killAfterGrace(child, signal);
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}

// model/list 是该入口原生选择器的可见目录。config/read 在同一工作区解析默认模型，
// 与审核者的具名 profile 无关；只取 model 字段，不保留配置或账号数据。
function codexCatalog(program: InteractiveProgram, cwd: string, env: NodeJS.ProcessEnv): Promise<DriverCatalog> {
  return new Promise((resolve, reject) => {
    const command = nativeCommand(program, ['app-server']);
    const signal = AbortSignal.timeout(timeoutMs);
    const child = spawn(command.shellPath, command.shellArgs, { cwd, env,
      stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, signal });
    killAfterGrace(child, signal);
    const lines = createInterface({ input: child.stdout });
    const send = (msg: object) => child.stdin.write(JSON.stringify(msg) + '\n');
    const fail = () => reject(new Error('Codex 未返回当前工作区的可见模型目录。'));
    child.on('error', fail);
    child.on('close', fail);
    child.stdin.on('error', fail);
    const models: DriverModel[] = [];
    let configured: string | undefined;
    let provider: string | undefined;
    let defaultEffort: string | undefined;
    let catalogDefault: string | undefined;
    let pageId = 2;
    const cursors = new Set<string>();
    const getPage = (cursor?: string) => send({ id: pageId, method: 'model/list', params: { limit: 100, cursor } });
    lines.on('line', line => {
      try {
        const msg = JSON.parse(line);
        if (msg.id == null) return;
        if (msg.error) throw new Error();
        if (msg.id === 0) {
          send({ method: 'initialized' });
          send({ id: 1, method: 'config/read', params: { cwd, includeLayers: false } });
        } else if (msg.id === 1) {
          configured = msg.result.config.model;
          provider = msg.result.config.model_provider;
          defaultEffort = msg.result.config.model_reasoning_effort;
          getPage();
        } else if (msg.id === pageId) {
          for (const m of msg.result.data) {
            const id = m.model || m.id;
            if (m.hidden || !identifier(id)) continue;
            models.push({ id, label: id, efforts: levels(m.supportedReasoningEfforts?.map((e: { reasoningEffort: string }) => e.reasoningEffort)) });
            if (m.isDefault) catalogDefault = id;
          }
          const next = msg.result.nextCursor;
          if (next) {
            if (cursors.has(next)) throw new Error();
            cursors.add(next);
            pageId++;
            getPage(next);
            return;
          }
          const def = models.find(m => m.id === (configured || catalogDefault));
          resolve({ models, defaultEfforts: def?.efforts ?? [], provider, defaultModel: configured || catalogDefault,
            defaultEffort, note: models.length ? '' : '当前 Codex 入口没有可选模型，可沿用 CLI 默认。' });
          child.stdin.end();
        }
      } catch { fail(); child.kill(); }
    });
    send({ id: 0, method: 'initialize', params: { clientInfo: { name: 'trivium_cockpit', version: '1' } } });
  });
}

export function claudeCatalog(help: string, output: string): DriverCatalog {
  const result = emptyCatalog('');
  if (!/^\s*--model\s/m.test(help)) return result;
  // initialize 返回供应商解析后的交互菜单；帮助中的强度全集还需与逐模型能力取交集。
  const effortHelp = help.match(/^\s*--effort\s[^\n]*(?:\n[ \t]+\([^\n]+\))?/m)?.[0] ?? '';
  const accepted = levels(effortHelp.match(/\(([^()]+)\)/)?.[1]?.split(/\s*[,|]\s*/));
  for (const line of output.split('\n')) {
    if (!line.startsWith('{')) continue;
    const msg = JSON.parse(line);
    if (msg.type !== 'control_response' || msg.response?.request_id !== 'catalog') continue;
    for (const m of msg.response.response?.models ?? []) {
      if (!identifier(m.value)) continue;
      const efforts = m.supportsEffort ? levels(m.supportedEffortLevels).filter(e => accepted.includes(e)) : [];
      if (m.value === 'default') {
        result.defaultEfforts = efforts;
        result.defaultModel = m.description || m.displayName;
      } else {
        const label = m.displayName && m.displayName !== m.value ? m.displayName + ' (' + m.value + ')' : m.value;
        result.models.push({ id: m.value, label, efforts });
      }
    }
  }
  return result;
}

export async function readDriverCatalog(agent: AgentId, program: InteractiveProgram, cwd: string, parentEnv: NodeJS.ProcessEnv = process.env): Promise<DriverCatalog> {
  const env = { ...parentEnv, ...program.scriptEnv };
  const query = queryProgram(program, cwd, env);
  try {
    if (agent === 'codex') {
      try { return await codexCatalog(program, cwd, env); } catch {
        // 较早的入口沿用 doctor 的 debug models 可见目录与 supported_reasoning_levels。
        const raw = JSON.parse(await query(['debug', 'models']));
        const catalog = emptyCatalog('');
        for (const m of raw.models) {
          if (m.visibility !== 'hide' && identifier(m.slug)) catalog.models.push({ id: m.slug, label: m.slug,
            efforts: levels(m.supported_reasoning_levels?.map((l: { effort: string }) => l.effort)) });
        }
        return catalog;
      }
    }
    if (agent === 'claude') {
      const request = { type: 'control_request', request_id: 'catalog', request: { subtype: 'initialize' } };
      const [help, menu] = await Promise.all([query(['--help']), query(['--print', '--input-format', 'stream-json',
        '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--strict-mcp-config',
        '--settings', '{"disableAllHooks":true}'], JSON.stringify(request) + '\n')]);
      return claudeCatalog(help, menu);
    }
    if (agent === 'gemini') {
      const [help, list] = await Promise.all([query(['--help']), query(['models'])]);
      const catalog = emptyCatalog('Antigravity 的强度随模型变体选择。');
      if (/^\s*--model\s/m.test(help)) {
        for (const line of list.split('\n')) {
          const [id, name] = line.trim().split('\t');
          if (identifier(id) && name) catalog.models.push({ id, label: name, efforts: [] });
        }
      }
      return catalog;
    }
    return await zcodeCatalog(query);
  } catch {
    return emptyCatalog('当前交互入口未返回可用的模型目录，可沿用 CLI 默认。');
  }
}

async function zcodeCatalog(query: Query): Promise<DriverCatalog> {
  const help = await query(['--help']);
  const modelFlag = /^\s*(?:-m,\s*)?--model(?:\s|=|$)/m.test(help);
  const effortFlag = /^\s*--(?:effort|reasoning-effort)(?:\s|=|$)/m.test(help);
  if (modelFlag || effortFlag) return emptyCatalog('此 ZCode 入口的启动参数有变化，尚无与其供应商匹配的选项目录。');
  return emptyCatalog('此 ZCode 入口由原生供应商配置决定模型和强度。');
}
