/** 采集器内存护栏；不回显秘密。native内部解密字段未取得时必须单列范围。 */
export function collectCredentialValues(text,values,boundary={skipped_metadata:0}){
  const raw=text.trim();if(raw.length>=16)values.push(raw);
  const collect=(v,key='')=>{
    if(typeof v==='string'&&v){
      if(/(?:token|secret|password|api[_-]?key|credential|authorization|machine_id)$/i.test(key)||v.length>=16)values.push(v);
      else boundary.skipped_metadata++;
    }else if(v&&typeof v==='object')for(const [k,value] of Object.entries(v))collect(value,k);
  };
  try{collect(JSON.parse(text));}catch{/* 不透明源只保护原始复制字节，不猜明文。 */}
  return boundary;
}

export function secretGuard(values,redact=s=>s){
  let leaked=false;const matches=new Set();
  return {
    scrub(input){
      let text=String(input);
      for(const [index,value] of values.entries()){
        if(typeof value!=='string'||!value)continue;
        for(const variant of new Set([value,JSON.stringify(value).slice(1,-1)])){
          if(text.includes(variant)){leaked=true;matches.add(index);text=text.split(variant).join('[REDACTED]');}
        }
      }
      return redact(text);
    },
    get leaked(){return leaked;},
    get matchIndices(){return [...matches].sort((a,b)=>a-b);},
    exitCode(current=0){return leaked?1:current;},
  };
}
