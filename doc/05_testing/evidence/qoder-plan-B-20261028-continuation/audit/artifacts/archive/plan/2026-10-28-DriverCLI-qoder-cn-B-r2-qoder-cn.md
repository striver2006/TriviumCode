# sum 修复计划（第 2 轮 · 相对第 1 轮改动）

## 本轮改动

- **AGY-01**（接受）：补充测试文件路径 `sum.test.cjs` 与运行命令 `node --test sum.test.cjs`
- **AGY-02**（接受）：补充 HEAD 重现验证的隔离机制
- **AGY-04**（接受）：删除 §清理 中的模板残留
- **GLM-01**（接受）：补充以 `git show HEAD:sum.cjs` 导出临时副本的取证机制
- **GLM-02**（接受）：补充测试输入域限定与 NaN/Infinity 排除条款
- **AGY-03**（暂缓）：参数数量异常与超大整数留待后续迭代，本轮仅限定输入域为小整数

## 目标

修正 HEAD 中 `sum.cjs` 的减法错误（`a-b` → `a+b`），使 `sum(2,1)` 返回 3。
使用 Node 内置 `node:test` 与 `assert` 增加测试覆盖。
不引入外部依赖，不处理非 number 输入及浮点精度契约。

## 实施步骤

1. **修复 sum.cjs**：将 `exports.sum = (a,b) => a-b` 改为 `exports.sum = (a,b) => a+b`。
2. **新增测试文件 `sum.test.cjs`**（项目根目录）：
   - 正数相加（小整数）：`sum(2,1) === 3`、`sum(100,200) === 300`
   - 负数相加（小整数）：`sum(-1,-2) === -3`、`sum(-1,1) === 0`
   - 零值：`sum(0,0) === 0`、`sum(0,5) === 5`
   - 交换律：`sum(a,b) === sum(b,a)`，取 `a=3,b=7`
   - 运行命令：`node --test sum.test.cjs`

## 验收

1. **HEAD 取证**：运行 `git show HEAD:sum.cjs > /tmp/sum-head.cjs`，导出 HEAD 版本到临时文件。
2. **HEAD 失败证明**：编写临时测试探针，`require('/tmp/sum-head.cjs')` 加载 HEAD 版本，运行 `sum(2,1)` 断言其不等于 3（实际返回 1），证明 HEAD 存在减法错误。
3. **清理临时文件**：删除 `/tmp/sum-head.cjs`，不触碰工作树中未验收的加法改动。
4. **候选通过证明**：在工作树运行 `node --test sum.test.cjs`，证明全部通过，退出码为 0。

## 边界声明

- 测试输入域限定为**小整数**（绝对值 ≤ 1000）。
- **NaN 与 Infinity**：typeof 为 number，但本轮明确排除，不编写对应测试用例。
- 不处理非 number 类型输入（字符串、null、undefined 等）。
- 不处理浮点精度问题（如 `sum(0.1, 0.2)` 不保证等于 `0.3`）。
- 参数数量异常（缺参、多参）遵循 JS 原生行为，本轮不单独测试。
- 超出 `Number.MAX_SAFE_INTEGER` 的整数不在测试范围内。
- 测试文件 `sum.test.cjs` 作为交付物保留，随修复一同提交。
