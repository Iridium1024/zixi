## Windows 下载

普通用户请下载 `Zixi-<版本>-Windows-x64-Setup.exe`，双击后按提示安装。无需安装 Node.js、Rust 或其他开发工具。

`Zixi-<版本>-Windows-x64.msi` 主要用于需要 MSI 的管理或批量部署环境。GitHub 自动附带的 `Source code (zip)` 和 `Source code (tar.gz)` 是源码归档，不是可直接运行的安装包。

### 系统要求

- Windows 10 或 Windows 11，x64
- Microsoft Edge WebView2 Runtime（受支持的 Windows 10/11 通常已预装）

### 安全提示

当前公开构建尚未进行商业代码签名，Windows SmartScreen 可能显示“未知发布者”。请只从本仓库的 Releases 页面下载，并使用 `SHA256SUMS.txt` 核对文件完整性。

字隙是本地优先应用。升级或卸载程序不会主动删除 `%APPDATA%\com.zixi.desktop` 中的用户数据库和外观资源。
