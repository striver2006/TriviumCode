/** 仅合成与本地shell，不启动厂商CLI或正式审查。 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {candidateRegistry,discoveryRows,catalogMatches,shellQuote,names,absent,main} from './driver-cli.mjs';

test('隔离开关变换仅修改指定注册块，不跨越既有Driver或开启审核',()=>{
  const source="const table = [\n  {\n    id: 'existing',\n    driverEnabled: true,\n  },\n  {\n    id: 'candidate',\n    criticEnabled: false,\n    defaultSelected: false,\n    driverEnabled: false,\n  },\n];";
  const changed=candidateRegistry(source,['candidate']);
  assert.equal(changed,source.replace('driverEnabled: false','driverEnabled: true'));
  assert.throws(()=>candidateRegistry(source,['missing']));
  assert.throws(()=>candidateRegistry(source,[]));
  assert.throws(()=>candidateRegistry(source,['candidate','candidate']));
  assert.throws(()=>candidateRegistry(changed,['candidate']));
});

test('两种发现格式核完整七项、唯一数量及原生来源，不接受只提到技能名',()=>{
  const entries=names.map(name=>({name,installed:`/private/var/fixture/skills/${name}/SKILL.md`}));
  const kimi=entries.map(e=>`- ${e.name}: synthetic\n  Path: ${e.installed}`).join('\n');
  const qoder=entries.map(e=>`${e.name} [Enabled]\n  Description: synthetic\n  Location:    ${e.installed.replace('/private/var/','/var/')}`).join('\n\n');
  for(const text of [kimi,qoder]){
    const rows=discoveryRows(text);assert.equal(rows.length,7);assert.equal(catalogMatches(rows,entries),true);
    assert.equal(catalogMatches(rows.slice(1),entries),false);
    assert.equal(catalogMatches([...rows,rows[0]],entries),false);
    assert.equal(catalogMatches(rows.map((r,i)=>i? r:{...r,source:'/other/SKILL.md'}),entries),false);
  }
  assert.equal(catalogMatches(discoveryRows(names.join(' ')),entries),false);
});

test('单引号转抄保留中文空格、美元符、反引号及旗标字面',{skip:process.platform==='win32'},()=>{
  const value="中文 空格 O'Bob $HOME `literal` --尾 $(literal)";
  assert.equal(execFileSync('/bin/sh',['-c',`printf '%s' ${shellQuote(value)}`],{encoding:'utf8'}),value);
});

test('清理回读只接受ENOENT，读取失败不得伪装已删除',async()=>{
  const self=fileURLToPath(import.meta.url);
  assert.equal(await absent(self),false);
  assert.equal(await absent(self+'.missing'),true);
  await assert.rejects(()=>absent(self+'/missing'),{code:'ENOTDIR'});
  // ENOTDIR 与 ENOENT 不同，不得变成「不存在」。
  const original=fs.lstat;
  try{fs.lstat=async()=>{throw Object.assign(Error('denied'),{code:'EACCES'});};await assert.rejects(()=>absent('fixture'),/denied/);}
  finally{fs.lstat=original;}
});

test('无效或重复参数在临时根和真实客户端启动之前拒绝',async()=>{
  await assert.rejects(()=>main(['--agent','kimi','--case','review']),/未知参数拒绝/);
  await assert.rejects(()=>main(['--agent','kimi','--agent','kimi']),/参数/);
});
