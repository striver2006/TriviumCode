# 编译测试记录 · WinW5-A

- **运行**：`20261030T010657Z`
- **结论**：✅ 通过
- **起止**：2026-10-30T01:06:57.955Z → 2026-10-30T01:06:58.555Z
- **项目根**：`D:/Work/TriviumCode-fixtures/four-agent-win-20261029-211334/W5-A-run`

## 一、执行的命令

| # | 组 | 命令 | 退出码 | 耗时 | 命令 sha256 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | build | `node --check src/sum.cjs` | 0 | 0.4s | `67312499d37f` |
| 2 | test | `node --test test/sum.test.cjs` | 0 | 0.2s | `df314f839ee4` |

> `命令 sha256` 取命令原文，用于与配置对账（AC-10）。

## 二、输出摘要

### `node --check src/sum.cjs`（build，退出码 0）

（无输出）

### `node --test test/sum.test.cjs`（test，退出码 0）

**stdout（尾部）**

```text
✔ 两个正常数相加 (0.8787ms)
✔ 拒绝字符串 (0.6826ms)
✔ 拒绝 NaN（断言实际值回显，GLM-04） (0.2013ms)
✔ 拒绝 ±Infinity（断言实际值回显，GLM-04） (0.1931ms)
✔ 拒绝非 number 类型（两位置对称覆盖） (0.7785ms)
✔ 拒绝 bigint：拿到带类型标记说明的 TypeError 而非引擎序列化报错 (0.1689ms)
✔ 拒绝循环引用对象：消息构造路径不可抛（锁定 try/catch 回退分支，GLM-03） (0.1737ms)
✔ 允许负数 (0.103ms)
✔ 允许小数（容差断言，避免浮点误差假失败） (0.1887ms)
ℹ tests 9
ℹ suites 0
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 97.987
```

