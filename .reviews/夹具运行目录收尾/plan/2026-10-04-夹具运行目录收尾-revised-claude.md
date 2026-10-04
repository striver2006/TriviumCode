---
schema: trivium.disposition.v1
topic: 夹具运行目录收尾
stage: plan
role: claude
kind: revised
run_id: 20261004T090126Z
addresses:
  - 2026-10-04-夹具运行目录收尾-gemini.md
  - 2026-10-04-夹具运行目录收尾-glm.md
---

# 裁决：夹具运行目录收尾 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-04-夹具运行目录收尾-claude.md`（r1，起点 `91136f7`）
> ｜ 运行：`20261004T090126Z`
> ｜ 结论：gemini `approve-with-nits`（次要 2、吹毛求疵 1）｜ glm `approve-with-nits`（次要 2、吹毛求疵 2）｜ **codex 失败**（kimi 侧 403「5-hour usage limit」，第 1 次尝试 26 s 即退，未产出结论）
> ｜ 共 7 条：接受 7
> ｜ 修订后的计划：`plan/2026-10-04-夹具运行目录收尾-r2-claude.md`；命令 A 不设人工闸门

**本轮是降级轮次**：入选三侧，codex 因额度耗尽失败；本次运行未带 `--allow-single`，编排器把整次判 `failed`（退 75）。用户看过终态后（2026-10-04）定为「用已归档的 gemini、glm 两份往下走」，`gate --check` 按单侧降级认这两份（`structured_ids` 恰为下表 7 条）。缺一侧的盲区在 r2 §6 写明，代码双审时三侧照常入选。

两侧都复核了 r1 §1 的现状：行号、8 行 5 文件的拼路径清单、22 文件 182 处调用、`isUnder` 按 `/` 边界、`repoId` 取 basename 加路径哈希、挂点选进程退出钩子的理由。glm 还核出 `TRIVIUM_KEEP_FIXTURES` 不撞名、EV-208 与 v1.3.85 不撞号。

GLM-01 是本轮唯一推翻用例设计的意见，已回源码核实：`exec.ts:304-307` 在启动失败（`git` 不在 PATH，ENOENT）时走 `child.on('error')` → `finish(null, null)`，Promise 只会 resolve；`git.ts:458-468` 的 `initFixtureRepo` 六条 `await run(...)` 不看退出码。r1 FC4 用「PATH 里没有 git」造不出抛错，`makeFixture` 会静默返回一个没有 `.git` 的夹具，变异 H5 也随之失去锚点。r2 改用一个真正会抛的写盘步骤（§2.5 FC4）。`initFixtureRepo` 不查退出码这件事另登 EV-209。

GLM-02 同样属实：`scripts/mutation-check.mjs:137-139` 的 `artifactOf` 对任意 `.ts` 通用，`test/helpers/fixture.ts` 映射到 `dist/test/test/helpers/fixture.js`。装置不限定 `src/`，坑清单里「只认 src/*.ts」是过时说法。helper 批改走装置，不再自写脚本。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| AGY-01 | gemini | minor | 接受 | 方向对，形态需订正：`rmSync` 带 `force: true` 本身不会因 ENOENT 抛出；会抛的是 r1 没写兜底的权限恢复遍历（`readdirSync` / `chmodSync` 撞上已不存在的路径）。r2 规定遍历中每一步单独 try/catch、一律吞掉（它只是删除的准备，失败了照样去删，删不掉由 `rmSync` 报真实错误码），删除仍靠 `force` 吞 ENOENT。不另加 `existsSync`：先查后删多一个竞态窗口，判据也不比 `force` 更准。FC1 增加一格前提：子用例自己先删掉其中一个夹具父目录，退出后不应出现「没删掉」那一行 | r2 §2.2 收尾第 2 点；§2.5 FC1 |
| AGY-02 | gemini | minor | 接受 | 属实：r1 只写了对 `Dirent.isDirectory()` 为真的子项做 `chmod`，父目录自身若被改成只读或不可执行，`readdirSync` 当场 EACCES，子孙权限一个都恢复不了。与仓内既有的 `unlockAll`（worktree-hash-cleanup、selftest S3）同形：进入每一层（含根）先 `chmodSync(dir, 0o700)`、再 `readdirSync`。FC3 那一格锁的正是父目录的上一层（`TMPDIR`），父目录自身不锁；另加一格让子用例把夹具父目录本身改成 `0o500`，退出后要删得掉 | r2 §2.2 收尾第 2 点；§2.5 FC1 |
| AGY-03 | gemini | nit | 接受 | 实际触发不了：`kept` 支只在建夹具成功之后可达（失败或带 `--keep-fixture` 才保留，且建夹具失败那一处返回 `kept: false`），这时 `fixtureRoot` 恒为 `base/repo`。但「靠调用时序保证 dirname 恰好是父目录」正是 EV-204 GLM-01 不愿留的那种隐式前提。r2 改为父目录取 `path.dirname(runRoot)`，且只在它等于 `path.dirname(fixtureRoot)` 时打「两者同在…」那半句，否则只给运行目录路径；S5 加一格 `fixtureRoot` 与 `runRoot` 不同父时不打那半句 | r2 §2.1 保留提示；§2.5 S5 |
| GLM-01 | glm | minor | 接受 | 属实（见上）。FC4 改注入手段：用现有 `opts.topic` 造一个必抛的写盘步骤——topic 含 NUL（`'a\u0000b'`），`stageDir` 的 `mkdir` 抛 `ERR_INVALID_ARG_VALUE`。这一步在 `mkdtemp`、登记、`repo/` 与配置写盘之后，正好是「建到一半」，不为测试给 `makeFixture` 新开注入口。H5（登记挪到 `stageDir` 写盘之后）锚点随之挂到这一步。`initFixtureRepo` 不查 git 退出码另登 **EV-209**（只登记；它同时是 `probes/fixture.ts` 与自检夹具的建仓步骤，git 缺失时会静默建出没有 `.git` 的夹具）。结案语如实记这一发现 | r2 §2.5 FC4；§2.6 H5；§3 BACKLOG |
| GLM-02 | glm | minor | 接受 | 属实（见上）。helper 批并入装置：规格的 `targets` 含 `src/trivium/selftest.ts` 与 `test/helpers/fixture.ts`，`suites` 分别指向编译后的测试文件。仍按坑清单先用带 `--test-timeout` 的逐条预跑脚本过一遍，再正式跑装置。装置七道闸（哨兵、产物指纹、`cases ⊆ targets` 等）对 helper 批同样生效，不再有手工流程。收尾时把坑清单里「装置只认 src/*.ts」订正为「targets 任意 .ts，产物按 `dist/test/<相对路径>.js` 映射」 | r2 §2.6；收尾订正记忆 |
| GLM-03 | glm | nit | 接受 | 属实：`precreateRunDirs` 调用点是 5 处（`gate-loop.test.ts:2461`、`:2481`、`:2509`、`:2540`、`:2560`），`statusJsonOf` 1 处（`:2521`），r1 写「三处」是数错了；`temp-index-cleanup.test.ts:279-284` 的 S4 合成对象要补 `runRoot`，否则 tsc 红 | r2 §2.3 表；§2.5 S 组清单 |
| GLM-04 | glm | nit | 接受 | 修法便宜，形态与 EV-204「收尾失败不顶替已得出的结果」同源：退出钩子里的提示收敛进一个永不抛的 `warnLine()`（`fs.writeSync(2, …)` 包 try/catch，写不出去最多丢一行字）；每个父目录的删除也各自包 try/catch，一个出错不中断后面的 | r2 §2.2 收尾第 1～3 点 |

## 2. 无修改项

无。7 条全部接受；修订落在 r2，原稿 r1 不改。
