/**
 * 生成 M10a 第 5 步段一（D3 + 认领文案）的变异规格（计划 `.reviews/M10a-第5步/plan/…-r2-claude.md` §3.0.4）。
 *
 * find / replace 逐字取自实施后的源码；唯一性由装置闸 7 在开跑前机械保证，不唯一即拒跑。
 * 含 `${` 的串一律写成普通单引号串（`String.raw` 模板仍会插值 `${…}`，第一版因此语法报错）；
 * 源码里的一个反斜杠，在这里写成两个。含单引号的源码行用双引号串包住。
 *
 * 用法（仓库根执行）：
 *   node doc/05_testing/evidence/m10a-step5-mutation-20260923/gen-spec.mjs
 *   node scripts/mutation-check.mjs doc/05_testing/evidence/m10a-step5-mutation-20260923/mutation-spec.json
 *
 * find 串钉的是本步提交时的源码；之后源码改动使某条不再恰好命中一处时，闸 7 会拒跑并点名，
 * 那时按当前源码更新本脚本，别绕过闸 7。结果见 `REPORT_2026-09-23_m10a_step5_d3.md` §1。
 */
import { writeFileSync } from 'node:fs';

const HK = 'dist/test/test/unit/hooks.test.js';
const DC = 'dist/test/test/unit/driver-claim.test.js';

const spec = {
  targets: ['src/trivium/hooks.ts', 'src/trivium/driver-claim.ts'],
  suites: [HK, DC],
  cases: [
    {
      id: 'MD3a', desc: 'Bash 侧判据退回全集减缺省 Driver', file: 'src/trivium/hooks.ts',
      // 普通单引号串：`${` 在这里是字面量（String.raw 的模板仍会插值，第一次写错过）；源码里的 `\\.` 在此写作 `\\\\.`
      find: 'return new RegExp(`-(?:${bashProtectedRoleSuffixes().join(\'|\')})\\\\.md\\\\b`);',
      replace: 'return new RegExp(`-(?:${criticRoleSuffixes(DEFAULT_DRIVER).join(\'|\')})\\\\.md\\\\b`);',
      expect: HK,
    },
    {
      id: 'MD3b', desc: '拦截文案退回独立取值（与判据不同源）', file: 'src/trivium/hooks.ts',
      find: '${bashProtectedRoleSuffixes().map((s) => `-${s}.md`).join(\' / \')}',
      replace: '${criticRoleSuffixes(DEFAULT_DRIVER).map((s) => `-${s}.md`).join(\' / \')}',
      expect: HK,
    },
    /*
     * 认领出口文案三条（代码双审 r6 CODEX-05 / CODEX-01 之后）：各只动一句，分别只由一类断言咬住。
     * MC1 的替换串不是历史原文（原文是四行、结构不同），只是「含『删不掉』的措辞」——描述照此写，不称「原句」。
     */
    {
      id: 'MC1', desc: '出口句退回含「删不掉」的措辞（只由负向断言咬住）', file: 'src/trivium/driver-claim.ts',
      find: "'  出口：请用户确认它们的去留后，在**终端**里处理再重试。\\n' +",
      replace: "'  出口：在**终端**里清理后重试（会话内删不掉同样是刻意的）。\\n' +",
      expect: DC,
    },
    {
      id: 'MC2', desc: '删去真实理由「会话自己翻转声明」（只由正向断言咬住）', file: 'src/trivium/driver-claim.ts',
      find: "'  不要在会话里删它们来换回认领——那正是这条限制要防的「会话自己翻转声明」。'",
      replace: "'  不要在会话里删它们来换回认领。'",
      expect: DC,
    },
    {
      id: 'MC4', desc: '文件性质退回一律称孤儿（分支 4 真实路径用例 + 文案用例）', file: 'src/trivium/driver-claim.ts',
      find: "'  也可能是尚无声明时写下、仍在使用的原稿。\\n' +",
      replace: "'  它们是撤回前留下的孤儿。\\n' +",
      expect: DC,
    },
  ],
};

writeFileSync(new URL('./mutation-spec.json', import.meta.url), JSON.stringify(spec, null, 2) + '\n');
console.log(`已写出 ${spec.cases.length} 条变异规格`);
