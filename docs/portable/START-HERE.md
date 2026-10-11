# 字隙：启动说明 / Zixi: Start here

1. 将整个 ZIP 解压到准备长期保存的位置。 / Extract the entire ZIP to a place you intend to keep.
2. 双击本文件旁的 `zixi.exe` 启动字隙，无需 Node.js 或 Rust。 / Double-click the adjacent `zixi.exe`; Node.js and Rust are not required.
3. 默认不创建桌面快捷方式。需要时才运行 `scripts/Create Desktop Shortcut.cmd`，或右键 `zixi.exe` → 显示更多选项 → 发送到 → 桌面快捷方式。 / No desktop shortcut is created by default. Create one only when needed with `scripts/Create Desktop Shortcut.cmd`, or use the Windows Send to Desktop shortcut action.

`fonts` 文件夹提供应用字体，请与 `zixi.exe` 一起保留。不要直接从压缩包预览窗口运行程序。若曾手动创建快捷方式，移动整个文件夹后请重新创建或运行可选工具更新入口。

Keep the `fonts` folder beside `zixi.exe`. Do not run the app from the ZIP preview window. If you move a folder with a manually created shortcut, recreate it or run the optional shortcut tool again.

## 系统要求

Windows 10/11 x64，以及 Microsoft Edge WebView2 Runtime。若系统缺少 WebView2，请使用 Release 页的 `Windows-x64-Setup.exe` 安装版，由安装器处理运行时依赖。

“免安装”仅表示程序可直接运行；便签、比较正文与设置仍保存在 `%APPDATA%\com.zixi.desktop`，不随此文件夹移动。备份数据前，请从托盘菜单完全退出字隙，再复制该应用数据目录。升级免安装版也应先从托盘退出，随后完整解压新版。

窗口右上角关闭按钮会将程序收起到托盘。独立文字比较窗口和悬浮便签都是同一个 `zixi.exe` 的功能。

## 下载文件的区别

- `Windows-x64-Portable.zip`：本免安装包，解压后根目录直接提供 `zixi.exe`。
- `Windows-x64-Setup.exe`：安装版，适合多数用户。
- `Windows-x64.msi`：MSI 安装版。
- GitHub 自动附带的 `Source code.zip`：源码，需开发环境才能构建，不包含已编译的 EXE。

所有下载均以官方 [GitHub Releases](https://github.com/Iridium1024/zixi/releases) 页面为准。当前版本未进行商业代码签名，可使用发布页 `SHA256SUMS.txt` 校验下载。
