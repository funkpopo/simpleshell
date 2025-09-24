<p align="center">
  <img src="src/assets/SimpleShell.png" style="width:100px"/>
</p>

<h1 align="center">SimpleShell</h1>

<p align="center">
  <strong>A powerful cross-platform SSH terminal application built with Electron + React</strong>
</p>

<p align="center">
  <a href="README_zh.md">中文</a> |
  <a href="https://github.com/funkpopo/simpleshell/releases">Download</a> |
  <a href="#features">Features</a> |
  <a href="#development">Development</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.12-blue" alt="Version">
  <img src="https://img.shields.io/badge/license-Apache%202.0-green" alt="License">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform">
</p>

## **Overview**

SimpleShell is a modern, feature-rich SSH terminal application that combines the power of Electron's desktop capabilities with React's intuitive development experience. Designed for developers and system administrators who need efficient remote server management.

## **Features**

### 🔌 **Connection Management**

- **Multi-Protocol Support**: SSH, Telnet, and local PowerShell terminals
- **Connection Pooling**: Intelligent connection reuse to minimize resource usage
- **Smart Tabs**: Drag-drop tab reordering, merging, and split-screen support
- **Group Synchronization**: Execute commands across multiple connections simultaneously
- **Visual Server Map**: Geographic visualization of server locations worldwide

### 📁 **Advanced File Management**

- **Full SFTP Browser**: Intuitive file browsing with drag-drop operations
- **Bulk Transfers**: Upload/download entire folders with progress tracking
- **Zero-Copy Engine**: High-performance file transfers with minimal memory usage
- **Smart Caching**: Multi-level cache for improved file access speed
- **File Preview**: Built-in viewer for text, images, code, and PDFs

### 🤖 **AI-Powered Assistant**

- **Intelligent Command Helper**: AI assistant for command suggestions and explanations
- **Multi-Model Support**: Configurable AI providers and models
- **Streaming Responses**: Real-time AI responses with context awareness
- **Worker Thread Processing**: Non-blocking AI operations for smooth performance

### 🎨 **User Experience**

- **Modern UI**: Material-UI v7 with smooth animations and transitions
- **Theme Support**: Dark and light modes with system preference detection
- **Command History**: Intelligent command suggestions and auto-completion
- **Multi-Language**: Full internationalization (English and Chinese)
- **Shortcut Management**: Custom command shortcuts and macros

### 📊 **Monitoring & Tools**

- **Resource Monitor**: Real-time CPU, memory, and network statistics
- **Remote System Info**: Monitor remote server performance via SSH
- **Network Diagnostics**: IP address lookup with geolocation
- **Security Tools**: Built-in password generator with customizable rules

### ⚡ **Performance Optimizations**

- **Lazy Loading**: Components loaded on-demand for faster startup
- **Backpressure Control**: Stable file transfers with flow control
- **Memory Management**: Active memory pool with leak detection
- **Connection Health Monitoring**: Automatic reconnection and failover

## **Installation**

### **Download Pre-built Binaries**

Download the latest release for your platform from the [Releases page](https://github.com/funkpopo/simpleshell/releases).

- **Windows**: `.exe` installer

### **Build from Source**

If you prefer to build from source, follow the development instructions below.

## **Development**

### **Prerequisites**

- Node.js 22+ and npm
- Git
- Python (for node-gyp compilation)
- Build tools for your platform:
  - **Windows**: Visual Studio Build Tools or Visual Studio
  - **macOS**: Xcode Command Line Tools
  - **Linux**: build-essential package

### **Setup**

```bash
# Clone the repository
git clone https://github.com/funkpopo/simpleshell.git
cd simpleshell

# Install dependencies
npm install
```

### **Development Mode**

```bash
# Start development server with hot reload
npm run start
```

This will:

- Start the Webpack dev server on port 3001
- Launch Electron in development mode
- Enable hot module replacement for React components

### **Available Scripts**

```bash
# Format code with Prettier
npm run format

# Run ESLint (configure via .eslintrc.json)
npx eslint src/

# Package application for current platform
npm run package

# Build distributable installers
npm run make

# Publish application (requires configuration)
npm run publish
```

### **Build for Production**

```bash
# Build for current platform
npm run make

# Build for specific platform
npm run make -- --platform=win32
npm run make -- --platform=darwin
npm run make -- --platform=linux
```

## **Project Structure**

```
simpleshell/
├── src/
│   ├── main.js              # Main process entry
│   ├── app.jsx              # Renderer process entry
│   ├── preload.js           # Preload script
│   ├── core/                # Core modules
│   │   ├── connection/      # Connection management
│   │   ├── transfer/        # File transfer engine
│   │   ├── memory/          # Memory management
│   │   ├── ipc/            # IPC communication
│   │   └── proxy/          # Proxy management
│   ├── modules/            # Feature modules
│   │   ├── terminal/       # Terminal implementation
│   │   ├── sftp/          # SFTP operations
│   │   ├── system-info/   # System monitoring
│   │   └── connection/    # Connection handling
│   ├── components/        # React components
│   └── i18n/             # Internationalization
├── forge.config.js       # Electron Forge configuration
└── webpack.*.config.js   # Webpack configurations
```

## **Tech Stack**

### **Core Technologies**

- **[Electron](https://www.electronjs.org/)** v37.4.0 - Cross-platform desktop framework
- **[React](https://react.dev/)** v18.3.1 - UI library
- **[Material-UI](https://mui.com/)** v7 - Component library
- **[TypeScript](https://www.typescriptlang.org/)** - Type safety

### **Terminal & SSH**

- **[xterm.js](https://xtermjs.org/)** - Terminal emulator
- **[ssh2](https://github.com/mscdex/ssh2)** - SSH/SFTP client
- **[node-pty](https://github.com/microsoft/node-pty)** - Pseudo terminal support

### **Additional Libraries**

- **[CodeMirror](https://codemirror.net/)** - Code editor with syntax highlighting
- **[i18next](https://www.i18next.com/)** - Internationalization
- **[React Beautiful DnD](https://github.com/atlassian/react-beautiful-dnd)** - Drag and drop
- **[React Simple Maps](https://www.react-simple-maps.io/)** - World map visualization

## **Contributing**

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## **Support**

If you encounter any issues or have questions:

- Open an issue on [GitHub Issues](https://github.com/funkpopo/simpleshell/issues)
- Check existing issues for solutions
- Provide detailed information about your environment and the problem

## **License**

Distributed under the Apache License 2.0. See `LICENSE` for more information.

## **Author**

**funkpopo** - [s767609509@gmail.com](mailto:s767609509@gmail.com)
