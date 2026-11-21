/** WebDAV client transport and remote package upload/download helpers. */
function createWebdavClientMethods({
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
}) {
  return {
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
      const fileName =
        String(settings.fileName || DEFAULT_REMOTE_FILE_NAME)
          .trim()
          .replace(/^\/+/, "")
          .replace(/\\/g, "/") || DEFAULT_REMOTE_FILE_NAME;

      return {
        protocol: parsed.protocol === "https:" ? "https" : "http",
        host: parsed.hostname,
        port: parsed.port
          ? Number(parsed.port)
          : parsed.protocol === "https:"
            ? 443
            : 80,
        auth:
          parsed.username || parsed.password
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
    },

    _webdavRequest({ settings, method, body = null, headers = {} }) {
      const target = this._normalizeWebDAVSettings(settings);
      return new Promise((resolve, reject) => {
        const requestPath = `${target.basePath}/${target.fileName}`;
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
            path: requestPath,
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
    },

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
        return {
          success: true,
          status: response.status,
          note: "REMOTE_NOT_FOUND",
        };
      }
      if (response.status === 401 || response.status === 403) {
        const error = new Error("WebDAV authentication failed");
        error.code = "WEBDAV_AUTH_FAILED";
        throw error;
      }
      const error = new Error(
        `WebDAV request failed (HTTP ${response.status})`,
      );
      error.code = "WEBDAV_REQUEST_FAILED";
      error.status = response.status;
      throw error;
    },

    /**
     * 将本地导出包上传到 WebDAV
     * @param {Object} options - { url, username, password, fileName, filePath, exportOptions }
     */
    async webdavUpload(options = {}) {
      let packageBuffer;
      let summary = null;

      if (options.filePath && fs.existsSync(options.filePath)) {
        packageBuffer = await fsp.readFile(options.filePath);
      } else {
        // 未指定本地文件时先在临时目录生成导出包再上传
        this._assertCredentialStoreUnlocked();
        const tempPath = path.join(
          os.tmpdir(),
          `simpleshell-sync-${Date.now()}-${process.pid}${EXPORT_FILE_EXTENSION}`,
        );
        try {
          const exportResult = await this.exportToFile({
            filePath: tempPath,
            password: options.exportPassword,
            sections: options.sections,
          });
          summary = exportResult.summary;
          packageBuffer = await fsp.readFile(tempPath);
        } finally {
          try {
            await fsp.unlink(tempPath);
          } catch {
            // ignore
          }
        }
      }

      // 远端包字节哈希：上传成功后写入 lastRemoteHash 供自动拉取比对
      const localBytesHash = crypto
        .createHash("sha256")
        .update(packageBuffer)
        .digest("hex");

      // 冲突保护：上传前先 GET 远端包，比对载荷内容哈希（而非密文字节，
      // 后者因随机 salt/IV 每次导出都不同），
      // 避免两台设备同时自动同步时后写者整包覆盖前写者的配置
      if (options.force !== true) {
        const remote = await this._webdavRequest({
          settings: options,
          method: "GET",
        });
        if (remote.status === 401 || remote.status === 403) {
          const error = new Error("WebDAV authentication failed");
          error.code = "WEBDAV_AUTH_FAILED";
          throw error;
        }
        if (remote.status === 200) {
          // 本地/远端包哈希提取互相独立，并行执行（旧格式包需 scrypt 解密）
          const [localPayloadHash, remotePayloadHash] = await Promise.all([
            this._getPackagePayloadHash(packageBuffer, options.exportPassword),
            this._getPackagePayloadHash(remote.body, options.exportPassword),
          ]);
          if (
            !localPayloadHash ||
            !remotePayloadHash ||
            localPayloadHash !== remotePayloadHash
          ) {
            const error = new Error(
              "Remote config package has changed since the last sync",
            );
            error.code = "WEBDAV_CONFLICT";
            error.remoteBytes = remote.body.length;
            this._log(
              `ConfigTransferService: Upload aborted - remote package payload mismatch (localHash=${localPayloadHash || "unavailable"}, remoteHash=${remotePayloadHash || "unavailable"}; possible concurrent modification)`,
              "WARN",
            );
            throw error;
          }
        } else if (remote.status !== 404) {
          // 404 = 远端尚无配置包，允许直接上传；其余状态视为请求失败
          const error = new Error(
            `WebDAV upload failed (HTTP ${remote.status})`,
          );
          error.code = "WEBDAV_REQUEST_FAILED";
          error.status = remote.status;
          throw error;
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
        const error = new Error(
          `WebDAV upload failed (HTTP ${response.status})`,
        );
        error.code = "WEBDAV_REQUEST_FAILED";
        error.status = response.status;
        throw error;
      }

      this._log(
        `ConfigTransferService: Config package uploaded to WebDAV (${response.status}, ${packageBuffer.length} bytes)`,
        "INFO",
      );

      // 上传成功后记录远端包字节哈希，避免下次自动拉取把本次上传误判为远端更新
      try {
        const raw = this._readRawSyncSettings();
        const uploadedUrl = String(options.url || "").trim();
        if (raw.url && uploadedUrl && raw.url === uploadedUrl) {
          this._updateSyncSettingsState({
            lastRemoteHash: localBytesHash,
          });
        }
      } catch {
        // ignore
      }

      return {
        success: true,
        status: response.status,
        bytes: packageBuffer.length,
        summary,
      };
    },

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
        const error = new Error(
          `WebDAV download failed (HTTP ${response.status})`,
        );
        error.code = "WEBDAV_REQUEST_FAILED";
        error.status = response.status;
        throw error;
      }

      const packageBuffer = response.body;
      if (options.filePath) {
        const tempPath = `${options.filePath}.tmp-${process.pid}`;
        await fsp.writeFile(tempPath, packageBuffer);
        await fsp.rename(tempPath, options.filePath);
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
      const payload = await this._decryptPackage(
        packageObject,
        options.importPassword || "",
      );
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
    },
  };
}

module.exports = createWebdavClientMethods;
