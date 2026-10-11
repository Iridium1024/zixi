# Windows 发布文件 / Windows release files

- `Zixi-<版本>-Windows-x64-Portable.zip`：完整解压后双击根目录 `zixi.exe`；保留字体，需要系统 WebView2。 / Fully extract, then run the root `zixi.exe`; keep the fonts and use system WebView2.
- `Zixi-<版本>-Windows-x64-Setup.exe`：普通安装版。 / Standard installer.
- `Zixi-<版本>-Windows-x64.msi`：MSI 安装版。 / MSI installer.
- `SHA256SUMS.txt`：以上三个文件的 SHA-256 校验值。 / SHA-256 hashes for the three packages.
- `RELEASE-NOTES.md`：本版本发布说明。 / Release notes for this version.

Release 附件仅上传三个程序包和校验文件；发布说明作为 Release 正文。不要上传完整开发项目、依赖缓存或本地执行报告。此文件夹存在不等于已发布到 GitHub。

Release attachments contain only the three packages and checksums; use the release notes as the Release body. Do not upload the full development project, dependency caches, or local reports. The presence of this folder does not mean a GitHub Release has been published.

免安装版与安装版都将数据保存于 `%APPDATA%\com.zixi.desktop`，移动程序文件夹不会迁移数据。免安装版默认不创建桌面快捷方式。

Both portable and installed editions store data in `%APPDATA%\com.zixi.desktop`; moving the program folder does not move data. The portable edition does not create a desktop shortcut by default.
