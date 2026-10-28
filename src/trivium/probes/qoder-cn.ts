/** 显式 CN 路由探针；不会据此开放只读审核准入。 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CommonProbe, NativeModelFacts } from '../types.js';
import { run } from '../util/exec.js';
import { parseQoderCatalog, QoderModelMonitor, qoderHash } from '../adapters/qoder-cn-model.js';
import { qoderConfiguration, withQoderHome } from '../adapters/qoder-cn-native.js';

/** 已由 1.1.80 隔离真机执行证实的无工具路线；生产适配器原样消费，不重建。 */
export const QODER_MODEL_ARGS = ['--setting-sources','user','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--no-session-persistence','--output-format','stream-json'];

export async function probeQoderCn(bin:string|null,base:CommonProbe,skipModelCalls=false):Promise<CommonProbe> {
  const entry=path.resolve(bin??path.join(os.homedir(),'.local/bin/qoderclicn'));
  const configuration=await qoderConfiguration();
  return withQoderHome(async(home,config,env)=>{
    const version=await run(entry,['--version'],{cwd:home,env,timeoutMs:15000,killTree:true});
    if(version.code!==0 || !/^\d+\.\d+\.\d+$/.test(version.stdout.trim()))throw new Error('Qoder CN 版本探测失败');
    const catalog=await run(entry,['--config-dir',config,'--setting-sources','user','--list-models'],{cwd:home,env,timeoutMs:90000,killTree:true});
    if(catalog.code!==0||catalog.timedOut||catalog.truncated)throw new Error('Qoder CN 官方目录获取失败');
    const parsed=parseQoderCatalog(catalog.stdout);
    if(skipModelCalls)return {...base,entrypoint:entry,version:version.stdout.trim(),models:parsed.models,native_default:undefined};
    const configured=parsed.models.find(x=>x.toLowerCase()===configuration.model?.toLowerCase())??null;
    const monitor=new QoderModelMonitor(configured,parsed.routeLabels,parsed.models);
    const result=await run(entry,['--config-dir',config,...QODER_MODEL_ARGS,...(configured?['--model',configured]:[]),'-p','Reply OK only.'],{cwd:home,env,timeoutMs:90000,killTree:true,
      onStdoutLine:line=>monitor.line(line),onStderrLine:line=>monitor.line(line)});
    if(result.spawned===false)throw new Error('Qoder CN 默认模型进程启动失败');
    if(result.timedOut)throw new Error('Qoder CN 默认模型探测超时');
    if(result.truncated)throw new Error('Qoder CN 默认模型探测输出截断');
    if(result.code!==0)throw new Error(`Qoder CN 默认模型探测退出失败：${result.code??result.signal}`);
    if(!monitor.sawResult||monitor.resultError)throw new Error('Qoder CN 默认模型探测缺少成功最终结果');
    monitor.finish();
    const defaultLabel=parsed.models.find(x=>x.toLowerCase()===monitor.initLabel?.toLowerCase());
    if(result.code!==0||result.timedOut||result.truncated||!monitor.sawResult||monitor.resultError||!defaultLabel)throw new Error('Qoder CN 默认路由未验证');
    // 不从目录顺序猜默认；省略 --model 的 init 标签与目录项相互验证。
    const native:NativeModelFacts={model:defaultLabel,source:configured?'config':'catalog-default',observed_user_model:configuration.model,
      models:parsed.models,route_labels:parsed.routeLabels,catalog_sha256:parsed.semanticHash,catalog_raw_sha256:qoderHash(catalog.stdout),
      configuration_sha256:configuration.hash,entrypoint:entry,cli_sha256:qoderHash(await fs.readFile(entry)),cli_version:version.stdout.trim(),
      platform:process.platform,prepared_at:new Date().toISOString(),default_verified:true,invocation_args:[...QODER_MODEL_ARGS]};
    return {...base,entrypoint:entry,version:native.cli_version,version_probe:{runner:null,args:['--version'],extract:null},probed_at:native.prepared_at,models:parsed.models,native_default:native};
  });
}
