/** Qoder CN 官方目录、声明与流式回读。Auto/Fast 是路由标签，不是底层模型。 */
import { createHash } from 'node:crypto';
import type { NativeModelFacts, NativeModelRequest } from '../types.js';

export class QoderModelConfigurationError extends Error {}
export class QoderModelFallbackError extends Error {}
export const qoderHash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const labelKey = (s: string): string => s.toLowerCase();

/** 1.1.80 隔离官方认证目录输出：MODEL 标题，一行一个标识。其他格式拒绝。 */
export function parseQoderCatalog(stdout: string): { models: string[]; routeLabels: string[]; semanticHash: string } {
  const lines = stdout.trim().split(/\r?\n/).map(x => x.trim());
  if (lines.shift() !== 'MODEL' || lines.length === 0 || lines.some(x => !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(x))) {
    throw new QoderModelConfigurationError('Qoder CN 官方目录格式未知/为空；只接受已取证的隔离 MODEL 单列格式');
  }
  if (new Set(lines.map(labelKey)).size !== lines.length) throw new QoderModelConfigurationError('Qoder CN 目录项重复或歧义');
  const routeLabels = lines.filter(x => /^(auto|fast)$/i.test(x)).sort();
  const models = [...lines].sort();
  return { models, routeLabels, semanticHash: qoderHash(JSON.stringify({ models, routeLabels })) };
}

/** 支持 JSON 字符串/转义与两种注释；拒绝环境引用和 JSON.parse 不接受的语法。 */
export function parseQoderSettings(text: string): string | null {
  let clean = '', string = false, escape = false, line = false, block = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!, next = text[i + 1];
    if (line) { if (c === '\n') { line = false; clean += c; } continue; }
    if (block) { if (c === '*' && next === '/') { block = false; i++; } else if(c === '\n')clean += c; continue; }
    if (string) { clean += c; if(escape)escape=false; else if(c==='\\')escape=true; else if(c==='"')string=false; continue; }
    if(c==='"') { string=true; clean+=c; }
    else if(c==='/' && next==='/') { line=true; clean+=' '; i++; }
    else if(c==='/' && next==='*') { block=true; clean+=' '; i++; }
    else clean+=c;
  }
  if(block || string)throw new QoderModelConfigurationError('Qoder CN 配置注释/字符串未闭合');
  let parsed: unknown;
  try {parsed=JSON.parse(clean);}catch {throw new QoderModelConfigurationError('Qoder CN settings.json JSON 语法无效（支持注释，不支持尾逗号）');}
  const settings = object(parsed);
  if(!settings)throw new QoderModelConfigurationError('Qoder CN 配置必须为对象');
  const m=settings['model'];
  if(m===undefined)return null;
  const model=object(m);
  if(!model)throw new QoderModelConfigurationError('Qoder CN model 必须为对象');
  const name=model['name'];
  if(name===undefined)return null;
  if(typeof name!=='string'||!name.trim()||/\$\{|\$[A-Za-z_]|%[A-Za-z_][A-Za-z0-9_]*%/.test(name))throw new QoderModelConfigurationError('Qoder CN model.name 缺失或使用不支持的环境引用');
  return name;
}

export function validateQoderFacts(f: NativeModelFacts): NativeModelFacts {
  if(!f || !Array.isArray(f.models) || !f.models.length || !f.default_verified || !f.models.includes(f.model))throw new QoderModelConfigurationError('Qoder CN 缺少已验证的官方目录/默认');
  const normalized = {models:[...f.models].sort(),routeLabels:[...f.route_labels].sort()};
  if(qoderHash(JSON.stringify(normalized))!==f.catalog_sha256)throw new QoderModelConfigurationError('Qoder CN 目录语义指纹不一致');
  if(!f.entrypoint || !f.cli_version || !/^[a-f0-9]{64}$/.test(f.cli_sha256) || !Number.isFinite(Date.parse(f.prepared_at)))throw new QoderModelConfigurationError('Qoder CN 默认来源绑定不完整');
  if(!Array.isArray(f.invocation_args)||!f.invocation_args.length||f.invocation_args.some(x=>typeof x!=='string'))throw new QoderModelConfigurationError('Qoder CN 受测调用配方缺失');
  if(!['catalog-default','config'].includes(f.source) || (f.source==='config' && f.observed_user_model?.toLowerCase()!==f.model.toLowerCase()))throw new QoderModelConfigurationError('Qoder CN 原生配置默认来源不一致');
  return f;
}

export function qoderModelRequest(facts: NativeModelFacts, requested: string, origin: string): NativeModelRequest {
  validateQoderFacts(facts);
  const canonical=facts.models.find(m=>labelKey(m)===labelKey(requested));
  if(!canonical)throw new QoderModelConfigurationError(`Qoder CN 请求模型不在官方目录：${requested}`);
  return {facts:structuredClone(facts),requested:canonical,override:origin==='probe_default'?null:requested,origin};
}

export interface QoderEffectiveModel {label: string | null; effective: string | null; source: 'envelope' | 'unverified'}

/** 首因粘滞；不扫描 assistant/user/tool 正文或嵌入的 JSON。 */
export class QoderModelMonitor {
  readonly labels: string[] = [];
  readonly usageLabels: string[] = [];
  initLabel: string | null = null;
  failure: string | null = null;
  sawResult = false;
  resultError = false;
  resultText: string | null = null;
  constructor(readonly requested: string | null, readonly routeLabels: readonly string[] = ['Auto','Fast'], readonly catalogModels: readonly string[] = []) {}
  private observe(v: unknown): void {
    if(typeof v!=='string'||!v.trim())return;
    const label=v.trim();
    if(!this.labels.includes(label))this.labels.push(label);
    const requested=this.requested??this.initLabel;
    if(requested===null)return;
    const route=this.routeLabels.some(x=>labelKey(x)===labelKey(requested));
    if(route && this.routeLabels.some(x=>labelKey(x)===labelKey(label)) && labelKey(label)!==labelKey(requested))this.failure ??= `路由标签发生变化：请求 ${requested}，回读 ${label}`;
    if(!route && labelKey(label)!==labelKey(requested))this.failure ??= `生效标签与精确请求不符：请求 ${requested}，回读 ${label}`;
  }
  line(text: string): void {
    let event: Record<string, unknown> | null;
    try {event=object(JSON.parse(text));} catch {
      if(/^\s*Model\s+["'][^"']+["']\s+is not available(?: right now)?;?\s+using\s+["'][^"']+["']\s+instead\.(?:\s+Use \/model to choose another model\.)?\s*$/i.test(text))this.failure ??= `原生模型回退：${text.trim()}`;
      return;
    }
    if(!event)return;
    if(event['type']==='system' && event['subtype']==='init') {
      const label=event['model'];
      if(typeof label==='string'&&label.trim()) {
        if(this.initLabel===null)this.initLabel=label.trim();
        else if(labelKey(this.initLabel)!==labelKey(label.trim()))this.failure ??= '原生 init 模型标签发生变化';
      }
      this.observe(label);
    }
    if(event['type']==='assistant')this.observe(object(event['message'])?.['model']);
    if(event['type']==='result') {
      this.sawResult=true;
      this.resultError=event['is_error']===true || event['subtype']!=='success';
      this.resultText=typeof event['result']==='string'?event['result']:null;
      const usage=object(event['modelUsage']);
      if(usage)for(const k of Object.keys(usage)) {
        if(!this.usageLabels.includes(k))this.usageLabels.push(k);
        // 当前真机 qfmodel 与目录 Qwen3.8-Flash 同时出现；不能凭这一例猜别名。
        // 只在目录已认识该键时将其用作模型变化的佐证，否则独立保留未知计费键。
        if(this.catalogModels.some(m=>labelKey(m)===labelKey(k)))this.observe(k);
      }
    }
  }
  readback(): QoderEffectiveModel {
    const label=this.labels.at(-1)??null;
    const actual=this.labels.filter(x=>!this.routeLabels.some(r=>labelKey(r)===labelKey(x))).at(-1)??null;
    return {label,effective:actual,source:actual===null?'unverified':'envelope'};
  }
  finish(): QoderEffectiveModel {
    if(this.failure)throw new QoderModelFallbackError(this.failure);
    const readback=this.readback();
    if(readback.label===null)throw new QoderModelFallbackError(this.requested===null?'默认探测未核实模型：没有原生 init 回读':`未核实模型：请求 ${this.requested}，没有原生回读`);
    return readback;
  }
}

export function readQoderEffectiveModel(text: string): QoderEffectiveModel {
  const monitor=new QoderModelMonitor('Auto');
  for(const line of text.split(/\r?\n/))monitor.line(line);
  if(!monitor.labels.length)return {label:null,effective:null,source:'unverified'};
  return monitor.finish();
}

export function assertQoderModelDidNotFallback(resolved: {requested:string}, stdout: string, stderr: string): QoderEffectiveModel {
  const monitor=new QoderModelMonitor(resolved.requested);
  for(const line of [...stdout.split(/\r?\n/),...stderr.split(/\r?\n/)])monitor.line(line);
  return monitor.finish();
}
