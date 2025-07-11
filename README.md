<p align="center">
  <img src="src/assets/SimpleShell.png" style="width:100px"/>
</p>

[中文](README_zh.md)

# **SimpleShell - An Electron + React Terminal Application**

This is a terminal application built with Electron and React, combining the desktop application capabilities of Electron with the modern web development experience of React.

## **Features**

- **Core Functionality**: 
  - Integrated `xterm.js` and `ssh2` to provide remote terminal and file transfer capabilities.
  - File manager for browsing and managing local and remote files.
  - Support for SFTP folder uploads and downloads.
- **AI-Powered Assistant**: 
  - An integrated AI assistant to help users with commands and workflows.
- **Productivity & User Experience**:
  - Command history and suggestion features to improve user input efficiency.
  - Connection manager to save and manage SSH connection configurations.
  - World map display to show the geographical distribution of servers.
  - Dark mode and Light mode support.
  - Cross-platform support (Windows, macOS, Linux).
  - Internationalization support (English and Chinese).
- **System & Security Tools**:
  - Real-time performance and resource monitoring.
  - Random password generator for enhanced security.
  - IP address query tool to quickly find network information.
- **Performance & Architecture**:
  - Multi-level caching mechanism to improve data access speed.
  - Zero-copy file transfer engine to enhance SFTP efficiency.
  - Synchronous command dispatcher for managing group tasks.
  - Backpressure control and optimization middleware to ensure stable file transfers.

## **Development**

### **Prerequisites**

- Node.js 22+ and npm

### **Install Dependencies**

```bash
npm install
```

### **Development Mode**

```bash
npm run start
```

This will start the React development server and the Electron application.

### **Build Application**

```bash
npm run make
```

This will build the React application and the Electron application, and generate distributable installers.

## **Tech Stack**

- [Electron](https://www.electronjs.org/) \- Cross-platform desktop application framework
- [Material UI](https://mui.com/material-ui/) \- Component library
- [TypeScript](https://www.typescriptlang.org/) \- Typed JavaScript

## **License**

Apache \- 2.0
