# 第三方依赖与许可证

本文件记录字隙 0.1.0 直接依赖的实际安装版本。完整依赖树由 `package-lock.json` 与 `src-tauri/Cargo.lock` 锁定；发布时应随产物保留各包内的许可证文本。

| 组件 | 版本 | 用途 | 许可证 |
| --- | ---: | --- | --- |
| React / React DOM | 19.2.8 | 界面运行时 | MIT |
| Monaco Editor | 0.53.0 | 双栏文本编辑与范围装饰 | MIT |
| @monaco-editor/react | 4.7.0 | React 集成 | MIT |
| jsdiff (`diff`) | 9.0.0 | 确定性序列差异 | BSD-3-Clause |
| lucide-react | 1.28.0 | 界面图标 | ISC |
| Tauri API | 2.11.1 | 桌面 API | Apache-2.0 OR MIT |
| Tauri CLI | 2.11.4 | 构建工具 | Apache-2.0 OR MIT |
| Tauri dialog/fs/opener/sql/window-state 插件 | 2.x | 保存、文件、定位、SQLite、窗口状态 | MIT OR Apache-2.0 |
| Vite | 7.3.6 | 前端构建 | MIT |
| TypeScript | 6.0.3 | 类型系统与编译 | Apache-2.0 |
| Vitest | 3.2.6 | 自动测试 | MIT |
| ESLint 及 React Hooks 插件 | 10.8.0 / 7.1.1 | 静态检查 | MIT |
| Testing Library | 16.3.2 / 14.6.3 / 7.0.0 | 测试辅助 | MIT |
| sha2 | 0.10.x | 应用管理资源的内容标识与重复检测 | MIT OR Apache-2.0 |
| rusqlite | 0.32.1 | 便签原子事务与乐观并发控制 | MIT |

## 随应用分发的字体

- **Noto Serif SC Variable**（内部 family name：`Noto Serif SC`），来源为 Google Fonts 官方 `ofl/notoserifsc` 目录，上游为 Noto CJK 项目。
- 字体许可证为 SIL Open Font License 1.1；许可证原文随源码保存在 `src-tauri/resources/fonts/OFL.txt`，构建后与字体一同进入应用 `fonts` 资源目录和安装包。
- 本项目未修改字体名称或字形；应用只在自身 WebView 中注册字体，不向操作系统安装字体。

Rust 直接依赖包括 Tauri 2.11.5、serde、serde_json、sha2、log 及 Tauri 官方插件。它们的准确传递依赖版本和校验值记录在 `src-tauri/Cargo.lock` 中；主要采用 MIT、Apache-2.0 或双许可证，具体条款以各 crate 随附文件为准。

## 参考但未复制代码的项目

- `sqmw/desk_tidy_sticky`：多便签窗口和外观交互思路。
- `Chengyue-Lu/StickyDesk`：托盘、单实例和设置持久化思路；因许可证未明确，没有复制代码或资源。
- `robmoraes/pinleaf`：本地优先、SQLite 与自动保存生命周期思路。
- `kpdecker/jsdiff`、`microsoft/monaco-editor`：通过上述正式依赖使用其公开 API。
- `pbek/QOwnNotes`、`Zettlr/Zettlr`：本地文档与导出管线思路。

除正式依赖外，本项目未复制上述参考项目的源代码、图标、品牌或视觉资产。
