// 只读核对：从编译产物里截出 parseEffortLevels，施加 N3 / N4 的等价替换，跑 K1 续行③ 的三条断言，看先红的是哪条。
import fs from 'node:fs';
const src = fs.readFileSync(process.argv[2], 'utf8');
const start = src.indexOf('function parseEffortLevels(');
const end = src.indexOf('\n}\n', start) + 3;
const fn = src.slice(start, end);
const variants = {
  base: fn,
  N3: fn.replace('t === "" || ', ''),
  N4: fn.replace('if (!/^\\s/.test(l)) break;', ''),
};
const head = '  --effort <level>          Effort level\n                            for the current\n                            session';
const tail = '                            (a, b)';
const cells = { 空行即止: `${head}\n\n${tail}`, 纯空白行即止: `${head}\n      \n${tail}`, 顶格行即止: `${head}\nCommands:\n${tail}` };
for (const [k, body] of Object.entries(variants)) {
  if (k !== 'base' && body === fn) throw new Error(`${k} 替换没生效`);
  const f = new Function(`${body}; return parseEffortLevels;`)();
  console.log(k, Object.entries(cells).map(([n, s]) => `${n}=${JSON.stringify(f(s))}`).join('  '));
}
