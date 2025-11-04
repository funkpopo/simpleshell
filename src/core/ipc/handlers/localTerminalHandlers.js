const { ipcMain } = require("electron");
const TerminalDetector = require("../../local-terminal/terminal-detector");
const LocalTerminalManager = require("../../local-terminal/local-terminal-manager");
const WindowEmbedder = require("../../local-terminal/window-embedder");

class LocalTerminalHandlers {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.terminalDetector = new TerminalDetector();
    this.terminalManager = new LocalTerminalManager();
    this.windowEmbedder = new WindowEmbedder(mainWindow);

    this.setupEventListeners();
    this.registerHandlers();
  }

  setupEventListeners() {
    // 监听终端管理器事件
    this.terminalManager.on("terminalLaunched", (data) => {
      this.mainWindow.webContents.send("localTerminalStatus", {
        type: "launched",
        tabId: data.tabId,
        terminalInfo: {
          tabId: data.terminalInfo?.tabId,
          pid: data.terminalInfo?.pid,
          status: data.terminalInfo?.status,
          startTime: data.terminalInfo?.startTime,
          hwnd: data.terminalInfo?.hwnd,
        },
      });
    });

    this.terminalManager.on("terminalReady", async (data) => {
      const { tabId, hwnd, pid } = data;

      if (hwnd && process.platform === "win32") {
        try {
          // 计算嵌入边界 - 可替换为 WebTerminal 实际容器位置
          const containerBounds = {
            x: 0,
            y: 40, // AppBar 高度
            width: this.mainWindow.getBounds().width - 120, // 预留侧边栏宽度
            height: this.mainWindow.getBounds().height - 40,
          };

          // 执行窗口嵌入
          await this.windowEmbedder.embedWindow(tabId, hwnd, containerBounds);

          this.mainWindow.webContents.send("localTerminalStatus", {
            type: "embedded",
            tabId,
            hwnd,
            embedded: true,
          });
        } catch (error) {
          console.error("Failed to embed terminal window:", error);
          this.mainWindow.webContents.send("localTerminalStatus", {
            type: "embed-error",
            tabId,
            error: error.message || "Embed failed",
          });
        }
      }

      this.mainWindow.webContents.send("localTerminalStatus", {
        type: "ready",
        tabId,
        hwnd,
        pid,
      });
    });

    this.terminalManager.on("terminalError", (data) => {
      this.mainWindow.webContents.send("localTerminalStatus", {
        type: "error",
        tabId: data.tabId,
        error: {
          message: data.error?.message || "Unknown error",
          stack: data.error?.stack,
        },
      });
    });

    this.terminalManager.on("terminalExited", (data) => {
      this.mainWindow.webContents.send("localTerminalStatus", {
        type: "closed",
        tabId: data.tabId,
        code: data.code,
      });
    });

    // 监听窗口嵌入事件
    this.windowEmbedder.on("windowEmbedded", (data) => {
      this.mainWindow.webContents.send("localTerminalStatus", {
        type: "embedded",
        tabId: data.tabId,
        hwnd: data.hwnd,
      });
    });

    this.windowEmbedder.on("windowUnembedded", (data) => {
      this.mainWindow.webContents.send("localTerminalStatus", {
        type: "unembedded",
        tabId: data.tabId,
      });
    });

    // 监听窗口尺寸变化，调整嵌入终端的尺寸
    this.mainWindow.on("resize", () => {
      this.resizeEmbeddedTerminals();
    });
  }

  async resizeEmbeddedTerminals() {
    try {
      const embeddedWindows = this.windowEmbedder.getAllEmbeddedWindows();
      const bounds = this.mainWindow.getBounds();

      for (const windowInfo of embeddedWindows) {
        if (windowInfo.isEmbedded) {
          const containerBounds = {
            x: 0,
            y: 40,
            width: bounds.width - 120,
            height: bounds.height - 40,
          };

          await this.windowEmbedder.resizeEmbeddedWindow(
            windowInfo.tabId,
            containerBounds,
          );
        }
      }
    } catch (error) {
      console.error("Failed to resize embedded terminals:", error);
    }
  }

  registerHandlers() {
    // 检测本地终端
    ipcMain.handle("detectLocalTerminals", async () => {
      try {
        // 获取系统检测到的终端
        const systemTerminals =
          await this.terminalDetector.detectAllTerminals();

        return systemTerminals;
      } catch (error) {
        console.error("Failed to detect local terminals:", error);
        throw error;
      }
    });

    // 启动本地终端
    ipcMain.handle(
      "launchLocalTerminal",
      async (event, terminalConfig, tabId, options = {}) => {
        try {
          const result = await this.terminalManager.launchTerminal(
            terminalConfig,
            tabId,
            options,
          );

          // 仅返回可序列化字段
          return {
            success: true,
            data: {
              tabId: result.tabId || tabId,
              pid: result.pid,
              status: result.status,
              startTime: result.startTime,
              hwnd: result.hwnd,
              distribution: result.distribution || null,
              config: {
                name: terminalConfig.name,
                type: terminalConfig.type,
                executable: terminalConfig.executable,
                availableDistributions:
                  terminalConfig.availableDistributions || [],
              },
            },
            embedded: false, // 初始嵌入状态，后续通过事件更新
          };
        } catch (error) {
          console.error("Failed to launch local terminal:", error);
          return {
            success: false,
            error: error.message || "Unknown error occurred",
          };
        }
      },
    );

    // 关闭本地终端
    ipcMain.handle("closeLocalTerminal", async (event, tabId) => {
      try {
        // 先取消窗口嵌入
        await this.windowEmbedder.unembedWindow(tabId);
        // 再结束终端进程
        await this.terminalManager.closeTerminal(tabId);

        return { success: true };
      } catch (error) {
        console.error("Failed to close local terminal:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 获取终端详细信息
    ipcMain.handle("getLocalTerminalInfo", async (event, tabId) => {
      try {
        const terminalInfo = this.terminalManager.getActiveTerminal(tabId);
        const embeddedInfo = this.windowEmbedder.getEmbeddedWindow(tabId);

        // 仅返回可序列化字段
        return {
          success: true,
          data: {
            terminal: terminalInfo
              ? {
                  tabId: terminalInfo.tabId,
                  pid: terminalInfo.pid,
                  status: terminalInfo.status,
                  startTime: terminalInfo.startTime,
                  hwnd: terminalInfo.hwnd,
                }
              : null,
            embedded: embeddedInfo
              ? {
                  tabId: embeddedInfo.tabId,
                  hwnd: embeddedInfo.hwnd,
                  isEmbedded: embeddedInfo.isEmbedded,
                  originalParent: embeddedInfo.originalParent,
                  originalStyle: embeddedInfo.originalStyle,
                }
              : null,
          },
        };
      } catch (error) {
        console.error("Failed to get terminal info:", error);
        return {
          success: false,
          error: error.message || "Unknown error occurred",
        };
      }
    });

    // 调整嵌入窗口大小
    ipcMain.handle("resizeEmbeddedTerminal", async (event, tabId, bounds) => {
      try {
        const success = await this.windowEmbedder.resizeEmbeddedWindow(
          tabId,
          bounds,
        );
        return { success: Boolean(success) };
      } catch (error) {
        console.error("Failed to resize embedded terminal:", error);
        return {
          success: false,
          error: error.message || "Unknown error occurred",
        };
      }
    });

    // 获取所有活动终端
    ipcMain.handle("getAllActiveLocalTerminals", async () => {
      try {
        const terminals = this.terminalManager.getAllActiveTerminals();

        // 返回可序列化的终端信息
        const serializableTerminals = terminals.map((terminal) => ({
          tabId: terminal.tabId,
          pid: terminal.pid,
          status: terminal.status,
          startTime: terminal.startTime,
          hwnd: terminal.hwnd,
          config: terminal.config
            ? {
                name: terminal.config.name,
                type: terminal.config.type,
                executable: terminal.config.executable,
              }
            : null,
        }));

        return {
          success: true,
          data: serializableTerminals,
        };
      } catch (error) {
        console.error("Failed to get active terminals:", error);
        return {
          success: false,
          error: error.message || "Unknown error occurred",
        };
      }
    });
  }

  async cleanup() {
    try {
      await this.windowEmbedder.cleanup();
      await this.terminalManager.cleanup();
    } catch (error) {
      console.error("Error during local terminal cleanup:", error);
    }
  }
}

module.exports = LocalTerminalHandlers;

