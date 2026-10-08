// 「复盘报告双维度聚合」（M11 第 7 步）逐字沿用 evidence/m11-effort-continuation-20261008/mutation-names.mjs，下面是原注释。
// 「claude 思考等级续行解析」（M11 第 6 步跟进修复）逐字沿用 evidence/m11-effort-wiring-20261008/mutation-names.mjs，下面是原注释。
// 「思考等级透传与留痕接线」（M11 第 6 步）逐字沿用 evidence/m11-tier-flags-20261008/mutation-names.mjs，下面是原注释。
// 「档位命令行旗标」（M11 第 5 步）逐字沿用 evidence/m11-tier-config-20261007/mutation-names.mjs，下面是原注释。
// 「配置契约与档位解析」（M11 第 4 步）逐字沿用 evidence/m11-ac25-three-critic-20261007/mutation-names.mjs，下面是原注释。
// 「AC-25 三审形态检测收口」（M11 第 3 步）逐字沿用 evidence/breach-unconfirmed-release-20261006/mutation-names.mjs，下面是原注释。
// 「只读失守未确证改动放行」（EV-223）逐字沿用 evidence/breach-gate-wording-20261002/mutation-names.mjs，下面是原注释。
// 「收工闸门文案区分只读失守」（EV-98 文案部分）逐字沿用 evidence/brief-mcp-exec-ban-20261002/mutation-names.mjs，下面是原注释。
// 「任务书点名禁用MCP执行工具」（EV-191 缓解①）逐字沿用 evidence/mcp-exec-detect-20261002/mutation-names.mjs，下面是原注释。
// 逐条变异、带超时跑期望套件，存下**失败用例名与首行断言文案**（变异装置只记 fail 数、且不给套件加超时）。
// 原样照搬 evidence/critic-exec-wording-20261002/mutation-names.mjs（「MCP执行工具调用检测」EV-188，计划 r2 §3.1 变异）：
// 本主题期望套件里有经 bundle 跨进程跑的集成用例（integration/mcp-detect），重建用 --with-tests，否则预跑会假绿。
// 逐条：备份 → 变异（find 须唯一）→ 重建（含 bundle）→ 跑期望套件 → 恢复并逐字节核对；收尾重建一次。
// 用法（在仓库根，变异装置与全量检查都不在跑）：node mutation-names.mjs <规格路径> [输出 JSON 路径]
//
// **哨兵**（代码双审 r1 CODEX-04）：恢复靠 try/finally，进程被信号强制终止时 finally 不执行，src/ 会停在变异态。
// 开跑落 .mutation-names-running（内容 = 各目标文件变异前的 sha256），正常收尾删除；开跑时发现它还在就拒跑。
// 被强杀后的处置：按哨兵里的哈希逐个核对目标文件（不符的用 git 或本仓备份恢复到该哈希），核对一致后再删哨兵重跑。
// 输出 JSON 同时带目标文件的 sha256，供事后对账。
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3] ?? null;
const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const build = () => execFileSync(process.execPath, ['scripts/build.mjs', '--with-tests'], { stdio: 'ignore' });
const runSuite = (suite) => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', '--test-timeout=60000', suite], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 900_000,
  });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const body = out.split('✖ failing tests:')[0];
  const red = [...new Set([...body.matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]))];
  const msgs = [...body.matchAll(/^✖ .+?\(\d[^\n]*\n(?:[^\n]*\n){0,3}?\s*([^\n]*Error[^\n]*)/gm)].map((m) => m[1].trim().slice(0, 200));
  return {
    fail: Number(/ℹ fail (\d+)/.exec(out)?.[1] ?? (r.status === 0 ? 0 : -1)),
    timed_out: r.error?.code === 'ETIMEDOUT',
    cancelled: Number(/ℹ cancelled (\d+)/.exec(out)?.[1] ?? 0),
    red,
    firstLines: [...new Set(msgs)].slice(0, 8),
    elapsed_s: Math.round((Date.now() - t0) / 1000),
  };
};

const SENTINEL = '.mutation-names-running';
if (fs.existsSync(SENTINEL)) {
  console.error(`哨兵 ${SENTINEL} 还在：上一次运行没有正常收尾，src/ 可能停在变异态。按哨兵里的 sha256 逐个核对恢复后再删哨兵重跑。`);
  process.exit(3);
}
const base = Object.fromEntries(spec.targets.map((f) => [f, fs.readFileSync(f, 'utf8')]));
const baseHash = Object.fromEntries(spec.targets.map((f) => [f, sha(f)]));
fs.writeFileSync(SENTINEL, JSON.stringify(Object.fromEntries(spec.targets.map((f) => [f, sha(f)])), null, 2) + '\n');
const results = [];
try {
  for (const c of spec.cases) {
    const src = base[c.file];
    if (src.split(c.find).length - 1 !== 1) throw new Error(`${c.id} 的 find 不唯一`);
    fs.writeFileSync(c.file, src.replace(c.find, c.replace));
    try {
      build();
      const r = runSuite(c.expect);
      results.push({ id: c.id, desc: c.desc, suite: c.expect, ...r });
      console.error(`${c.id}：fail=${r.fail} cancelled=${r.cancelled} ${r.elapsed_s}s ⇒ ${r.red.join(' ｜ ')}`);
    } finally {
      fs.writeFileSync(c.file, src);
      if (sha(c.file) !== baseHash[c.file]) throw new Error(`恢复 ${c.file} 后哈希不符，停下人工处理`);
    }
  }
} finally {
  for (const f of spec.targets) if (sha(f) !== baseHash[f]) fs.writeFileSync(f, base[f]);
  build();
}
for (const f of spec.targets) if (sha(f) !== baseHash[f]) throw new Error(`收尾后 ${f} 与变异前哈希不符，哨兵保留，停下人工处理`);
fs.rmSync(SENTINEL);
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ targets_sha256: baseHash, results }, null, 2) + '\n');
