const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const CURRENT_DB_VERSION = 1;

class SQLiteConfigStorage {
  constructor(options) {
    this.dbPath = options.dbPath;
    this.logger = options.logger;
    this.encryptText = options.encryptText;
    this.decryptText = options.decryptText;
    this.db = null;
  }

  initialize() {
    if (this.db) {
      return;
    }

    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    this._applyPragmas();
    this._migrate();
  }

  close() {
    if (!this.db) {
      return;
    }

    this.db.close();
    this.db = null;
  }

  hasAnyData() {
    this._ensureOpen();

    const count =
      this.db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM connections) +
             (SELECT COUNT(*) FROM groups) +
             (SELECT COUNT(*) FROM ai_configs) +
             (SELECT COUNT(*) FROM command_history) +
             (SELECT COUNT(*) FROM settings_kv) AS total`,
        )
        .get()?.total ?? 0;

    return count > 0;
  }

  exportDatabase(targetPath) {
    this._ensureOpen();
    this.db.pragma("wal_checkpoint(TRUNCATE)");
    return this.db.backup(targetPath);
  }

  async importDatabase(sourcePath) {
    this._validateSyncPackage(sourcePath);

    const backupPath = `${this.dbPath}.bak-${Date.now()}.ssdb`;
    await this.exportDatabase(backupPath);

    this.close();
    this._deleteSidecars(this.dbPath);
    fs.copyFileSync(sourcePath, this.dbPath);
    this.initialize();

    return backupPath;
  }

  loadConnections() {
    this._ensureOpen();

    const groupRows = this.db
      .prepare(
        `SELECT id, name, createdAt, updatedAt
         FROM groups
         ORDER BY LENGTH(name) ASC, name COLLATE NOCASE ASC`,
      )
      .all();

    const roots = [];
    const groupsByPath = new Map();

    for (const row of groupRows) {
      const parts = this._splitGroupPath(row.name);
      const shortName = parts[parts.length - 1] || row.name;
      const groupItem = {
        id: `group_${row.id}`,
        type: "group",
        name: shortName,
        items: [],
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };

      groupsByPath.set(row.name, groupItem);

      const parentPath = parts.slice(0, -1).join(" / ");
      if (parentPath && groupsByPath.has(parentPath)) {
        groupsByPath.get(parentPath).items.push(groupItem);
      } else {
        roots.push(groupItem);
      }
    }

    const connectionRows = this.db
      .prepare(
        `SELECT
           id, groupName, name, protocol, host, port, username, authType,
           passwordEnc, privateKeyEnc, privateKeyPathEnc, privateKeyPassphraseEnc,
           proxyJson, extraJson, createdAt, updatedAt, lastConnectedAt
         FROM connections
         ORDER BY createdAt ASC, name COLLATE NOCASE ASC`,
      )
      .all();

    for (const row of connectionRows) {
      const connection = {
        type: "connection",
        id: row.id,
        name: row.name,
        protocol: row.protocol || "ssh",
        host: row.host,
        port: row.port,
        username: row.username,
        authType: this._mapAuthTypeForLoad(row.authType),
        password: this._decryptMaybe(row.passwordEnc),
        privateKey: this._decryptMaybe(row.privateKeyEnc),
        privateKeyPath: this._decryptMaybe(row.privateKeyPathEnc),
        privateKeyPassphrase: this._decryptMaybe(row.privateKeyPassphraseEnc),
        proxy: this._safeJsonParse(row.proxyJson, null),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        lastConnectedAt: row.lastConnectedAt,
      };

      const extra = this._safeJsonParse(row.extraJson, {});
      Object.assign(connection, extra);

      const group = row.groupName ? groupsByPath.get(row.groupName) : null;
      if (group) {
        group.items.push(connection);
      } else {
        roots.push(connection);
      }
    }

    return roots;
  }

  saveConnections(connections) {
    this._ensureOpen();

    const groupRows = [];
    const connectionRows = [];
    this._collectConnectionRows(
      connections || [],
      "",
      groupRows,
      connectionRows,
    );

    const clearGroupsStmt = this.db.prepare("DELETE FROM groups");
    const clearConnectionsStmt = this.db.prepare("DELETE FROM connections");
    const insertGroupStmt = this.db.prepare(
      `INSERT INTO groups(name, createdAt, updatedAt)
       VALUES(@name, @createdAt, @updatedAt)`,
    );
    const insertConnectionStmt = this.db.prepare(
      `INSERT INTO connections(
         id, groupName, name, protocol, host, port, username, authType,
         passwordEnc, privateKeyEnc, privateKeyPathEnc, privateKeyPassphraseEnc,
         proxyJson, extraJson, createdAt, updatedAt, lastConnectedAt
       ) VALUES (
         @id, @groupName, @name, @protocol, @host, @port, @username, @authType,
         @passwordEnc, @privateKeyEnc, @privateKeyPathEnc, @privateKeyPassphraseEnc,
         @proxyJson, @extraJson, @createdAt, @updatedAt, @lastConnectedAt
       )`,
    );

    const tx = this.db.transaction((groups, rows) => {
      clearGroupsStmt.run();
      clearConnectionsStmt.run();

      for (const group of groups) {
        insertGroupStmt.run(group);
      }

      for (const row of rows) {
        insertConnectionStmt.run(row);
      }
    });

    tx(groupRows, connectionRows);
    return true;
  }

  loadAISettings() {
    this._ensureOpen();

    const rows = this.db
      .prepare(
        `SELECT
           id, name, apiUrl, apiKeyEnc, model, maxTokens, temperature,
           streamEnabled, createdAt, updatedAt
         FROM ai_configs
         ORDER BY updatedAt DESC, createdAt DESC`,
      )
      .all();

    const configs = rows.map((row) => ({
      id: row.id,
      name: row.name,
      apiUrl: row.apiUrl,
      apiKey: this._decryptMaybe(row.apiKeyEnc),
      model: row.model,
      maxTokens: row.maxTokens,
      temperature: row.temperature,
      streamEnabled: row.streamEnabled === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));

    const currentId = this.readSetting("ai.currentId", null);
    const current = configs.find((item) => item.id === currentId) ||
      configs[0] || {
        apiUrl: "",
        apiKey: "",
        model: "",
        streamEnabled: true,
      };

    const customRiskRules = this.readSetting("ai.customRiskRules", null);

    return customRiskRules != null
      ? { configs, current, customRiskRules }
      : { configs, current };
  }

  saveAISettings(settings) {
    this._ensureOpen();

    const configs = Array.isArray(settings?.configs) ? settings.configs : [];
    const now = Date.now();

    const clearStmt = this.db.prepare("DELETE FROM ai_configs");
    const insertStmt = this.db.prepare(
      `INSERT INTO ai_configs(
         id, name, apiUrl, apiKeyEnc, model, maxTokens,
         temperature, streamEnabled, createdAt, updatedAt
       ) VALUES (
         @id, @name, @apiUrl, @apiKeyEnc, @model, @maxTokens,
         @temperature, @streamEnabled, @createdAt, @updatedAt
       )`,
    );

    const tx = this.db.transaction(() => {
      clearStmt.run();
      for (const config of configs) {
        const id = String(config?.id || `ai_${Date.now()}_${Math.random()}`);
        insertStmt.run({
          id,
          name: String(config?.name || ""),
          apiUrl: String(config?.apiUrl || ""),
          apiKeyEnc: this._encryptMaybe(config?.apiKey),
          model: String(config?.model || ""),
          maxTokens:
            typeof config?.maxTokens === "number" ? config.maxTokens : null,
          temperature:
            typeof config?.temperature === "number" ? config.temperature : null,
          streamEnabled: config?.streamEnabled === false ? 0 : 1,
          createdAt: Number(config?.createdAt) || now,
          updatedAt: now,
        });
      }
    });

    tx();

    const currentId =
      settings?.current?.id ||
      configs.find((item) => item?.id === settings?.current?.id)?.id ||
      configs[0]?.id ||
      null;

    this.writeSetting("ai.currentId", currentId);

    if (
      Object.prototype.hasOwnProperty.call(settings || {}, "customRiskRules")
    ) {
      this.writeSetting("ai.customRiskRules", settings.customRiskRules ?? null);
    }

    return true;
  }

  loadCommandHistory() {
    this._ensureOpen();

    return this.db
      .prepare(
        `SELECT command, count, lastUsedAt, createdAt
         FROM command_history
         ORDER BY lastUsedAt DESC, createdAt DESC`,
      )
      .all()
      .map((row) => ({
        command: row.command,
        count: row.count,
        timestamp: row.lastUsedAt,
        createdAt: row.createdAt,
      }));
  }

  saveCommandHistory(history) {
    this._ensureOpen();

    const rows = Array.isArray(history)
      ? history
          .filter((item) => item && typeof item.command === "string")
          .map((item) => ({
            command: item.command,
            count:
              typeof item.count === "number" && Number.isFinite(item.count)
                ? Math.max(1, Math.floor(item.count))
                : 1,
            lastUsedAt:
              Number(item.timestamp) || Number(item.lastUsedAt) || Date.now(),
            createdAt: Number(item.createdAt) || Date.now(),
          }))
      : [];

    const clearStmt = this.db.prepare("DELETE FROM command_history");
    const insertStmt = this.db.prepare(
      `INSERT INTO command_history(command, count, lastUsedAt, createdAt)
       VALUES(@command, @count, @lastUsedAt, @createdAt)`,
    );

    const tx = this.db.transaction(() => {
      clearStmt.run();
      for (const row of rows) {
        insertStmt.run(row);
      }
    });

    tx();
    return true;
  }

  readSetting(key, fallbackValue) {
    this._ensureOpen();

    const row = this.db
      .prepare("SELECT valueJson FROM settings_kv WHERE key = ? LIMIT 1")
      .get(key);
    if (!row) {
      return fallbackValue;
    }

    return this._safeJsonParse(row.valueJson, fallbackValue);
  }

  writeSetting(key, value) {
    this._ensureOpen();

    const now = Date.now();
    const json = JSON.stringify(value ?? null);

    this.db
      .prepare(
        `INSERT INTO settings_kv(key, valueJson, updatedAt)
         VALUES(?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           valueJson = excluded.valueJson,
           updatedAt = excluded.updatedAt`,
      )
      .run(key, json, now);

    return true;
  }

  _collectConnectionRows(items, parentPath, groups, rows) {
    if (!Array.isArray(items)) {
      return;
    }

    const now = Date.now();

    for (const item of items) {
      if (!item || typeof item !== "object") {
        continue;
      }

      if (item.type === "group") {
        const groupName = String(item.name || "").trim();
        if (!groupName) {
          continue;
        }

        const fullPath = parentPath
          ? `${parentPath} / ${groupName}`
          : groupName;
        groups.push({
          name: fullPath,
          createdAt: Number(item.createdAt) || now,
          updatedAt: Number(item.updatedAt) || now,
        });

        this._collectConnectionRows(item.items || [], fullPath, groups, rows);
        continue;
      }

      if (item.type !== "connection") {
        continue;
      }

      const protocol = String(item.protocol || "ssh");
      const port = Number(item.port) || (protocol === "telnet" ? 23 : 22);
      const authType = this._mapAuthTypeForStorage(item.authType);

      const standardFields = new Set([
        "type",
        "id",
        "name",
        "protocol",
        "host",
        "port",
        "username",
        "authType",
        "password",
        "privateKey",
        "privateKeyPath",
        "privateKeyPassphrase",
        "proxy",
        "createdAt",
        "updatedAt",
        "lastConnectedAt",
      ]);

      const extra = {};
      for (const [key, value] of Object.entries(item)) {
        if (!standardFields.has(key)) {
          extra[key] = value;
        }
      }

      rows.push({
        id: String(item.id || `conn_${Date.now()}_${Math.random()}`),
        groupName: parentPath || null,
        name: String(item.name || `${item.username || ""}@${item.host || ""}`),
        protocol,
        host: String(item.host || ""),
        port,
        username: String(item.username || ""),
        authType,
        passwordEnc: this._encryptMaybe(item.password),
        privateKeyEnc: this._encryptMaybe(item.privateKey),
        privateKeyPathEnc: this._encryptMaybe(item.privateKeyPath),
        privateKeyPassphraseEnc: this._encryptMaybe(item.privateKeyPassphrase),
        proxyJson: item.proxy == null ? null : JSON.stringify(item.proxy),
        extraJson: Object.keys(extra).length > 0 ? JSON.stringify(extra) : null,
        createdAt: Number(item.createdAt) || now,
        updatedAt: Number(item.updatedAt) || now,
        lastConnectedAt:
          item.lastConnectedAt == null ? null : Number(item.lastConnectedAt),
      });
    }
  }

  _mapAuthTypeForStorage(authType) {
    if (authType === "privateKey") {
      return "key";
    }
    return authType || "password";
  }

  _mapAuthTypeForLoad(authType) {
    if (authType === "key") {
      return "privateKey";
    }
    return authType || "password";
  }

  _splitGroupPath(pathValue) {
    return String(pathValue || "")
      .split("/")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  _validateSyncPackage(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Sync package not found: ${filePath}`);
    }

    const sourceDb = new Database(filePath, {
      readonly: true,
      fileMustExist: true,
    });

    try {
      const tableRows = sourceDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .all();
      const tableSet = new Set(tableRows.map((row) => row.name));

      const requiredTables = [
        "groups",
        "connections",
        "ai_configs",
        "settings_kv",
        "command_history",
      ];

      for (const tableName of requiredTables) {
        if (!tableSet.has(tableName)) {
          throw new Error(`Invalid sync package, missing table: ${tableName}`);
        }
      }
    } finally {
      sourceDb.close();
    }
  }

  _deleteSidecars(filePath) {
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = `${filePath}${suffix}`;
      if (fs.existsSync(sidecar)) {
        fs.unlinkSync(sidecar);
      }
    }
  }

  _ensureOpen() {
    if (!this.db) {
      throw new Error("SQLite storage is not initialized");
    }
  }

  _applyPragmas() {
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("temp_store = MEMORY");
  }

  _migrate() {
    const currentVersion =
      this.db.pragma("user_version", { simple: true }) || 0;

    if (currentVersion >= CURRENT_DB_VERSION) {
      return;
    }

    if (currentVersion < 1) {
      this._createV1Schema();
      this.db.pragma(`user_version = ${CURRENT_DB_VERSION}`);
    }
  }

  _createV1Schema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY,
        groupName TEXT,
        name TEXT NOT NULL,
        protocol TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        username TEXT NOT NULL,
        authType TEXT NOT NULL,
        passwordEnc TEXT,
        privateKeyEnc TEXT,
        privateKeyPathEnc TEXT,
        privateKeyPassphraseEnc TEXT,
        proxyJson TEXT,
        extraJson TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        lastConnectedAt INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_connections_host_port_username_protocol
        ON connections(host, port, username, protocol);
      CREATE INDEX IF NOT EXISTS idx_connections_lastConnectedAt
        ON connections(lastConnectedAt);

      CREATE TABLE IF NOT EXISTS ai_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        apiUrl TEXT NOT NULL,
        apiKeyEnc TEXT,
        model TEXT,
        maxTokens INTEGER,
        temperature REAL,
        streamEnabled INTEGER NOT NULL DEFAULT 1,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings_kv (
        key TEXT PRIMARY KEY,
        valueJson TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS command_history (
        command TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        lastUsedAt INTEGER NOT NULL,
        createdAt INTEGER NOT NULL
      );
    `);
  }

  _encryptMaybe(value) {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (this._looksEncrypted(trimmed)) {
      return trimmed;
    }

    try {
      const encrypted = this.encryptText ? this.encryptText(trimmed) : null;
      return encrypted || trimmed;
    } catch (_error) {
      return trimmed;
    }
  }

  _decryptMaybe(value) {
    if (typeof value !== "string") {
      return "";
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }

    if (!this._looksEncrypted(trimmed)) {
      return trimmed;
    }

    try {
      const decrypted = this.decryptText ? this.decryptText(trimmed) : null;
      return decrypted || "";
    } catch (_error) {
      return "";
    }
  }

  _looksEncrypted(value) {
    const index = value.indexOf(":");
    if (index <= 0 || index === value.length - 1) {
      return false;
    }

    const ivHex = value.slice(0, index);
    const cipherHex = value.slice(index + 1);

    if (ivHex.length !== 32 || cipherHex.length % 2 !== 0) {
      return false;
    }

    const hexPattern = /^[0-9a-fA-F]+$/;
    return hexPattern.test(ivHex) && hexPattern.test(cipherHex);
  }

  _safeJsonParse(json, fallbackValue) {
    if (typeof json !== "string") {
      return fallbackValue;
    }

    try {
      return JSON.parse(json);
    } catch (_error) {
      return fallbackValue;
    }
  }
}

module.exports = SQLiteConfigStorage;
