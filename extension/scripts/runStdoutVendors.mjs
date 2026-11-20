// 隔离仓内的厂商管道采样。用本地正式配置与只读适配器，原仓的状态、审批和配置均不写。
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import YAML from 'yaml';
const root = fileURLToPath(new URL('../../', import.meta.url));
const base = await fs.realpath(await fs.mkdtemp('/tmp/tv-e1-vendor-'));
const core = path.join(root, 'skills/dual-critic/scripts/trivium.cjs');
const preload = fileURLToPath(new URL('../test/e2e/vendorTimings.cjs', import.meta.url));
const exec = promisify(execFile);
const json = async p => JSON.parse(await fs.readFile(p,'utf8'));
console.log(base);
async function sample(driver, critics) {
  const dir = path.join(base, driver);
  const topic = '只读输出计时';
  const timing = path.join(dir, 'timing');
  const dot = path.join(dir, '.trivium');
  await fs.mkdir(dot, {recursive:true,mode:0o700});
  await fs.mkdir(timing,{ mode:0o700 });
  const env = { ...process.env, TRIVIUM_ASSET_ROOT:path.join(root,'skills/dual-critic'),
    TRIVIUM_E1_TIMING_DIR:timing, NODE_OPTIONS:'--require=' + JSON.stringify(preload) };
  delete env.TRIVIUM_STUB_CRITIC;
  const local = path.join(dot,'config.local.yaml');
  const cmd = async (...args) => {
    const r = await exec(process.execPath, [core,...args,'--json'],{cwd:dir,env,maxBuffer:2**20});
    return JSON.parse(r.stdout);
  };
  let step = '准备';
  const report = { driver, critics, core, topic, samples:{}, attempts:0 };
  try {
    await fs.copyFile(path.join(root,'.trivium/config.local.yaml'),local);
    await fs.chmod(local,0o600);
    const config = YAML.parse(await fs.readFile(path.join(root,'.trivium/config.yaml'),'utf8'));
    config.runtime.run_root = path.join(base,'runs');
    await fs.writeFile(path.join(dot,'config.yaml'),YAML.stringify(config));
    await fs.writeFile(path.join(dir,'.gitignore'), '.trivium/config.local.yaml\n.trivium/state.json\n.trivium/lock/\ntiming/\n');
    await fs.writeFile(path.join(dot,'state.json'),JSON.stringify({ schema:'trivium.state.v1', gates:{} }));
    await fs.writeFile(path.join(dir,'README.md'), '# 输出时序夹具\n\n命令以 UTF-8 输出应用状态。空输入显示等待提示。\n');
    const git = (...a) => execFileSync('git',a,{cwd:dir,stdio:'ignore'});
    git('init','-q'); git('add','--','.gitignore','README.md');
    git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','隔离夹具');
    await cmd('topic','claim','--stage','plan','--topic',topic,'--driver',driver);
    const plan = path.join(dir,'.reviews',topic,'plan');
    await fs.mkdir(plan,{recursive:true});
    await fs.writeFile(path.join(plan,'2026-11-20-'+topic+'-'+driver+'.md'),'# 读取说明文件\n\n本夹具拟在终端显示 README 约定的状态，并核对空输入提示和 UTF-8。仅审查本计划与 README.md。\n');
    if (critics.includes('codex')) {
      step = 'doctor';
      await cmd('doctor','--only','codex','--native-codex','--driver',driver,'--deadline-s','360');
    }
    step = 'preflight';
    report.preflight = (await cmd('preflight','--stage','plan','--driver',driver,'--critics',critics.join(','))).ok;
    step = 'review --start';
    const start = await cmd('review','--start','--entry','B','--stage','plan','--topic',topic,'--driver',driver,
      '--critics',critics.join(','),'--focus','核对说明文件中约定的输出行为','--context','README.md');
    report.runId = start.run_id; report.attempts++; report.runDir = start.run_dir;
    let phase;
    do {
      const s = await json(path.join(start.run_dir,'status.json'));
      phase = s.phase;
      for (const [id, side] of Object.entries(s.sides ?? {})) {
        if (!side.cli?.pgid) continue;
        const list = report.samples[id] ??= [];
        if (!list.includes(side.cli.pgid)) list.push(side.cli.pgid);
      }
      if (!['success','failed','cancelled'].includes(phase)) await sleep(250);
    } while (!['success','failed','cancelled'].includes(phase));
    report.phase = phase;
    const meta = await json(path.join(plan,'_meta','run-'+start.run_id+'.json'));
    report.versions = Object.fromEntries(Object.entries(meta.critics).map(([id,c]) => [id,c.cli_version]));
    for (const [id,pids] of Object.entries(report.samples)) report.samples[id] = await Promise.all(pids.map(pid => json(path.join(timing,pid+'.json')).catch(() => ({pid, timing:'未测'}))));
  } catch (e) {
    report.exit = e.code ?? null;
    // 仅输出错误类别，不回显配置、账号和厂商响应。
    report.step = step;
    let out;
    try { out = JSON.parse(e.stdout); } catch { /* 无结构化输出 */ }
    const problems = out?.problems ?? out?.errors ?? out?.error ?? out?.checks?.filter(x => !x.ok) ?? [];
    report.detail = (Array.isArray(problems) ? problems : [problems]).map(p =>
      String(p?.message ?? p?.detail ?? p?.reason ?? p).slice(0,220));
    report.stderr = String(e.stderr ?? '').split('\n').filter(x => /^✗|失败|拒绝|找不到|没有|不能|必须|不可|初始|状态|不存在/.test(x)).map(x => x.slice(0,180)).slice(-4);
  } finally {
    await fs.rm(local,{force:true});
    await fs.writeFile(path.join(dir,'report.json'),JSON.stringify(report,null,2));
    console.log(driver,report.phase ?? '未完成',report.runId ?? '',report.exit ?? '');
  }
}
for (const driver of (process.argv.slice(2).length ? process.argv.slice(2) : ['codex','claude']))
  await sample(driver,driver === 'codex' ? ['glm','gemini','claude'] : ['codex']);
