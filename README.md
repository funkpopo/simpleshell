<p align="center">
  <img src="src/renderer/assets/SimpleShell.png" style="width:100px"/>
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
  <img src="https://img.shields.io/badge/version-0.5.1-blue" alt="Version">
  <img src="https://img.shields.io/badge/license-Apache%202.0-green" alt="License">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform">
</p>

## **Overview**

SimpleShell is a modern, feature-rich SSH terminal application that combines the power of Electron's desktop capabilities with React's intuitive development experience. Designed for developers and system administrators who need efficient remote server management.

## **Features**

### 🔌 **Connection Management**

- **Multi-Protocol Support**: SSH, Telnet, Serial (COM), Mosh, and local PowerShell terminals
- **Connection Pooling**: Intelligent connection reuse to minimize resource usage
- **OpenSSH Config Import**: Parse `~/.ssh/config` and batch-import hosts in one click (supports HostName/Port/User/IdentityFile/ForwardAgent, Host wildcard & negation patterns, and global defaults; hosts using ProxyJump/ProxyCommand are flagged for manual jump configuration)
- **SSH Agent Forwarding**: Enable forwarding with password, private-key, or agent login. Password/private-key connections keep their login methods when forwarding is enabled; imported `ForwardAgent yes` applies to those connections too. The local agent path is configurable; reconnect after changing this setting.
- **Serial Console**: Direct serial/COM connections with configurable baud rate, data bits, stop bits, parity, and flow control; each tab holds an exclusive session per port
- **Mosh Support**: Weak-network/roaming-friendly sessions via a locally hosted mosh client (SSH bootstrap; interactive authentication happens in the terminal). On Windows, run through WSL or point to an MSYS2/Cygwin mosh binary; prediction mode (adaptive/always/never/experimental) and a custom mosh-server port are configurable.
- **Mosh Roaming Status**: The connection indicator follows the focused pane and displays running, waiting for recovery, or exited. Waiting follows the stock Mosh client's network notice; keep the tab open during an outage or network change so the client can recover the existing session. This is a display hint, not a UDP latency measurement; SSH probes do not restart Mosh sessions.
- **Smart Tabs**: Drag-drop tab reordering, merging, and split-screen support
- **Split Terminal**: Drag a tab onto the middle of another tab (stack-merge) or into the terminal area to merge it into a split view (up to 2×2 panes); right-click the merged tab → "Unsplit & Restore Tabs" to restore panes back to standalone tabs — sessions and terminal content are preserved on both merge and unsplit; each pane an independent session that can connect to a different host; drag pane headers to swap, drag dividers to resize; panes compose with sync-input groups for batch ops (`Ctrl+Shift+W` closes the focused pane) Closing a pane ends only that session, including the root pane; closing other panes retains exactly the selected session. Split tabs must be restored to standalone tabs before they can be merged into another tab.
- **Group Synchronization**: Execute commands across multiple connections simultaneously
- **Active Session Tools**: Resource monitoring, file management, AI, and quick commands follow the focused pane. File navigation and AI conversations/drafts stay separate for each session; switching SSH panes keeps the file sidebar open.
- **Visual Server Map**: Geographic visualization of server locations worldwide

### 📁 **Advanced File Management**

- **Full SFTP Browser**: Intuitive file browsing with drag-drop operations
- **Native SFTP Operations**: Directory browsing, file reads/writes, and transfers run in the Rust service. Uploads have no file-count cap. Dragged upload conflict checks submit the complete path list and use eight concurrent metadata reads on one session; JavaScript owns task scheduling, retries, and resume manifests.
- **Follow Terminal Directory**: A persistent global option in Settings → General lets SFTP follow the focused SSH terminal, with directory state isolated per tab or split session. Enabled by default.
- **Bulk Transfers**: Upload/download entire folders with progress tracking
- **Resumable SFTP Transfers**: Pause, reconnect, or restart the app and resume retained files from the transfer panel; files of 128 MiB or larger resume by completed segments
- **Integrity Verification**: Optional SHA-256 by default or MD5 per task, streamed over SFTP without shell access; a mismatch triggers exactly one full-file retransmission and reports both hashes if it fails again
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

### **Linux One-line Install**

```bash
curl -fsSL https://raw.githubusercontent.com/funkpopo/simpleshell/main/scripts/install-linux.sh | sh
```

Install a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/funkpopo/simpleshell/main/scripts/install-linux.sh | SIMPLESHELL_VERSION=0.4.39 sh
```

The script detects Debian/Ubuntu `.deb` and Fedora/RHEL/openSUSE `.rpm` systems, then downloads the matching latest package for the current CPU architecture from GitHub Releases.

### **Download Pre-built Binaries**

Download the latest release for your platform from the [Releases page](https://github.com/funkpopo/simpleshell/releases).

- **Windows**: `.exe` installer
- **Linux**: `.deb` or `.rpm` package

### **Build from Source**

If you prefer to build from source, follow the development instructions below.

## **Development**

For Serial/Mosh, SSH agent forwarding, and native SFTP manual verification, see [Manual checks](MANUAL_TESTING.md). The guide covers network roaming, split-pane status, client cleanup, forwarding with password/private-key login, and upload conflicts.

### **Prerequisites**

- Node.js 22.22.2+ (22 LTS) or 24.15.0+ and npm
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

# Run all check scripts and unit tests
npm test

# Run only Node unit tests
npm run test:unit

# Lint application code, scripts and unit tests
npm run lint

# Package application for current platform
npm run package

# Build distributable installers
npm run make

# Publish application (requires configuration)
npm run publish
```

Preload contracts use JSDoc and shared declarations in `src/shared/contracts/preload.d.ts`.
`npm run check` parses exposed methods and IPC calls with TypeScript, then checks
`src/preload/index.js` against its annotations using `tsconfig.preload.json`. Raw IPC
responses that have no detailed contract remain `unknown` and must be narrowed
by callers; this check does not type-check the renderer or main-process handlers.

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

```text
simpleshell/
├── src/
│   ├── main/                # Electron lifecycle, IPC, sessions, storage, native clients
│   ├── preload/             # contextBridge API and subscriptions
│   ├── renderer/            # React UI, terminal views and browser helpers
│   └── shared/              # Contracts, pure cross-runtime logic and locales
├── native-services/         # Rust native-services crate
├── tests/                   # Unit and composition tests
├── scripts/                 # Build, release and integration checks
├── docs/                    # Release and architecture documentation
├── forge.config.js
└── webpack.*.config.js
```

Source is organized by runtime. See [DIRECTORY_CONVENTIONS.md](DIRECTORY_CONVENTIONS.md), [MANUAL_TESTING.md](MANUAL_TESTING.md) and [docs/RELEASING.md](docs/RELEASING.md).

## **Tech Stack**

### **Core Technologies**

- **[Electron](https://www.electronjs.org/)** 40.4.1 - Cross-platform desktop framework
- **[React](https://react.dev/)** 19.2.8 - UI library (React 19)
- **[Material UI](https://mui.com/)** 9.2.0 - Component library
- **Electron Forge + Webpack** + **ESLint/Prettier** - Build and code quality toolchain
- JavaScript/JSX + Babel toolchain (no TypeScript build in this repo)

### **Terminal & SSH**

- **[xterm.js](https://xtermjs.org/)** 6.1.0-beta.167 - Terminal emulator + add-ons
  - `@xterm/addon-fit`, `@xterm/addon-search`, `@xterm/addon-web-links`, `@xterm/addon-image`, `@xterm/addon-webgl`
- **[ssh2](https://github.com/mscdex/ssh2)** 1.17.0 - SSH/SFTP client
- **[node-pty](https://github.com/microsoft/node-pty)** 1.2.0-beta.11 - Pseudo terminal support
- **[telnet-client](https://www.npmjs.com/package/telnet-client)** 2.2.13 - Telnet client

### **Native Services Host**

- **Rust host (`native-services/`)** - `simpleshell-native-services` hosts file-management and AI services behind stable subcommands

### **Editing, Preview & Rendering**

- **CodeMirror 6** (`@codemirror/*`, `@uiw/react-codemirror`) - Syntax highlighting and editors
- **highlight.js** - Additional code highlighting
- **react-markdown** + `remark-gfm` - Markdown rendering
- **react-pdf** - PDF preview
- **DND kit** (`@dnd-kit/*`) - Drag-and-drop interactions

### **Internationalization, UI & Utilities**

- **i18next** + **react-i18next** - Internationalization
- **react-simple-maps** - World map visualization
- **systeminformation** - System info collection
- Proxy support: `http-proxy-agent`, `https-proxy-agent`, `socks-proxy-agent`
- Performance helpers: `react-window`, `react-window-infinite-loader`

## **Connection Architecture**

`src/main/connection/` owns protocol pools, reconnection and connection orchestration; `connectionManager.js` composes the pools. Terminal sessions live in `src/main/terminal/`, SFTP task orchestration in `src/main/file-transfer/`, and Rust clients in `src/main/native/`.

Renderer accesses these capabilities through preload. IPC definitions and terminal protocols live in `src/shared/contracts/`; neither runtime imports the other runtime implementation.

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
