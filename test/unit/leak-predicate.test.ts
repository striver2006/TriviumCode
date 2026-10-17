import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoriesVoid, hitsVoid, leakRecordVoids } from '../../src/trivium/freeze.js';
import type { DenyCategory } from '../../src/trivium/types.js';

/**
 * 作废谓词（BACKLOG EV-239，M12 批次 1）：守卫的侧级判定与闸门的作废派生调同一个 `leakRecordVoids`。
 *
 * 闸门曾对命令通道按 `hit === true` 一律作废（注释称「命令通道没有类别信息」，而带类的 `hits` 早已落盘），
 * 只命中编排器状态目录的一侧在守卫看来有效、在闸门看来作废。这里钉三件事：
 * ①只有两类作废类让谓词为真；②`leakRecordVoids` 与守卫改动前的口径逐格一致；③旧记录各按旧口径。
 */

const ALL: readonly DenyCategory[] = ['peer-artifact', 'peer-run-output', 'own-run-material', 'orchestrator-state', 'sensitive'];
const VOIDING = new Set<DenyCategory>(['peer-artifact', 'peer-run-output']);

/** 守卫改动前的侧级口径，照 `guard.ts` 原逻辑另写一份做参照：路径命中里有作废类，或某条命令撞上作废类 */
function guardBefore(pathCats: readonly DenyCategory[], cmdCatsPerCommand: readonly (readonly DenyCategory[])[]): boolean {
  const peerHits = pathCats.filter((c) => VOIDING.has(c));
  const cmdVoidingHits = cmdCatsPerCommand.filter((cats) => cats.length > 0 && cats.some((c) => VOIDING.has(c)));
  return peerHits.length > 0 || cmdVoidingHits.length > 0;
}

/** 0～2 个类别的全部组合（含空、含重复类别的两元组） */
function combos(): DenyCategory[][] {
  const out: DenyCategory[][] = [[]];
  for (const a of ALL) out.push([a]);
  for (const a of ALL) for (const b of ALL) out.push([a, b]);
  return out;
}

test('EV-239 ①：categoriesVoid / hitsVoid 只对 peer-artifact、peer-run-output 为真', () => {
  for (const c of ALL) {
    assert.equal(categoriesVoid([c]), VOIDING.has(c), c);
    assert.equal(hitsVoid([{ category: c }]), VOIDING.has(c), c);
  }
  assert.equal(categoriesVoid([]), false);
  assert.equal(hitsVoid([]), false);
  assert.equal(categoriesVoid(['orchestrator-state', 'sensitive', 'own-run-material']), false, '告警档与己方材料怎么叠都不作废');
  assert.equal(categoriesVoid(['orchestrator-state', 'peer-run-output']), true, '有一个作废类就作废（取最重档）');
});

test('EV-239 ②：leakRecordVoids 与守卫改动前的侧级口径逐格一致（两条通道 × 全部类别组合）', () => {
  let cells = 0;
  for (const pathCats of combos()) {
    for (const cmdA of combos()) {
      for (const cmdB of [[], ['orchestrator-state']] as DenyCategory[][]) {
        const commands = [cmdA, cmdB];
        const cmdHits = commands.flatMap((cats, i) => cats.map((category) => ({ command: `c${i}`, path: `p${i}`, category })));
        const got = leakRecordVoids({
          path: { hits: pathCats.map((category, i) => ({ path: `f${i}`, category })) },
          command: { hit: cmdHits.length > 0, hits: cmdHits },
        });
        assert.equal(got, guardBefore(pathCats, commands), `path=${JSON.stringify(pathCats)} cmd=${JSON.stringify(commands)}`);
        cells++;
      }
    }
  }
  assert.ok(cells > 1000, `组合数不足，表没铺开：${cells}`);
});

test('EV-239 ③：只命中告警级的命令通道（M11 第 12 步 B2 形态）不作废', () => {
  const cmd = 'find . -name "*.js" -not -path "./.trivium/*"';
  // run.json 落盘的命令通道命中带 command / path 两个字段，谓词只读 category
  const hits = [{ command: cmd, path: '.trivium', category: 'orchestrator-state' as const }];
  assert.equal(
    leakRecordVoids({ command: { hit: true, hits } }),
    false,
    'hit 为真只说明扫到了东西；类别是告警级',
  );
});

test('EV-239 ④：旧记录各按旧口径——命令通道缺 hits 退回 hit，路径通道缺 hits 按无作废', () => {
  assert.equal(leakRecordVoids({ command: { hit: true } }), true, '2026-09-17 之前的 run.json 只有 commands：命中即作废');
  assert.equal(leakRecordVoids({ command: { hit: false } }), false);
  assert.equal(leakRecordVoids({ path: {} }), false, '路径通道缺 hits：无从区分类别，按无作废');
  assert.equal(leakRecordVoids({}), false, '两条通道都没记：那一侧没扫');
  assert.equal(leakRecordVoids({ path: undefined, command: undefined }), false);
  // 有 hits 时不看 hit：空 hits 配 hit 为真（不应出现，但真出现也按类别判）
  assert.equal(leakRecordVoids({ command: { hit: true, hits: [] } }), false);
});
