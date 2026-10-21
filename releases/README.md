# releases/ · 预构建发布产物

本目录存放随版本入库的正式发布包与配套手册（`dist/releases/` 是构建现场，本目录是入库快照）。

| 文件 | 说明 |
| :--- | :--- |
| `TriviumCode-<版本>-windows-x64.zip` | Windows 正式发布包（`npm run release` 于干净工作树产出，`candidate: false`） |
| `TriviumCode-<版本>-windows-x64.zip.sha256` | 传输校验值 |
| `TriviumCode-<版本>-完整手册.pdf` | 安装部署 + 用户手册 + 该版增补篇（Edge 无头渲染） |

安装步骤见[稳定版部署手册](../doc/06_deployment/稳定版部署手册.md) §2；收到包先核对 `.sha256`。

## 当前条目

| 版本 | 日期 | 平台 | 包 | 手册 |
| :--- | :--- | :--- | :--- | :--- |
| 1.2.7 | 2026-10-21 | windows-x64 | `TriviumCode-1.2.7-windows-x64.zip`（sha256 `ebfe85ba…0b59a7`） | `TriviumCode-1.2.7-完整手册.pdf`（44 页） |

> 历史版本（1.1.0 candidate、1.2.2）不入库；需要时由对应标签重新 `npm run release`。
