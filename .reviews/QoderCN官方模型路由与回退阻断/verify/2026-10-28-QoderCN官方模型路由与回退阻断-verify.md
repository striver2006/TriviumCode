# 编译测试记录 · QoderCN官方模型路由与回退阻断

- **运行**：`20261028T000656Z`
- **结论**：❌ 失败
- **起止**：2026-10-28T00:06:56.452Z → 2026-10-28T00:12:29.337Z
- **项目根**：`/Users/chenzhenbo/Work/TriviumCode`

## 一、执行的命令

| # | 组 | 命令 | 退出码 | 耗时 | 命令 sha256 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | build | `npm run typecheck` | 0 | 2s | `982c1455e5e7` |
| 2 | build | `npm run build` | 0 | 1.8s | `16c0e4305ac2` |
| 3 | test | `npm test` | 1 | 329.1s | `328e123c6385` |

> `命令 sha256` 取命令原文，用于与配置对账（AC-10）。

## 二、输出摘要

### `npm test`（test，退出码 1）

**stdout（尾部）**

```text
…（已省略前 4489 行）
  + [
  +   'qoder-cn.ts: stdout.ndjson',
  +   'qoder-cn.ts: stderr.txt'
  + ]
  - []
  
      at TestContext.<anonymous> (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/contract/orchestrator-logs-parity.test.js:23:10)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:358:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: [ 'qoder-cn.ts: stdout.ndjson', 'qoder-cn.ts: stderr.txt' ],
    expected: [],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at dist/test/test/integration/stub-agent-kit.test.js:64:1
✖ 接入套件 ①：overlay 自报的触及路径与全树哈希差集逐项相等 (110.566625ms)
  Error: overlay 找不到锚点（WIRED 接线表）：
  ---
    glm: zcodeAdapter,
  };
  ---
      at anchor (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:72:11)
      at file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:183:9
      at Recorder.edit (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:62:19)
      at async applyOverlay (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:176:3)
      at async TestContext.<anonymous> (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/integration/stub-agent-kit.test.js:42:22)
      at async TestHook.run (node:internal/test_runner/test:1113:7)

test at dist/test/test/integration/stub-agent-kit.test.js:72:1
✖ 接入套件 ①：新增一家 Agent 只触及接入套件白名单内的路径 (0.459958ms)
  Error: overlay 找不到锚点（WIRED 接线表）：
  ---
    glm: zcodeAdapter,
  };
  ---
      at anchor (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:72:11)
      at file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:183:9
      at Recorder.edit (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:62:19)
      at async applyOverlay (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:176:3)
      at async TestContext.<anonymous> (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/integration/stub-agent-kit.test.js:42:22)
      at async TestHook.run (node:internal/test_runner/test:1113:7)

test at dist/test/test/integration/stub-agent-kit.test.js:85:1
✖ 接入套件 ①：第②层判据的论域边界——树内软链恰好只有依赖树那一条 (0.0595ms)
  Error: overlay 找不到锚点（WIRED 接线表）：
  ---
    glm: zcodeAdapter,
  };
  ---
      at anchor (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:72:11)
      at file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:183:9
      at Recorder.edit (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:62:19)
      at async applyOverlay (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:176:3)
      at async TestContext.<anonymous> (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/integration/stub-agent-kit.test.js:42:22)
      at async TestHook.run (node:internal/test_runner/test:1113:7)

test at dist/test/test/integration/stub-agent-kit.test.js:93:1
✖ 接入套件 ①：白名单不得留空头支票（每一条都要被真正用到） (0.046583ms)
  Error: overlay 找不到锚点（WIRED 接线表）：
  ---
    glm: zcodeAdapter,
  };
  ---
      at anchor (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:72:11)
      at file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:183:9
      at Recorder.edit (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:62:19)
      at async applyOverlay (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:176:3)
      at async TestContext.<anonymous> (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/integration/stub-agent-kit.test.js:42:22)
      at async TestHook.run (node:internal/test_runner/test:1113:7)

test at dist/test/test/integration/stub-agent-kit.test.js:103:1
✖ 接入套件 ②：加桩之后类型层依然自洽（tsc --noEmit） (0.10575ms)
  Error: overlay 找不到锚点（WIRED 接线表）：
  ---
    glm: zcodeAdapter,
  };
  ---
      at anchor (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:72:11)
      at file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:183:9
      at Recorder.edit (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:62:19)
      at async applyOverlay (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:176:3)
      at async TestContext.<anonymous> (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/integration/stub-agent-kit.test.js:42:22)
      at async TestHook.run (node:internal/test_runner/test:1113:7)

test at dist/test/test/integration/stub-agent-kit.test.js:114:1
✖ 接入套件 ②：三审全链路在重打包产物上跑通 (0.081792ms)
  Error: overlay 找不到锚点（WIRED 接线表）：
  ---
    glm: zcodeAdapter,
  };
  ---
      at anchor (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:72:11)
      at file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:183:9
      at Recorder.edit (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:62:19)
      at async applyOverlay (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:176:3)
      at async TestContext.<anonymous> (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/integration/stub-agent-kit.test.js:42:22)
      at async TestHook.run (node:internal/test_runner/test:1113:7)

test at dist/test/test/integration/stub-agent-kit.test.js:175:1
✖ 接入套件 ③：三审的重合度逐对算，三对齐备 (0.055208ms)
  Error: overlay 找不到锚点（WIRED 接线表）：
  ---
    glm: zcodeAdapter,
  };
  ---
      at anchor (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:72:11)
      at file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:183:9
      at Recorder.edit (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:62:19)
      at async applyOverlay (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:176:3)
      at async TestContext.<anonymous> (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/integration/stub-agent-kit.test.js:42:22)
      at async TestHook.run (node:internal/test_runner/test:1113:7)

test at dist/test/test/integration/stub-agent-kit.test.js:193:1
✖ 接入套件 ④：登记而未启用为 Driver 的第五家——显式与继承两条路都退 64 (0.095375ms)
  Error: overlay 找不到锚点（WIRED 接线表）：
  ---
    glm: zcodeAdapter,
  };
  ---
      at anchor (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:72:11)
      at file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:183:9
      at Recorder.edit (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:62:19)
      at async applyOverlay (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/fixtures/stub-agent-kit/overlay.js:176:3)
      at async TestContext.<anonymous> (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/integration/stub-agent-kit.test.js:42:22)
      at async TestHook.run (node:internal/test_runner/test:1113:7)

test at dist/test/test/unit/probe-fixture-cleanup.test.js:503:3
✖ W3 probes 与 adapters 两目录下没有裸递归删除：删临时目录一律经 tryRemoveTempDir (31.2185ms)
  AssertionError [ERR_ASSERTION]: src/trivium/probes 与 src/trivium/adapters 两目录里出现了递归删除（rm / rmdir / rmSync 带 recursive）——删不掉会从 finally 抛出、顶替探针结论（EV-199）。改调 util/fsx.ts 的 tryRemoveTempDir。本条只管这两个目录；src/ 全树守卫见 temp-index-cleanup.test.ts 的 W 组（EV-204）
  + actual - expected
  
  + [
  +   'adapters/qoder-cn-native.ts×1'
  + ]
  - []
  
      at TestContext.<anonymous> (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/unit/probe-fixture-cleanup.test.js:511:12)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:788:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: [ 'adapters/qoder-cn-native.ts×1' ],
    expected: [],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at dist/test/test/unit/scratch-guard.test.js:72:3
✖ G1 test/ 下建临时目录的调用只剩豁免表里的那几处，其余一律经 scratchDir (783.908958ms)
  AssertionError [ERR_ASSERTION]: test/ 下建临时目录的调用（mkdtemp / mkdtempSync / makeTempDir）的分布与豁免表不符：跑完不删会在系统临时目录里越堆越多（EV-208）。新增的改调 test/helpers/scratch.ts 的 scratchDir（登记 + 进程退出时删）；确属自带可靠收尾的在豁免表登记理由；豁免项已改掉的从表里删去
  + actual - expected
  
    {
      'test/helpers/scratch.ts': 2,
      'test/integration/claude-structured-probe.test.ts': 6,
      'test/integration/codex-scrub.test.ts': 2,
      'test/integration/fixture-cleanup.test.ts': 1,
  +   'test/integration/qoder-cn-routing.test.ts': 1,
      'test/integration/run-protocol.test.ts': 1,
      'test/integration/scratch-cleanup.test.ts': 1,
      'test/integration/selftest.test.ts': 1,
      'test/integration/stub-agent-kit.test.ts': 1,
      'test/integration/worktree-hash-cleanup.test.ts': 1,
  
      at TestContext.<anonymous> (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/unit/scratch-guard.test.js:80:12)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:788:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: { 'test/helpers/scratch.ts': 2, 'test/integration/claude-structured-probe.test.ts': 6, 'test/integration/codex-scrub.test.ts': 2, 'test/integration/fixture-cleanup.test.ts': 1, 'test/integration/qoder-cn-routing.test.ts': 1, 'test/integration/run-protocol.test.ts': 1, 'test/integration/scratch-cleanup.test.ts': 1, 'test/integration/selftest.test.ts': 1, 'test/integration/stub-agent-kit.test.ts': 1, 'test/integration/worktree-hash-cleanup.test.ts': 1, 'test/unit/codex-adapter.test.ts': 3, 'test/unit/codex-auth-probe.test.ts': 1, 'test/unit/codex-events.test.ts': 1, 'test/unit/doctor-deadline.test.ts': 1, 'test/unit/mustread-deny.test.ts': 2, 'test/unit/preflight-auth-guard.test.ts': 1, 'test/unit/probe-fixture-cleanup.test.ts': 1, 'test/unit/probe-verify.test.ts': 1, 'test/unit/temp-index-cleanup.test.ts': 1, 'test/unit/zcode-doctor-probe-home.test.ts': 3, 'test/unit/zcode-full-copy-arm.test.ts': 1, 'test/unit/zcode-mcp-adapter.test.ts': 1, 'test/unit/zcode-mcp-detect.test.ts': 1, 'test/unit/zcode-provider-env.test.ts': 5 },
    expected: { 'test/helpers/scratch.ts': 2, 'test/integration/claude-structured-probe.test.ts': 6, 'test/integration/codex-scrub.test.ts': 2, 'test/integration/fixture-cleanup.test.ts': 1, 'test/integration/run-protocol.test.ts': 1, 'test/integration/scratch-cleanup.test.ts': 1, 'test/integration/selftest.test.ts': 1, 'test/integration/stub-agent-kit.test.ts': 1, 'test/integration/worktree-hash-cleanup.test.ts': 1, 'test/unit/codex-adapter.test.ts': 3, 'test/unit/codex-auth-probe.test.ts': 1, 'test/unit/codex-events.test.ts': 1, 'test/unit/doctor-deadline.test.ts': 1, 'test/unit/mustread-deny.test.ts': 2, 'test/unit/preflight-auth-guard.test.ts': 1, 'test/unit/probe-fixture-cleanup.test.ts': 1, 'test/unit/probe-verify.test.ts': 1, 'test/unit/temp-index-cleanup.test.ts': 1, 'test/unit/zcode-doctor-probe-home.test.ts': 3, 'test/unit/zcode-full-copy-arm.test.ts': 1, 'test/unit/zcode-mcp-adapter.test.ts': 1, 'test/unit/zcode-mcp-detect.test.ts': 1, 'test/unit/zcode-provider-env.test.ts': 5 },
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at dist/test/test/unit/temp-index-cleanup.test.js:251:3
✖ W src/ 全树的递归删除只剩豁免表里的那几处，其余一律经 tryRemoveTempDir (27.598459ms)
  AssertionError [ERR_ASSERTION]: src/ 下递归删除（rm / rmdir / rmSync 带 recursive）的分布与豁免表不符：删不掉会从 finally 抛出、顶替原结果（EV-204）。新增的改调 util/fsx.ts 的 tryRemoveTempDir；确属有意保留的在豁免表登记理由；豁免项已改掉的从表里删去
  + actual - expected
  
    {
      'src/install.ts': 3,
  +   'src/trivium/adapters/qoder-cn-native.ts': 1,
      'src/trivium/lock.ts': 1,
      'src/trivium/util/fsx.ts': 1
    }
  
      at TestContext.<anonymous> (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/unit/temp-index-cleanup.test.js:259:12)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:788:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: { 'src/install.ts': 3, 'src/trivium/adapters/qoder-cn-native.ts': 1, 'src/trivium/lock.ts': 1, 'src/trivium/util/fsx.ts': 1 },
    expected: { 'src/install.ts': 3, 'src/trivium/lock.ts': 1, 'src/trivium/util/fsx.ts': 1 },
    operator: 'deepStrictEqual',
    diff: 'simple'
  }
```

**stderr（尾部）**

```text

  skills/dual-critic/scripts/trivium.cjs  1.9mb ⚠️

⚡ Done in 27ms

  dist/install.cjs  295.9kb

⚡ Done in 6ms

  dist/test/test/integration/gate-loop.test.js        635.7kb
  dist/test/test/unit/hooks.test.js                   304.3kb
  dist/test/src/trivium/run-protocol.js               301.5kb
  dist/test/src/trivium/review.js                     301.5kb
  dist/test/src/trivium/cli.js                        294.2kb
  dist/test/test/integration/fault-injection.test.js  256.0kb
  dist/test/test/integration/run-protocol.test.js     231.3kb
  dist/test/src/trivium/probes/zcode.js               215.9kb
  dist/test/src/trivium/hooks.js                      212.4kb
  dist/test/test/unit/registry-parity.test.js         210.4kb
  dist/test/src/trivium/adapters/base.js              203.8kb
  dist/test/src/trivium/adapters/zcode.js             197.4kb
  dist/test/src/trivium/gate.js                       193.9kb
  dist/test/src/trivium/probes/claude.js              186.7kb
  dist/test/test/unit/preflight.test.js               184.1kb
  dist/test/src/trivium/types.js                      181.8kb
  dist/test/test/unit/gate.test.js                    179.3kb
  dist/test/test/unit/lock.test.js                    170.2kb
  dist/test/src/trivium/report.js                     167.6kb
  dist/test/src/trivium/doctor.js                     158.4kb
  ...and 324 more output files...

⚡ Done in 92ms
```

### `npm run typecheck`（build，退出码 0）

**stdout（尾部）**

```text

> triviumcode@1.3.2 typecheck
> tsc --noEmit
```

### `npm run build`（build，退出码 0）

**stdout（尾部）**

```text

> triviumcode@1.3.2 build
> node scripts/build.mjs

构建标识：355eb46（作用面内有未提交改动），inputs 0ed87af17a05
```

**stderr（尾部）**

```text

  skills/dual-critic/scripts/trivium.cjs  1.9mb ⚠️

⚡ Done in 26ms

  dist/install.cjs  295.9kb

⚡ Done in 4ms
```

---

> ❌ 有命令非零退出，全流程状态为 `failed`。已产生的计划 / 审查 / 应答工件全部保留，
> 不因本次失败而删改（设计 §14.2）。修复后重跑会另起一份记录，本文件不被覆盖。
