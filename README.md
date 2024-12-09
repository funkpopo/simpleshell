# SimpleShell

![License](https://img.shields.io/badge/license-GPL3.0-green.svg)
![Python](https://img.shields.io/badge/python-3.12.7-blue.svg)
![Node.js](https://img.shields.io/badge/node-v22.11.0-green.svg)
![Release](https://img.shields.io/github/v/release/funkpopo/simpleshell)

This project is an SSH client tool developed with Python3 + Vue3 + ArcoDesign + Xterm.js, featuring an intuitive and user-friendly interface.

![simpleshell](https://github.com/user-attachments/assets/ec5a637d-34a1-46f1-97c0-b08266be473b)

- Frontend created with Vue and ArcoDesign UI framework
- Web terminal functionality implemented using Xterm.js
- Backend server built with Python3 + FastAPI + Uvicorn
- Supports text copy and paste operations
- Folder-style management of multiple secure SSH connections

## Features
- Intuitive user interface, easy to use
- Support for multiple SSH connection management
- SFTP file transfer support
- Real-time terminal interaction
- Built-in AI assistant functionality
- SSH password and key authentication
- Other configuration saving and loading

## Usage Instructions
Use the left menu to add and manage SSH connections
Click on a connection to open a new terminal tab
Interact with remote servers in real-time through the terminal interface

## Configuration File

SSH connection configurations are stored in the `config.json` file. This file contains all saved SSH connection information. For security reasons, this file is not committed to version control.

If the file doesn't exist, the application will create it automatically.

Frontend files are stored in the project root directory

Backend program is stored in the `backend` folder under the project root

## Development

- Frontend: Vue 3 + ArcoDesign + Xterm.js
- Backend: Python 3.12

## Installing Dependencies

1. Install frontend dependencies:
   ```
   npm install
   ```

2. Install backend dependencies:
   ```
   pip install -r backend/requirements.txt
   ```

## Running the Project (Testing)

1. Start the backend server:
   ```
   python backend/main.py
   ```

2. Start the frontend development server:
   ```
   npm run serve
   ```

3. Test electron (automatically starts backend):
   ```
   npm run electron:serve
   ```

---

## Building and Packaging

1. Build frontend
   ```
   # Default build for win x64
   npm run electron:build
   # Build for Windows platform
   npm run electron:build:win
   # Build for Linux platform
   npm run electron:build:linux
   ```

2. Build backend
   ```
   python -m PyInstaller --clean --noconfirm --onefile --hidden-import=gevent.monkey --hidden-import=gevent.builtins --hidden-import=gevent.signal --hidden-import=gevent.libev.corecext --hidden-import=gevent.libuv.loop --hidden-import=gevent.socket --hidden-import=gevent.threading --hidden-import=gevent._threading --hidden-import=gevent.time --hidden-import=gevent.os --hidden-import=gevent.select --hidden-import=gevent.ssl --hidden-import=gevent.subprocess --hidden-import=gevent.thread --hidden-import=gevent.resolver.thread --hidden-import=gevent.resolver.blocking --hidden-import=gevent.resolver.cares --hidden-import=gevent.resolver.dnspython --hidden-import=gevent._ssl3 --hidden-import=engineio.async_drivers.gevent --hidden-import=openai --hidden-import=ollama --hidden-import=zhipuai --hidden-import=numpy --hidden-import=pandas --hidden-import=aiohttp --hidden-import=urllib3 --hidden-import=ssl --collect-all gevent --collect-all aiohttp --collect-all urllib3 service.py

   ## If UPX compression is needed
   python -m PyInstaller --clean --noconfirm --onefile --hidden-import=gevent.monkey --hidden-import=gevent.builtins --hidden-import=gevent.signal --hidden-import=gevent.libev.corecext --hidden-import=gevent.libuv.loop --hidden-import=gevent.socket --hidden-import=gevent.threading --hidden-import=gevent._threading --hidden-import=gevent.time --hidden-import=gevent.os --hidden-import=gevent.select --hidden-import=gevent.ssl --hidden-import=gevent.subprocess --hidden-import=gevent.thread --hidden-import=gevent.resolver.thread --hidden-import=gevent.resolver.blocking --hidden-import=gevent.resolver.cares --hidden-import=gevent.resolver.dnspython --hidden-import=gevent._ssl3 --hidden-import=engineio.async_drivers.gevent --hidden-import=openai --hidden-import=ollama --hidden-import=zhipuai --hidden-import=numpy --hidden-import=pandas --hidden-import=aiohttp --hidden-import=urllib3 --hidden-import=ssl --collect-all gevent --collect-all aiohttp --collect-all urllib3 service.py --upx-dir "UPX_PATH"
   ```

   ## For faster startup speed (sacrificing package size, but UPX compression is still optional)
   ```
   python -m PyInstaller --clean --noconfirm --hidden-import=gevent.monkey --hidden-import=gevent.builtins --hidden-import=gevent.signal --hidden-import=gevent.libev.corecext --hidden-import=gevent.libuv.loop --hidden-import=gevent.socket --hidden-import=gevent.threading --hidden-import=gevent._threading --hidden-import=gevent.time --hidden-import=gevent.os --hidden-import=gevent.select --hidden-import=gevent.ssl --hidden-import=gevent.subprocess --hidden-import=gevent.thread --hidden-import=gevent.resolver.thread --hidden-import=gevent.resolver.blocking --hidden-import=gevent.resolver.cares --hidden-import=gevent.resolver.dnspython --hidden-import=gevent._ssl3 --hidden-import=engineio.async_drivers.gevent --hidden-import=openai --hidden-import=ollama --hidden-import=zhipuai --hidden-import=numpy --hidden-import=pandas --hidden-import=aiohttp --hidden-import=urllib3 --hidden-import=ssl --collect-all gevent --collect-all aiohttp --collect-all urllib3 service.py --upx-dir "UPX_PATH"
   ```

## Contributing

Issues and pull requests are welcome to improve this project.

## License

[GPL-3.0 License](LICENSE)