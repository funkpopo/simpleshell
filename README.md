# SSH Project

![License](https://img.shields.io/badge/license-GPL3.0-green.svg)
![Python](https://img.shields.io/badge/python-3.12.7-blue.svg)
![Node.js](https://img.shields.io/badge/node-v20.12.1-green.svg)
![Release](https://img.shields.io/github/v/release/funkpopo/simplessh)

本项目前端基于Python3 + Vue3 + ArcoDesign + Xterm.js开发，实现一个SSH客户端工具，具有直观友好的用户界面。

![image](https://github.com/user-attachments/assets/a1b72c1b-802c-4ceb-85a1-d91415e24cdb)

- 通过Vue创建前端页面，使用ArcoDesign作为UI框架
- 使用Xterm.js实现网页终端功能
- 使用Python3 + FastAPI + Uvicorn实现后端服务器
- 支持文字复制粘贴操作
- 可以文件夹式管理多个安全可靠的SSH连接

## 功能特性
- 直观的用户界面，易于使用
- 支持多个SSH连接的管理
- 支持SFTP文件传输
- 实时终端交互
- 安全的密码和密钥认证
- 配置保存和加载

## 使用说明
使用左侧菜单添加和管理SSH连接
点击连接以打开新的终端标签页
在终端界面与远程服务器实时交互

## 配置文件

SSH连接配置保存在 `config.json` 文件中。该文件包含了所有保存的SSH连接信息。出于安全考虑，该文件不会被提交到版本控制系统。

如果该文件不存在，应用程序会自动创建它。

前端文件保存在项目根目录下

后端程序保存在项目根目录下的`backend`文件夹中

## 开发

- 前端：Vue 3 + ArcoDesign + Xterm.js

## 安装依赖

1. 安装前端依赖：
   ```
   npm install
   ```

2. 安装后端依赖：
   ```
   pip install -r backend/requirements.txt
   ```

## 运行项目（测试）

1. 启动后端服务器：
   ```
   python backend/main.py
   ```

2. 启动前端开发服务器：
   ```
   npm run serve
   ```

3. 测试electron（自动启动后端）
   ```
   npm run electron:serve
   ```

---

## 编译打包

1. 编译前端
   ```
   npm run electron:build
   ```

2. 编译后端
   ```
   python -m PyInstaller --clean --noconfirm --onefile  --hidden-import=gevent.builtins  --hidden-import=gevent.signal  --hidden-import=gevent.libev.corecext  --hidden-import=gevent.libuv.loop  --hidden-import=gevent.socket  --hidden-import=gevent.threading  --hidden-import=gevent._threading  --hidden-import=gevent.time  --hidden-import=gevent.os  --hidden-import=gevent.select  --hidden-import=gevent.ssl  --hidden-import=gevent.subprocess  --hidden-import=gevent.thread  --hidden-import=gevent.resolver.thread  --hidden-import=gevent.resolver.blocking  --hidden-import=gevent.resolver.cares  --hidden-import=gevent.resolver.dnspython  --hidden-import=gevent._ssl3  --hidden-import=engineio.async_drivers.gevent  --collect-all gevent service.py
   ```

## 贡献

欢迎提交问题和拉取请求以改进这个项目。

## 许可

[GPL-3.0 License](LICENSE)
