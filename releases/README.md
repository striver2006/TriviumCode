# releases/ · 发布物目录

- **根目录**：`scripts/build-manual-pdf.mjs` 等脚本的缺省输出位置，**不入库**（见根目录 `.gitignore`）。`dist/releases/` 是 `npm run release` 的构建现场，同样不入库。
- **版本子目录 `releases/<x.y.z>/`（2026-10-27 起入库）**：该版本的正式发布包与对应 `.sha256`——macOS `tar.gz` 在 Mac 上打，Windows `windows-x64.zip` 在 Windows 上打，各自提交推送到 `main`。两台机器拉取后就都有全套包，可在任一台上传 Release。完整手册 PDF 也可放这里。只放正式包（`发布信息.json` 为 `stable`、`source_dirty: false`），不放候选包与解压目录。

正式包、`.sha256` 与完整手册 PDF 仍作为代码托管平台上对应版本标签的 **Release 附件**发布；仓库里的副本便于在两台机器之间传递和留存，二者应逐字节相同。

安装步骤见[部署手册](../doc/06_deployment/部署手册.md) §2；收到包先核对 `.sha256`。

> 2026-10-24 双平台统一时移除了原先入库的 1.2.7 Windows 包与 1.2.7 / 1.2.9 手册 PDF；
> 需要时可从 `windows` 分支历史取回，或由对应提交重新 `npm run release`。
