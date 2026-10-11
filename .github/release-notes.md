## 下载与启动 / Download and launch

普通用户请下载 `Zixi-<版本>-Windows-x64-Setup.exe`。如需解压即用，请下载 `Zixi-<版本>-Windows-x64-Portable.zip`，完整解压后双击根目录 `zixi.exe` 并保留 `fonts`；默认不创建桌面快捷方式。

For most users, download `Zixi-<版本>-Windows-x64-Setup.exe`. For direct use after extraction, download `Zixi-<版本>-Windows-x64-Portable.zip`, fully extract it, run the root `zixi.exe`, and keep `fonts`; no desktop shortcut is created by default.

`Zixi-<版本>-Windows-x64.msi` 面向需要 MSI 的部署环境。GitHub 自动附带的 Source code ZIP/TAR.GZ 仅为源码，不是可运行安装包。

`Zixi-<版本>-Windows-x64.msi` is for MSI-based deployment. GitHub-generated Source code ZIP/TAR.GZ contains source only, not a runnable package.

## 要求与安全 / Requirements and security

支持 Windows 10/11 x64，免安装版需要 Microsoft Edge WebView2 Runtime；缺少时请使用安装版。公开构建尚未进行商业代码签名，请只从本仓库 Releases 下载并以 `SHA256SUMS.txt` 核验。

Windows 10/11 x64 is supported. The portable edition requires Microsoft Edge WebView2 Runtime; use the installer if it is unavailable. Public builds are not commercially code-signed; download only from this repository’s Releases and verify `SHA256SUMS.txt`.

用户数据保存在 `%APPDATA%\com.zixi.desktop`，不会随程序文件夹移动，也不会由升级或卸载主动删除。

User data is stored in `%APPDATA%\com.zixi.desktop`; it does not move with the program folder and is not actively deleted by upgrades or uninstallation.
