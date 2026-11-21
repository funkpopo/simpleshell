const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { promisify } = require("util");
const configService = require("./configService");
const createPackageCodecMethods = require("./transfer/packageCodec");
const createPayloadMergeMethods = require("./transfer/payloadMerge");
const createWebdavClientMethods = require("./transfer/webdavClient");
const createAutoSyncSchedulerMethods = require("./transfer/autoSyncScheduler");

// Node 22 起移除了 zlib.promises，改用 util.promisify 包装回调式 API（全版本兼容）
const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

/**
 * ConfigTransferService - 配置导入/导出/同步服务
 *
 * 导出包格式（.ssx，JSON 文本）：
 * {
 *   magic: "simpleshell-config-export",
 *   version: 1,
 *   createdAt, appVersion,
 *   kdf: { algorithm: "scrypt", salt, N, r, p, keyLength },
 *   cipher: "aes-256-gcm",
 *   iv, authTag, data (hex，gzip(JSON(payload)) 密文)
 * }
 *
 * 加密密钥由用户提供的导出密码经 scrypt 派生，与 safeStorage/主密码体系完全解耦，
 * 因此导出包可以跨机器、跨平台解密导入。
 */

const EXPORT_MAGIC = "simpleshell-config-export";
const EXPORT_VERSION = 1;
const EXPORT_FILE_EXTENSION = ".ssx";
const DEFAULT_REMOTE_FILE_NAME = "simpleshell-config.ssx";
const SYNC_SETTINGS_CONFIG_KEY = "syncSettings";
const WEBDAV_TIMEOUT_MS = 30000;
const AUTO_SYNC_STARTUP_DELAY_MS = 15000;
const AUTO_SYNC_MIN_INTERVAL_MIN = 5;
const AUTO_SYNC_MAX_INTERVAL_MIN = 1440;
const AUTO_SYNC_DEFAULT_INTERVAL_MIN = 30;
const KDF_SALT_LENGTH = 16;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
// 合并导入命令历史的上限：防止长期自动同步导致 commandHistory 无限膨胀
const MAX_MERGED_COMMAND_HISTORY = 20000;
// 配置包解压后载荷上限：防恶意 .ssx 的 zip-bomb 放大攻击
const MAX_DECOMPRESSED_PAYLOAD_BYTES = 50 * 1024 * 1024;
const SCRYPT_COST = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
};

const SUPPORTED_SECTIONS = Object.freeze([
  "connections",
  "aiSettings",
  "uiSettings",
  "shortcutCommands",
  "commandHistory",
  "portForwards",
]);

const KDF_CONTEXT = "SimpleShellConfigExport";

class ConfigTransferService {
  constructor() {
    this.logger = null;
    // 自动同步调度器状态
    this._autoSyncTimer = null;
    this._autoSyncRunning = false;
    this._nextRunAt = null;
    this._autoSyncNotifier = null;
  }

  init(loggerModule) {
    this.logger = loggerModule || null;
  }

  _log(message, level = "INFO") {
    if (this.logger && typeof this.logger.logToFile === "function") {
      this.logger.logToFile(message, level);
    }
  }

  getSupportedSections() {
    return SUPPORTED_SECTIONS.slice();
  }

  getDefaultRemoteFileName() {
    return DEFAULT_REMOTE_FILE_NAME;
  }
}

Object.assign(
  ConfigTransferService.prototype,
  createPackageCodecMethods({
    crypto,
    fsp,
    gzipAsync,
    gunzipAsync,
    configService,
    EXPORT_MAGIC,
    EXPORT_VERSION,
    KDF_CONTEXT,
    KDF_SALT_LENGTH,
    KEY_LENGTH,
    IV_LENGTH,
    SCRYPT_COST,
    MAX_DECOMPRESSED_PAYLOAD_BYTES,
    SUPPORTED_SECTIONS,
  }),
  createPayloadMergeMethods({
    configService,
    MAX_MERGED_COMMAND_HISTORY,
  }),
  createWebdavClientMethods({
    crypto,
    fs,
    fsp,
    http,
    https,
    os,
    path,
    DEFAULT_REMOTE_FILE_NAME,
    EXPORT_FILE_EXTENSION,
    WEBDAV_TIMEOUT_MS,
  }),
  createAutoSyncSchedulerMethods({
    crypto,
    configService,
    DEFAULT_REMOTE_FILE_NAME,
    SYNC_SETTINGS_CONFIG_KEY,
    AUTO_SYNC_STARTUP_DELAY_MS,
    AUTO_SYNC_MIN_INTERVAL_MIN,
    AUTO_SYNC_MAX_INTERVAL_MIN,
    AUTO_SYNC_DEFAULT_INTERVAL_MIN,
  }),
);

module.exports = new ConfigTransferService();
module.exports.SUPPORTED_SECTIONS = SUPPORTED_SECTIONS;
module.exports.EXPORT_FILE_EXTENSION = EXPORT_FILE_EXTENSION;
module.exports.DEFAULT_REMOTE_FILE_NAME = DEFAULT_REMOTE_FILE_NAME;
