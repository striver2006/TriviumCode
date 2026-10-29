// 生成 stress2.cjs：把 run_root 从 BASE/runs（项目内）挪到 BASE+'-runs'（项目外），其余逐字相同
'use strict';
const fs = require('node:fs');
let s = fs.readFileSync(__dirname + '/stress.cjs', 'utf8');
const needle = "${BASE.replace(/\\\\/g, '/')}/runs";
const repl = "${(BASE + '-runs').replace(/\\\\/g, '/')}";
if (!s.includes(needle)) { console.log('NEEDLE NOT FOUND'); process.exit(1); }
s = s.split(needle).join(repl);
fs.writeFileSync(__dirname + '/stress2.cjs', s);
console.log('stress2.cjs written: run_root moved outside project');
