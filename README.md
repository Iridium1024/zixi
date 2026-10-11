# 字隙 Zixi

本地文字比较与桌面便签工具 / A local text-comparison and desktop-notes app.

下载免安装版后，完整解压并双击根目录 `zixi.exe`；请保留 `fonts/`。默认不会创建桌面快捷方式。

For the portable download, fully extract it and double-click the root `zixi.exe`; keep `fonts/` beside it. No desktop shortcut is created by default.

| 位置 / Location | 内容 / Contents |
|---|---|
| `releases/v0.1.1/` | 本地待发布的安装包、免安装 ZIP、校验和与说明 / staged packages, checksums, and notes |
| `src/`、`public/` | 前端源码与静态资源 / frontend source and assets |
| `src-tauri/` | 桌面端源码、资源与 Rust 构建目录 / desktop source, assets, and Rust build files |
| `scripts/` | 构建、发布检查与可选工具 / build, release checks, and optional tools |
| `docs/` | 使用与开发资料 / user and development documentation |
| `docs/local/` | 本地检查与执行报告，不上传 GitHub / local-only checklists and reports |

[详细指南 / Guide](docs/GUIDE.md) · [目录说明 / Project map](docs/PROJECT-STRUCTURE.md) · [GitHub 下载 / Downloads](https://github.com/Iridium1024/zixi/releases)

源码下载不含 EXE；本地构建请运行 `npm ci` 与 `npm run release:build`。根目录配置文件和 `LICENSE` 为开发与许可所需。

Source downloads do not include an EXE. To build locally, run `npm ci` and `npm run release:build`; root configuration files and `LICENSE` are required for development and licensing.
