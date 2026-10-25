// 还原 Windows PowerShell 5.1 管道造成的乱码：node 的 UTF-8 输出被按 GBK（控制台代码页 936）解码后再存成 UTF-8。
// 做法：把乱码文本按 GBK 反向编码回字节，再按 UTF-8 解码。原 UTF-8 序列落在奇数字节边界处会被当时的解码吞成「?」，
// 这部分不可逆（还原文本里显示为 U+FFFD 或「?」，紧随其后的 ASCII 字符——常见是右引号——可能一并丢失，所以 JSON 一般解析不回来）。
// 判读只按字段逐行提取，不依赖整份 JSON 可解析。
// 用法：node repair-gbk-mojibake.mjs 〈乱码文件〉 〈输出文件〉
import fs from 'node:fs';

const [src, dst] = process.argv.slice(2);
const dec = new TextDecoder('gbk');
const map = new Map();
for (let a = 0x81; a <= 0xfe; a++) {
  for (let b = 0x40; b <= 0xfe; b++) {
    if (b === 0x7f) continue;
    const c = dec.decode(Uint8Array.of(a, b));
    if (c.length === 1 && c !== '�' && !map.has(c)) map.set(c, [a, b]);
  }
}
const out = [];
let lost = 0;
for (const ch of fs.readFileSync(src, 'utf8')) {
  const cp = ch.codePointAt(0);
  if (cp < 0x80) { out.push(cp); continue; }
  const m = map.get(ch);
  if (m) out.push(...m); else { lost++; out.push(0x3f); }
}
fs.writeFileSync(dst, Buffer.from(out).toString('utf8'));
console.log(`还原完成，无法反向编码的字符 ${lost} 个`);
