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
  <img src="https://img.shields.io/badge/version-0.4.24-blue" alt="Version">
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
│   ├── main.js              # Main process entry (Electron main)
│   ├── app.jsx              # Renderer entry (React app)
│   ├── preload.js           # Preload script (contextBridge/expose)
│   ├── components/         # React UI components
│   ├── core/                # Core modules / low-level primitives
│   │   ├── app/            # App bootstrap wiring
│   │   ├── connection/     # Protocol connection primitives/pools
│   │   ├── ipc/            # IPC helpers/services
│   │   ├── terminal/       # Terminal runtime (local/remote)
│   │   ├── local-terminal/ # Local terminal integration
│   │   ├── process/        # Process/pty helpers
│   │   ├── proxy/          # Proxy management
│   │   ├── services/       # Shared core services
│   │   ├── window/         # Window + lifecycle helpers
│   │   └── workers/        # Worker-thread logic
│   ├── modules/            # Feature modules (used by the UI)
│   │   ├── connection/     # Connection handling (app-level orchestration)
│   │   ├── filemanagement/ # File manager / transfer orchestration
│   │   ├── sftp/           # SFTP operations
│   │   ├── system-info/   # System monitoring (local/remote)
│   │   └── terminal/      # Terminal feature
│   ├── services/           # App services (e.g. config)
│   ├── store/              # State management
│   ├── workers/            # Worker entry points
│   ├── hooks/              # React hooks
│   ├── contexts/           # React contexts
│   ├── i18n/               # Internationalization
│   ├── styles/             # Global styles
│   ├── theme/              # Theme tokens/styles
│   └── utils/              # Shared utilities
├── transfernative/         # Native transfer sidecar (Rust)
├── forge.config.js         # Electron Forge configuration
├── webpack.main.config.js  # Webpack config for Electron main
└── webpack.renderer.config.js # Webpack config for Electron renderer
```

## **Tech Stack**

### **Core Technologies**

- **[Electron](https://www.electronjs.org/)** 40.4.1 - Cross-platform desktop framework
- **[React](https://react.dev/)** 19.2.4 - UI library (React 19)
- **[Material UI](https://mui.com/)** 7.3.9 - Component library
- **Electron Forge + Webpack** + **ESLint/Prettier** - Build and code quality toolchain
- JavaScript/JSX + Babel toolchain (no TypeScript build in this repo)

### **Terminal & SSH**

- **[xterm.js](https://xtermjs.org/)** 6.1.0-beta.167 - Terminal emulator + add-ons
  - `@xterm/addon-fit`, `@xterm/addon-search`, `@xterm/addon-web-links`, `@xterm/addon-image`, `@xterm/addon-webgl`
- **[ssh2](https://github.com/mscdex/ssh2)** 1.17.0 - SSH/SFTP client
- **[node-pty](https://github.com/microsoft/node-pty)** 1.2.0-beta.11 - Pseudo terminal support
- **[telnet-client](https://www.npmjs.com/package/telnet-client)** 2.2.13 - Telnet client

### **File Transfer (Native Sidecar)**

- **Rust sidecar (`transfernative/`)** - Native “transfer-sidecar” to speed up/robustify large transfers

### **Editing, Preview & Rendering**

- **CodeMirror 6** (`@codemirror/*`, `@uiw/react-codemirror`) - Syntax highlighting and editors
- **highlight.js** - Additional code highlighting
- **react-markdown** + `remark-gfm` - Markdown rendering
- **react-syntax-highlighter** - Fallback code highlighting for rendered markdown/code
- **react-pdf** - PDF preview
- **DND kit** (`@dnd-kit/*`) - Drag-and-drop interactions

### **Internationalization, UI & Utilities**

- **i18next** + **react-i18next** - Internationalization
- **react-simple-maps** - World map visualization
- **systeminformation** - System info collection
- Proxy support: `http-proxy-agent`, `https-proxy-agent`, `socks-proxy-agent`
- Performance helpers: `react-window`, `react-window-infinite-loader`

## **Connection Architecture**

- Core vs Modules
  - `src/core/connection`: Canonical, low-level connection primitives and pools. Files follow `*-connection-pool.js` naming (e.g., `ssh-connection-pool.js`, `telnet-connection-pool.js`) and a shared `base-connection-pool.js`.
  - `src/modules/connection`: App-level orchestration that composes the core pools and SFTP manager into a single service used by the app (exposed via `require("./modules/connection")`).

- Naming consistency
  - Use `*-connection-pool` for protocol-specific pools.
  - Legacy advanced pool/manager have been removed.
    - `ssh-advanced-pool.js` was consolidated into `src/core/connection/ssh-pool.js`.
    - Deprecated `src/core/connection/connection-manager.js` has been deleted to avoid split control paths.
  - Deprecated `src/core/connection/connection-monitor.js` has been removed. Connection health and observability now rely on:
    - Pool health checks (`base-connection-pool.js`)
    - Reconnection state machine (`reconnection-manager.js`)
    - Network latency service (`networkLatencyService.js`)

- Import guidance
  - For pools: `const { sshConnectionPool, telnetConnectionPool } = require("../../core/connection");`
  - For app-level connection features (incl. SFTP): `const connectionManager = require("./modules/connection");`

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

**funkpopo** - [funkpopoisme@gmail.com](mailto:funkpopoisme@gmail.com)
