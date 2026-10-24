# releases/ · 本地发布产物输出目录

本目录只是 `scripts/build-manual-pdf.mjs` 等脚本的缺省输出位置，**产物不入库**（见根目录 `.gitignore`）。
`dist/releases/` 是 `npm run release` 的构建现场。

正式发布包（macOS `tar.gz`、Windows `windows-x64.zip`）、对应的 `.sha256` 校验值与完整手册 PDF，
一律作为代码托管平台上对应版本标签的 **Release 附件**发布。

安装步骤见[稳定版部署手册](../doc/06_deployment/稳定版部署手册.md) §2；收到包先核对 `.sha256`。

> 2026-10-24 双平台统一时移除了原先入库的 1.2.7 Windows 包与 1.2.7 / 1.2.9 手册 PDF；
> 需要时可从 `windows` 分支历史取回，或由对应提交重新 `npm run release`。
