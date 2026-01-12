const { dialog } = require("electron");
const crypto = require("crypto");
const util = require("util");
const fs = require("fs").promises;
const { logToFile } = require("../../utils/logger");

const generateKeyPairAsync = util.promisify(crypto.generateKeyPair);

/**
 * SSH密钥相关的IPC处理器
 */
class SshKeyHandlers {
  getHandlers() {
    return [
      {
        channel: "generateSSHKeyPair",
        category: "sshKey",
        handler: this.generateSSHKeyPair.bind(this),
      },
      {
        channel: "saveSSHKey",
        category: "sshKey",
        handler: this.saveSSHKey.bind(this),
      },
    ];
  }

  async generateSSHKeyPair(event, options) {
    try {
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
          bits === 256
            ? "prime256v1"
            : bits === 384
              ? "secp384r1"
              : "secp521r1";
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
    } catch (error) {
      logToFile(`SSH key generation failed: ${error.message}`, "ERROR");
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async saveSSHKey(event, options) {
    try {
      const { content, filename } = options;

      const result = await dialog.showSaveDialog({
        defaultPath: filename,
        filters: [
          { name: "SSH Key Files", extensions: ["pub", "pem", "key"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (!result.canceled && result.filePath) {
        await fs.writeFile(result.filePath, content, "utf8");
        return { success: true };
      }

      return { success: false, error: "User cancelled" };
    } catch (error) {
      logToFile(`Save SSH key failed: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }
}

module.exports = SshKeyHandlers;
