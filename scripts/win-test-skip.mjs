/**
 * 一次性工具（Windows 移植 P6）：把指定测试文件整体包进「非 Windows 才执行」的 else 块。
 *
 * 这些文件守的是 POSIX 专属语义（权限位、活体进程组信号、ps 故障注入）或依赖 POSIX 专属机制
 * （shebang 假 CLI、PATH 垫片）。win32 上整文件跳过并打印 skip 说明；macOS/Linux 行为零变化。
 * 等价的 Windows 语义由 test/unit/platform-win.test.ts 等专门文件承接；残余登记 Bug 清单。
 *
 * 用法：node scripts/win-test-skip.mjs "<跳过理由>" <file...>
 */
import { promises as fs } from 'node:fs';

const [reason, ...files] = process.argv.slice(2);
if (!reason || files.length === 0) {
  console.error('用法：node scripts/win-test-skip.mjs "<理由>" <file...>');
  process.exit(1);
}

for (const file of files) {
  const src = await fs.readFile(file, 'utf8');
  if (src.includes('WIN_FILE_SKIP')) {
    console.log(`${file}: 已标注，跳过`);
    continue;
  }
  // 只认**文件头部**的连续 import 区：从头逐行走，允许空行与注释；一旦出现第一条
  // 非 import、非注释的语句即停（模板串里的 import 字样骗不到这里——那之前必有代码行）
  const lines = src.split('\n');
  let cut = 0;
  let pos = 0;
  let inImport = false;
  for (const line of lines) {
    const lineEnd = pos + line.length + 1;
    const t = line.trim();
    if (inImport) {
      if (t.endsWith(';')) { cut = lineEnd; inImport = false; }
      pos = lineEnd;
      continue;
    }
    if (t === '' || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) { pos = lineEnd; continue; }
    if (t.startsWith('import ') || t === 'import' || t.startsWith('import{')) {
      if (t.endsWith(';')) cut = lineEnd;
      else inImport = true;
      pos = lineEnd;
      continue;
    }
    break;
  }
  const head = src.slice(0, cut);
  const body = src.slice(cut);
  const inject =
    `\n// WIN_FILE_SKIP（Windows 移植）：${reason}\n` +
    `// macOS/Linux 行为零变化；Windows 侧等价语义见 test/unit/platform-win.test.ts 与取消标记相关用例。\n` +
    `if (process.platform === 'win32') {\n` +
    `  console.log('skip（win32）: ${reason.replace(/'/g, '')}');\n` +
    `} else {\n`;
  const text = head + inject + body + `\n}\n`;
  await fs.writeFile(file, text, 'utf8');
  console.log(`${file}: 已包裹`);
}
