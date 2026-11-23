const { dialog } = require("electron");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const util = require("util");
const fs = require("fs").promises;
const {
  IPC_REQUEST_CHANNELS,
} = require("../../../shared/contracts/ipc/channels");
const SSHAuthenticationService = require("../../connection/sshAuthenticationService");

const generateKeyPairAsync = util.promisify(crypto.generateKeyPair);

/**
 * SSH密钥与已知主机管理相关的IPC处理器
 * 错误统一由 safeHandle/wrapIpcHandler 捕获并生成标准错误响应,处理器内直接 throw
 * （用户取消保存对话框返回 success:false，不视为异常）
 */
class SshKeyHandlers {
  constructor(options = {}) {
    this.configService = options.configService || null;
    this.systemKnownHostsPath =
      options.systemKnownHostsPath !== undefined
        ? options.systemKnownHostsPath
        : path.join(os.homedir(), ".ssh", "known_hosts");
  }

  _getConfigService() {
    if (!this.configService) {
      this.configService = require("../../settings/configService");
    }
    return this.configService;
  }

  getHandlers() {
    return [
      {
        channel: IPC_REQUEST_CHANNELS.SSH_KEY_GENERATE,
        category: "sshKey",
        handler: this.generateSSHKeyPair.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SSH_KEY_SAVE,
        category: "sshKey",
        handler: this.saveSSHKey.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SSH_KNOWN_HOSTS_LIST,
        category: "sshKey",
        handler: this.listKnownHosts.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SSH_KNOWN_HOSTS_REMOVE,
        category: "sshKey",
        handler: this.removeKnownHost.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SSH_KNOWN_HOSTS_CLEAR,
        category: "sshKey",
        handler: this.clearKnownHosts.bind(this),
      },
    ];
  }

  async listKnownHosts() {
    return SSHAuthenticationService.listKnownHosts({
      configService: this._getConfigService(),
      systemKnownHostsPath: this.systemKnownHostsPath,
    });
  }

  async removeKnownHost(_event, payload) {
    const hostKey =
      typeof payload === "string" ? payload : payload && payload.hostKey;
    if (typeof hostKey !== "string" || !hostKey.trim()) {
      throw new Error("Host key is required");
    }

    return SSHAuthenticationService.removeStoredKnownHost({
      configService: this._getConfigService(),
      hostKey: hostKey.trim(),
    });
  }

  async clearKnownHosts() {
    return SSHAuthenticationService.clearStoredKnownHosts({
      configService: this._getConfigService(),
    });
  }

  async generateSSHKeyPair(event, options) {
    void event;
    const {
      type = "ed25519",
      bits = 256,
      comment = "",
      passphrase = "",
    } = options;

    let keyGenOptions = {};

    if (type === "rsa") {
      keyGenOptions = {
        modulusLength: bits,
        publicKeyEncoding: {
          type: "spki",
          format: "pem",
        },
        privateKeyEncoding: {
          type: "pkcs8",
          format: "pem",
          cipher: passphrase ? "aes-256-cbc" : undefined,
          passphrase: passphrase || undefined,
        },
      };
    } else if (type === "ed25519") {
      keyGenOptions = {
        publicKeyEncoding: {
          type: "spki",
          format: "pem",
        },
        privateKeyEncoding: {
          type: "pkcs8",
          format: "pem",
          cipher: passphrase ? "aes-256-cbc" : undefined,
          passphrase: passphrase || undefined,
        },
      };
    } else if (type === "ecdsa") {
      const namedCurve =
        bits === 256 ? "prime256v1" : bits === 384 ? "secp384r1" : "secp521r1";
      keyGenOptions = {
        namedCurve: namedCurve,
        publicKeyEncoding: {
          type: "spki",
          format: "pem",
        },
        privateKeyEncoding: {
          type: "pkcs8",
          format: "pem",
          cipher: passphrase ? "aes-256-cbc" : undefined,
          passphrase: passphrase || undefined,
        },
      };
    }

    const { publicKey, privateKey } = await generateKeyPairAsync(
      type,
      keyGenOptions,
    );

    // 格式化公钥为SSH格式
    let sshPublicKey;
    if (type === "rsa") {
      const keyData = publicKey
        .replace(/-----BEGIN PUBLIC KEY-----\n?/, "")
        .replace(/\n?-----END PUBLIC KEY-----/, "")
        .replace(/\n/g, "");
      sshPublicKey = `ssh-rsa ${keyData} ${comment}`;
    } else if (type === "ed25519") {
      const keyData = publicKey
        .replace(/-----BEGIN PUBLIC KEY-----\n?/, "")
        .replace(/\n?-----END PUBLIC KEY-----/, "")
        .replace(/\n/g, "");
      sshPublicKey = `ssh-ed25519 ${keyData} ${comment}`;
    } else {
      const keyData = publicKey
        .replace(/-----BEGIN PUBLIC KEY-----\n?/, "")
        .replace(/\n?-----END PUBLIC KEY-----/, "")
        .replace(/\n/g, "");
      const curveType =
        bits === 256
          ? "ecdsa-sha2-nistp256"
          : bits === 384
            ? "ecdsa-sha2-nistp384"
            : "ecdsa-sha2-nistp521";
      sshPublicKey = `${curveType} ${keyData} ${comment}`;
    }

    return {
      success: true,
      publicKey: sshPublicKey.trim(),
      privateKey: privateKey,
    };
  }

  async saveSSHKey(event, options) {
    void event;
    const { content, filename } = options;

    // 私钥文件无扩展名，过滤器不能包含扩展名，
    // 否则 Windows 保存对话框会自动为无扩展名的文件名追加过滤器扩展名（如 .pub）
    const isPublicKey = filename.endsWith(".pub");
    const result = await dialog.showSaveDialog({
      defaultPath: filename,
      filters: isPublicKey
        ? [
            { name: "SSH Public Key", extensions: ["pub"] },
            { name: "All Files", extensions: ["*"] },
          ]
        : [{ name: "All Files", extensions: ["*"] }],
    });

    if (!result.canceled && result.filePath) {
      await fs.writeFile(result.filePath, content, "utf8");
      return { success: true };
    }

    // 用户取消保存：业务取消态，不走异常通道
    return { success: false, cancelled: true, error: "User cancelled" };
  }
}

module.exports = SshKeyHandlers;
