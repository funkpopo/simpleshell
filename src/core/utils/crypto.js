const crypto = require("crypto");

// 加密配置
const ENCRYPTION_KEY = "simple-shell-encryption-key-12345"; // 在生产环境中应该更安全地存储
const ENCRYPTION_ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16; // 对于 aes-256-cbc，IV长度是16字节

function encryptText(text) {
  try {
    // 创建随机的初始化向量
    const iv = crypto.randomBytes(IV_LENGTH);
    // 从加密密钥创建密钥（使用SHA-256哈希以得到正确长度的密钥）
    const key = crypto
      .createHash("sha256")
      .update(String(ENCRYPTION_KEY))
      .digest();
    // 创建加密器
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
    // 加密文本
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    // 将IV附加到加密文本的前面，以便解密时使用
    return iv.toString("hex") + ":" + encrypted;
  } catch (error) {
    // logToFile(`Encryption failed: ${error.message}`, "ERROR");
    return null;
  }
}

function decryptText(text) {
  if (typeof text !== "string" || !text.includes(":")) {
    // logToFile(`Decryption failed: Invalid input format. Input: ${text}`, "ERROR");
  }
  try {
    // 分离IV和加密文本
    const textParts = text.split(":");
    const ivHex = textParts.shift();
    const encryptedText = textParts.join(":");
    const iv = Buffer.from(ivHex, "hex");
    // 从加密密钥创建密钥
    const key = crypto
      .createHash("sha256")
      .update(String(ENCRYPTION_KEY))
      .digest();
    // 创建解密器
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    // 解密文本
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    // logToFile(`Decryption failed: ${error.message}`, "ERROR");
    return null;
  }
}

module.exports = {
  encryptText,
  decryptText,
  ENCRYPTION_KEY,
  ENCRYPTION_ALGORITHM,
  IV_LENGTH,
};
