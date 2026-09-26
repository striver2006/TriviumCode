---
schema: trivium.disposition.v1
topic: 配置加载重构
stage: plan
role: glm
kind: revised
run_id: 20260926T012336Z
addresses:
  - .reviews/配置加载重构/plan/2026-09-26-配置加载重构-claude.md
  - .reviews/配置加载重构/plan/2026-09-26-配置加载重构-gemini.md
---

# 《配置加载重构》计划裁决与修订（revised）

> 当轮 Driver：glm ｜ 裁决 9 条意见：接受 9 ｜ 驳回 0 ｜ 暂缓 0
> 双侧结论均为 request-changes。所有意见均成立且可在计划层落点，无静默忽略项。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
|---|---|---|---|---|---|
| AGY-01 | gemini | blocker | 接受 | 属实：原稿 §4.2 伪码 ENOENT 分支只赋 base 未短路，流程穿透到 `JSON.parse(raw)`（raw 为 undefined）必抛 SyntaxError，被外层包装成「配置文件损坏」，R2「缺失回退默认值」在伪码层面直接失效。散文部分的设计意图没错，但伪码是编码轮蓝本，必须修 | 修订后伪码：ENOENT 置 `fileObj = null` 并跳过解析与合并，仅读成功才 `JSON.parse`（见本件「修订后伪码」）；编码轮落 `src/config.ts` 控制流 |
| AGY-02 | gemini | major | 接受 | 属实：以 `typeof base[k]` 为转换基准会把文件脏类型带进 env 覆盖——文件 `port: "8080"` 时 `APP_PORT` 按 string 规则原样覆盖，违背 `AppConfig` 的 `port: number` 契约；嵌套对象键则 convert 无分支、行为未定义。改锚 DEFAULT_CONFIG 契约类型后两个问题同时消失，且与「不做文件 schema 校验」的非目标不冲突：文件值照旧透传，只有 env 转换的基准改绑契约 | 原稿 §3.1 转换基准改为 `typeof DEFAULT_CONFIG[k]`；convert 分支收窄为 number/boolean/string、其余防御性抛错；伪码同步（本件「修订后伪码」）；§2 非目标中「APP_PORT 按 string 规则原样覆盖」的表述相应改写 |
| CLAUDE-02 | claude | major | 接受 | 属实：决策点 D 逐键浅合并未过滤未声明键，文件多余键进入 base 后被 §3.1「遍历配置的顶层键」纳入 env 覆盖范围，与「返回值形状始终是 AppConfig」的保证矛盾——该保证原本只覆盖「未知 APP_* 被忽略」这一半。只保留声明键后形状保证闭环，且与 AGY-02 的「遍历以 DEFAULT_CONFIG 合法键为准」同向 | 原稿 §3.2 决策点 D 修订为「仅合并 AppConfig/DEFAULT_CONFIG 声明键，未声明键静默丢弃」；伪码 base 构造改为按 `keys(DEFAULT_CONFIG)` 挑选；测试清单增用例 18 |
| CLAUDE-01 | claude | major | 接受 | 属实：`Number()` 对纯空白串先 trim 再转换，`Number(' ') === 0`、`Number('\t') === 0`，仅拒绝精确空串挡不住空白输入，会静默得到 port=0，与「转换失败即抛错」的既定取向自相矛盾，且原清单无测试覆盖 | 原稿 §3.1 number 规则改为：`v.trim() === ''` 拒绝；`n = Number(v.trim())`；`!Number.isFinite(n)` 拒绝（一并覆盖 NaN / Infinity / -Infinity）；测试清单增用例 15 |
| AGY-03 | gemini | minor | 接受 | 与 CLAUDE-01 同源，另指出原表述只列 `Infinity` 未显式 `-Infinity`。`Number.isFinite` 一次覆盖 NaN/±Infinity，采纳该写法，不再枚举 | 并入 CLAUDE-01 同一落点（§3.1 number 规则 + 用例 15），不另立改动 |
| CLAUDE-03 | claude | minor | 接受 | 属实：决策点 E 只论证了「损坏不缓存」，未显式声明「缺失回退默认值的结果视为成功并永久缓存，同进程内文件之后被创建也不会被感知」这一交叉语义。该行为是「只读一次」的正确推论，但属计划空白，应写明并给行为锚点 | 原稿 §3.2/§3.3 决策点 E 补显式声明一句；测试清单增用例 17 |
| AGY-04 | gemini | minor | 接受 | 三项缺口成立：「文件缺失 + APP_* 同时存在」是对「env 覆盖层级最高」的直接锚点，原清单只测了缺失回退全默认；空白串用例由 CLAUDE-01 落点补齐；布尔大小写原清单只有非法值反例（用例 8），无「大小写不敏感通过」的正例 | 测试清单增用例 16（缺失 + `APP_PORT=4000` 组合）与用例 19（`APP_DEBUG=TRUE` 通过）；空白串锚点即用例 15 |
| CLAUDE-04 | claude | nit | 接受 | 成立：`src/config.ts:9` 现有 JSDoc `/** 读取 JSON 配置文件 */` 在重构后将沦为过时副本，对回退默认值、env 覆盖、冻结、缓存只字不提，误导读者 | 原稿 §4 实施步骤第 1 条补「同步更新 loadConfig 的 JSDoc（默认值回退 / env 覆盖 / 只读冻结 / 单次读盘）」；编码轮落 `src/config.ts:9` |
| CLAUDE-05 | claude | nit | 接受 | 成立：`path.resolve` 依赖 `process.cwd()`，进程内 cwd 变化（测试框架切目录、调用方 chdir）会使同一相对路径解析漂移，缓存 key 稳定性存在隐含前提；按意见只需显式化，不改设计 | 原稿 §6 风险表补一行「缓存 key 的稳定性假设进程内 cwd 不变（含测试框架 chdir 场景）」 |

## 修订清单（对原稿的增量，原稿本身不改）

1. **§4.2 伪码控制流**（AGY-01）：ENOENT 短路，不触碰 `JSON.parse`。
2. **§3.1 类型转换**（AGY-02 / CLAUDE-01 / AGY-03）：基准绑 `DEFAULT_CONFIG` 契约类型；number 规则改 `trim` + `Number.isFinite`；boolean 先 trim 再小写比较。
3. **§3.2 决策点 D**（CLAUDE-02）：仅合并声明键，未声明键丢弃。
4. **§3.2/§3.3 决策点 E**（CLAUDE-03）：补「缺失回退结果视为成功并永久缓存」显式声明。
5. **§4 实施步骤**（CLAUDE-04）：补 JSDoc 同步更新。
6. **§5 测试清单**（AGY-04 / CLAUDE-01 / CLAUDE-02 / CLAUDE-03）：增用例 15–19。
7. **§6 风险表**（CLAUDE-05）：补 cwd 稳定性假设。

### 修订后伪码（整段替换原稿 §4.2）

```text
loadConfig(path):
  key = resolve(path)
  if cache.has(key): return cache.get(key)
  fileObj = null
  try raw = readFileSync(path, 'utf8')
  catch e:
    if e.code == 'ENOENT': pass            # 缺失：短路，稍后只用默认值
    else: throw wrap(e, path)
  if raw is defined:                        # 读到了才解析；ENOENT 不碰 JSON.parse
    try obj = JSON.parse(raw)
    catch e: throw Error(`配置文件损坏: ${key}`, { cause: e })
    if not plainObject(obj): throw Error(`配置文件损坏: ${key}`)
    fileObj = obj
  base = {}
  for k of keys(DEFAULT_CONFIG):            # 只认声明键；未声明键丢弃
    base[k] = (fileObj has k) ? fileObj[k] : DEFAULT_CONFIG[k]
  for k of keys(DEFAULT_CONFIG):
    v = process.env['APP_' + k.toUpperCase()]
    if v is defined: base[k] = convert(v, typeof DEFAULT_CONFIG[k])   # 基准绑契约
  result = deepFreeze(base)
  cache.set(key, result)                    # 缺失回退的结果同样入缓存并固化 env
  return result

convert(v, t):                              # t 只来自 DEFAULT_CONFIG，必为三种标量之一
  number:  s = v.trim(); if s == '': throw; n = Number(s); if not Number.isFinite(n): throw; return n
  boolean: s = v.trim().toLowerCase(); if s == 'true': return true; if s == 'false': return false; throw
  string:  return v
  其他:    throw（防御性，按当前契约不可达）
```

### 测试清单增补（接原稿用例 14 之后）

- **用例 15**：`APP_PORT=' '` 与 `APP_PORT='\t'` → 抛错（空白串锚点）；
- **用例 16**：文件缺失 + `APP_PORT=4000` → `{ port: 4000, debug: false, name: 'app' }`（env 覆盖层级最高 + 缺失组合锚点）；
- **用例 17**：文件缺失（返回默认值并缓存）→ 外部创建该文件 → 同进程再次调用仍返回默认值（缺失缓存语义锚点）；
- **用例 18**：文件含未声明键（如 `tz: "UTC"`）→ 被忽略，返回形状不变，且 `APP_TZ` 不因此参与覆盖；
- **用例 19**：`APP_DEBUG=TRUE` → true（大小写不敏感通过的正例）。

### 决策点表更新（替换原稿 §6 表中受影响行）

| # | 决策 | 修订后取向 |
|---|------|-----------|
| A | env 值类型转换失败 | 抛错（维持）；number 规则细化：拒绝空白串与非有限数 |
| D | 部分键文件 / 未声明键 | 仅合并 AppConfig 声明键，未声明键静默丢弃（原「逐键浅合并」作废） |
| E | 失败是否缓存 | 只缓存成功结果；**显式声明：缺失回退的结果视为成功并永久缓存**，同进程内文件后建不感知 |
