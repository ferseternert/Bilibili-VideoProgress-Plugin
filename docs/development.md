# 开发说明

## 目录

```text
src/
  core.js         记录格式、本地存储、续播规则
  client.js       读取客户端状态、切换分P、识别合集目录
  extension.js    处理播放入口、恢复进度、显示原生提示
  main.js         Electron 页面加载入口
  Asar.cs         读写客户端资源包
  Installer.cs    安装、备份和恢复
  Program.cs      安装器界面
tests/
  core.test.cjs   进度规则和存储测试
  client.test.cjs 客户端状态与分P映射测试
  installer.ps1  安装与卸载测试
```

## 运行方式

安装器在客户端 `index.js` 开头加载 `bpm-main.js`。每当客户端加载播放器页面，`main.js` 按顺序注入 `core.js`、`client.js` 和 `extension.js`。

`client.js` 从客户端的 Pinia store 读取视频、分P和合集目录，通过原播放器的 `ugcReload`、`changeMediaPage` 或 `initVideoList` 切换视频。适配新客户端时，优先检查这个文件里的 store 字段和 `loadBus()` 中的模块版本。

`extension.js` 负责一次打开操作的生命周期：

1. 区分「播放全部」、直接选分P和自动连播。
2. 等待播放器准备好，读取对应记录。
3. 通过原播放器跳转，并确认已到达记录时间。
4. 显示原生提示，恢复定时保存。

正在恢复时暂停写入进度，避免刚打开时的 0 秒覆盖旧记录。切换视频前保存最后一个有效采样，BV、CID 与播放器当前内容一致时才生成新采样。

观看记录以 `bili-progress-memory:v1:` 为前缀保存在 `localStorage`。一条记录按 BV 和 CID 唯一标识，同时关联所属视频和合集。

## 本地检查

需要 Node.js 18+ 和 Windows PowerShell。

```powershell
npm test
./build.ps1
powershell -NoProfile -File ./tests/installer.ps1
```

安装器测试会在临时目录生成一个小型 ASAR，检查新增模块、备份和卸载后的文件哈希。

## 实际播放器验证

0.1.0 已在客户端副本中验证：

- 跨分P恢复进度，并撤回。
- 直接选分P时提示记录，点击后跳转。
- 分别返回当前系列开头和整个合集开头。
- 主窗口合集播放器中的原生提示与手动跳转。

测试使用启动包 1.17.2 和界面热更新 1.20.0。离线列表仍待实际播放验证。

## 发布

运行 `./build.ps1`，将 `BiliProgressSetup.exe` 附加到对应版本的 GitHub Release。版本号同时更新 `package.json`、`Installer.Version` 和 `extension.js` 的诊断版本；功能变化写入 `CHANGELOG.md`。
