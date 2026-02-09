const { logToFile } = require("../utils/logger");
const configService = require("../../services/configService");
const net = require("node:net");
const { Buffer } = require("node:buffer");

class ProxyManager {
  constructor() {
    this.defaultProxyConfig = null;
    this.systemProxyConfig = null;
    this.initialized = false;
    this._systemProxyByHost = new Map(); // cache for Electron/PAC per host
  }

  initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // 加载默认代理配置
      this.loadDefaultProxyConfig();

      // 检测系统代理配置
      this.detectSystemProxy();

      this.initialized = true;
      logToFile("ProxyManager initialized", "INFO");
    } catch (error) {
      logToFile(
        `ProxyManager initialization failed: ${error.message}`,
        "ERROR",
      );
    }
  }

  /**
   * 加载默认代理配置
   */
  loadDefaultProxyConfig() {
    try {
      const config = configService.get("defaultProxyConfig");
      if (config && this.isValidProxyConfig(config)) {
        this.defaultProxyConfig = config;
        logToFile("Default proxy config loaded", "INFO");
      }
    } catch (error) {
      logToFile(
        `Failed to load default proxy config: ${error.message}`,
        "ERROR",
      );
    }
  }

  /**
   * 保存默认代理配置
   * @param {object} proxyConfig - 代理配置
   */
  saveDefaultProxyConfig(proxyConfig) {
    try {
      if (this.isValidProxyConfig(proxyConfig)) {
        this.defaultProxyConfig = proxyConfig;
        configService.set("defaultProxyConfig", proxyConfig);
        logToFile("Default proxy config saved", "INFO");
        return true;
      } else {
        throw new Error("Invalid proxy configuration");
      }
    } catch (error) {
      logToFile(
        `Failed to save default proxy config: ${error.message}`,
        "ERROR",
      );
      return false;
    }
  }

  /**
   * 获取默认代理配置
   * @returns {object|null} 代理配置或null
   */
  getDefaultProxyConfig() {
    return this.defaultProxyConfig;
  }

  /**
   * 检测系统代理配置
   */
  detectSystemProxy() {
    try {
      // Windows系统代理检测
      if (process.platform === "win32") {
        this.detectWindowsProxy();
      }
      // macOS系统代理检测
      else if (process.platform === "darwin") {
        this.detectMacOSProxy();
      }
      // Linux系统代理检测
      else if (process.platform === "linux") {
        this.detectLinuxProxy();
      }
    } catch (error) {
      logToFile(`System proxy detection failed: ${error.message}`, "ERROR");
    }
  }

  /**
   * Windows系统代理检测
   */
  detectWindowsProxy() {
    try {
      // 检查环境变量
      const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
      const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;

      if (httpProxy || httpsProxy) {
        const proxyUrl = new URL(httpProxy || httpsProxy);
        this.systemProxyConfig = {
          type: proxyUrl.protocol.replace(":", ""),
          host: proxyUrl.hostname,
          port:
            parseInt(proxyUrl.port) ||
            (proxyUrl.protocol === "http:" ? 80 : 443),
          username: proxyUrl.username || undefined,
          password: proxyUrl.password || undefined,
          source: "environment",
        };
        logToFile(
          "Windows system proxy detected from environment variables",
          "INFO",
        );
      }
    } catch (error) {
      logToFile(`Windows proxy detection error: ${error.message}`, "ERROR");
    }
  }

  /**
   * macOS系统代理检测
   */
  detectMacOSProxy() {
    try {
      // 检查环境变量
      const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
      const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;

      if (httpProxy || httpsProxy) {
        const proxyUrl = new URL(httpProxy || httpsProxy);
        this.systemProxyConfig = {
          type: proxyUrl.protocol.replace(":", ""),
          host: proxyUrl.hostname,
          port:
            parseInt(proxyUrl.port) ||
            (proxyUrl.protocol === "http:" ? 80 : 443),
          username: proxyUrl.username || undefined,
          password: proxyUrl.password || undefined,
          source: "environment",
        };
        logToFile(
          "macOS system proxy detected from environment variables",
          "INFO",
        );
      }
    } catch (error) {
      logToFile(`macOS proxy detection error: ${error.message}`, "ERROR");
    }
  }

  /**
   * Linux系统代理检测
   */
  detectLinuxProxy() {
    try {
      // 检查环境变量
      const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
      const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
      const socksProxy = process.env.SOCKS_PROXY || process.env.socks_proxy;

      const proxyUrl = new URL(httpProxy || httpsProxy || socksProxy);
      if (proxyUrl) {
        this.systemProxyConfig = {
          type: proxyUrl.protocol.replace(":", ""),
          host: proxyUrl.hostname,
          port:
            parseInt(proxyUrl.port) ||
            this.getDefaultPortForProtocol(proxyUrl.protocol),
          username: proxyUrl.username || undefined,
          password: proxyUrl.password || undefined,
          source: "environment",
        };
        logToFile(
          "Linux system proxy detected from environment variables",
          "INFO",
        );
      }
    } catch (error) {
      logToFile(`Linux proxy detection error: ${error.message}`, "ERROR");
    }
  }

  /**
   * 获取协议默认端口
   * @param {string} protocol - 协议类型
   * @returns {number} 默认端口
   */
  getDefaultPortForProtocol(protocol) {
    switch (protocol) {
      case "http:":
        return 80;
      case "https:":
        return 443;
      case "socks4:":
        return 1080;
      case "socks5:":
        return 1080;
      default:
        return 8080;
    }
  }

  /**
   * 获取系统代理配置
   * @returns {object|null} 系统代理配置或null
   */
  getSystemProxyConfig() {
    return this.systemProxyConfig;
  }

  /**
   * 为指定目标主机解析系统代理（支持 Electron/PAC 按 host 分流）
   * - 若 PAC/系统规则对该 host 返回 DIRECT，则返回 null（表示应直连/走 VPN 路由）
   * - 环境变量代理无法按 host 分流，若存在则直接返回
   * @param {string} targetHost
   * @returns {Promise<object|null>}
   */
  async resolveSystemProxyForTarget(targetHost) {
    // 环境变量代理（全局，不按 host）
    if (this.systemProxyConfig && this.isValidProxyConfig(this.systemProxyConfig)) {
      return this.systemProxyConfig;
    }

    const hostKey = String(targetHost || "").trim().toLowerCase();
    if (!hostKey) return null;

    if (this._systemProxyByHost.has(hostKey)) {
      return this._systemProxyByHost.get(hostKey);
    }

    try {
      const cfg = await this.detectElectronSystemProxyForTarget(targetHost);
      // 缓存结果（包含 null，避免频繁 resolveProxy）
      this._systemProxyByHost.set(hostKey, cfg || null);
      return cfg || null;
    } catch (error) {
      logToFile(`Electron system proxy detection failed for ${targetHost}: ${error.message}`, "WARN");
      this._systemProxyByHost.set(hostKey, null);
      return null;
    }
  }

  /**
   * 异步确保系统代理已检测（支持 Electron 的 PAC/系统代理规则）
   * @returns {Promise<object|null>}
   */
  async ensureSystemProxyConfig() {
    // 已有缓存
    if (this.systemProxyConfig && this.isValidProxyConfig(this.systemProxyConfig)) {
      return this.systemProxyConfig;
    }

    // 先同步检测环境变量（快速路径）
    try {
      this.detectSystemProxy();
      if (this.systemProxyConfig && this.isValidProxyConfig(this.systemProxyConfig)) {
        return this.systemProxyConfig;
      }
    } catch {
      // ignore
    }

    // 对于 Electron/PAC，代理可能按目标主机变化；这里不再设置全局 systemProxyConfig
    return null;
  }

  /**
   * 从 Electron session.resolveProxy() 获取系统代理（含 PAC 结果），按目标主机解析
   * @returns {Promise<object|null>}
   */
  async detectElectronSystemProxyForTarget(targetHost) {
    let electronSession = null;
    try {
      // 在主进程中可用；在纯 Node 环境中可能不可用
      electronSession = require("electron")?.session || null;
    } catch {
      electronSession = null;
    }

    const defaultSession = electronSession?.defaultSession;
    if (!defaultSession || typeof defaultSession.resolveProxy !== "function") {
      return null;
    }

    // resolveProxy 不会真正发起网络请求，用目标 host 构造 URL 以便 PAC 做按 host 分流
    // 注意：这里用 http://<host>/ 只是用于匹配规则，SSH 仍然是 TCP 直连/走代理隧道
    const safeHost = String(targetHost || "").trim();
    if (!safeHost) return null;
    const proxyRules = await defaultSession.resolveProxy(`http://${safeHost}/`);
    const parsed = this.parseElectronProxyRules(proxyRules);
    return parsed;
  }

  /**
   * 解析 Electron resolveProxy 返回的规则字符串
   * 形如： "PROXY 127.0.0.1:7890; DIRECT"
   *       "SOCKS5 127.0.0.1:1080; DIRECT"
   * @param {string} rules
   * @returns {object|null}
   */
  parseElectronProxyRules(rules) {
    if (!rules || typeof rules !== "string") return null;

    const entries = rules
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const entry of entries) {
      if (/^DIRECT$/i.test(entry)) continue;

      const parts = entry.split(/\s+/).filter(Boolean);
      if (parts.length < 2) continue;

      const scheme = String(parts[0]).toUpperCase();
      const hostPort = parts.slice(1).join(" ");

      const { host, port } = this.parseHostPort(hostPort);
      if (!host || !port) continue;

      const type = (() => {
        // Electron: PROXY=HTTP 代理，HTTPS=HTTPS 代理，SOCKS/SOCKS5/SOCKS4
        if (scheme === "PROXY") return "http";
        if (scheme === "HTTPS") return "https";
        if (scheme === "SOCKS5") return "socks5";
        if (scheme === "SOCKS4") return "socks4";
        if (scheme === "SOCKS") return "socks5";
        return null;
      })();

      if (!type) continue;

      return { type, host, port, source: "electron" };
    }

    return null;
  }

  /**
   * 解析 host:port（兼容 IPv6 [::1]:7890）
   * @param {string} hostPort
   * @returns {{host: string|null, port: number|null}}
   */
  parseHostPort(hostPort) {
    if (!hostPort || typeof hostPort !== "string") return { host: null, port: null };

    const s = hostPort.trim();
    if (!s) return { host: null, port: null };

    // [IPv6]:port
    const ipv6Match = s.match(/^\[([^\]]+)\]:(\d+)$/);
    if (ipv6Match) {
      return { host: ipv6Match[1], port: Number(ipv6Match[2]) };
    }

    // host:port (host 不含冒号)
    const idx = s.lastIndexOf(":");
    if (idx <= 0) return { host: null, port: null };
    const host = s.slice(0, idx).trim();
    const port = Number(s.slice(idx + 1));
    if (!host || !Number.isFinite(port)) return { host: null, port: null };
    return { host, port };
  }

  /**
   * 解析连接的代理配置
   * @param {object} sshConfig - SSH连接配置
   * @returns {object|null} 最终使用的代理配置
   */
  resolveProxyConfig(sshConfig) {
    // 只有当连接项显式启用代理（存在 proxy 字段）时，才应用任何代理策略
    if (!sshConfig || !sshConfig.proxy) {
      return null;
    }

    // 如果连接明确配置了代理（自定义 host/port）
    if (sshConfig.proxy && !sshConfig.proxy.useDefault) {
      logToFile(
        `Using connection-specific proxy: ${sshConfig.proxy.host}:${sshConfig.proxy.port}`,
        "INFO",
      );
      return sshConfig.proxy;
    }

    // 如果连接配置了使用默认代理或没有配置代理信息
    if (sshConfig.proxy.useDefault) {
      // 优先使用默认配置
      if (this.defaultProxyConfig) {
        logToFile(
          `Using default proxy config: ${this.defaultProxyConfig.host}:${this.defaultProxyConfig.port}`,
          "INFO",
        );
        return this.defaultProxyConfig;
      }

      // 其次使用系统代理配置
      if (this.systemProxyConfig) {
        logToFile(
          `Using system proxy config: ${this.systemProxyConfig.host}:${this.systemProxyConfig.port}`,
          "INFO",
        );
        return this.systemProxyConfig;
      }
    }

    return null;
  }

  /**
   * resolveProxyConfig 的异步版本：当需要“系统代理”时，会尝试异步解析（Electron/PAC）
   * @param {object} sshConfig
   * @returns {Promise<object|null>}
   */
  async resolveProxyConfigAsync(sshConfig) {
    // 只有当连接项显式启用代理（存在 proxy 字段）时，才应用任何代理策略
    if (!sshConfig?.proxy) return null;

    // 自定义代理
    if (!sshConfig.proxy.useDefault) {
      return sshConfig.proxy;
    }

    // useDefault：先默认代理，再系统代理（系统代理需要按目标 host 解析，支持 PAC/DIRECT）
    if (this.defaultProxyConfig) return this.defaultProxyConfig;
    return await this.resolveSystemProxyForTarget(sshConfig.host);
  }

  /**
   * 通过代理创建到目标的 TCP 隧道 socket（用于 ssh2 的 sock）
   * @param {object} proxyConfig
   * @param {string} targetHost
   * @param {number} targetPort
   * @param {object} options
   * @returns {Promise<import("net").Socket>}
   */
  async createTunnelSocket(proxyConfig, targetHost, targetPort, options = {}) {
    const timeoutMs = Number(options.timeoutMs) || 15000;
    const type = String(proxyConfig?.type || "").toLowerCase();

    if (!proxyConfig || !this.isValidProxyConfig(proxyConfig)) {
      throw new Error("Invalid proxy configuration");
    }

    // 注意：系统规则中 "HTTPS host:port" 表示“用于 HTTPS 请求的代理”，但代理本身通常仍是 HTTP 代理（明文 CONNECT）
    if (type === "http" || type === "https") {
      return await this._connectViaHttpProxy(proxyConfig, targetHost, targetPort, { timeoutMs });
    }
    if (type === "socks5") {
      return await this._connectViaSocks5(proxyConfig, targetHost, targetPort, { timeoutMs });
    }
    if (type === "socks4") {
      return await this._connectViaSocks4(proxyConfig, targetHost, targetPort, { timeoutMs });
    }

    throw new Error(`Unsupported proxy type: ${proxyConfig.type}`);
  }

  _createTimeoutError(message) {
    const err = new Error(message || "Proxy connection timeout");
    err.code = "ETIMEDOUT";
    return err;
  }

  _withTimeout(promise, timeoutMs, message) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(this._createTimeoutError(message)), timeoutMs),
      ),
    ]);
  }

  _readUntil(socket, delimiter, timeoutMs) {
    return this._withTimeout(
      new Promise((resolve, reject) => {
        let buffer = Buffer.alloc(0);

        const cleanup = () => {
          socket.off("data", onData);
          socket.off("error", onError);
          socket.off("close", onClose);
        };

        const onError = (e) => {
          cleanup();
          reject(e);
        };
        const onClose = () => {
          cleanup();
          reject(new Error("Proxy socket closed before response"));
        };
        const onData = (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          const idx = buffer.indexOf(delimiter);
          if (idx === -1) return;

          const head = buffer.slice(0, idx + delimiter.length);
          const rest = buffer.slice(idx + delimiter.length);
          cleanup();
          resolve({ head, rest });
        };

        socket.on("data", onData);
        socket.once("error", onError);
        socket.once("close", onClose);
      }),
      timeoutMs,
      "Proxy handshake timed out",
    );
  }

  async _connectViaHttpProxy(proxyConfig, targetHost, targetPort, { timeoutMs }) {
    const connectPromise = new Promise((resolve, reject) => {
      const onError = (e) => reject(e);

      // 重要：不要把 proxy type=HTTPS 误当成“对代理服务器做 TLS 连接”
      // 大多数系统代理的 HTTPS 代理依然是明文 HTTP 代理（通过 CONNECT 建隧道）
      const socket = net.connect(proxyConfig.port, proxyConfig.host);

      socket.setNoDelay(true);
      socket.once("error", onError);
      socket.once("connect", () => {
        socket.off("error", onError);
        resolve(socket);
      });
    });

    const socket = await this._withTimeout(
      connectPromise,
      timeoutMs,
      "Connect to HTTP proxy timed out",
    );

    try {
      const headers = [
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
        `Host: ${targetHost}:${targetPort}`,
        "Proxy-Connection: Keep-Alive",
        "Connection: Keep-Alive",
      ];

      if (proxyConfig.username) {
        const token = Buffer.from(
          `${proxyConfig.username}:${proxyConfig.password || ""}`,
        ).toString("base64");
        headers.push(`Proxy-Authorization: Basic ${token}`);
      }

      socket.write(headers.join("\r\n") + "\r\n\r\n");

      const { head, rest } = await this._readUntil(
        socket,
        Buffer.from("\r\n\r\n"),
        timeoutMs,
      );

      const headStr = head.toString("utf8");
      const statusLine = (headStr.split("\r\n")[0] || "").trim();
      const match = statusLine.match(/^HTTP\/\d+\.\d+\s+(\d+)/i);
      const code = match ? Number(match[1]) : 0;

      if (code !== 200) {
        socket.destroy();
        if (code === 407) {
          throw new Error(`HTTP proxy authentication required: ${statusLine}`);
        }
        throw new Error(`HTTP proxy CONNECT failed: ${statusLine}`);
      }

      // 把多余数据塞回去（极少数代理会在 CONNECT 后立刻发送额外数据）
      if (rest && rest.length > 0 && typeof socket.unshift === "function") {
        socket.unshift(rest);
      }

      return socket;
    } catch (error) {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      throw error;
    }
  }

  _readExact(socket, size, timeoutMs) {
    return this._withTimeout(
      new Promise((resolve, reject) => {
        let buffer = Buffer.alloc(0);

        const cleanup = () => {
          socket.off("data", onData);
          socket.off("error", onError);
          socket.off("close", onClose);
        };
        const onError = (e) => {
          cleanup();
          reject(e);
        };
        const onClose = () => {
          cleanup();
          reject(new Error("Proxy socket closed unexpectedly"));
        };
        const onData = (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          if (buffer.length < size) return;
          const out = buffer.slice(0, size);
          const rest = buffer.slice(size);
          cleanup();
          if (rest.length > 0 && typeof socket.unshift === "function") {
            socket.unshift(rest);
          }
          resolve(out);
        };

        socket.on("data", onData);
        socket.once("error", onError);
        socket.once("close", onClose);
      }),
      timeoutMs,
      "Proxy handshake timed out",
    );
  }

  async _connectViaSocks5(proxyConfig, targetHost, targetPort, { timeoutMs }) {
    const socket = await this._withTimeout(
      new Promise((resolve, reject) => {
        const s = net.connect(proxyConfig.port, proxyConfig.host);
        s.setNoDelay(true);
        s.once("error", reject);
        s.once("connect", () => resolve(s));
      }),
      timeoutMs,
      "Connect to SOCKS5 proxy timed out",
    );

    try {
      const hasAuth = Boolean(proxyConfig.username);
      const methods = hasAuth ? [0x02, 0x00] : [0x00];
      socket.write(Buffer.from([0x05, methods.length, ...methods]));

      const methodResp = await this._readExact(socket, 2, timeoutMs);
      if (methodResp[0] !== 0x05) {
        throw new Error("Invalid SOCKS5 proxy response (bad version)");
      }
      const method = methodResp[1];
      if (method === 0xff) {
        throw new Error("SOCKS5: no acceptable authentication methods");
      }

      if (method === 0x02) {
        const u = Buffer.from(String(proxyConfig.username || ""), "utf8");
        const p = Buffer.from(String(proxyConfig.password || ""), "utf8");
        if (u.length > 255 || p.length > 255) {
          throw new Error("SOCKS5: username/password too long");
        }
        socket.write(
          Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]),
        );
        const authResp = await this._readExact(socket, 2, timeoutMs);
        if (authResp[0] !== 0x01 || authResp[1] !== 0x00) {
          throw new Error("SOCKS5 authentication failed");
        }
      } else if (method !== 0x00) {
        throw new Error(`SOCKS5: unsupported auth method selected: 0x${method.toString(16)}`);
      }

      // CONNECT request
      const atyp = (() => {
        const ipType = net.isIP(targetHost);
        if (ipType === 4) return 0x01;
        if (ipType === 6) return 0x04;
        return 0x03;
      })();

      let addrPart;
      if (atyp === 0x01) {
        addrPart = Buffer.from(targetHost.split(".").map((n) => Number(n)));
      } else if (atyp === 0x04) {
        // 16 bytes IPv6
        const packed = this._packIPv6(targetHost);
        addrPart = packed;
      } else {
        const domain = Buffer.from(String(targetHost), "utf8");
        if (domain.length > 255) {
          throw new Error("SOCKS5: domain name too long");
        }
        addrPart = Buffer.concat([Buffer.from([domain.length]), domain]);
      }

      const portPart = Buffer.alloc(2);
      portPart.writeUInt16BE(Number(targetPort), 0);

      socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, atyp]), addrPart, portPart]));

      const head = await this._readExact(socket, 4, timeoutMs);
      if (head[0] !== 0x05) throw new Error("Invalid SOCKS5 proxy response (bad version)");
      const rep = head[1];
      const repAtyp = head[3];
      if (rep !== 0x00) {
        throw new Error(`SOCKS5 CONNECT failed (REP=0x${rep.toString(16)})`);
      }

      // Consume BND.ADDR and BND.PORT
      if (repAtyp === 0x01) {
        await this._readExact(socket, 4 + 2, timeoutMs);
      } else if (repAtyp === 0x04) {
        await this._readExact(socket, 16 + 2, timeoutMs);
      } else if (repAtyp === 0x03) {
        const lenBuf = await this._readExact(socket, 1, timeoutMs);
        const len = lenBuf[0];
        await this._readExact(socket, len + 2, timeoutMs);
      } else {
        throw new Error("Invalid SOCKS5 proxy response (unknown ATYP)");
      }

      return socket;
    } catch (error) {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      throw error;
    }
  }

  // 简单 IPv6 文本转 16 字节（不依赖额外依赖；仅满足常见格式）
  _packIPv6(ip) {
    // Node 内部没有公开 pack；这里用 net.isIP 校验后做最小实现
    // 支持 :: 压缩
    const input = String(ip);
    const parts = input.split("::");
    const left = parts[0] ? parts[0].split(":").filter(Boolean) : [];
    const right = parts[1] ? parts[1].split(":").filter(Boolean) : [];
    const fill = 8 - (left.length + right.length);
    const full = [...left, ...Array(Math.max(0, fill)).fill("0"), ...right];
    if (full.length !== 8) {
      throw new Error("Invalid IPv6 address");
    }
    const buf = Buffer.alloc(16);
    for (let i = 0; i < 8; i++) {
      buf.writeUInt16BE(parseInt(full[i], 16) || 0, i * 2);
    }
    return buf;
  }

  async _connectViaSocks4(proxyConfig, targetHost, targetPort, { timeoutMs }) {
    const socket = await this._withTimeout(
      new Promise((resolve, reject) => {
        const s = net.connect(proxyConfig.port, proxyConfig.host);
        s.setNoDelay(true);
        s.once("error", reject);
        s.once("connect", () => resolve(s));
      }),
      timeoutMs,
      "Connect to SOCKS4 proxy timed out",
    );

    try {
      const userId = Buffer.from(String(proxyConfig.username || ""), "utf8");
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(Number(targetPort), 0);

      const ipType = net.isIP(targetHost);
      let ipBuf;
      let hostBuf = null;

      if (ipType === 4) {
        ipBuf = Buffer.from(targetHost.split(".").map((n) => Number(n)));
      } else {
        // SOCKS4a：0.0.0.1 + domain\0
        ipBuf = Buffer.from([0x00, 0x00, 0x00, 0x01]);
        hostBuf = Buffer.from(String(targetHost), "utf8");
      }

      const reqParts = [
        Buffer.from([0x04, 0x01]),
        portBuf,
        ipBuf,
        userId,
        Buffer.from([0x00]),
      ];
      if (hostBuf) {
        reqParts.push(hostBuf, Buffer.from([0x00]));
      }

      socket.write(Buffer.concat(reqParts));

      const resp = await this._readExact(socket, 8, timeoutMs);
      const vn = resp[0];
      const cd = resp[1];
      if (vn !== 0x00 && vn !== 0x04) {
        throw new Error("Invalid SOCKS4 proxy response");
      }
      if (cd !== 0x5a) {
        throw new Error(`SOCKS4 CONNECT failed (CD=0x${cd.toString(16)})`);
      }

      return socket;
    } catch (error) {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      throw error;
    }
  }

  /**
   * 验证代理配置是否有效
   * @param {object} proxyConfig - 代理配置
   * @returns {boolean} 是否有效
   */
  isValidProxyConfig(proxyConfig) {
    return (
      proxyConfig &&
      typeof proxyConfig === "object" &&
      proxyConfig.host &&
      proxyConfig.port &&
      proxyConfig.type &&
      ["http", "https", "socks4", "socks5"].includes(
        proxyConfig.type.toLowerCase(),
      )
    );
  }

  /**
   * 获取代理配置状态
   * @returns {object} 代理配置状态
   */
  getProxyStatus() {
    return {
      initialized: this.initialized,
      hasDefaultProxy: !!this.defaultProxyConfig,
      hasSystemProxy: !!this.systemProxyConfig,
      defaultProxy: this.defaultProxyConfig
        ? {
            type: this.defaultProxyConfig.type,
            host: this.defaultProxyConfig.host,
            port: this.defaultProxyConfig.port,
            hasAuth: !!(
              this.defaultProxyConfig.username &&
              this.defaultProxyConfig.password
            ),
          }
        : null,
      systemProxy: this.systemProxyConfig
        ? {
            type: this.systemProxyConfig.type,
            host: this.systemProxyConfig.host,
            port: this.systemProxyConfig.port,
            source: this.systemProxyConfig.source,
            hasAuth: !!(
              this.systemProxyConfig.username && this.systemProxyConfig.password
            ),
          }
        : null,
    };
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.defaultProxyConfig = null;
    this.systemProxyConfig = null;
    this.initialized = false;
    try {
      this._systemProxyByHost?.clear?.();
    } catch {
      // ignore
    }
    logToFile("ProxyManager cleanup completed", "INFO");
  }
}

// 创建单例实例
const proxyManager = new ProxyManager();

module.exports = proxyManager;
