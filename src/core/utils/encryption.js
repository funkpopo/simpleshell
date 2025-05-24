const crypto = require("crypto");

// 加密配置
const ENCRYPTION_KEY = "simple-shell-encryption-key-12345"; // 在生产环境中应该更安全地存储
const ENCRYPTION_ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16; // 对于 aes-256-cbc，IV长度是16字节

/**
 * 加密文本
 * @param {string} text - 要加密的文本
 * @returns {string} 加密后的文本
 */
function encryptText(text) {
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipher(ENCRYPTION_ALGORITHM, ENCRYPTION_KEY);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return iv.toString("hex") + ":" + encrypted;
  } catch (error) {
    console.error("加密失败:", error);
    throw error;
  }
}

/**
 * 解密文本
 * @param {string} text - 要解密的文本
 * @returns {string} 解密后的文本
 */
function decryptText(text) {
  try {
    const textParts = text.split(":");
    const iv = Buffer.from(textParts.shift(), "hex");
    const encryptedText = textParts.join(":");
    const decipher = crypto.createDecipher(
      ENCRYPTION_ALGORITHM,
      ENCRYPTION_KEY,
    );
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    console.error("解密失败:", error);
    throw error;
  }
}

module.exports = {
  encryptText,
  decryptText,
  ENCRYPTION_KEY,
  ENCRYPTION_ALGORITHM,
  IV_LENGTH,
};
