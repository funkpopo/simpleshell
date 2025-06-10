<p align="center">
  <img src="src/assets/SimpleShell.png" style="width:100px"/>
</p>

[中文](README_zh.md)

# **SimpleShell - An Electron + React Terminal Application**

This is a terminal application built with Electron and React, combining the desktop application capabilities of Electron with the modern web development experience of React.

## **Features**

- Built with Electron-forge
- Uses React and the Material UI component library
- Dark mode support
- Offline usage
- Cross-platform support (Windows, macOS, Linux)
- Implements SSH and SFTP functionality using Xterm.js and SSH2
- Allows SFTP folder uploads and downloads
- AI support

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
