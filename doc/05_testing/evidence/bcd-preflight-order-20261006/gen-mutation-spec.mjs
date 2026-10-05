// 生成「命令 B/C/D 先解析后预检」（EV-126）的变异规格。本批未走双审，规格由执笔方自定。
// 变异目标是 skill 源 `skills-src/partials/review/body.md`：`scripts/mutation-check.mjs` 的闸 4 只认 `dist/test` 下的
// 被测产物（`.ts` → `.js`），`.md` 源没有对应产物，装置无法证明「变异进了产物」，故本题只用逐条预跑脚本
// （mutation-names.mjs：备份 → 变异 → 重建 → 跑套件 → 恢复并逐字节核对）；契约用例在测试时现读 skills-src 渲染，变异直接生效。
// 用法（在仓库根）：node doc/05_testing/evidence/bcd-preflight-order-20261006/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const BODY = 'skills-src/partials/review/body.md';
const SUITE = 'dist/test/test/contract/entry-render-parity.test.js';
const PF = 'TV preflight --stage {{STAGE}} --driver {{DRIVER}} --critics <critics> [--profile <名称>] [--model-<审核者 id> <模型> …] --json\n';
const STEP1 = '### 1. 解析主题与被审对象\n';

const cases = [
  {
    id: 'M1', desc: '预检不带 --critics（改前的预检命令形态）', file: BODY, find: PF,
    replace: 'TV preflight --stage {{STAGE}} --driver {{DRIVER}} --json\n', expect: SUITE,
  },
  {
    id: 'M2', desc: '在解析之前再放一条预检（退回「先预检后解析」）', file: BODY, find: STEP1,
    replace: '运行 `TV preflight --stage {{STAGE}} --driver {{DRIVER}} --critics <critics> --json`。\n\n' + STEP1, expect: SUITE,
  },
];

for (const c of cases) {
  const n = read(c.file).split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里命中 ${n} 处`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
  if ([...c.replace].some((ch, i) => ch.charCodeAt(0) === 36 && /[$&`'0-9<]/.test(c.replace[i + 1] ?? ''))) {
    throw new Error(`${c.id} 的 replace 含特殊替换模式`);
  }
}
const spec = {
  targets: [...new Set(cases.map((c) => c.file))],
  suites: [...new Set(cases.map((c) => c.expect))],
  cases,
};
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.error(`规格 ${cases.length} 条 → ${OUT}`);
