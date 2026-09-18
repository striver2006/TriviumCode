/**
 * **裁决件里的承诺必须真的落地**（BACKLOG EV-50，代码双审 r3）。
 *
 * ## 这条用例要买的东西
 *
 * 裁决件是一份**完成声明**：它写着「我会怎么改」，走完 `gate --check`、
 * 由项目负责人审批，然后成为归档件。而 `gate --check` **只查每条意见有没有裁决，
 * 不查承诺的落点是否被改**——于是「写了没做」这件事在整条流水线上没有任何闸。
 *
 * 实证：r1 有三条承诺没落地，r2 有四条。**数字在涨**，而 r2 为此登记的 EV-50
 * 给的对策是「下一轮开跑前手工比对一遍」——那道闸从登记之后**一次都没被执行过**。
 * 本仓这一年补的全部是「把纪律换成机器判据」，唯独在「我写的承诺」这个论域上，
 * 给的一直是纪律。这个文件是第一次给它配机器判据。
 *
 * ## 判据与它的边界
 *
 * 它**判不了「改对了没有」**——那不可判定。它只判一件事：
 * **裁决件自己声明为可核验的那些串，在工作树里真的存在（或真的不存在）。**
 *
 * 承诺方在裁决件里写一行「落点核验」，列出本轮改完之后必须成立的 grep 事实：
 *
 * ```text
 * <!-- 落点核验: +deny_bytes +backedUp -「含圆括号或换行」 -->
 * ```
 *
 * `+串` = 改完后该串必须在仓里出现；`-串` = 必须不再出现（引号内的中文措辞同理）。
 * 没写这一行的裁决件**不参与本条校验**——旧归档件不追溯，新承诺自愿加严。
 *
 * ## 写 `-串` 的一条硬要求（第一次跑就撞上了）
 *
 * **`-串` 必须精确到断言形态，不能写成那句话的关键词。**
 * 改口径时通常会**引述旧措辞说明它错在哪**（本仓的注释惯例就是这样），
 * 于是裸关键词会把新写的那句引述也算成「旧断言还在」——r3 首跑两条 `-` 全是这么误报的。
 * 写法：连同标点与上下文一起取——取到足以与引述区分开为止，
 * 而不是只取那句话里最显眼的几个字。
 *
 * （上面那个格式示例里的串是**假的**，别照抄。本文件按构造会引用这类串，
 * 所以它把自己排除在搜索论域外——第一次跑时正是被自己的文档块绊了一下，
 * **守卫的文档块是守卫的一部分，不是旁白**。）
 *
 * **它抓不住的**：承诺里那些无法化成 grep 事实的部分（「把理由写准」「补一条用例」）。
 * 所以它是**下界不是上界**——但 r2 那四条里有三条（`deny_bytes` 零出现、
 * 探针侧旧口径仍在、设计里「复算为」零出现）**都会被它当场抓住**，
 * 这个覆盖率已经足够说明问题不在判据难写，而在一直没去写。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT } from '../helpers/fixture.js';

const MARKER = /<!--\s*落点核验:\s*([^>]*?)\s*-->/g;

/** 递归找 `.reviews/` 下所有 `*-response-claude.md` */
async function responseFiles(dir: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await responseFiles(full)));
    else if (e.name.endsWith('-response-claude.md')) out.push(full);
  }
  return out;
}

/**
 * 仓内全文搜一个串。
 *
 * **论域刻意排除两处**：
 *
 * 1. `.reviews/`——裁决件自己就写着那些串，算进来的话 `+` 恒成立、`-` 恒不成立，
 *    两个方向同时失效，判据变成纯空转；
 * 2. **本文件自己**——守卫的文档块要解释怎么写这些串，按构造就会引用它们。
 *    与第 1 条同一条理由：守卫自身的源码不属于被断言面。
 * 3. **打包产物**（`dist/`、`skills/dual-critic/scripts/*.cjs`）——它们是**派生面**，
 *    内容由源码决定。首跑时 `trivium.cjs` 里那条旧措辞就误报过一次：
 *    `--tests-only` 不重建 bundle，于是产物比源码旧。判据要盯的是源，
 *    产物与源的一致性由构建负责，不该在这里重复判一遍。
 */
const SELF = 'test/unit/promise-landing.test.ts';
/** 派生面：内容由源码决定，不参与「承诺落地」判定 */
const DERIVED = [/^dist\//, /^skills\/dual-critic\/scripts\/.*\.cjs$/];

function existsInRepo(needle: string): boolean {
  const r = spawnSync(
    'grep',
    ['-rFl', '--exclude-dir=.reviews', '--exclude-dir=node_modules', '--exclude-dir=dist',
      '--exclude-dir=.git', needle, '.'],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60_000 },
  );
  if (r.status !== 0) return false;
  const hits = (r.stdout ?? '')
    .split('\n')
    .map((l) => l.replace(/^\.\//, '').trim())
    .filter((l) => l.length > 0 && l !== SELF && !DERIVED.some((re) => re.test(l)));
  return hits.length > 0;
}

test('裁决件声明的落点核验串，逐条与工作树比对（EV-50）', async () => {
  const files = await responseFiles(path.join(REPO_ROOT, '.reviews'));
  const failures: string[] = [];
  let checked = 0;

  for (const f of files) {
    const src = await fs.readFile(f, 'utf8');
    const rel = path.relative(REPO_ROOT, f);
    for (const m of src.matchAll(MARKER)) {
      // 按空白切成若干 `+串` / `-串`；带「」的中文措辞按整体取
      const spec = m[1] ?? '';
      for (const item of spec.match(/[+-](?:「[^」]*」|\S+)/g) ?? []) {
        const sign = item[0];
        const needle = item.slice(1).replace(/^「|」$/g, '');
        if (!needle) continue;
        checked += 1;
        const present = existsInRepo(needle);
        if (sign === '+' && !present) {
          failures.push(`${rel}\n    承诺「${needle}」会出现在仓里——**全仓零命中，这条承诺没落地**`);
        } else if (sign === '-' && present) {
          failures.push(`${rel}\n    承诺「${needle}」会被改掉——**它还在**`);
        }
      }
    }
  }

  assert.deepEqual(
    failures,
    [],
    '裁决件里的承诺与工作树对不上。裁决件是走完 gate --check、经人工审批的**完成声明**，\n' +
      '  写了没做比没写更糟——读它的人会据此认为那件事已经做了：\n  ' +
      failures.join('\n  '),
  );

  /*
   * **不断言 `checked > 0`**：本条的论域是「自愿加严的裁决件」，一份都没有是合法状态
   * （旧归档件不追溯）。但要把数报出来，免得它悄悄退化成永远扫不到东西的空转——
   * 「恒真的断言比没有更糟」是本仓 r2 删掉旧反向对账时立的口径。
   */
  console.log(`  [EV-50] 本次核验了 ${checked} 条落点声明，覆盖 ${files.length} 份裁决件`);
});
