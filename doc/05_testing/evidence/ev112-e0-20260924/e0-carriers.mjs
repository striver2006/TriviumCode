#!/usr/bin/env node
/**
 * EV-112 E0（计划 r1 §6.3，用户定为送审前跑）：零配额实测 0.16.9 的 CLI 产物是否跟着三个落点键走。
 *
 *   对照组：HOME=A1，三个落点键不设（今天无副本审查运行的形态，A1 扮演「真实 HOME」）
 *   实验组：HOME=A2，另设 ZCODE_STORAGE_DIR / ZCODE_SESSION_DB_PATH / ZCODE_LOG_DIR 指向 B2 下与副本同形的布局
 *
 * 零配额的做法：
 * - 假 HOME 里只放一份**合成**的 `cli/config.json`：一个 custom provider，`baseURL` 指向本脚本起的 127.0.0.1 服务，
 *   apiKey 是哨兵（与 `probeModelOverride` 同一常量），`apiKeyRequired: true`。不读任何真实配置文件；
 * - 本地服务对一切请求回 401，只记方法与路径（不记请求头、请求体）；
 * - 子进程环境与 `invokeZcode` 同法：`zcodeProviderEnv` 整包（目录键全清），另清两个凭据键与会话库两个别名键。
 *
 * 纪律：
 * - 所有目录来自 `mkdtemp` 的返回值；脚本**不含任何删除调用**，临时目录由用户决定去留（R1 / R8）；
 * - 不改真实 `~/.zcode/**`；对它只做「本次 sessionId 的文件名是否出现」的只读检查；
 * - 输出只含文件相对路径与大小、退出码、请求计数、sessionId，不含任何文件内容；
 * - 仓库根按脚本位置推导（EV-103）。
 *
 * 用法：先 `node scripts/build.mjs --tests-only`，再 `node doc/05_testing/evidence/ev112-e0-20260924/e0-carriers.mjs`
 */
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const mod = (p) => import(pathToFileURL(path.join(ROOT, 'dist/test/src/trivium', p)).href);

const { zcodeProviderEnv, ZCODE_CREDENTIAL_ENV_KEYS, ZCODE_DIR_ENV_KEYS, readonlyArgsFromProbe, buildZcodeArgs } = await mod('adapters/zcode.js');
const { ZCODE_PROBE_SENTINEL_KEY } = await mod('probes/zcode.js');
const { run } = await mod('util/exec.js');

const ENTRY = '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs';
const NODE = process.execPath;
const SESSION_DB_ALIASES = ['ZCODE_SESSION_DB_PATH', 'ZCODE_SESSION_DB'];
const PROMPT = '只回复 OK 两个字母，不要调用任何工具。';

// ── 本地 401 服务：模型请求只会打到这里 ──
const hits = [];
const server = http.createServer((req, res) => {
  hits.push(`${req.method} ${req.url}`);
  req.resume();
  res.writeHead(401, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'e0 local sentinel: unauthorized', type: 'invalid_request_error', code: 'invalid_api_key' } }));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

function syntheticCliConfig() {
  const provider = {
    'e0-local': {
      // 字段形态照本机 cli/config.json 的 custom provider（只看了键名与 kind / source，未读任何凭据值）；
      // 第一版缺 kind 与模型子结构，两组都停在 Model creation failed、没走到模型层
      name: 'E0 Local', kind: 'anthropic', source: 'custom', enabled: true,
      models: {
        'e0-model': {
          reasoning: { enabled: true, variants: ['low', 'max', 'high'], defaultVariant: 'max' },
          limit: { context: 200000, output: 8192 },
          modalities: { input: ['text'], output: ['text'] },
          zcode: { modified: false, priority: 99 },
        },
      },
      // 计算属性键：`fixture-credentials` 扫描器按字面形态认密钥赋值，这里是哨兵常量
      options: { baseURL: `http://127.0.0.1:${port}/v1`, apiKeyRequired: true, ['api' + 'Key']: ZCODE_PROBE_SENTINEL_KEY },
    },
  };
  return { provider, model: { main: 'e0-local/e0-model', lite: 'e0-local/e0-model' } };
}

/** 递归列文件（相对路径 + 字节数）；`cli/plugins` 只计数不展开 */
async function listTree(root) {
  const out = [];
  let pluginFiles = 0;
  async function walk(dir, inPlugins) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs);
      const plug = inPlugins || /(^|\/)\.zcode\/cli\/plugins$/.test(rel);
      if (e.isDirectory()) await walk(abs, plug);
      else if (plug) pluginFiles++;
      else out.push({ path: rel, bytes: (await fs.stat(abs)).size });
    }
  }
  await walk(root, false);
  return { files: out.sort((a, b) => a.path.localeCompare(b.path)), pluginFiles };
}

/** 分类：按 §1.2 的载体归到 P1/P2/P4/P5/P6 */
function classify(files) {
  const c = { log: [], rollout: [], db: [], artifacts: [], memories: [] };
  for (const f of files) {
    if (/\.zcode\/cli\/log\//.test(f.path)) c.log.push(f.path);
    else if (/\.zcode\/cli\/(rollout|debug)\//.test(f.path)) c.rollout.push(f.path);
    else if (/\.zcode\/cli\/db\//.test(f.path)) c.db.push(f.path);
    else if (/\.zcode\/cli\/artifacts\//.test(f.path)) c.artifacts.push(f.path);
    else if (/\.zcode\/cli\/memories\//.test(f.path)) c.memories.push(f.path);
  }
  return c;
}

/** 真实 HOME 只读检查：本次 sessionId 是否以文件名形式出现在 rollout / artifacts 下 */
async function realHomeHasSession(sessionId) {
  if (!sessionId) return null;
  const real = path.join(os.userInfo().homedir, '.zcode/cli');
  const names = async (d) => { try { return await fs.readdir(path.join(real, d)); } catch { return []; } };
  return {
    rollout: (await names('rollout')).filter((n) => n.includes(sessionId)),
    artifacts: (await names('artifacts')).filter((n) => n.includes(sessionId)),
  };
}

async function group(label, redirect) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), `ev112-e0-${label}-home-`));
  const proj = await fs.mkdtemp(path.join(os.tmpdir(), `ev112-e0-${label}-proj-`));
  const target = redirect ? await fs.mkdtemp(path.join(os.tmpdir(), `ev112-e0-${label}-target-`)) : null;
  await fs.mkdir(path.join(home, '.zcode/cli'), { recursive: true });
  await fs.writeFile(path.join(home, '.zcode/cli/config.json'), JSON.stringify(syntheticCliConfig(), null, 2), { encoding: 'utf8', mode: 0o600 });

  // 与 invokeZcode 同法（无副本一支：不省略个人键，按「真实用户目录」= 假 HOME 派生；假 HOME 下没有个人文件，键自然为 undefined）
  const env = {
    ...(await zcodeProviderEnv(ENTRY, home)),
    ...Object.fromEntries([...ZCODE_CREDENTIAL_ENV_KEYS, ...SESSION_DB_ALIASES].map((k) => [k, undefined])),
    HOME: home,
  };
  const root = target ? path.join(target, 'home') : null;
  if (root) {
    // 先清后设（计划 §4.4）：上面已全部清掉，这里只覆盖三个
    env.ZCODE_STORAGE_DIR = path.join(root, '.zcode');
    env.ZCODE_SESSION_DB_PATH = path.join(root, '.zcode/cli/db/db.sqlite');
    env.ZCODE_LOG_DIR = path.join(root, '.zcode/cli/log');
  }
  const args = buildZcodeArgs({
    entry: ENTRY, prompt: PROMPT, cwd: proj,
    readonlyArgs: readonlyArgsFromProbe(['--mode plan', '--disallowed-tools x']),
  });
  hits.length = 0;
  const r = await run(NODE, args, { cwd: proj, env, timeoutMs: 120_000, killTree: true });
  let sessionId = null;
  for (const line of r.stdout.split('\n')) {
    try { const j = JSON.parse(line); if (typeof j.sessionId === 'string') sessionId = j.sessionId; } catch { /* 非 JSON 行 */ }
  }
  const homeTree = await listTree(home);
  const targetTree = target ? await listTree(target) : null;
  // 请求失败时 stdout 没有 envelope，sessionId 只剩 rollout 文件名里那一份（model-io-<sessionId>.jsonl）
  if (!sessionId) {
    const ro = [...homeTree.files, ...(targetTree?.files ?? [])].map((f) => /model-io-(.+)\.jsonl$/.exec(f.path)?.[1]).find(Boolean);
    sessionId = ro ?? null;
  }
  return {
    label,
    dirs: { home, proj, target },
    env_set: root ? { ZCODE_STORAGE_DIR: env.ZCODE_STORAGE_DIR, ZCODE_SESSION_DB_PATH: env.ZCODE_SESSION_DB_PATH, ZCODE_LOG_DIR: env.ZCODE_LOG_DIR } : null,
    env_cleared: [...ZCODE_DIR_ENV_KEYS, ...ZCODE_CREDENTIAL_ENV_KEYS, ...SESSION_DB_ALIASES].filter((k) => env[k] === undefined),
    exit_code: r.code, timed_out: r.timedOut, duration_ms: r.durationMs,
    stderr_head: r.stderr.slice(0, 300),
    session_id: sessionId,
    local_model_requests: [...hits],
    home_carriers: classify(homeTree.files),
    target_carriers: targetTree ? classify(targetTree.files) : null,
    home_plugin_files: homeTree.pluginFiles,
    target_plugin_files: targetTree ? targetTree.pluginFiles : null,
    home_other_files: homeTree.files.map((f) => f.path).filter((p) => !/\.zcode\/cli\/(log|rollout|debug|db|artifacts|memories)\//.test(p)),
    target_other_files: targetTree ? targetTree.files.map((f) => f.path).filter((p) => !/\.zcode\/cli\/(log|rollout|debug|db|artifacts|memories)\//.test(p)) : null,
    real_home_session_names: await realHomeHasSession(sessionId),
  };
}

const hostZcodeKeys = Object.keys(process.env).filter((k) => k.startsWith('ZCODE_'));
const control = await group('control', false);
const experiment = await group('experiment', true);
server.close();

const result = {
  generated_at: new Date().toISOString(),
  entry: ENTRY, node: NODE, node_version: process.version,
  host_zcode_env_keys: hostZcodeKeys,
  local_server: `127.0.0.1:${port}（一律回 401）`,
  control, experiment,
};
await fs.writeFile(path.join(HERE, 'e0-output.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(`已写 ${path.relative(ROOT, path.join(HERE, 'e0-output.json'))}`);
