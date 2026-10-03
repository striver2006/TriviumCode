# codex 探活删除收尾（EV-200）计划 r2

起点：`9ce191f`（`main`，工作树干净）。下文源码行号均取自 `9ce191f`。
任务目标见本主题任务文件（用户决策在任务目标里，下文按「决策 一～六」引用）；焦点未给（命令 A `--entry A`）。
全程零配额（决策六）：不跑任何真实 codex 调用，认证探活用假入口（一个可执行的 node 脚本），经 `CODEX_HOME` 指向合成源目录。

r2 相对 r1：按计划双审第 1 轮（run `20261003T142424Z`）12 条全接受修订，逐条见同目录 `revised` 裁决件。改动点：§2.1 通用函数改名 `tryRemoveTempDir`（GLM-04）；§2.3 两档措辞共用前缀（AGY-01）；§2.4 步骤助手加对象守卫（AGY-02）；§3.1 C3 / C3b 摆法与 C6 成功支（CODEX-01、CODEX-02 ≡ GLM-03、GLM-02）；§3.3 EV-201 分诊规则（CODEX-03）；§4 新登 EV-202（CODEX-04 ≡ GLM-01 ≡ AGY-03）；§5 补对称残余（GLM-05）。

## 0. 范围与不做

**做**：

1. codex 认证探活 `authProbe.probe()`（`src/trivium/adapters/codex.ts:331-363`）拆出内部 `attempt`：结果在 `attempt` 里拼完，删除挪到外层 finally，重试三次、失败不抛；删不掉时把残留提示接在详情末尾，`ok` 不因此改变；删除成功时输出逐字节不变（决策一）。
2. 删除与「删除失败后现场查」的通用部分从 `removeZcodeTempDir`（`src/trivium/adapters/zcode.ts:954-972`）抽到 `src/trivium/util/fsx.ts` 的 `tryRemoveTempDir`；zcode 的 `removeZcodeTempDir` 改成薄包装，`zcodeTempDirResidueText`（:928-937）原样保留，zcode 侧全部输出逐字不变（决策二）。
3. `tildeHome`（`zcode.ts:896-899`）随之挪到 `util/fsx.ts`，`zcode.ts` 原名再导出，既有引用点（`probes/zcode.ts`、测试）不动。codex 探活要用它归一家目录，而 `adapters/codex.ts` 引 `adapters/zcode.ts` 会让两个载体互相依赖。
4. codex 的措辞一句（`codexTempDirResidueText`），两档：现场查到凭据副本（或查不了）⇒「含真实凭据，请手工删除」；都不在 ⇒「没有凭据副本，是本次探活的 CLI 产物」（决策二）。
5. 副本准备失败落成一条可读的检查项失败：`ok: false`，详情写明是哪一步失败、家目录归一 `~`，不再抛穿 `probeAuth`（决策三）。
6. 单测新文件 `test/unit/codex-auth-probe.test.ts`；变异；全量两次；doctor 自检（决策六）。
7. 文档：BACKLOG EV-200 结案、新登 EV-202；主设计一句 + 版本记录一行；RUNBOOK 一行；测试报告与 `doc/05_testing/README.md` 登记（决策五）。

**不做**：

- 不改拉起参数、判据（`traceCompleted`）、指纹、缓存口径（决策三）。`probeAuth`（`src/trivium/preflight.ts:699-740`）不动。指纹读盘无兜底另登 EV-202（§4、§5.4）。
- EV-199 的 codex 隔离探针 `probeCodexIsolation` 裸删不在本题（决策四）。
- 审查运行 `run()` 的副本准备与清扫路径不动（`codex.ts:547-560` 已有兜底；清扫走 `scrubCodexHome`）。
- `maxRetries` 只对瞬时错误重试、用例摆的 EACCES 不重试，不新覆盖（同 EV-197 残余 ③）。

## 1. 现状核对（9ce191f）

1. **探活形态**：`probe()` 在 `try` 里 `prepareCodexHome` → `invokeCodex` → 拼结果直接 `return`，`finally` 是 `fs.rm(tmp, { recursive: true, force: true })`（:360-362）。`force` 只吞 ENOENT，ENOTEMPTY / EBUSY / EACCES 从 finally 抛出、顶替返回值。与 EV-197 修之前的 zcode 探活同形。
2. **穿透**：`probeAuth` 直接 `await auth.probe()`（`preflight.ts:730`），无 try；`runPreflight` 用 `Promise.all` 收各侧（:835），任一抛出即整个预检崩成内部错误。`await auth.fingerprint()`（:723）同样无 try（见 §5.4）。
3. **残留内容**：`prepareCodexHome`（`codex-home.ts:274-335`）在 `<tmp>/codexhome/` 下写三类凭据载体：裁剪后的 `config.toml`、本次 profile 的 `<profile>.config.toml`（`trimCodexToml` 保留整段 `[model_providers.*]`，其中可能有 `experimental_bearer_token`），以及原样拷入的 `auth.json`。这三份正是 `isCredentialCarrier`（:93-94）认的名字、也是 `scrubCodexHome` 整份删除的对象。所以残留提示**没有哨兵档**：只分「凭据副本还在（或查不了）」与「都不在」两档。
4. **副本准备会抛**：`prepareCodexHome` 里 `ensureDir`、`fs.readFile`（裁剪）、`fs.writeFile` / `fs.chmod`、`rewriteHomePaths`（读、`copyFile`、`chmod`、写）、`fs.copyFile` / `fs.chmod`（`auth.json`）、`fs.appendFile`（信任记录）都没有兜底。`run()` 在 :549-560 已兜成 `准备 codex 隔离副本失败：<消息>`；探活没兜。
5. **其它抛点**：`invokeCodex` 走 `util/exec.ts` 的 `run()`，拉起失败（入口不存在等）落在 `error` 事件里按 `finish(null, null)` 收尾、不 reject（`exec.ts:304-307`）；`parseCodexEvents` 逐行 try/catch（`codex-trace.ts:62-70`）。所以 `attempt` 里剩下的抛点只有副本准备。`mkdtemp` 本身失败照旧抛（与 zcode 探活同形，不在本题）。
6. **措辞现状**：`zcodeTempDirResidueText` 写死「cli/config.json 副本」，主语只有「探针 / 探活」；`removeZcodeTempDir` 的现场查只 stat 一个位置。codex 要查的是三个位置。
7. **测试现状**：仓里没有 codex `probe()` 的单测（`test/unit/codex-adapter.test.ts` 只测 argv、准备、结果组装等）。

## 2. 设计

### 2.1 `util/fsx.ts` 新增两项

```ts
/** 家目录绝对路径归一成 `~`（自 adapters/zcode.ts 挪来，EV-136 代码双审 r1 GLM-01；EV-200 起 codex 探活共用） */
export function tildeHome(text: string, home: string = os.homedir()): string

/** 删除失败时的现场：错误码，与调用方给的位置里删除失败后仍在（或查不了）的那些 */
export interface TempDirLeftover { code: string; remaining: string[] }

/**
 * 删 mkdtemp 的返回值：重试三次、失败不抛；删成功返回 null。
 * 只删传进来的那个路径；`copies` 只用于 stat、不用于删除。ENOENT 才算没有，查不了（权限等）按在说。
 * 措辞由各载体自持。
 */
export async function tryRemoveTempDir(dir: string, copies: readonly string[]): Promise<TempDirLeftover | null>
```

实现即 `removeZcodeTempDir` 现有的 try / catch 去掉措辞：`fs.rm(dir, { recursive: true, force: true, maxRetries: 3 })`；失败时对 `copies` 逐个 `fs.stat`，`code === 'ENOENT'` 判不在、其余错误判在；`code` 取 `(e as NodeJS.ErrnoException).code ?? (e as Error).message`（与现状同）。`copies` 为空时不 stat。

命名（GLM-04）：`probes/zcode.ts:937` 已有同名注入选项 `opts.removeTempDir`（类型 `typeof removeZcodeTempDir`，返回整句提示），通用函数取名 `tryRemoveTempDir` 避开同名异义；该选项的文档块补一句点名两者的区别。

### 2.2 zcode 薄包装（输出逐字不变）

```ts
export async function removeZcodeTempDir(runDir, who, copy) {
  const left = await tryRemoveTempDir(runDir, copy ? [copy.path] : []);
  if (left === null) return null;
  return zcodeTempDirResidueText(who, runDir, left.code, copy && left.remaining.length > 0 ? copy.kind : null);
}
```

签名、三档措辞、`copy === null` 不查的语义全不变。`tildeHome` 在 `zcode.ts` 里 import 自 `util/fsx.ts` 并原名再导出，`probes/zcode.ts` 与测试的 import 不动。

### 2.3 codex 侧

**凭据副本位置的单一定义**（`codex-home.ts`，放在 `isCredentialCarrier` 旁）：

```ts
/** 某次准备的凭据载体副本位置：`prepareCodexHome` 的写入面，删除失败后的现场查按它查 */
export function codexCredentialCopies(codexHome: string, profile: string | null): string[]
// ⇒ [config.toml, <profile>.config.toml（profile 非 null 时）, auth.json]，都在 codexHome 下
```

不改 `prepareCodexHome` 的写入逻辑；一致性由单测钉住（摆齐三份源文件准备一次，副本目录里 `isCredentialCarrier` 认得的文件恰好等于该清单）。`rewriteHomePaths` 按幸存键拷进来的文件（如 `model_catalog_json` 指向的模型目录）不在清单内——它们不是凭据载体，与 `scrubCodexHome` 的口径一致（那里也只整删这三类，其余过扫描器）。

**措辞**（`codex.ts`，与 `zcodeTempDirResidueText` 同句式，主语固定「探活」）。两档共用同一个前缀，前缀里统一调 `tildeHome(runDir)`，档位只决定后半句（AGY-01）：

```ts
export function codexTempDirResidueText(runDir: string, code: string, hasCopies: boolean): string {
  return (
    `⚠️ 探活临时目录删除失败（${code}）：${tildeHome(runDir)} 仍在，` +
    (hasCopies
      ? '其中的 codexhome 凭据副本（auth.json 与 toml）含真实凭据，请手工删除'
      : '其中没有凭据副本，是本次探活的 CLI 产物，请手工删除')
  );
}
```

**删除**：

```ts
async function removeCodexAuthTempDir(tmp: string, profile: string | null): Promise<string | null> {
  const left = await tryRemoveTempDir(tmp, codexCredentialCopies(codexHomeUnder(tmp), profile));
  return left === null ? null : codexTempDirResidueText(tmp, left.code, left.remaining.length > 0);
}
```

**`probe()` 拆法**（照 `zcode.ts:1165-1189`）：

```ts
async probe() {
  const probe = cfg.probe.cli.codex;
  const bin = codexConfig(ctx).bin ?? probe?.entrypoint ?? null;
  if (!bin) return { ok: false, detail: 'codex 入口未记录' };
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-codex-auth-'));
  let r: { ok: boolean; detail: string };
  let residue: string | null = null;
  try {
    r = await attempt(bin, tmp, probe);
  } finally {
    residue = await removeCodexAuthTempDir(tmp, profile);
  }
  return residue === null ? r : { ok: r.ok, detail: `${r.detail}；${residue}` };
}
```

`attempt` 内容即现有 try 块（拉起参数、超时 120s、判据、两句详情逐字照搬），只在 `prepareCodexHome` 外加一层 catch（见 2.4）。删除只认 `mkdtemp` 的返回值 `tmp`（2026-09-20 事故后的规矩）。接续符 `；` 与 zcode 侧相同；失败详情本身带换行（`\n  请确认 profile…`），提示接在它末尾。

### 2.4 副本准备失败（决策三）

「哪一步失败」要能写出来：node 的错误消息有时不带路径（如对目录 `readFile` 得到的 `EISDIR: illegal operation on a directory, read`），只靠消息说不清。做法：

- `prepareCodexHome` 内各步用一个小助手包住，抛出时给**原错误对象**挂一个属性 `codexPrepStep`（已有则不覆盖），**不改消息、不换错误类型**——`run()` 的兜底文案（`准备 codex 隔离副本失败：<消息>`，:557）因此逐字不变。步骤名：`建副本目录`、`裁剪 <文件名>`、`重写 <文件名> 里的 ~/ 路径`、`拷入 auth.json`、`写入项目信任记录`。
- 助手挂属性前先判 `e !== null && typeof e === 'object'`，原始值（字符串等）原样重抛、不挂（AGY-02）；读取侧同样先判对象再取属性、取到的不是字符串就当没有。
- 探活 `attempt` 里 catch 它，返回 `{ ok: false, detail: '准备 codex 隔离副本失败（<步骤>）：<消息，家目录归一 ~>' }`；拿不到步骤名时省略括注。前缀与 `run()` 同一句，便于对照。
- 副本没备好就不拉起 CLI；外层 finally 照常删除（目录里可能已有一部分副本）。

不另改 `run()` 去显示步骤名：那是审查运行的输出，不在本题。

### 2.5 不变的东西

- 删除成功时：通过支 `探活通过（Ns）`、失败支 `探活失败：…。\n  请确认 profile「…」对应的 provider 凭据可用。` 两句逐字节不变。
- `fingerprint()`、缓存、`probeAuth` 不动；正结论照常入缓存，残留提示只在当次可见（同 EV-197 残余 ②，RUNBOOK 已写「看到一次就处理」）。
- zcode：`removeZcodeTempDir` / `zcodeTempDirResidueText` / `tildeHome` 的签名与全部输出不变；既有 A1～A4、R7（`zcode-auth-probe`）、D10～D10d（`zcode-doctor-probe-home`）、R1（`zcode-provider-env`）、R2～R6（`zcode-full-copy-arm`）照绿。

## 3. 验证（零配额）

### 3.1 单测 `test/unit/codex-auth-probe.test.ts`

假入口：`<root>/bin/codex`，首行 shebang 写 `process.execPath`，可执行；读完 stdin，把看到的 `CODEX_HOME`、`HOME` 与副本目录文件清单写进观测文件（先写观测、再摆锁）；按 `FAKE_LOCK` 摆现场，摆不出就退非 0 并在 stderr 说明（让用例红，不静默通过）；按 `FAKE_EXIT` 输出成功事件流（`thread.started` → `item.completed` 的 `agent_message` "OK" → `turn.completed`）或一条顶层 `error` 事件后退 1。

`FAKE_LOCK` 的几种摆法（写死在假入口里）：

- `codexhome`：把 `$CODEX_HOME`（凭据所在的 `codexhome/`）改 0o500——里面的文件 unlink 不掉，删除必然失败在持副本的目录上，三个位置仍可 stat。
- `keep:<文件名>`：先删掉三份凭据副本里除 `<文件名>` 之外的两份，再同 `codexhome` 锁 `codexhome/`（CODEX-01：留下的那份必然在场，不依赖递归删除的顺序）。
- `gone`：先删掉全部三份凭据副本，再在临时根（`$CODEX_HOME` 的父目录）下建 `locked/`、**在里面放一个文件 `f`**、再把 `locked/` 改 0o500（CODEX-02 ≡ GLM-03：空的只读目录能被直接删掉，锁不住；照 zcode 装置 sibling 形态）。自检：三份副本都已不在、`locked/f` 在，否则退非 0。
- `unreadable`：把 `$CODEX_HOME` 改 0o000（查不了）。

合成源：钉 `HOME` 到 mkdtemp 的假家目录，`CODEX_HOME` 指向其下 `.codex/`，摆 `config.toml`（含一段 `[model_providers.fake]` 与假 `experimental_bearer_token`）、`qwen.config.toml`（缺省档 profile 是 qwen）、`auth.json`，全是假值。`TMPDIR` 钉到本格私有根，残留落在里面；收尾恢复 `codexhome/` 与 `locked/` 的权限、整删私有根。

| 格 | 摆法 | 断言 |
| :--- | :--- | :--- |
| C1 | 探活通过；`codexhome` 锁 | 不抛；`ok` 为 true；详情以 `探活通过（` 开头、以 `；` + 「含真实凭据」那档提示结尾（字面正则 + 函数输出各比一次）；私有根下恰有一个残留 |
| C2 | 探活失败（退 1）；同 C1 锁 | 不抛；`ok` 为 false；以 `探活失败：` 开头、末尾同 C1 |
| C3 | `gone` | 末尾是「没有凭据副本」那档；不含「含真实凭据」 |
| C3b | 三次：`keep:config.toml` / `keep:qwen.config.toml` / `keep:auth.json` | 三次都取「含真实凭据」档——查的是三个位置，少查任何一个都会红 |
| C4 | `unreadable` | 「含真实凭据」档（查不了按在说） |
| C5a | 源 `config.toml` 摆成一个目录（`EISDIR`，root 下也成立） | `ok` 为 false；详情 `准备 codex 隔离副本失败（裁剪 config.toml）：…`；入口没被拉起（无观测文件）；私有根下无残留 |
| C5b | 源 `auth.json` 改 000（root 跳过） | 详情含 `（拷入 auth.json）` 与 `~/.codex/auth.json`、不含假家目录绝对路径 |
| C6 | 不锁：通过、失败各一次 | 通过支匹配 `^探活通过（\d+s）$`——时长 N 是唯一变量，不写死（GLM-02）；失败支**等于**改动前那句（profile 与错误消息写死比对）；两次私有根下都无残留 |
| C7 | `prepareCodexHome` 摆齐三份源 | 副本目录里凭据载体名的文件恰为 `codexCredentialCopies` 给出的三个 |
| C8 | 措辞两档字面 | 写死两句完整字面比对；两档都把家目录归一成 `~` |
| F1 | `tryRemoveTempDir` 直测 | 删成功返回 null；失败时 `copies` 里 ENOENT 的不进 `remaining`、在的进；`copies` 为空时 `remaining` 为空 |

摆锁守则照旧：涉及权限的格 root 下跳过（C5a 除外）；摆锁失败入口退非 0 ⇒ 用例红；锁的是凭据所在的 `codexhome/`（C1 / C2 / C3b / C4），只有副本已全删的 C3 才锁兄弟目录（副本由入口自己删，不依赖递归删除的顺序——EV-197 踩过）。所有等待都是同步拉起，无需桩超时；`probe()` 内的 `invokeCodex` 超时 120s 不触发。

### 3.2 变异（先逐条带 `--test-timeout` 预跑，再跑装置）

| # | 变异 | 期望咬住 |
| :--- | :--- | :--- |
| M1 | codex `probe()` 外层 finally 退回裸删 | C1（抛 EACCES） |
| M2 | 不接残留提示（`return r`） | C1 |
| M3 | 残留时把 `ok` 改为 false | C1 |
| M4 | `codexCredentialCopies` 去掉 `auth.json` | C3b |
| M5 | `codexCredentialCopies` 去掉 profile 分层文件 | C3b |
| M6 | codex 措辞档位反向（`remaining.length === 0`） | C1 / C3 |
| M7 | `tryRemoveTempDir` 把 ENOENT 也判在 | C3（codex）；zcode D10c 亦红 |
| M8 | `tryRemoveTempDir` 查不了判不在 | C4（codex）；zcode D10d 亦红 |
| M9 | `tryRemoveTempDir` 不查（`remaining` 恒空） | C1 |
| M10 | `attempt` 不兜副本准备 | C5a（抛） |
| M11 | 步骤名不挂（助手不写 `codexPrepStep`） | C5a |
| M12 | 副本准备失败详情不归一家目录 | C5b |
| M13 | zcode 薄包装忽略 `remaining`（恒取 `copy.kind`） | zcode D10c / R6 |
| M14 | 删除成功时也接一个空提示（`；` 恒接） | C6 |
| M15 | 「没有凭据副本」档不归一家目录 | C8 |

装置每条只收一个套件：M7、M8、M13 的期望套件按上表第一个写；跨套件的「亦红」在预跑里顺带记。

### 3.3 全量与自检

`npm run check` 两次（串行、一次只发一条、输出重定向到证据目录、取真实退出码），`trivium doctor --selftest` 一次。读数写进报告 `doc/05_testing/REPORT_2026-10-03_codex_probe_cleanup.md`，证据目录 `doc/05_testing/evidence/codex-probe-cleanup-20261003/`。

**已知偶发红的分诊（CODEX-03）**：全量若红、且红格恰为 `cancel-grace-unverifiable` 的 K 格（K-K3 / K-K4 一类信号时序断言，与 EV-201 登记的签名相符），则单跑该文件确认全绿、截下失败文案与负载，记进报告并注明「EV-201 已登记、与本题无交集」，该次全量照计、不重烧；红在别处则按真红处理。EV-149、EV-153 两条已登记的偶发红同此口径。

## 4. 文档（决策五）

- `doc/08_project/BACKLOG.md`：EV-200 → done，写结案摘要、读数指针与残余；**新登 EV-202**（todo）：codex 认证探活的 `fingerprint()` 读盘无兜底——`exists` 之后 `sha256File` / `readFile` 抛错（权限、`EISDIR` 等）穿过 `probeAuth`（`preflight.ts:723`）把预检崩成内部错误；修法方向照 zcode 侧 EV-136 r1 CODEX-01（读不了返回 null、交给 `probe()` 报可读失败）；触发条件：下一次动 codex 指纹，或实遇一次（CODEX-04 ≡ GLM-01 ≡ AGY-03）；
- 主设计：§10.5「凭据」那一行（运行目录里的凭据副本）补一句「认证探活的临时副本探完即删，删不掉不抛、提示接在详情末尾」；§11.3 第 7 条「临时目录删除共用 `removeZcodeTempDir`」后补「通用部分自 v1.3.81 起在 `util/fsx.ts` 的 `tryRemoveTempDir`，codex 认证探活共用；拉起本身抛错且删不掉时提示随异常丢失，三处同形」；版本记录加 v1.3.81 一行、头部版本号同步；
- `doc/06_deployment/RUNBOOK_pipeline_ops.md:279`：触发列加「预检「Codex 已认证」详情末尾」，前缀补 `trivium-codex-auth-`，写 codex 两档措辞的处置；
- 报告与证据目录登记进 `doc/05_testing/README.md`。

## 5. 风险与残余

1. **残留提示只当次可见**：正结论入缓存后 TTL 期内不再出现（同 EV-197 残余 ②，`probeAuth` 缓存条目不含 detail）。不改缓存口径（决策三）。
2. **`mkdtemp` 本身失败照抛**：与 zcode 探活同形，不在本题。
3. **步骤属性挂在原错误对象上**：是对 node 错误对象的附加属性，不改消息与类型；`run()` 不读它。若将来有人在 `prepareCodexHome` 外再包一层 `new Error(...)`，属性会丢、退化成不带括注——C5a 会红。
4. **指纹读盘无兜底**（三侧同指）：codex 的 `fingerprint()`（`codex.ts:307-330`）读 `auth.json` / profile toml / 基底 toml 时无兜底，抛错同样穿过 `probeAuth` 崩预检；决策三定了不改指纹，本题不动，另登 EV-202（§4）。
5. **`attempt` 抛错且删不掉时提示随异常丢失**（GLM-05）：与 zcode 两侧的既有残余对称（设计 §11.3 第 7 条 v1.3.79 段「两侧同形」）。codex 侧改后 `attempt` 的抛出面近于空（副本准备已兜、`invokeCodex` 不 reject、事件解析逐行兜底），只为记录对称，随 §4 的设计补句一并写明。
