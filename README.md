# SimpleShell-V2

本项目前端基于Vue3 + Xterm.js + node-pty + Electron开发，实现一个Windows平台的SSH客户端GUI应用程序，具有直观友好的用户界面。

- 通过Vue + Typescript实现显示页面
- 使用Xterm.js + node-pty实现网页终端功能
- 可以文件夹式管理多个安全可靠的SSH连接

## 使用说明
使用左侧边栏菜单添加和管理SSH连接。左侧边栏可以管理当前连接目标服务器的文件。

使用右侧边栏连接项触发打开新的终端标签页。

在终端界面与远程服务器实时交互。

## 配置文件

全局设置保存在`config.json`文件中。该文件包含了界面字体、字号、主题语言配置。

SSH连接配置保存在 `connections.json` 文件中。该文件包含了所有保存的SSH连接信息。

出于安全考虑，配置文件不会被提交到版本控制系统。

如果配置文件不存在，应用程序会自动创建它。

## 开发

- Vue + Xterm.js + node-pty + Electron

## 安装依赖

1. 安装前端依赖：
   ```
   npm install
   ```

## 运行项目（测试）

1. 测试electron
   ```
   npm run dev
   ```

---

## 编译打包

1. 编译前端
   ```
   # Windows平台打包
   npm run build:win
   # Linux平台打包
   npm run build:linux
   ```

## 图标包

Ui Oval Interface Icons Collection

## TODO
[√] 连接信息加密解密机制

[√] 文件传输浮窗自动删除item机制

[√] 右键菜单文件信息查看支持

[√] 连接信息拖拽排序分组

[√] 应用图标

[√] xterm中的鼠标事件、快捷键、搜索机制

[√] 鼠标移出应用窗口后的freeze处理，添加高亮规则

[ ] AI历史记录，配置自定义API

[√] 目标服务器资源监控

[√] 连接项图标优化显示

[√] 文件管理右键菜单添加刷新项

[√] json文件生产环境存储路径指定

[√] 终端字体和字号设置
