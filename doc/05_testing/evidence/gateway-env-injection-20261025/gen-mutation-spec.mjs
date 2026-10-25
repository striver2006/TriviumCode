// 生成 EV-256 变异规格（计划 r2 §2.3）：每条 find 在目标文件里须恰好命中一处，替换串不含 `$` 特殊替换模式。
// 用法（仓库根）：node doc/05_testing/evidence/gateway-env-injection-20261025/gen-mutation-spec.mjs
import fs from 'node:fs';

const DIR = 'doc/05_testing/evidence/gateway-env-injection-20261025';
const ROUTE = 'src/trivium/adapters/claude-route.ts';
const ADAPTER = 'src/trivium/adapters/claude.ts';
const PROBE = 'src/trivium/probes/claude.ts';
const DIRECTORY = 'src/trivium/probes/claude-directory.ts';
const IT = 'dist/test/test/integration/claude-gateway-env.test.js';
const UNIT = 'dist/test/test/unit/claude-adapter.test.js';

const inlineEnv = 'settings: JSON.stringify({ env: routeContext.getStore()?.route.settingsEnv ?? {} })';
const cases = [
  { id: 'M1', desc: '次序颠倒：先注网关键、后展开清除补丁（同名键被父进程清除覆盖）', file: ROUTE,
    find: '  return { ...route.env, ...route.settingsEnv };',
    replace: '  return { ...route.settingsEnv, ...route.env };', expect: IT },
  { id: 'M1b', desc: '同 M1，对单测 G1', file: ROUTE,
    find: '  return { ...route.env, ...route.settingsEnv };',
    replace: '  return { ...route.settingsEnv, ...route.env };', expect: UNIT },
  { id: 'M2', desc: '出口漏注：invokeClaude 只给清除补丁', file: ADAPTER,
    find: '    env: opts.route ? claudeInvocationEnv(opts.route) : undefined,',
    replace: '    env: opts.route?.env,', expect: IT },
  { id: 'M3', desc: '出口漏注：探针 routeInvocation 只给清除补丁', file: PROBE,
    find: 'env: ctx ? claudeInvocationEnv(ctx.route) : claudeRouteEnv(null) };',
    replace: 'env: ctx?.route.env ?? claudeRouteEnv(null) };', expect: IT },
  { id: 'M4', desc: '某臂仍内联：记忆对照臂的 --settings 带 env 段', file: PROBE,
    find: '    control: probeArgs({ prompt, readonlyFlags: projectMemoryControlArgs(READONLY_INVARIANTS) }),',
    replace: `    control: probeArgs({ prompt, readonlyFlags: projectMemoryControlArgs(READONLY_INVARIANTS), ${inlineEnv} }),`, expect: IT },
  { id: 'M5', desc: '某臂仍内联：verbose 阴性对照的 --settings 带 env 段', file: PROBE,
    find: "  return probeArgs({ prompt: '只回复 OK 两个字母，不要调用任何工具。', omitVerbose: true });",
    replace: `  return probeArgs({ prompt: '只回复 OK 两个字母，不要调用任何工具。', omitVerbose: true, ${inlineEnv} });`, expect: IT },
  { id: 'M6', desc: '某臂仍内联：目录臂把网关 env 并进 deny 载荷', file: DIRECTORY,
    find: 'readonlyArgs: [...input.readonlyFlags], schemaJson, settingsJson: settings.json, timeoutMs: 180_000 });',
    replace: "readonlyArgs: [...input.readonlyFlags], schemaJson, settingsJson: JSON.stringify({ ...JSON.parse(settings.json ?? '{}'), env: input.route.settingsEnv }), timeoutMs: 180_000 });",
    expect: IT },
  { id: 'M6b', desc: '某臂漏注：目录臂拿到的路线丢了网关键', file: DIRECTORY,
    find: '      const outcome = await invoke({ bin: input.route.bin!, route: input.route, cwd: fx!.root,',
    replace: '      const outcome = await invoke({ bin: input.route.bin!, route: { ...input.route, settingsEnv: {} }, cwd: fx!.root,',
    expect: IT },
  { id: 'M7', desc: '某臂仍内联：探活形态（settingsJson 为 null）补一份 {"env":…}', file: ADAPTER,
    find: '  const args = [...(opts.route?.prefix ?? []), ...buildClaudeArgs(opts)];',
    replace: '  const args = [...(opts.route?.prefix ?? []), ...buildClaudeArgs({ ...opts, settingsJson: opts.settingsJson ?? (opts.route && Object.keys(opts.route.settingsEnv).length > 0 ? JSON.stringify({ env: opts.route.settingsEnv }) : null) })];',
    expect: IT },
  { id: 'M8', desc: '某臂漏注：verbose 阴性对照绕过 routeInvocation 的注入、只给清除补丁', file: PROBE,
    find: 'const invocation = routeInvocation(bin, verboseNegativeControlArgs());',
    replace: 'const invocation = { ...routeInvocation(bin, verboseNegativeControlArgs()), env: routeContext.getStore()?.route.env ?? claudeRouteEnv(null) };',
    expect: IT },
  { id: 'M9', desc: '键集外溢：extractSettingsEnv 去掉前缀过滤', file: ROUTE,
    find: "    if (/^(ANTHROPIC_|CLAUDE_)/.test(k) && typeof v === 'string' && v.length > 0) out[k] = v;",
    replace: "    if (typeof v === 'string' && v.length > 0) out[k] = v;", expect: IT },
  { id: 'M10', desc: '脱敏丢失：invokeClaude 的 stdout 不过 scrub', file: ADAPTER,
    find: '    stdout: scrub(r.stdout),',
    replace: '    stdout: r.stdout,', expect: IT },
  { id: 'M11', desc: '零变化破坏：未注入时不清父进程路线变量', file: ROUTE,
    find: '  return { ...route.env, ...route.settingsEnv };',
    replace: '  return Object.keys(route.settingsEnv).length > 0 ? { ...route.env, ...route.settingsEnv } : {};', expect: IT },
  // 代码审 GLM-01 补：探针执行封装的输出脱敏
  { id: 'M12', desc: '脱敏丢失：探针 execArgv 的 stdout 不过 scrub', file: PROBE,
    find: '  const stdout = scrubGatewayEnv(r.stdout, gatewayEnv);',
    replace: '  const stdout = r.stdout;', expect: IT },
  { id: 'M12b', desc: '脱敏丢失：探针 execArgv 的 stderr 不过 scrub', file: PROBE,
    find: '  const stderr = scrubGatewayEnv(r.stderr, gatewayEnv);',
    replace: '  const stderr = r.stderr;', expect: IT },
];

const targets = [ROUTE, ADAPTER, PROBE, DIRECTORY];
const src = Object.fromEntries(targets.map((f) => [f, fs.readFileSync(f, 'utf8')]));
for (const c of cases) {
  const n = src[c.file].split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id}：find 在 ${c.file} 命中 ${n} 处，须恰好 1 处`);
  if (/\$[$&`'0-9<]/.test(c.replace)) throw new Error(`${c.id}：替换串含 $ 特殊替换模式`);
}
const spec = { targets, suites: [IT, UNIT], cases };
fs.writeFileSync(`${DIR}/mutation-spec.json`, JSON.stringify(spec, null, 2) + '\n');
console.log(`已生成 ${cases.length} 条，find 全部唯一`);
