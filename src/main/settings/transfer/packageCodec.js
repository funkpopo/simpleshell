/** Config package encryption, decryption, validation, and local file import/export helpers. */
function createPackageCodecMethods({
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
}) {
  return {
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
    },

    _assertCredentialStoreUnlocked() {
      const status = configService.getCredentialSecurityStatus();
      if (status?.requiresUnlock) {
        const error = new Error("Credential store is locked");
        error.code = "CREDENTIAL_STORE_LOCKED";
        throw error;
      }
    },

    _stripMachineSpecificUISettings(uiSettings) {
      if (!uiSettings || typeof uiSettings !== "object") {
        return uiSettings;
      }
      const result = { ...uiSettings };
      delete result.windowBounds;
      return result;
    },

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
    },

    _countConnections(items) {
      if (!Array.isArray(items)) {
        return 0;
      }
      let count = 0;
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        if (item.type === "connection") count += 1;
        else if (item.type === "group")
          count += this._countConnections(item.items);
      }
      return count;
    },

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
    },

    /**
     * 由导出密码派生加密密钥（盐值随导出随机生成并写入包内）
     * 使用异步派生：scrypt 成本参数下同步计算约耗时 50-100ms，会阻塞主进程。
     */
    _derivePackageKeyAsync(password, salt) {
      return new Promise((resolve, reject) => {
        crypto.scrypt(
          String(password),
          `${KDF_CONTEXT}:${salt}`,
          KEY_LENGTH,
          { ...SCRYPT_COST },
          (error, derivedKey) => {
            if (error) reject(error);
            else resolve(derivedKey);
          },
        );
      });
    },

    /**
     * 递归排序对象键，生成与键序无关的规范化结构。
     * 用于计算载荷的内容哈希：同样的配置内容无论字段顺序如何都得到相同哈希。
     */
    _canonicalize(value) {
      if (Array.isArray(value)) {
        return value.map((item) => this._canonicalize(item));
      }
      if (value && typeof value === "object") {
        const result = {};
        for (const key of Object.keys(value).sort()) {
          result[key] = this._canonicalize(value[key]);
        }
        return result;
      }
      return value;
    },

    /**
     * 计算载荷的规范化内容哈希（sha256）。
     * 加密包因随机 salt/IV 每次导出字节都不同，冲突检测必须比对内容哈希而非密文字节。
     */
    _computePayloadHash(payloadJson) {
      let payload;
      try {
        payload = JSON.parse(payloadJson);
      } catch {
        return null;
      }
      return crypto
        .createHash("sha256")
        .update(JSON.stringify(this._canonicalize(payload)))
        .digest("hex");
    },

    /**
     * 解析配置包并取其载荷哈希。
     * 优先读包内 payloadHash 元数据；旧格式包（无该字段）在有导出密码时
     * 解密后现场计算；无法取得时返回 null（由调用方按冲突处理）。
     */
    async _getPackagePayloadHash(packageBuffer, exportPassword) {
      let packageObject;
      try {
        packageObject = JSON.parse(packageBuffer.toString("utf8"));
      } catch {
        return null;
      }
      if (typeof packageObject.payloadHash === "string") {
        return packageObject.payloadHash;
      }
      if (typeof exportPassword === "string" && exportPassword.length >= 4) {
        try {
          const payload = await this._decryptPackage(
            packageObject,
            exportPassword,
          );
          return this._computePayloadHash(JSON.stringify(payload));
        } catch {
          return null;
        }
      }
      return null;
    },

    async _encryptPayload(payloadJson, password) {
      const salt = crypto.randomBytes(KDF_SALT_LENGTH).toString("hex");
      const key = await this._derivePackageKeyAsync(password, salt);
      const compressed = await gzipAsync(Buffer.from(payloadJson, "utf8"));
      const iv = crypto.randomBytes(IV_LENGTH);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, {
        authTagLength: 16,
      });
      const encrypted = Buffer.concat([
        cipher.update(compressed),
        cipher.final(),
      ]);
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
    },

    async _decryptPackage(packageObject, password) {
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
      const key = await this._derivePackageKeyAsync(password, kdf.salt);
      const iv = Buffer.from(packageObject.iv, "hex");
      const authTag = Buffer.from(packageObject.authTag, "hex");
      const encrypted = Buffer.from(packageObject.data, "hex");

      let compressed;
      try {
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, {
          authTagLength: 16,
        });
        decipher.setAuthTag(authTag);
        compressed = Buffer.concat([
          decipher.update(encrypted),
          decipher.final(),
        ]);
      } catch {
        const error = new Error("DECRYPT_FAILED");
        error.code = "DECRYPT_FAILED";
        throw error;
      }

      let decompressed;
      try {
        decompressed = await gunzipAsync(compressed, {
          maxOutputLength: MAX_DECOMPRESSED_PAYLOAD_BYTES,
        });
      } catch (error) {
        if (error?.code === "ERR_BUFFER_TOO_LARGE") {
          const tooLarge = new Error("PACKAGE_TOO_LARGE");
          tooLarge.code = "PACKAGE_TOO_LARGE";
          throw tooLarge;
        }
        // 解密成功但解压失败：包体损坏
        throw new Error("INVALID_PACKAGE");
      }
      const payloadJson = decompressed.toString("utf8");
      const payload = JSON.parse(payloadJson);
      if (!payload || typeof payload !== "object" || !payload.sections) {
        throw new Error("INVALID_PACKAGE");
      }
      return payload;
    },

    /**
     * 导出加密配置包
     * @param {Object} options - { filePath, password, sections }
     * @returns {Object} { success, filePath, summary }
     */
    async exportToFile(options = {}) {
      const filePath = String(options.filePath || "").trim();
      const password =
        typeof options.password === "string" ? options.password : "";
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
      const payloadJson = JSON.stringify(payload);

      const packageObject = {
        magic: EXPORT_MAGIC,
        version: EXPORT_VERSION,
        createdAt: new Date().toISOString(),
        sections: sectionList,
        // 载荷内容哈希（键序规范化）：WebDAV 冲突检测依赖它，
        // 密文本身因随机 salt/IV 每次都不同，无法直接比对
        payloadHash: this._computePayloadHash(payloadJson),
        ...(await this._encryptPayload(payloadJson, password)),
      };

      // 全程异步 IO + 线程池加密，避免大数据量时卡住主进程
      const tempPath = `${filePath}.tmp-${process.pid}`;
      await fsp.writeFile(
        tempPath,
        JSON.stringify(packageObject, null, 2),
        "utf8",
      );
      await fsp.rename(tempPath, filePath);

      const summary = this._summarizePayload(payload);
      this._log(
        `ConfigTransferService: Exported config package to ${filePath} (sections=${sectionList.join(",")}, summary=${JSON.stringify(summary)})`,
        "INFO",
      );

      return { success: true, filePath, sections: sectionList, summary };
    },

    /**
     * 从加密配置包导入
     * @param {Object} options - { filePath, password, mode: "merge"|"replace", sections }
     * @returns {Object} { success, applied, summary }
     */
    async importFromFile(options = {}) {
      const filePath = String(options.filePath || "").trim();
      const password =
        typeof options.password === "string" ? options.password : "";
      if (!filePath) {
        throw new Error("Import file path is required");
      }

      const raw = await fsp.readFile(filePath, "utf8");
      let packageObject;
      try {
        packageObject = JSON.parse(raw);
      } catch {
        throw new Error("INVALID_PACKAGE");
      }

      const payload = await this._decryptPackage(packageObject, password);
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
    },
  };
}

module.exports = createPackageCodecMethods;
