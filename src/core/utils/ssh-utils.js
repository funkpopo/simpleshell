const fs = require("fs");
const path = require("path");
const { logToFile } = require("./logger");

/**
 * 读取SSH私钥文件内容
 * @param {string} privateKeyPath - 私钥文件路径
 * @returns {string|null} 私钥内容，读取失败返回null
 */
function readPrivateKeyFile(privateKeyPath) {
  if (!privateKeyPath || typeof privateKeyPath !== "string") {
    logToFile("私钥文件路径为空或无效", "ERROR");
    return null;
  }

  try {
    // 检查文件是否存在
    if (!fs.existsSync(privateKeyPath)) {
      logToFile(`私钥文件不存在: ${privateKeyPath}`, "ERROR");
      return null;
    }

    // 检查文件是否可读
    try {
      fs.accessSync(privateKeyPath, fs.constants.R_OK);
    } catch (accessError) {
      logToFile(`私钥文件无读取权限: ${privateKeyPath}`, "ERROR");
      return null;
    }

    // 读取文件内容
    const keyContent = fs.readFileSync(privateKeyPath, "utf8");

    // 验证私钥格式
    if (!validatePrivateKeyFormat(keyContent)) {
      logToFile(`私钥文件格式无效: ${privateKeyPath}`, "ERROR");
      return null;
    }

    logToFile(`成功读取私钥文件: ${privateKeyPath}`, "INFO");
    return keyContent;
  } catch (error) {
    logToFile(
      `读取私钥文件失败: ${privateKeyPath} - ${error.message}`,
      "ERROR",
    );
    return null;
  }
}

/**
 * 异步读取SSH私钥文件内容
 * @param {string} privateKeyPath - 私钥文件路径
 * @returns {Promise<string|null>} 私钥内容，读取失败返回null
 */
async function readPrivateKeyFileAsync(privateKeyPath) {
  if (!privateKeyPath || typeof privateKeyPath !== "string") {
    logToFile("私钥文件路径为空或无效", "ERROR");
    return null;
  }

  try {
    // 检查文件是否存在
    if (!fs.existsSync(privateKeyPath)) {
      logToFile(`私钥文件不存在: ${privateKeyPath}`, "ERROR");
      return null;
    }

    // 检查文件是否可读
    try {
      await fs.promises.access(privateKeyPath, fs.constants.R_OK);
    } catch (accessError) {
      logToFile(`私钥文件无读取权限: ${privateKeyPath}`, "ERROR");
      return null;
    }

    // 读取文件内容
    const keyContent = await fs.promises.readFile(privateKeyPath, "utf8");

    // 验证私钥格式
    if (!validatePrivateKeyFormat(keyContent)) {
      logToFile(`私钥文件格式无效: ${privateKeyPath}`, "ERROR");
      return null;
    }

    logToFile(`成功读取私钥文件: ${privateKeyPath}`, "INFO");
    return keyContent;
  } catch (error) {
    logToFile(
      `读取私钥文件失败: ${privateKeyPath} - ${error.message}`,
      "ERROR",
    );
    return null;
  }
}

/**
 * 验证私钥文件格式
 * @param {string} keyContent - 私钥文件内容
 * @returns {boolean} 格式是否有效
 */
function validatePrivateKeyFormat(keyContent) {
  if (!keyContent || typeof keyContent !== "string") {
    return false;
  }

  // 移除换行符和空格进行基本检查
  const cleanedContent = keyContent.trim();

  // 检查OpenSSH格式私钥
  if (
    cleanedContent.includes("-----BEGIN OPENSSH PRIVATE KEY-----") &&
    cleanedContent.includes("-----END OPENSSH PRIVATE KEY-----")
  ) {
    return true;
  }

  // 检查传统PEM格式私钥
  const pemPatterns = [
    /-----BEGIN RSA PRIVATE KEY-----[\s\S]*-----END RSA PRIVATE KEY-----/,
    /-----BEGIN DSA PRIVATE KEY-----[\s\S]*-----END DSA PRIVATE KEY-----/,
    /-----BEGIN EC PRIVATE KEY-----[\s\S]*-----END EC PRIVATE KEY-----/,
    /-----BEGIN PRIVATE KEY-----[\s\S]*-----END PRIVATE KEY-----/,
  ];

  for (const pattern of pemPatterns) {
    if (pattern.test(cleanedContent)) {
      return true;
    }
  }

  // 检查是否包含私钥的基本标识
  const hasPrivateKeyMarkers =
    cleanedContent.includes("PRIVATE KEY") &&
    (cleanedContent.includes("-----BEGIN") ||
      cleanedContent.includes("-----END"));

  return hasPrivateKeyMarkers;
}

/**
 * 处理SSH配置中的私钥
 * @param {Object} sshConfig - SSH配置对象
 * @returns {Object} 处理后的SSH配置对象
 */
function processSSHPrivateKey(sshConfig) {
  if (!sshConfig) {
    return sshConfig;
  }

  // 如果已经有privateKey内容，直接返回
  if (sshConfig.privateKey) {
    return sshConfig;
  }

  // 如果有privateKeyPath，读取文件内容
  if (sshConfig.privateKeyPath) {
    const keyContent = readPrivateKeyFile(sshConfig.privateKeyPath);
    if (keyContent) {
      // 创建新的配置对象，避免修改原对象
      return {
        ...sshConfig,
        privateKey: keyContent,
      };
    } else {
      logToFile(
        `无法读取私钥文件，将尝试其他认证方式: ${sshConfig.privateKeyPath}`,
        "WARN",
      );
    }
  }

  return sshConfig;
}

/**
 * 异步处理SSH配置中的私钥
 * @param {Object} sshConfig - SSH配置对象
 * @returns {Promise<Object>} 处理后的SSH配置对象
 */
async function processSSHPrivateKeyAsync(sshConfig) {
  if (!sshConfig) {
    return sshConfig;
  }

  // 如果已经有privateKey内容，直接返回
  if (sshConfig.privateKey) {
    return sshConfig;
  }

  // 如果有privateKeyPath，读取文件内容
  if (sshConfig.privateKeyPath) {
    const keyContent = await readPrivateKeyFileAsync(sshConfig.privateKeyPath);
    if (keyContent) {
      // 创建新的配置对象，避免修改原对象
      return {
        ...sshConfig,
        privateKey: keyContent,
      };
    } else {
      logToFile(
        `无法读取私钥文件，将尝试其他认证方式: ${sshConfig.privateKeyPath}`,
        "WARN",
      );
    }
  }

  return sshConfig;
}

module.exports = {
  readPrivateKeyFile,
  readPrivateKeyFileAsync,
  validatePrivateKeyFormat,
  processSSHPrivateKey,
  processSSHPrivateKeyAsync,
};
