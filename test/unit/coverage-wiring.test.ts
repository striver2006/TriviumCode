import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// 打包后测试跑在 dist/test/ 下，相对层数与源码树不同——用既有的 REPO_ROOT，别自算
import { REPO_ROOT } from '../helpers/fixture.js';
import { AGY_MUST_HAVE_PATH } from '../../src/trivium/adapters/agy-events.js';
import { ZCODE_MUST_HAVE_PATH } from '../../src/trivium/adapters/zcode-trace.js';

/**
 * 路径覆盖率的**接线**守卫（r2 代码双审 CODEX-10 ≡ GLM-08）。
 *
 * ## 为什么光测提取器不够
 *
 * `pathCoverage()` 自己有单测，判定层 `pathVerificationTier()` 也有——
 * 而这两者中间隔着一行「适配器把算出来的数填进 `CriticResult`」。
 * 删掉那一行：提取器的用例全绿（它照样算得对），判定层的用例也全绿
 * （它照样会把「没报数」判成 `unavailable`），**没有任何用例会红**，
 * 而生产上两家结构化轨迹的侧会一起退化成「路径核验档位不可判」。
 *
 * 这正是本主题反复撞见的形态：判定层做对了事，消费层没接住。
 * r1 的 `voidedSides`、r2 的命令通道分类，都是同一个模子。
 *
 * 这里用源码级断言守那一行——适配器要真跑起来得有厂商 CLI，
 * 而这条缺口的形态恰恰是「那一行被删掉」，源码级就咬得住。
 */

const ADAPTERS = path.join(REPO_ROOT, 'src/trivium/adapters');
const read = (f: string): string => readFileSync(path.join(ADAPTERS, f), 'utf8');

test('两家结构化轨迹的适配器都把覆盖率填进了结果', () => {
  for (const f of ['agy.ts', 'zcode.ts']) {
    const src = read(f);
    assert.match(
      src,
      /path_bearing_reads:/,
      `${f} 没有填 path_bearing_reads——该侧的路径核验档位会恒为 unavailable(no-counts)`,
    );
    assert.match(
      src,
      /path_bearing_reads_with_path:/,
      `${f} 没有填 path_bearing_reads_with_path`,
    );
  }
});

test('覆盖率是**无条件**填的，不能在算不出时整个省略键', () => {
  /*
   * zcode 读不到 rollout 时算不出覆盖率。上一版在那种情形下**整体省略**这两个键，
   * 于是「本族有这个概念、这次没采到」与「该族结构性没有这个概念」在留痕上同形。
   * 现在恒写，算不出就写 `null`——判定结论不变（都是 unavailable），成因分得开。
   */
  const src = read('zcode.ts');
  assert.doesNotMatch(
    src,
    /\.\.\.\(coverage[\s\S]{0,80}path_bearing_reads/,
    'zcode 又把覆盖率放回条件展开里了：算不出要写 null，不是省略键',
  );
  assert.match(
    src,
    /path_bearing_reads: coverage \? coverage\.total : null/,
    'zcode 的覆盖率要恒写：算不出时写 null，让成因落在 no-counts 而不是「该族没有这个概念」',
  );
});

test('两家的分母各自非空，且按厂商契约取值不同', () => {
  /*
   * 分母是「必然带路径」的读工具集。空集会让档位恒为
   * `unavailable(no-path-bearing-calls)`——探测面归零而留痕看不出异常。
   *
   * 两家取值不同是**有意的**：agy 侧四个读工具的路径/目录参数都是必填，
   * zcode 侧只有 `Read` 如此。断言这个差异，是防止哪天有人「统一」成一份清单——
   * 那会让其中一家凭空多出稳态 `partial` 噪声，或少掉真信号。
   */
  assert.ok(AGY_MUST_HAVE_PATH.size > 0, 'agy 侧分母不得为空');
  assert.ok(ZCODE_MUST_HAVE_PATH.size > 0, 'zcode 侧分母不得为空');
  assert.notDeepEqual(
    [...AGY_MUST_HAVE_PATH].sort(),
    [...ZCODE_MUST_HAVE_PATH].sort(),
    '两家的读工具集本就不同；真要改成一样，先改掉这条断言并在裁决件里写明理由',
  );
});
