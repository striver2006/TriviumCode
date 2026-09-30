# 构建树（并发写闸门偶发红，EV-153，计划 r2 §5.1）

四棵树，都在会话 scratchpad（临时目录，会话结束可能被清）；搭法可复现，不需要网络：

```sh
SP=〈scratchpad〉
git archive 〈提交〉 | tar -x -C $SP/〈目录〉
ln -s 〈仓库〉/node_modules $SP/〈目录〉/node_modules
(cd $SP/〈目录〉 && node scripts/build.mjs --tests-only)
```

| 树 | 来源 | `src/trivium/lock.ts` sha256 前 16 位 | `dist/test/src/trivium/lock.js` sha256 前 16 位 | 用途 |
| :-- | :-- | :-- | :-- | :-- |
| 旧 `old-3e38d29` | `git archive 3e38d29`（EV-173 修复之前，用户指定） | `93eb307d927f3887` | `62c105b8323c258b` | §2.1 A1 / A2 / B1 / C1、repeat-old-plan、移植验收、跨进程验收 |
| 改前 `pre-7c6959e` | `git archive 7c6959e`（本主题起点） | `a4d98c4e11d41f2d` | `b4e78aaf0ace8c8d` | 移植验收、跨进程验收（§2.1 的「新」读数取自仓库工作树，那时与本树同码） |
| 原型 `proto-f2` | `git archive HEAD`（= 7c6959e）后只改 D1 一行，diff 见 `proto-f2.diff` | `cb549455801adcb3` | `ed7d41e4fa230c0f` | §2.1 P1 / P2 |
| 改后 | 仓库工作树（D1 + 注释 / JSDoc） | `af25a20af0618456` | `8c9d5a213ed967d2` | 编码阶段全部改后读数 |

移植验收（`acceptance.mjs`）把改后的 `test/unit/lock.test.ts`、`test/unit/state.test.ts`、`test/helpers/ps-stub.ts` 拷进旧树与改前树后重新 `--tests-only`，拷入前后的 sha256 记在 `acceptance-readout.json` 的 `ported[]`；`lock.js` 不受拷入影响（上表哈希取自拷入之后）。
