---
schema: trivium.disposition.v1
topic: 目标回退取计划定稿
stage: plan
role: claude
kind: revised
run_id: 20261005T090634Z
addresses:
  - 2026-10-05-目标回退取计划定稿-codex.md
  - 2026-10-05-目标回退取计划定稿-gemini.md
  - 2026-10-05-目标回退取计划定稿-glm.md
---

# 目标回退取计划定稿 · 计划双审第 1 轮裁决

run `20261005T090634Z`：gemini `approve`（零意见），codex、glm `approve-with-nits`，共 4 条（次要 1、吹毛求疵 3），全部接受。
合入后的完整计划见 `2026-10-05-目标回退取计划定稿-r2-claude.md`。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | nit | 接受 | 属实：`dist/` 与 `node_modules/` 都被忽略，`git archive` 导出的是旧源码树，旧 bundle 要在导出树里软链依赖后现编；「导出旧构建」会误导执行者 | r2 §4.3 首段改为「导出旧源码树并就地构建」，注明照 EV-210 `a1-old-new-brief.mjs` 的配方 |
| GLM-01 | glm | minor | 接受 | 属实：`'/proj'` 那格是 M4 唯一可能的杀手，集成侧子进程 cwd 就是项目根、对 M4 无鉴别力；若桩用夹具根而函数传 `'/proj'`，正确实现与变异都落 catch 返回 null，该格退化成永绿 | r2 §4.1 把该格写死为 T7：桩与 `resolveTaskGoal` 用同一个非 cwd 根 `'/proj'`，断言取到非空目标；§4.4 M4 行改指 T7 并注明是唯一杀手 |
| GLM-02 | glm | nit | 接受 | 属实：含该措辞的渲染产物是 12 份（三个 review 命令的源产物 3 份 + codex、gemini、glm 三家入口各 3 份）；`trivium.cjs` 那句是 `cli.ts` 帮助文本的打包产物，不属渲染产物 | r2 §1 第 7 条与 §3.3 改为 12 份并区分打包产物；实施时以渲染实际重写数回填报告 |
| GLM-03 | glm | nit | 接受 | 属实：同一夹具实例先后跑新旧构建，第二轮第 4 段会多出第一轮落下的己方历史文档，造成与改动无关的差异，诱导加大归一化 | r2 §4.3 A1、A2 写明新旧两侧各用全新夹具实例（同形不同实例），并断言比较前两侧己方历史文档清单为空 |

## 逐条说明

### CODEX-01（接受）

措辞问题，步骤不变：验收脚本照 EV-210 的配方——`git archive 7b643b0` 导出到会话临时目录、软链工作树的 `node_modules`、在导出树内 `node scripts/build.mjs` 构建，再直接 node 调新旧两份 bundle。

### GLM-01（接受）

T7 的构造：夹具文件写在 scratch 目录里；`resolveTaskGoal(opts, ref, '/proj', () => resolvePlanFinal(ref, '/proj'))`。`resolvePlanFinal` 返回 `path.relative('/proj', abs)`（以 `..` 开头的相对路径），正确实现按 `'/proj'` 还原后读到文件，断言目标非空且等于标题；M4 变异按进程 cwd 读该相对路径 ⇒ ENOENT ⇒ null ⇒ 红。既有 9 格改为夹具根当 `projectRoot`（桩与函数同根），它们不承担 M4。

### GLM-02（接受）

重数：`skills/dual-review-{plan,code,bug}/SKILL.md` 3 份，`skills/dual-critic/entry/{codex,gemini,glm}/dual-review-{plan,code,bug}/SKILL.md` 9 份，共 12 份，各 2 处。`skills/dual-critic/scripts/trivium.cjs` 的同句随构建从 `cli.ts` 再生。

### GLM-03（接受）

A1、A2 每个场景造两个同形的全新夹具实例，一个给旧构建、一个给新构建；比较前先断言两侧第 4 段里没有本主题己方历史文档条目。差异源从比较面上排除，不靠归一化抹平。
