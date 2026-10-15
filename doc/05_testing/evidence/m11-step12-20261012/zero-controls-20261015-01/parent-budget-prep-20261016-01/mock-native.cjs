// 无外部命令、无网络的替身，指纹不是厂商CLI。
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const spec=JSON.parse(fs.readFileSync(process.env.M11_LOCAL_SPEC,'utf8'));
assert.equal(spec.kind,'local-mock-only');assert.equal(process.cwd(),spec.root);
const ticket=process.env.M11_LOCAL_PARENT_TICKET;assert(/^(admission|review):\d+$/.test(ticket??''));
const [pool,num]=ticket.split(':');
const reserved=spec.root+'/ledger/'+pool+'/reserved-'+num.padStart(4,'0')+'.json';
assert(fs.existsSync(reserved),'child不可先于reserve');
const input=fs.readFileSync(0);
const result={cli_version:'m11-local-only/0.0.0',pid:process.pid,ppid:process.ppid,ticket,reservation_exists_at_child_entry:true,input_sha256:crypto.createHash('sha256').update(input).digest('hex')};
fs.writeFileSync(spec.root+'/markers/'+crypto.randomUUID()+'.json',JSON.stringify(result),{flag:'wx',mode:0o600});
process.stdout.write(JSON.stringify(result)+'\n');
if(process.argv[2]==='exit7'){process.stderr.write('LOCAL_EXPECTED_ERROR\n');process.exitCode=7;}
if(process.argv[2]==='signal')process.kill(process.pid,'SIGTERM');
