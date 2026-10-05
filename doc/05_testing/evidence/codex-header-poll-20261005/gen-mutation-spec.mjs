// 生成「header探测计时器收尾」（EV-205）的源码变异规格（计划 r2 §4.3）。
// 照搬 evidence/goal-fallback-plan-final-20261005/gen-mutation-spec.mjs 的形态：find 串从源码截取、逐条核对在目标文件里
// 恰好出现一次，替换串扫一遍 String.replace 的特殊替换模式，再落盘。期望套件只有一个：codex-header-drain。
// 用法（在仓库根）：node doc/05_testing/evidence/codex-header-poll-20261005/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const CX = 'src/trivium/probes/codex.ts';
const SUITE = 'dist/test/test/unit/codex-header-drain.test.js';

const FIN = '  } finally {\n    if (poll.timer) clearInterval(poll.timer);\n  }\n';
const TAIL = '          }, 50);\n        },\n      },\n    );\n' + FIN;
const STOP = '              stop();\n';
const COND = '            if (sawDivider || want.every((k) => seen.has(k))) {\n';

const cases = [
  { id: 'M1', desc: '删掉 finally 里的清理，恢复 31 s 兜底（恢复只靠兜底）', file: CX, find: TAIL,
    replace: '          }, 50);\n          setTimeout(() => clearInterval(poll.timer!), 31_000).unref();\n        },\n      },\n    );\n  } finally {\n  }\n',
    expect: SUITE },
  { id: 'M2', desc: '删掉 finally 里的清理、不恢复兜底', file: CX, find: FIN,
    replace: '  } finally {\n  }\n', expect: SUITE },
  { id: 'M3', desc: '轮询见到 header 后不调 stop()（不早退）', file: CX, find: STOP,
    replace: '              void stop;\n', expect: SUITE },
  { id: 'M4', desc: '早退判据去掉分隔线一支', file: CX, find: COND,
    replace: '            if (want.every((k) => seen.has(k))) {\n', expect: SUITE },
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
