import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { REPO_ROOT } from '../helpers/fixture.js';
import { tsFiles } from '../helpers/recursive-rm.js';
import { stripNonCode } from '../helpers/strip-non-code.js';

/**
 * EV-208：`test/` 下建临时目录的调用只许经 `test/helpers/scratch.ts`（登记 + 测试文件进程退出时删）。
 *
 * 此前各测试文件自己 mkdtemp、跑完不删，每跑一遍全量就在系统临时目录多留约一千个（2026-10-04 实测，堆了十几万个）。
 * 本守卫按文件数（剥掉注释与字符串后）建临时目录的调用，分布必须与豁免表**逐项相等**：新增一处当场红，
 * 豁免项改掉而表没更新也红——同 EV-204 的 `src/` 递归删除守卫（`temp-index-cleanup.test.ts` 的 W）。
 *
 * **只看调用形态，不看「建了之后有没有删」**：豁免表里的文件将来若把自己的收尾改坏，本守卫看不出来（残余）；
 * 字符串里的调用（子进程脚本文本）与不经 mkdtemp 的固定名目录也看不到，现状两者都是零。
 */

/** 剥掉注释与字符串后数建临时目录的调用：`mkdtemp` / `mkdtempSync` / 产品侧 `makeTempDir`，接收者任意 */
function countTempDirCalls(src: string): number {
  return [...stripNonCode(src).matchAll(/\b(?:mkdtemp|mkdtempSync|makeTempDir)\s*\(/g)].length;
}

/**
 * 有意保留的裸调用（计划 r2 §1.3、§3）。计数**相等**才过。除 helper 本体外，每一项都自带可靠收尾：
 * 建出来的目录在 `finally` 或文件级 `after` 里删（断言失败也走得到），或建在同文件另一个可靠收尾的私有根之下。
 * 本守卫文件自己的样例都在字符串里、正则在正则字面量里，剥离后恒计 0，不需要表项。
 */
const TEMP_DIR_EXEMPT: Record<string, number> = {
  // helper 本体：mkdtemp 与 mkdtempSync 各一处
  'test/helpers/scratch.ts': 2,
  // before 建 work、after 删；其余 5 处建在 work 下
  'test/integration/claude-structured-probe.test.ts': 6,
  // 同上（work + 其下 run-*）
  'test/integration/codex-scrub.test.ts': 2,
  // EV-207 FC 组：各格 finally 里先恢复权限再删私有根（不用被测的 helper 收尾自己）
  'test/integration/fixture-cleanup.test.ts': 1,
  // sigtermScenario 的 finally
  'test/integration/run-protocol.test.ts': 1,
  // EV-208 SC 组：同 fixture-cleanup
  'test/integration/scratch-cleanup.test.ts': 1,
  // privateTmp / dropPrivateTmp，各格 finally
  'test/integration/selftest.test.ts': 1,
  // temps 清单 + after
  'test/integration/stub-agent-kit.test.ts': 1,
  // CREATED + after
  'test/integration/worktree-hash-cleanup.test.ts': 1,
  // 每格 finally
  'test/unit/codex-adapter.test.ts': 3,
  // tmp() 一处定义；CREATED + after、probeIn 与 F1 的 finally
  'test/unit/codex-auth-probe.test.ts': 1,
  // 建在 node_modules/ 下（不在系统临时目录），finally 删
  'test/unit/codex-events.test.ts': 1,
  // cleanup()，各格 finally 调
  'test/unit/deny-matrix.test.ts': 1,
  // 每格 finally
  'test/unit/mustread-deny.test.ts': 2,
  // CREATED + after（先恢复权限）
  'test/unit/preflight-auth-guard.test.ts': 1,
  // 私有根 TMPDIR，after 与 finally
  'test/unit/probe-fixture-cleanup.test.ts': 1,
  // after
  'test/unit/probe-verify.test.ts': 1,
  // 私有根 TMPDIR，after 与 finally
  'test/unit/temp-index-cleanup.test.ts': 1,
  // world() 的私有根，各格 finally 里 cleanup(w)；其余 2 处建在私有根下
  'test/unit/zcode-doctor-probe-home.test.ts': 3,
  // madeDirs + after
  'test/unit/zcode-full-copy-arm.test.ts': 1,
  // made + test.after
  'test/unit/zcode-mcp-adapter.test.ts': 1,
  // finally
  'test/unit/zcode-mcp-detect.test.ts': 1,
  // L.cleanup() / M.cleanup() 与各处 finally
  'test/unit/zcode-provider-env.test.ts': 5,
};

test('G0 计数：注释与字符串里的提及不算，各种接收者与同步形态都算', () => {
  assert.equal(countTempDirCalls('// await fs.mkdtemp(x)\n/* mkdtempSync(y) */'), 0, '注释');
  assert.equal(countTempDirCalls("const s = 'fs.mkdtemp(x)'; const t = `mkdtempSync(${'y'})`;"), 0, '字符串与模板串');
  assert.equal(countTempDirCalls('await fs.mkdtemp(path.join(os.tmpdir(), p));'), 1);
  assert.equal(countTempDirCalls('await fs.promises.mkdtemp (p);'), 1, 'fs.promises 接收者、括号前有空白');
  assert.equal(countTempDirCalls('const d = mkdtempSync(p);'), 1, '同步形态');
  assert.equal(countTempDirCalls('const d = await mkdtemp(p);'), 1, '解构导入的裸调用');
  assert.equal(countTempDirCalls('const d = await makeTempDir(p);'), 1, '产品侧 helper');
  assert.equal(countTempDirCalls("const d = await scratchDir('trivium-x-');"), 0, '走 helper 的不算');
});

test('G1 test/ 下建临时目录的调用只剩豁免表里的那几处，其余一律经 scratchDir', async () => {
  const files = await tsFiles(path.join(REPO_ROOT, 'test'));
  assert.ok(files.length > 100, `只扫到 ${files.length} 个文件——扫描写错了会让本条永绿`);
  const hits: Record<string, number> = {};
  for (const { name, src } of files) {
    const k = countTempDirCalls(src);
    if (k > 0) hits[name.split(path.sep).join('/')] = k;
  }
  assert.deepEqual(
    hits,
    TEMP_DIR_EXEMPT,
    'test/ 下建临时目录的调用（mkdtemp / mkdtempSync / makeTempDir）的分布与豁免表不符：跑完不删会在系统临时目录里越堆越多（EV-208）。' +
      '新增的改调 test/helpers/scratch.ts 的 scratchDir（登记 + 进程退出时删）；确属自带可靠收尾的在豁免表登记理由；豁免项已改掉的从表里删去',
  );
});
