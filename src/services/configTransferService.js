const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const configService = require("./configService");

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

  _normalizeSections(sections) {
    if (sections === undefined || sections === null) {
      return SUPPORTED_SECTIONS.slice();
    }
    if (!Array.isArray(sections)) {
      throw new Error("sections must be an array");
    }
    const normalized = [];
    for (const raw of sections) {
      const section = String(raw || "").trim();
      if (!SUPPORTED_SECTIONS.includes(section)) {
        throw new Error(`Unsupported config section: ${section}`);
      }
      if (!normalized.includes(section)) {
        normalized.push(section);
      }
    }
    if (normalized.length === 0) {
      throw new Error("No config section selected");
    }
    return normalized;
  }

  _assertCredentialStoreUnlocked() {
    const status = configService.getCredentialSecurityStatus();
    if (status?.requiresUnlock) {
      const error = new Error("Credential store is locked");
      error.code = "CREDENTIAL_STORE_LOCKED";
      throw error;
    }
  }

  _stripMachineSpecificUISettings(uiSettings) {
    if (!uiSettings || typeof uiSettings !== "object") {
      return uiSettings;
    }
    const result = { ...uiSettings };
    delete result.windowBounds;
    return result;
  }

  /**
   * 构建导出载荷（敏感字段为解密后的明文，仅在内存中短暂存在）
   */
  _buildExportPayload(sectionList) {
    const sectionSet = new Set(sectionList);
    const payload = { sections: {} };

    if (sectionSet.has("connections")) {
      payload.sections.connections = configService.loadConnections();
      payload.sections.topConnections = configService.loadTopConnections();
      payload.sections.lastConnections = configService.loadLastConnections();
    }
    if (sectionSet.has("aiSettings")) {
      payload.sections.aiSettings = configService.loadAISettings();
    }
    if (sectionSet.has("uiSettings")) {
      payload.sections.uiSettings = this._stripMachineSpecificUISettings(
        configService.loadUISettings(),
      );
    }
    if (sectionSet.has("shortcutCommands")) {
      payload.sections.shortcutCommands =
        configService.loadShortcutCommands() || {};
    }
    if (sectionSet.has("commandHistory")) {
      payload.sections.commandHistory = configService.loadCommandHistory();
    }
    if (sectionSet.has("portForwards")) {
      payload.sections.portForwards = configService.loadPortForwards();
    }

    return payload;
  }

  _countConnections(items) {
    if (!Array.isArray(items)) {
      return 0;
    }
    let count = 0;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      if (item.type === "connection") count += 1;
      else if (item.type === "group") count += this._countConnections(item.items);
    }
    return count;
  }

  _summarizePayload(payload) {
    const sections = payload?.sections || {};
    return {
      connections: this._countConnections(sections.connections),
      aiSettings: Array.isArray(sections.aiSettings?.configs)
        ? sections.aiSettings.configs.length
        : 0,
      shortcutCommands: sections.shortcutCommands
        ? Object.keys(sections.shortcutCommands).length
        : 0,
      commandHistory: Array.isArray(sections.commandHistory)
        ? sections.commandHistory.length
        : 0,
      portForwards: Array.isArray(sections.portForwards)
        ? sections.portForwards.length
        : 0,
    };
  }

  /**
   * 由导出密码派生加密密钥（盐值随导出随机生成并写入包内）
   */
  _derivePackageKey(password, salt) {
    return crypto.scryptSync(String(password), `${KDF_CONTEXT}:${salt}`, KEY_LENGTH, {
      ...SCRYPT_COST,
    });
  }

  _encryptPayload(payloadJson, password) {
    const salt = crypto.randomBytes(KDF_SALT_LENGTH).toString("hex");
    const key = this._derivePackageKey(password, salt);
    const compressed = zlib.gzipSync(Buffer.from(payloadJson, "utf8"));
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, {
      authTagLength: 16,
    });
    const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
    return {
      kdf: {
        algorithm: "scrypt",
        salt,
        N: SCRYPT_COST.N,
        r: SCRYPT_COST.r,
        p: SCRYPT_COST.p,
        keyLength: KEY_LENGTH,
      },
      cipher: "aes-256-gcm",
      iv: iv.toString("hex"),
      authTag: cipher.getAuthTag().toString("hex"),
      data: encrypted.toString("hex"),
    };
  }

  _decryptPackage(packageObject, password) {
    if (!packageObject || packageObject.magic !== EXPORT_MAGIC) {
      throw new Error("INVALID_PACKAGE");
    }
    if (packageObject.cipher !== "aes-256-gcm") {
      throw new Error("INVALID_PACKAGE");
    }
    const kdf = packageObject.kdf || {};
    if (kdf.algorithm !== "scrypt" || !kdf.salt) {
      throw new Error("INVALID_PACKAGE");
    }
    const key = this._derivePackageKey(password, kdf.salt);
    const iv = Buffer.from(packageObject.iv, "hex");
    const authTag = Buffer.from(packageObject.authTag, "hex");
    const encrypted = Buffer.from(packageObject.data, "hex");

    let compressed;
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, {
        authTagLength: 16,
      });
      decipher.setAuthTag(authTag);
      compressed = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    } catch {
      const error = new Error("DECRYPT_FAILED");
      error.code = "DECRYPT_FAILED";
      throw error;
    }

    const payloadJson = zlib.gunzipSync(compressed).toString("utf8");
    const payload = JSON.parse(payloadJson);
    if (!payload || typeof payload !== "object" || !payload.sections) {
      throw new Error("INVALID_PACKAGE");
    }
    return payload;
  }

  /**
   * 导出加密配置包
   * @param {Object} options - { filePath, password, sections }
   * @returns {Object} { success, filePath, summary }
   */
  exportToFile(options = {}) {
    const filePath = String(options.filePath || "").trim();
    const password = typeof options.password === "string" ? options.password : "";
    if (!filePath) {
      throw new Error("Export file path is required");
    }
    if (password.length < 4) {
      const error = new Error("Password too weak");
      error.code = "PASSWORD_TOO_WEAK";
      throw error;
    }

    this._assertCredentialStoreUnlocked();
    const sectionList = this._normalizeSections(options.sections);
    const payload = this._buildExportPayload(sectionList);

    const packageObject = {
      magic: EXPORT_MAGIC,
      version: EXPORT_VERSION,
      createdAt: new Date().toISOString(),
      sections: sectionList,
      ...this._encryptPayload(JSON.stringify(payload), password),
    };

    const tempPath = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tempPath, JSON.stringify(packageObject, null, 2), "utf8");
    fs.renameSync(tempPath, filePath);

    const summary = this._summarizePayload(payload);
    this._log(
      `ConfigTransferService: Exported config package to ${filePath} (sections=${sectionList.join(",")}, summary=${JSON.stringify(summary)})`,
      "INFO",
    );

    return { success: true, filePath, sections: sectionList, summary };
  }

  /**
   * 从加密配置包导入
   * @param {Object} options - { filePath, password, mode: "merge"|"replace", sections }
   * @returns {Object} { success, applied, summary }
   */
  importFromFile(options = {}) {
    const filePath = String(options.filePath || "").trim();
    const password = typeof options.password === "string" ? options.password : "";
    if (!filePath) {
      throw new Error("Import file path is required");
    }

    const raw = fs.readFileSync(filePath, "utf8");
    let packageObject;
    try {
      packageObject = JSON.parse(raw);
    } catch {
      throw new Error("INVALID_PACKAGE");
    }

    const payload = this._decryptPackage(packageObject, password);
    const applied = this._applyImportedPayload(payload, {
      mode: options.mode === "replace" ? "replace" : "merge",
      sections: options.sections,
    });

    this._log(
      `ConfigTransferService: Imported config package from ${filePath} (mode=${options.mode === "replace" ? "replace" : "merge"}, applied=${applied.join(",")})`,
      "INFO",
    );

    return {
      success: true,
      applied,
      summary: this._summarizePayload(payload),
    };
  }

  /**
   * 将导入载荷写回本地配置
   */
  _applyImportedPayload(payload, { mode, sections }) {
    const sectionFilter =
      sections === undefined || sections === null
        ? null
        : new Set(this._normalizeSections(sections));
    const imported = payload.sections || {};
    const applied = [];

    const shouldApply = (section) => sectionFilter === null || sectionFilter.has(section);

    if (imported.connections !== undefined && shouldApply("connections")) {
      if (mode === "replace") {
        configService.saveConnections(imported.connections || []);
        configService.saveTopConnections(imported.topConnections || []);
        configService.saveLastConnections(imported.lastConnections || []);
      } else {
        const currentConnections = configService.loadConnections();
        configService.saveConnections(
          this._mergeConnectionTrees(currentConnections, imported.connections || []),
        );
        const currentTop = configService.loadTopConnections();
        configService.saveTopConnections(
          this._mergeConnectionTrees(currentTop, imported.topConnections || []),
        );
        const currentLast = configService.loadLastConnections();
        configService.saveLastConnections(
          this._mergeConnectionTrees(currentLast, imported.lastConnections || []),
        );
      }
      applied.push("connections");
    }

    if (imported.aiSettings !== undefined && shouldApply("aiSettings")) {
      const importedSettings = imported.aiSettings || {};
      if (mode === "replace") {
        configService.saveAISettings(importedSettings);
      } else {
        const currentSettings = configService.loadAISettings() || {};
        configService.saveAISettings({
          ...currentSettings,
          ...importedSettings,
          configs: this._mergeById(
            currentSettings.configs,
            importedSettings.configs,
          ),
        });
      }
      applied.push("aiSettings");
    }

    if (imported.uiSettings !== undefined && shouldApply("uiSettings")) {
      const importedUI = { ...(imported.uiSettings || {}) };
      delete importedUI.windowBounds;
      if (mode === "replace") {
        configService.saveUISettings(importedUI);
      } else {
        const currentUI = configService.loadUISettings() || {};
        configService.saveUISettings({ ...currentUI, ...importedUI });
      }
      applied.push("uiSettings");
    }

    if (imported.shortcutCommands !== undefined && shouldApply("shortcutCommands")) {
      const importedCommands = imported.shortcutCommands || {};
      if (mode === "replace") {
        configService.saveShortcutCommands(importedCommands);
      } else {
        const currentCommands = configService.loadShortcutCommands() || {};
        configService.saveShortcutCommands({
          ...currentCommands,
          ...importedCommands,
        });
      }
      applied.push("shortcutCommands");
    }

    if (Array.isArray(imported.commandHistory) && shouldApply("commandHistory")) {
      if (mode === "replace") {
        configService.saveCommandHistory(imported.commandHistory);
      } else {
        const currentHistory = configService.loadCommandHistory() || [];
        configService.saveCommandHistory(
          this._mergeCommandHistory(currentHistory, imported.commandHistory),
        );
      }
      applied.push("commandHistory");
    }

    if (Array.isArray(imported.portForwards) && shouldApply("portForwards")) {
      if (mode === "replace") {
        configService.savePortForwards(imported.portForwards);
      } else {
        const currentForwards = configService.loadPortForwards() || [];
        configService.savePortForwards(
          this._mergeById(currentForwards, imported.portForwards),
        );
      }
      applied.push("portForwards");
    }

    return applied;
  }

  /**
   * 按 id 合并两个列表（导入项覆盖同 id 的现有项，其余保留）
   */
  _mergeById(currentItems, importedItems) {
    const current = Array.isArray(currentItems) ? currentItems : [];
    const imported = Array.isArray(importedItems) ? importedItems : [];
    if (imported.length === 0) {
      return current;
    }

    const merged = new Map();
    current.forEach((item) => {
      if (item && typeof item === "object" && item.id !== undefined) {
        merged.set(item.id, item);
      } else {
        merged.set(Symbol("anonymous"), item);
      }
    });
    imported.forEach((item) => {
      if (item && typeof item === "object" && item.id !== undefined) {
        merged.set(item.id, item);
      } else {
        merged.set(Symbol("anonymous"), item);
      }
    });
    return Array.from(merged.values());
  }

  /**
   * 按 id 递归合并连接树（组内同样按 id 合并）
   */
  _mergeConnectionTrees(currentItems, importedItems) {
    const mergeLevel = (current, imported) => {
      const currentList = Array.isArray(current) ? current : [];
      const importedList = Array.isArray(imported) ? imported : [];
      if (importedList.length === 0) {
        return currentList;
      }

      const importedById = new Map();
      const appended = [];
      importedList.forEach((item) => {
        if (item && typeof item === "object" && item.id) {
          importedById.set(item.id, item);
        } else {
          appended.push(item);
        }
      });

      const result = currentList.map((item) => {
        if (!item || typeof item !== "object") {
          return item;
        }
        const replacement = item.id ? importedById.get(item.id) : null;
        if (replacement) {
          importedById.delete(item.id);
          // 组节点递归合并，保证只存在于本机的子连接不丢失
          if (
            item.type === "group" &&
            replacement.type === "group" &&
            Array.isArray(item.items)
          ) {
            return {
              ...replacement,
              items: mergeLevel(item.items, replacement.items || []),
            };
          }
          return replacement;
        }
        if (item.type === "group" && Array.isArray(item.items)) {
          return {
            ...item,
            items: mergeLevel(item.items, []),
          };
        }
        return item;
      });

      // 导入项中现有树里没有的（含未在新位置命中的组）追加到末尾
      importedList.forEach((item) => {
        if (item && typeof item === "object" && item.id) {
          if (importedById.has(item.id)) {
            result.push(item);
          }
        } else {
          // appended 里的匿名项在此处不再重复追加（已在前面收集）
        }
      });
      appended.forEach((item) => result.push(item));

      return result;
    };

    return mergeLevel(currentItems, importedItems);
  }

  _mergeCommandHistory(currentHistory, importedHistory) {
    const merged = new Map();
    const addAll = (history) => {
      if (!Array.isArray(history)) {
        return;
      }
      history.forEach((entry) => {
        if (!entry || typeof entry !== "object") {
          return;
        }
        const key = typeof entry.command === "string" ? entry.command : null;
        if (!key) {
          return;
        }
        const existing = merged.get(key);
        if (
          !existing ||
          (Number(entry.count) || 0) > (Number(existing.count) || 0)
        ) {
          merged.set(key, { ...existing, ...entry, command: key });
        }
      });
    };
    addAll(currentHistory);
    addAll(importedHistory);
    return Array.from(merged.values());
  }

  // ==================== WebDAV 同步 ====================

  _normalizeWebDAVSettings(settings = {}) {
    const url = String(settings.url || "").trim();
    if (!url) {
      const error = new Error("WebDAV URL is required");
      error.code = "WEBDAV_URL_REQUIRED";
      throw error;
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      const error = new Error("WebDAV URL is invalid");
      error.code = "WEBDAV_URL_INVALID";
      throw error;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      const error = new Error("WebDAV URL must be http(s)");
      error.code = "WEBDAV_URL_INVALID";
      throw error;
    }

    const baseDir = parsed.pathname.replace(/\/+$/, "");
    const fileName = String(settings.fileName || DEFAULT_REMOTE_FILE_NAME)
      .trim()
      .replace(/^\/+/, "")
      .replace(/\\/g, "/") || DEFAULT_REMOTE_FILE_NAME;

    return {
      protocol: parsed.protocol === "https:" ? "https" : "http",
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80,
      auth: parsed.username || parsed.password
        ? `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`
        : [settings.username, settings.password].every(
              (value) => typeof value === "string" && value.length > 0,
            )
          ? `${settings.username}:${settings.password}`
          : "",
      basePath: baseDir,
      fileName,
      url,
    };
  }

  _webdavRequest({ settings, method, body = null, headers = {} }) {
    const target = this._normalizeWebDAVSettings(settings);
    return new Promise((resolve, reject) => {
      const path = `${target.basePath}/${target.fileName}`;
      const requestHeaders = { ...headers };
      if (target.auth) {
        requestHeaders.Authorization = `Basic ${Buffer.from(target.auth).toString("base64")}`;
      }
      if (body !== null) {
        requestHeaders["Content-Length"] = Buffer.byteLength(body);
      }

      const request = (target.protocol === "https:" ? https : http).request(
        {
          protocol: target.protocol === "https:" ? "https:" : "http:",
          hostname: target.host,
          port: target.port,
          method,
          path,
          headers: requestHeaders,
          timeout: WEBDAV_TIMEOUT_MS,
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            resolve({
              status: response.statusCode || 0,
              headers: response.headers,
              body: Buffer.concat(chunks),
            });
          });
        },
      );

      request.on("timeout", () => {
        request.destroy(new Error("WebDAV request timed out"));
      });
      request.on("error", reject);
      if (body !== null) {
        request.write(body);
      }
      request.end();
    });
  }

  async webdavTest(settings) {
    // PROPFIND Depth 0 验证目标目录（含文件名所在路径）可达且凭据有效
    const response = await this._webdavRequest({
      settings,
      method: "PROPFIND",
      headers: { Depth: "0" },
    });
    if (response.status === 207 || response.status === 200) {
      return { success: true, status: response.status };
    }
    if (response.status === 404) {
      return { success: true, status: response.status, note: "REMOTE_NOT_FOUND" };
    }
    if (response.status === 401 || response.status === 403) {
      const error = new Error("WebDAV authentication failed");
      error.code = "WEBDAV_AUTH_FAILED";
      throw error;
    }
    const error = new Error(`WebDAV request failed (HTTP ${response.status})`);
    error.code = "WEBDAV_REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }

  /**
   * 将本地导出包上传到 WebDAV
   * @param {Object} options - { url, username, password, fileName, filePath, exportOptions }
   */
  async webdavUpload(options = {}) {
    let packageBuffer;
    let summary = null;

    if (options.filePath && fs.existsSync(options.filePath)) {
      packageBuffer = fs.readFileSync(options.filePath);
    } else {
      // 未指定本地文件时先在临时目录生成导出包再上传
      this._assertCredentialStoreUnlocked();
      const tempPath = path.join(
        os.tmpdir(),
        `simpleshell-sync-${Date.now()}-${process.pid}${EXPORT_FILE_EXTENSION}`,
      );
      try {
        const exportResult = this.exportToFile({
          filePath: tempPath,
          password: options.exportPassword,
          sections: options.sections,
        });
        summary = exportResult.summary;
        packageBuffer = fs.readFileSync(tempPath);
      } finally {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // ignore
        }
      }
    }

    const response = await this._webdavRequest({
      settings: options,
      method: "PUT",
      body: packageBuffer,
    });
    if (![200, 201, 204].includes(response.status)) {
      if (response.status === 401 || response.status === 403) {
        const error = new Error("WebDAV authentication failed");
        error.code = "WEBDAV_AUTH_FAILED";
        throw error;
      }
      const error = new Error(`WebDAV upload failed (HTTP ${response.status})`);
      error.code = "WEBDAV_REQUEST_FAILED";
      error.status = response.status;
      throw error;
    }

    this._log(
      `ConfigTransferService: Config package uploaded to WebDAV (${response.status}, ${packageBuffer.length} bytes)`,
      "INFO",
    );
    return {
      success: true,
      status: response.status,
      bytes: packageBuffer.length,
      summary,
    };
  }

  /**
   * 从 WebDAV 下载配置包。filePath 提供时保存到本地文件，否则返回解密导入结果。
   * @param {Object} options - { url, username, password, fileName, filePath, importPassword, mode, sections }
   */
  async webdavDownload(options = {}) {
    const response = await this._webdavRequest({
      settings: options,
      method: "GET",
    });
    if (response.status === 404) {
      const error = new Error("Remote config package not found");
      error.code = "WEBDAV_REMOTE_NOT_FOUND";
      throw error;
    }
    if (response.status === 401 || response.status === 403) {
      const error = new Error("WebDAV authentication failed");
      error.code = "WEBDAV_AUTH_FAILED";
      throw error;
    }
    if (response.status !== 200) {
      const error = new Error(`WebDAV download failed (HTTP ${response.status})`);
      error.code = "WEBDAV_REQUEST_FAILED";
      error.status = response.status;
      throw error;
    }

    const packageBuffer = response.body;
    if (options.filePath) {
      const tempPath = `${options.filePath}.tmp-${process.pid}`;
      fs.writeFileSync(tempPath, packageBuffer);
      fs.renameSync(tempPath, options.filePath);
      return {
        success: true,
        filePath: options.filePath,
        bytes: packageBuffer.length,
      };
    }

    // 直接解密并导入
    let packageObject;
    try {
      packageObject = JSON.parse(packageBuffer.toString("utf8"));
    } catch {
      throw new Error("INVALID_PACKAGE");
    }
    const payload = this._decryptPackage(packageObject, options.importPassword || "");
    const applied = this._applyImportedPayload(payload, {
      mode: options.mode === "replace" ? "replace" : "merge",
      sections: options.sections,
    });
    this._log(
      `ConfigTransferService: Config package downloaded from WebDAV and imported (applied=${applied.join(",")})`,
      "INFO",
    );
    return {
      success: true,
      applied,
      summary: this._summarizePayload(payload),
      bytes: packageBuffer.length,
    };
  }

  // ==================== 同步设置（WebDAV 账号信息，密码经本机加密保存） ====================

  _readRawSyncSettings() {
    try {
      const stored = configService.get(SYNC_SETTINGS_CONFIG_KEY);
      return stored && typeof stored === "object" ? { ...stored } : {};
    } catch {
      return {};
    }
  }

  _updateSyncSettingsState(patch) {
    const next = { ...this._readRawSyncSettings(), ...patch };
    if (!configService.set(SYNC_SETTINGS_CONFIG_KEY, next)) {
      this._log(
        "ConfigTransferService: Failed to persist sync settings state.",
        "WARN",
      );
    }
  }

  _getDefaultAutoSyncSettings() {
    return {
      autoSyncEnabled: false,
      autoSyncOnStartup: true,
      autoSyncIntervalMinutes: AUTO_SYNC_DEFAULT_INTERVAL_MIN,
    };
  }

  _decryptStoredValue(value) {
    if (typeof value !== "string" || !value) {
      return "";
    }
    return configService.crypto?.decryptText
      ? configService.crypto.decryptText(value) || ""
      : "";
  }

  loadSyncSettings() {
    const raw = this._readRawSyncSettings();
    const defaults = this._getDefaultAutoSyncSettings();
    const webdavPassword = this._decryptStoredValue(raw.password);
    const storedExportPassword = this._decryptStoredValue(
      raw.storedExportPassword,
    );
    return {
      url: raw.url || "",
      username: raw.username || "",
      password: webdavPassword,
      hasStoredWebdavPassword: Boolean(raw.password),
      fileName: raw.fileName || DEFAULT_REMOTE_FILE_NAME,
      autoSyncEnabled: raw.autoSyncEnabled === true,
      autoSyncOnStartup:
        raw.autoSyncOnStartup === undefined
          ? defaults.autoSyncOnStartup
          : raw.autoSyncOnStartup === true,
      autoSyncIntervalMinutes: this._clampAutoSyncInterval(
        raw.autoSyncIntervalMinutes,
      ),
      rememberExportPassword: Boolean(raw.storedExportPassword),
      storedExportPassword,
      hasStoredExportPassword: Boolean(raw.storedExportPassword),
      lastSyncAt: raw.lastSyncAt || null,
      lastCheckAt: raw.lastCheckAt || null,
      lastSyncStatus: raw.lastSyncStatus || null,
      lastSyncDetail: raw.lastSyncDetail || null,
    };
  }

  _clampAutoSyncInterval(minutes) {
    const value = Number(minutes);
    if (!Number.isFinite(value)) {
      return AUTO_SYNC_DEFAULT_INTERVAL_MIN;
    }
    return Math.min(
      AUTO_SYNC_MAX_INTERVAL_MIN,
      Math.max(AUTO_SYNC_MIN_INTERVAL_MIN, Math.round(value)),
    );
  }

  /**
   * 保存同步设置（字段级合并，未提供的字段保留原值；密码仅提供时更新）
   */
  saveSyncSettings(settings = {}) {
    const next = this._readRawSyncSettings();

    if (settings.url !== undefined) {
      next.url = String(settings.url || "").trim();
    }
    if (settings.username !== undefined) {
      next.username = String(settings.username || "");
    }
    if (settings.fileName !== undefined) {
      next.fileName =
        String(settings.fileName || DEFAULT_REMOTE_FILE_NAME).trim() ||
        DEFAULT_REMOTE_FILE_NAME;
    }
    if (typeof settings.password === "string" && settings.password) {
      const encrypted = configService.crypto?.encryptText
        ? configService.crypto.encryptText(settings.password)
        : "";
      if (encrypted) {
        next.password = encrypted;
      }
    }

    // 自动同步开关
    if (settings.autoSyncEnabled !== undefined) {
      next.autoSyncEnabled = settings.autoSyncEnabled === true;
    }
    if (settings.autoSyncOnStartup !== undefined) {
      next.autoSyncOnStartup = settings.autoSyncOnStartup === true;
    }
    if (settings.autoSyncIntervalMinutes !== undefined) {
      next.autoSyncIntervalMinutes = this._clampAutoSyncInterval(
        settings.autoSyncIntervalMinutes,
      );
    }

    // 导出密码记忆（自动拉取解密需要）
    if (settings.rememberExportPassword !== undefined) {
      if (settings.rememberExportPassword === false) {
        delete next.storedExportPassword;
      }
    }
    if (
      settings.rememberExportPassword === true &&
      typeof settings.exportPassword === "string" &&
      settings.exportPassword
    ) {
      const encryptedExport = configService.crypto?.encryptText
        ? configService.crypto.encryptText(settings.exportPassword)
        : "";
      if (encryptedExport) {
        next.storedExportPassword = encryptedExport;
      }
    }

    if (!configService.set(SYNC_SETTINGS_CONFIG_KEY, next)) {
      throw new Error("Failed to save sync settings");
    }
    this._log("ConfigTransferService: Sync settings saved.", "INFO");
    return { success: true };
  }

  // ==================== 自动同步（启动时/定期拉取） ====================

  setAutoSyncNotifier(notifier) {
    this._autoSyncNotifier =
      typeof notifier === "function" ? notifier : null;
  }

  _notifyAutoSync(trigger, result) {
    if (!this._autoSyncNotifier) {
      return;
    }
    try {
      this._autoSyncNotifier({
        trigger,
        timestamp: Date.now(),
        ...result,
      });
    } catch (error) {
      this._log(
        `ConfigTransferService: Auto-sync notifier failed - ${error.message}`,
        "WARN",
      );
    }
  }

  _recordSyncResult(status, detail, remoteHash = null) {
    const patch = {
      lastCheckAt: Date.now(),
      lastSyncStatus: status,
      lastSyncDetail: detail || null,
    };
    if (status === "updated") {
      patch.lastSyncAt = Date.now();
    }
    if (remoteHash) {
      patch.lastRemoteHash = remoteHash;
    }
    this._updateSyncSettingsState(patch);
  }

  getAutoSyncStatus() {
    const settings = this.loadSyncSettings();
    return {
      hasWebdavConfig: Boolean(settings.url),
      hasStoredExportPassword: settings.hasStoredExportPassword,
      autoSyncEnabled: settings.autoSyncEnabled,
      autoSyncOnStartup: settings.autoSyncOnStartup,
      autoSyncIntervalMinutes: settings.autoSyncIntervalMinutes,
      lastSyncAt: settings.lastSyncAt,
      lastCheckAt: settings.lastCheckAt,
      lastSyncStatus: settings.lastSyncStatus,
      lastSyncDetail: settings.lastSyncDetail,
      nextRunAt: this._nextRunAt,
      running: this._autoSyncRunning,
    };
  }

  /**
   * 执行一次自动拉取：远端包哈希与上次同步一致则跳过，
   * 否则解密后按合并模式导入（自动同步永远不用替换模式，避免无人值守时覆盖丢数据）
   * @param {string} trigger - "startup" | "scheduled" | "manual"
   */
  async autoSyncPull(trigger = "manual") {
    if (this._autoSyncRunning) {
      return { success: false, skipped: true, reason: "BUSY" };
    }
    this._autoSyncRunning = true;
    try {
      const result = await this._autoSyncPullInternal(trigger);
      this._notifyAutoSync(trigger, result);
      return result;
    } finally {
      this._autoSyncRunning = false;
    }
  }

  async _autoSyncPullInternal(trigger) {
    const raw = this._readRawSyncSettings();
    if (!raw.url) {
      return { success: false, skipped: true, reason: "NO_URL" };
    }

    const credStatus = configService.getCredentialSecurityStatus();
    if (credStatus?.requiresUnlock) {
      this._recordSyncResult("locked", "credential store locked");
      return { success: false, skipped: true, reason: "CREDENTIAL_STORE_LOCKED" };
    }

    const importPassword = this._decryptStoredValue(raw.storedExportPassword);
    if (!importPassword) {
      this._recordSyncResult("no-export-password", "export password not saved");
      return {
        success: false,
        skipped: true,
        reason: "EXPORT_PASSWORD_NOT_SAVED",
      };
    }

    const settings = {
      url: raw.url,
      username: raw.username,
      password: this._decryptStoredValue(raw.password),
      fileName: raw.fileName,
    };

    let response;
    try {
      response = await this._webdavRequest({ settings, method: "GET" });
    } catch (error) {
      this._recordSyncResult("error", error.message || "network error");
      return {
        success: false,
        skipped: false,
        status: "error",
        error: error.message,
        errorCode: error.code || "WEBDAV_REQUEST_FAILED",
      };
    }

    if (response.status === 404) {
      this._recordSyncResult("remote-missing", "remote package not found");
      return {
        success: false,
        skipped: true,
        reason: "WEBDAV_REMOTE_NOT_FOUND",
      };
    }
    if (response.status === 401 || response.status === 403) {
      this._recordSyncResult("error", "webdav auth failed");
      return {
        success: false,
        skipped: false,
        status: "error",
        reason: "WEBDAV_AUTH_FAILED",
      };
    }
    if (response.status !== 200) {
      const detail = `webdav download failed (HTTP ${response.status})`;
      this._recordSyncResult("error", detail);
      return {
        success: false,
        skipped: false,
        status: "error",
        reason: "WEBDAV_REQUEST_FAILED",
        error: detail,
      };
    }

    const remoteHash = crypto
      .createHash("sha256")
      .update(response.body)
      .digest("hex");
    if (remoteHash === raw.lastRemoteHash) {
      this._recordSyncResult("up-to-date", "remote package unchanged", remoteHash);
      return {
        success: true,
        skipped: true,
        status: "up-to-date",
        reason: "UP_TO_DATE",
      };
    }

    let packageObject;
    try {
      packageObject = JSON.parse(response.body.toString("utf8"));
    } catch {
      this._recordSyncResult("error", "invalid package");
      return {
        success: false,
        skipped: false,
        status: "error",
        reason: "INVALID_PACKAGE",
      };
    }

    let payload;
    try {
      payload = this._decryptPackage(packageObject, importPassword);
    } catch (error) {
      const reason = error.code || "DECRYPT_FAILED";
      this._recordSyncResult("error", reason);
      return {
        success: false,
        skipped: false,
        status: "error",
        reason,
      };
    }

    const applied = this._applyImportedPayload(payload, { mode: "merge" });
    const summary = this._summarizePayload(payload);
    this._recordSyncResult("updated", `applied: ${applied.join(",")}`, remoteHash);
    this._log(
      `ConfigTransferService: Auto-sync (${trigger}) pulled and imported remote config (applied=${applied.join(",")})`,
      "INFO",
    );
    return {
      success: true,
      skipped: false,
      status: "updated",
      applied,
      summary,
    };
  }

  _getAutoSyncIntervalMs() {
    const raw = this._readRawSyncSettings();
    return (
      this._clampAutoSyncInterval(
        raw.autoSyncIntervalMinutes !== undefined
          ? raw.autoSyncIntervalMinutes
          : AUTO_SYNC_DEFAULT_INTERVAL_MIN,
      ) *
      60 *
      1000
    );
  }

  _clearAutoSyncTimers() {
    if (this._autoSyncTimer) {
      clearTimeout(this._autoSyncTimer);
      this._autoSyncTimer = null;
    }
    this._nextRunAt = null;
  }

  _scheduleNextRun(delayMs, intervalMs) {
    this._clearAutoSyncTimers();
    this._nextRunAt = Date.now() + delayMs;
    this._autoSyncTimer = setTimeout(async () => {
      try {
        await this.autoSyncPull("scheduled");
      } catch (error) {
        this._log(
          `ConfigTransferService: Scheduled auto-sync failed - ${error.message}`,
          "WARN",
        );
      }
      // 仅在仍启用时继续排程
      if (this._readRawSyncSettings().autoSyncEnabled === true) {
        this._scheduleNextRun(intervalMs, intervalMs);
      }
    }, delayMs);
  }

  /**
   * 启动自动同步调度器（按当前设置；未启用则为空操作）
   */
  startAutoSyncScheduler() {
    const raw = this._readRawSyncSettings();
    this._clearAutoSyncTimers();
    if (raw.autoSyncEnabled !== true || !raw.url) {
      return this.getAutoSyncStatus();
    }

    const intervalMs =
      this._clampAutoSyncInterval(raw.autoSyncIntervalMinutes) * 60 * 1000;
    // 启动时拉取：延迟 15s 等待窗口/凭据就绪；否则首个周期后再检查
    const firstDelayMs =
      raw.autoSyncOnStartup === false ? intervalMs : AUTO_SYNC_STARTUP_DELAY_MS;
    this._scheduleNextRun(firstDelayMs, intervalMs);
    this._log(
      `ConfigTransferService: Auto-sync scheduler started (firstCheckIn=${Math.round(firstDelayMs / 1000)}s, interval=${intervalMs / 60000}min)`,
      "INFO",
    );
    return this.getAutoSyncStatus();
  }

  /** 设置变化后重建调度器 */
  restartAutoSyncScheduler() {
    return this.startAutoSyncScheduler();
  }

  /** 应用退出时清理定时器 */
  stopAutoSyncScheduler() {
    this._clearAutoSyncTimers();
    this._log("ConfigTransferService: Auto-sync scheduler stopped.", "INFO");
  }
}

module.exports = new ConfigTransferService();
module.exports.SUPPORTED_SECTIONS = SUPPORTED_SECTIONS;
module.exports.EXPORT_FILE_EXTENSION = EXPORT_FILE_EXTENSION;
module.exports.DEFAULT_REMOTE_FILE_NAME = DEFAULT_REMOTE_FILE_NAME;
