/**
 * 一次性工具（Windows 移植 P6）：给测试文件里引号字符串中的 POSIX 绝对路径注入 ${ABS} 盘符根前缀。
 *
 * 背景：win32 的 path.isAbsolute 不认 '/proj' 这类盘相对形态，纯逻辑测试（命令解析/路径归一）
 * 的 POSIX 字面路径需要补 'D:' 根。macOS 上 ABS 为空串，字面量逐字不变。
 *
 * 用法：node scripts/win-test-prefix.mjs <file...>
 * 幂等：已有 const ABS 的文件跳过注入定义但照常转换；不改注释行。
 */
import { promises as fs } from 'node:fs';

const SEGS = 'proj|tmp|private|Users|etc|var|opt|home|Applications'; // 不含 dev/bin/usr：那是 shell 域字面路径（Git Bash 按字面认）
// 引号内、且该路径段前是引号开头或空白的形态——避免把 https://x/y 或 a/b 误伤。
// 检测用非全局实例（避免 /g 的 lastIndex 状态污染），替换用全局实例。
const IN_STR_TEST = new RegExp(`(?<=['"\` ])/(?=(?:${SEGS})(?:/|['"\`]|$))`);
const IN_STR = new RegExp(`(?<=['"\` ])/(?=(?:${SEGS})(?:/|['"\`]|$))`, 'g');

// 检测/替换都带前置哨兵空格：路径在字符串开头时（如 '/proj'），后行断言需要引号或空白
// 在 '/' 之前——哨兵代行这个角色，替换后剥掉。
function hits(body) {
  return IN_STR_TEST.test(' ' + body);
}

function convertBody(body) {
  return (' ' + body).replace(IN_STR, '${ABS}/').slice(1);
}

function transformLine(line) {
  const out = [];
  let i = 0;
  let changed = false;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "'" || ch === '"') {
      const j = line.indexOf(ch, i + 1);
      if (j === -1) { out.push(line.slice(i)); break; }
      const body = line.slice(i + 1, j);
      if (body.includes('`') || body.includes('${') || body.includes("'") || body.includes('"') || !hits(body)) {
        out.push(line.slice(i, j + 1));
      } else {
        out.push('`' + convertBody(body) + '`');
        changed = true;
      }
      i = j + 1;
      continue;
    }
    if (ch === '`') {
      const j = line.indexOf('`', i + 1);
      if (j === -1) { out.push(line.slice(i)); break; }
      const body = line.slice(i + 1, j);
      if (body.includes('${') || !hits(body)) {
        out.push(line.slice(i, j + 1));
      } else {
        out.push('`' + convertBody(body) + '`');
        changed = true;
      }
      i = j + 1;
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return [out.join(''), changed];
}

for (const file of process.argv.slice(2)) {
  const src = await fs.readFile(file, 'utf8');
  const lines = src.split('\n');
  const outLines = [];
  let changed = 0;
  let inBlock = false;
  for (const line of lines) {
    const st = line.trim();
    if (inBlock) { outLines.push(line); inBlock = !st.endsWith('*/'); continue; }
    if (st.startsWith('/*') && !st.endsWith('*/')) { outLines.push(line); inBlock = true; continue; }
    if (st.startsWith('//') || st.startsWith('*')) { outLines.push(line); continue; }
    const [newline, did] = transformLine(line);
    if (did) changed += 1;
    outLines.push(newline);
  }
  let text = outLines.join('\n');
  if (changed > 0 && !text.includes('const ABS')) {
    // 注入点：最后一个**顶层完整** import 语句之后（跨行 import 的结束行以 'from ...;' 收尾）
    const importEnds = [...text.matchAll(/^import[\s\S]*?from\s+'[^']+';\s*$/gm)].map((m) => m.index + m[0].length);
    const simpleImports = [...text.matchAll(/^import\s+'[^']+';$/gm)].map((m) => m.index + m[0].length);
    const candidates = [...importEnds, ...simpleImports];
    if (candidates.length === 0) { console.error(`${file}: 找不到 import 注入点`); process.exitCode = 1; continue; }
    const cut = Math.max(...candidates);
    const inject = "\nimport { IS_WIN } from '../helpers/platform.js';\n\n// Windows 移植：win32 的 path.isAbsolute 不认 '/proj' 这类盘相对形态；引号串里的 POSIX 绝对路径统一补 ${ABS} 盘符根（macOS 上为空串，字面不变）\nconst ABS = IS_WIN ? 'D:' : '';\n";
    text = text.slice(0, cut) + inject + text.slice(cut);
  }
  await fs.writeFile(file, text, 'utf8');
  console.log(`${file}: converted ${changed} lines`);
}
