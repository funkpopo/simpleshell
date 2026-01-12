const path = require("path");
const fs = require("fs").promises;
const { app } = require("electron");
const { logToFile } = require("../../utils/logger");

/**
 * 记忆文件相关的IPC处理器
 */
class MemoryHandlers {
  getTempDir() {
    if (app.isPackaged) {
      return path.join(path.dirname(app.getPath("exe")), "temp");
    } else {
      return path.join(app.getAppPath(), "temp");
    }
  }

  getHandlers() {
    return [
      {
        channel: "memory:save",
        category: "memory",
        handler: this.saveMemory.bind(this),
      },
      {
        channel: "memory:load",
        category: "memory",
        handler: this.loadMemory.bind(this),
      },
      {
        channel: "memory:delete",
        category: "memory",
        handler: this.deleteMemory.bind(this),
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
    } catch (err) {
      return null;
    }
  }

  async deleteMemory() {
    try {
      const tempDir = this.getTempDir();
      const filepath = path.join(tempDir, "mem.json");
      await fs.unlink(filepath);
      return true;
    } catch (err) {
      return false;
    }
  }
}

module.exports = MemoryHandlers;
