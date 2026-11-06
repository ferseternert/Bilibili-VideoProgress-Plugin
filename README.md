# B站客户端视频进度插件

在 B 站 Windows 客户端里记住分P和播放时间，以便后续快速跳转至断点。

[下载安装包](https://github.com/ferseternert/Bilibili-VideoProgress-Plugin/releases/latest) · [更新记录](CHANGELOG.md) · [开发说明](docs/development.md)

## 功能

| 操作 | 效果 |
| --- | --- |
| 点击「播放全部」 | 从记录的分P和时间继续播放，支持撤回 |
| 直接选择分P | 提示上次位置，可手动跳转 |
| 点击「从系列开头播放」 | 回到当前系列的第一个分P |
| 点击「从整个合集开头播放」 | 回到整个合集的第一个视频 |
| 自动连播、拖动进度条 | 按当前操作继续播放，并更新记录 |

系列与合集的从头播放入口分步显示：先回到系列开头，再选择是否从整个合集开头播放。没有系列划分时，直接提供合集开头入口。

## 安装

1. 从 [Releases](https://github.com/ferseternert/Bilibili-VideoProgress-Plugin/releases/latest) 下载 `BiliProgressSetup.exe`。
2. 从系统托盘完全退出哔哩哔哩。
3. 运行安装器，选择客户端安装目录，点击「安装到客户端」。
4. 重新打开哔哩哔哩。

首次安装后打开可能会卡退，重新启动即可。

目前仅验证 Windows 客户端启动包 **1.17.2**、界面热更新 **1.20.0**。

## 卸载和更新

退出客户端后运行安装器，点击「卸载并恢复」。安装器会恢复安装前的客户端文件，观看记录保留。

更新插件时，先卸载旧版，再安装新版。

## 观看记录

从安装后开始记录，播放时约每 4 秒保存一次，暂停、切换视频和退出时补存。记录保存在当前客户端的本地存储中。

## 从源码构建

在 Windows PowerShell 中运行：

```powershell
./build.ps1
```

生成的 `BiliProgressSetup.exe` 位于项目根目录。构建使用 Windows 自带的 .NET Framework 编译器。

开发和测试步骤见 [开发说明](docs/development.md)。

## 反馈

欢迎通过 [Issues](https://github.com/ferseternert/Bilibili-VideoProgress-Plugin/issues) 提交问题。附上客户端版本、视频链接和操作步骤，便于复现。

## 许可证

[MIT](LICENSE)
