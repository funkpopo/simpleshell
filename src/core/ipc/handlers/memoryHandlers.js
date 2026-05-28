const path = require("path");
const fs = require("fs").promises;
const { app } = require("electron");
const { logToFile } = require("../../utils/logger");
const { getTempDirectory } = require("../../utils/appPaths");
const fileCache = require("../../utils/fileCache");
const {
  mainProcessResourceManager,
} = require("../../utils/mainProcessResourceManager");
const processManager = require("../../process/processManager");
const aiWorkerManager = require("../../workers/aiWorkerManager");
const { IPC_REQUEST_CHANNELS } = require("../schema/channels");

/**
 * 记忆文件相关的IPC处理器
 */
class MemoryHandlers {
  getTempDir() {
    return getTempDirectory(app);
  }

  getHandlers() {
    return [
      {
        channel: IPC_REQUEST_CHANNELS.MEMORY_SAVE,
        category: "memory",
        handler: this.saveMemory.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.MEMORY_LOAD,
        category: "memory",
        handler: this.loadMemory.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.MEMORY_DELETE,
        category: "memory",
        handler: this.deleteMemory.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.MEMORY_GET_DIAGNOSTICS,
        category: "memory",
        handler: this.getDiagnostics.bind(this),
      },
    ];
  }

  async saveMemory(event, memory) {
    try {
      const tempDir = this.getTempDir();
      await fs.mkdir(tempDir, { recursive: true });
      const filepath = path.join(tempDir, "mem.json");
      await fs.writeFile(filepath, JSON.stringify(memory, null, 2), "utf-8");
      return { success: true, filepath };
    } catch (error) {
      logToFile(`Save memory failed: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async loadMemory() {
    try {
      const tempDir = this.getTempDir();
      const filepath = path.join(tempDir, "mem.json");
      const content = await fs.readFile(filepath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async deleteMemory() {
    try {
      const tempDir = this.getTempDir();
      const filepath = path.join(tempDir, "mem.json");
      await fs.unlink(filepath);
      return true;
    } catch {
      return false;
    }
  }

  async getDiagnostics() {
    try {
      const processEntries = Array.from(processManager.getProcessMap()).map(
        ([id, proc]) => ({
          id,
          type: proc?.type || "unknown",
          ready: proc?.ready === true,
          hasStream: Boolean(proc?.stream),
          hasConnectionInfo: Boolean(proc?.connectionInfo),
          tabId: proc?.config?.tabId || null,
        }),
      );

      return {
        success: true,
        timestamp: Date.now(),
        process: {
          pid: process.pid,
          platform: process.platform,
          arch: process.arch,
          uptimeSeconds: Math.round(process.uptime()),
          memoryUsage: process.memoryUsage(),
        },
        resources: mainProcessResourceManager.getStats(),
        terminalProcesses: {
          count: processManager.getProcessCount(),
          entries: processEntries,
        },
        fileCache: fileCache.getCacheStats(),
        aiWorker: aiWorkerManager.getDiagnostics(),
      };
    } catch (error) {
      logToFile(`Memory diagnostics failed: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }
}

module.exports = MemoryHandlers;
