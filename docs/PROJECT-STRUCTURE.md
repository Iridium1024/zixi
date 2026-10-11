# 项目目录说明

普通使用：双击根目录 `zixi.exe`。保留旁边的 `fonts/`，完整说明见 [使用与开发指南](GUIDE.md)。根目录只保留简短 README；启动和构建均不会自动创建桌面快捷方式。

| 位置 | 用途 |
|---|---|
| `zixi.exe`、`fonts/` | 本地可直接运行的分发文件，由构建脚本同步生成 |
| `releases/v0.1.1/` | 本地待发布的安装器、免安装 ZIP、校验和、发布说明 |
| `releases/archive/` | 历史本地构建归档，不代表线上已发布的原始二进制 |
| `src/`、`public/` | 前端源码和静态资源 |
| `src-tauri/src/`、`src-tauri/resources/`、`src-tauri/icons/` | 桌面端源码、随包资源及图标 |
| `scripts/` | 图标生成、构建打包、发布验证，以及可选的快捷方式工具 |
| `docs/` | 随源码维护的说明及截图 |
| `docs/local/` | 上传文件清单、本地执行记录与历史资料，不提交到公开仓库 |
| `.github/` | 发布工作流及发布说明模板 |
| `node_modules/`、`dist/`、`src-tauri/target/` | 依赖与正常构建缓存，不作为交付包上传 |

根目录的 package、TypeScript、Vite、ESLint 等配置保留在工具预期的位置，不为视觉整洁迁移它们。

发布使用 `npm run release:build`；已有正式构建时用 `npm run release:stage` 更新本地入口和发布包。快捷方式仅在用户主动运行 `scripts/Create Desktop Shortcut.cmd` 时创建。

免安装 ZIP 仅包含可运行程序、字体、许可证、启动说明和可选工具，不包含源码、依赖缓存、执行报告或用户数据库。用户数据仍位于 `%APPDATA%\com.zixi.desktop`。
