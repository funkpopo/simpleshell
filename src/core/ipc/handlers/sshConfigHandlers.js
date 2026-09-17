const os = require("os");
const path = require("path");
const fs = require("fs").promises;
const { IPC_REQUEST_CHANNELS } = require("../schema/channels");
const { parseOpenSSHConfig } = require("../../connection/openssh-config-parser");

/**
 * OpenSSH 客户端配置（~/.ssh/config）导入相关的 IPC 处理器
 * 错误统一由 safeHandle/wrapIpcHandler 捕获并生成标准错误响应，处理器内直接 throw
 * （配置文件不存在的业务态返回 success:true + exists:false，不视为异常）
 */
class SshConfigHandlers {
  getHandlers() {
    return [
      {
        channel: IPC_REQUEST_CHANNELS.SSH_CONFIG_IMPORT,
        category: "sshConfig",
        handler: this.importOpenSSHConfig.bind(this),
      },
    ];
  }

  /**
   * 解析 OpenSSH 客户端配置文件并返回可导入的主机列表
   * @param {Electron.IpcMainInvokeEvent} event
   * @param {{ configPath?: string }} [options] configPath 为自定义配置文件路径（默认 ~/.ssh/config）
   * @returns {Promise<object>} { success, exists, path, hosts, warnings }
   */
  async importOpenSSHConfig(event, options = {}) {
    void event;
    const homeDir = os.homedir();
    const configPath = path.isAbsolute(options?.configPath || "")
      ? options.configPath
      : path.join(homeDir, ".ssh", "config");

    let content;
    try {
      content = await fs.readFile(configPath, "utf8");
    } catch (error) {
      if (error && (error.code === "ENOENT" || error.code === "EISDIR")) {
        return {
          success: true,
          exists: false,
          path: configPath,
          hosts: [],
          warnings: [],
        };
      }
      // 权限不足等其他读取错误：交由异常通道返回失败响应
      throw error;
    }

    const { hosts, warnings } = parseOpenSSHConfig(content, { homeDir });

    return {
      success: true,
      exists: true,
      path: configPath,
      hosts,
      warnings,
    };
  }
}

module.exports = SshConfigHandlers;
