<p align="center">
  <img src="src/assets/SimpleShell.png" style="width:100px"/>
</p>

<h1 align="center">SimpleShell</h1>

<p align="center">
  <strong>基于 Electron + React 构建的强大跨平台 SSH 终端应用</strong>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="https://github.com/funkpopo/simpleshell/releases">下载</a> |
  <a href="#功能特性">功能</a> |
  <a href="#开发">开发</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/版本-0.1.12-blue" alt="版本">
  <img src="https://img.shields.io/badge/许可证-Apache%202.0-green" alt="许可证">
  <img src="https://img.shields.io/badge/平台-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="平台">
</p>

## **概述**

SimpleShell 是一款现代化、功能丰富的 SSH 终端应用，结合了 Electron 的桌面应用能力和 React 的直观开发体验。专为需要高效管理远程服务器的开发者和系统管理员设计。

## **功能特性**

### 🔌 **连接管理**

- **多协议支持**：SSH、Telnet 和本地 PowerShell 终端
- **连接池化**：智能连接复用，最小化资源占用
- **智能标签页**：拖放标签页重排、合并和分屏支持
- **组同步**：跨多个连接同时执行命令
- **可视化服务器地图**：全球服务器位置地理可视化

### 📁 **高级文件管理**

- **完整 SFTP 浏览器**：直观的文件浏览和拖放操作
- **批量传输**：支持进度跟踪的文件夹上传/下载
- **零拷贝引擎**：高性能文件传输，内存使用最小化
- **智能缓存**：多级缓存提升文件访问速度
- **文件预览**：内置文本、图片、代码和 PDF 查看器

### 🤖 **AI 智能助手**

- **智能命令助手**：AI 助手提供命令建议和解释
- **多模型支持**：可配置的 AI 提供商和模型
- **流式响应**：具有上下文感知的实时 AI 响应
- **工作线程处理**：非阻塞 AI 操作确保流畅性能

### 🎨 **用户体验**

- **现代化 UI**：Material-UI v7 与流畅的动画和过渡效果
- **主题支持**：暗色和亮色模式，自动检测系统偏好
- **命令历史**：智能命令建议和自动补全
- **多语言支持**：完整的国际化（中英文）
- **快捷方式管理**：自定义命令快捷方式和宏

### 📊 **监控与工具**

- **资源监控**：实时 CPU、内存和网络统计
- **远程系统信息**：通过 SSH 监控远程服务器性能
- **网络诊断**：带地理定位的 IP 地址查询
- **安全工具**：内置可自定义规则的密码生成器

### ⚡ **性能优化**

- **延迟加载**：按需加载组件，加快启动速度
- **背压控制**：通过流量控制实现稳定的文件传输
- **内存管理**：带泄漏检测的主动内存池
- **连接健康监控**：自动重连和故障转移

## **安装**

### **下载预构建版本**

从 [发布页面](https://github.com/funkpopo/simpleshell/releases) 下载适合您平台的最新版本。

- **Windows**：`.exe` 安装程序

### **从源代码构建**

如果您想从源代码构建，请按照下面的开发说明进行操作。

## **开发**

### **前提条件**

- Node.js 22+ 和 npm
- Git
- Python（用于 node-gyp 编译）
- 平台构建工具：
  - **Windows**：Visual Studio Build Tools 或 Visual Studio
  - **macOS**：Xcode Command Line Tools
  - **Linux**：build-essential 包

### **设置**

```bash
# 克隆仓库
git clone https://github.com/funkpopo/simpleshell.git
cd simpleshell

# 安装依赖
npm install
```

### **开发模式**

```bash
# 启动带热重载的开发服务器
npm run start
```

这将：

- 在端口 3001 上启动 Webpack 开发服务器
- 以开发模式启动 Electron
- 为 React 组件启用热模块替换

### **可用脚本**

```bash
# 使用 Prettier 格式化代码
npm run format

# 运行 ESLint（通过 .eslintrc.json 配置）
npx eslint src/

# 为当前平台打包应用
npm run package

# 构建可分发的安装包
npm run make

# 发布应用（需要配置）
npm run publish
```

### **生产构建**

```bash
# 为当前平台构建
npm run make

# 为特定平台构建
npm run make -- --platform=win32
npm run make -- --platform=darwin
npm run make -- --platform=linux
```

## **项目结构**

```
simpleshell/
├── src/
│   ├── main.js              # 主进程入口
│   ├── app.jsx              # 渲染进程入口
│   ├── preload.js           # 预加载脚本
│   ├── core/                # 核心模块
│   │   ├── connection/      # 连接管理
│   │   ├── transfer/        # 文件传输引擎
│   │   ├── memory/          # 内存管理
│   │   ├── ipc/            # IPC 通信
│   │   └── proxy/          # 代理管理
│   ├── modules/            # 功能模块
│   │   ├── terminal/       # 终端实现
│   │   ├── sftp/          # SFTP 操作
│   │   ├── system-info/   # 系统监控
│   │   └── connection/    # 连接处理
│   ├── components/        # React 组件
│   └── i18n/             # 国际化
├── forge.config.js       # Electron Forge 配置
└── webpack.*.config.js   # Webpack 配置
```

## **技术栈**

### **核心技术**

- **[Electron](https://www.electronjs.org/)** v37.4.0 - 跨平台桌面框架
- **[React](https://react.dev/)** v18.3.1 - UI 库
- **[Material-UI](https://mui.com/)** v7 - 组件库
- **[TypeScript](https://www.typescriptlang.org/)** - 类型安全

### **终端与 SSH**

- **[xterm.js](https://xtermjs.org/)** - 终端模拟器
- **[ssh2](https://github.com/mscdex/ssh2)** - SSH/SFTP 客户端
- **[node-pty](https://github.com/microsoft/node-pty)** - 伪终端支持

### **其他库**

- **[CodeMirror](https://codemirror.net/)** - 带语法高亮的代码编辑器
- **[i18next](https://www.i18next.com/)** - 国际化
- **[React Beautiful DnD](https://github.com/atlassian/react-beautiful-dnd)** - 拖放功能
- **[React Simple Maps](https://www.react-simple-maps.io/)** - 世界地图可视化

## **贡献**

欢迎贡献！请随时提交 Pull Request。

1. Fork 仓库
2. 创建您的功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交您的更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## **支持**

如果您遇到任何问题或有疑问：

- 在 [GitHub Issues](https://github.com/funkpopo/simpleshell/issues) 上开启问题
- 查看现有问题寻找解决方案
- 提供有关您的环境和问题的详细信息

## **许可证**

基于 Apache License 2.0 分发。有关更多信息，请参阅 `LICENSE`。

## **作者**

**funkpopo** - [s767609509@gmail.com](mailto:s767609509@gmail.com)
