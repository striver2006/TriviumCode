// 显式安装替身父级控制，模拟第二个启动边界；不依赖子环境NODE_OPTIONS。
require('./lab-parent-preload.cjs');
const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const spec=JSON.parse(fs.readFileSync(process.env.M11_LOCAL_SPEC,'utf8'));
try{
 const child=cp.spawn(process.execPath,[path.join(__dirname,'mock-native.cjs'),'ok'],{cwd:spec.root,stdio:['pipe','pipe','pipe'],env:{...process.env,NODE_OPTIONS:''}});
 child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);child.stdin.end('nested-input');
 child.once('close',code=>{process.exitCode=code??70;});
}catch(e){process.stderr.write(e.message+'\n');process.exitCode=75;}
