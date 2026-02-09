const { session } = require("electron");
const { logToFile, initLogger, updateLogConfig } = require("../utils/logger");
const configService = require("../../services/configService");
const sftpCore = require("../transfer/sftp-engine");
const sftpTransfer = require("../../modules/sftp/sftpTransfer");
const externalEditorManager = require("../../modules/sftp/externalEditorManager");
const fileCache = require("../utils/fileCache");
const connectionManager = require("../../modules/connection");
const commandHistoryService = require("../../modules/terminal/command-history");
const processManager = require("../process/processManager");
const { safeSendToRenderer } = require("../window/windowManager");

/**
 * 应用初始化模块
 * 负责在app.whenReady()时初始化所有核心模块
 */
class AppInitializer {
  constructor(app) {
    this.app = app;
  }

  /**
   * 初始化日志系统
   */
  initializeLogger() {
    initLogger(this.app);
    logToFile("Logger initialized", "INFO");
  }

  /**
   * 配置session代理
   */
  async configureSessionProxy() {
    try {
      await session.defaultSession.setProxy({ mode: "system" });
      logToFile("Session proxy configured to use system settings", "INFO");
    } catch (proxyErr) {
      logToFile(`Failed to configure session proxy: ${proxyErr.message}`, "WARN");
    }
  }

  /**
   * 初始化配置服务
   */
  initializeConfigService() {
    configService.init(this.app, { logToFile }, require("../utils/crypto"));
    configService.initializeMainConfig();

    const logSettings = configService.loadLogSettings();
    updateLogConfig(logSettings);
    logToFile("Config service initialized", "INFO");
  }

  /**
   * 初始化SFTP核心模块
   */
  initializeSftpCore() {
    sftpCore.init({ logToFile }, (tabId) => processManager.getProcess(tabId));
    sftpCore.startSftpHealthCheck();
    logToFile("SFTP core initialized", "INFO");
  }

  /**
   * 初始化SFTP传输模块
   */
  initializeSftpTransfer(dialog, shell) {
    sftpTransfer.init(
      { logToFile },
      sftpCore,
      dialog,
      shell,
      (tabId) => processManager.getProcess(tabId),
      (channel, ...args) => safeSendToRenderer(channel, ...args)
    );
    logToFile("SFTP transfer initialized", "INFO");
  }

  /**
   * 初始化外部编辑器管理器
   */
  initializeExternalEditorManager(shell) {
    try {
      externalEditorManager.init({
        app: this.app,
        logger: { logToFile },
        configService,
        sftpCore,
        shell,
        sendToRenderer: (channel, payload) => safeSendToRenderer(channel, payload),
      });
      logToFile("External editor manager initialized", "INFO");
    } catch (error) {
      logToFile(`Failed to initialize external editor manager: ${error.message}`, "ERROR");
    }
  }

  /**
   * 初始化文件缓存
   */
  initializeFileCache() {
    fileCache.init(logToFile, this.app);
    fileCache.startPeriodicCleanup();
    logToFile("File cache initialized", "INFO");
  }

  /**
   * 初始化连接管理器
   */
  initializeConnectionManager() {
    connectionManager.initialize();

    try {
      const lastConnections = configService.loadLastConnections();

      // 兼容/修复：旧版本保存的 lastConnections 可能缺少 proxy 字段，
      // 导致从“最近连接/快捷连接”打开时无法走用户配置的 HTTP 代理。
      // 这里用主连接列表里的同 host/port/username 条目补齐 proxy（不写回配置，仅用于本次启动）。
      let proxyByServerKey = null;
      try {
        const allConnections = configService.loadConnections();
        const flat = [];
        const walk = (items) => {
          if (!Array.isArray(items)) return;
          for (const it of items) {
            if (!it) continue;
            if (it.type === "connection") flat.push(it);
            if (it.type === "group" && Array.isArray(it.items)) walk(it.items);
          }
        };
        walk(allConnections);
        proxyByServerKey = new Map(
          flat
            .filter((c) => c?.host && (c?.username || c?.protocol === "telnet"))
            .map((c) => [
              `${c.host}:${c.port || (c.protocol === "telnet" ? 23 : 22)}:${c.username || ""}`,
              c.proxy || null,
            ]),
        );
      } catch {
        proxyByServerKey = null;
      }

      if (Array.isArray(lastConnections) && proxyByServerKey) {
        for (const lc of lastConnections) {
          if (!lc || lc.type !== "connection") continue;
          if (lc.protocol && String(lc.protocol).toLowerCase() !== "ssh") continue;
          if (lc.proxy) continue;
          const key = `${lc.host}:${lc.port || 22}:${lc.username || ""}`;
          const p = proxyByServerKey.get(key);
          if (p) lc.proxy = p;
        }
      }
      if (lastConnections && lastConnections.length > 0) {
        connectionManager.loadLastConnectionsFromConfig(lastConnections);
        logToFile(`Loaded ${lastConnections.length} last connections on startup`, "INFO");
      }
    } catch (error) {
      logToFile(`Failed to load last connections on startup: ${error.message}`, "ERROR");
    }
  }

  /**
   * 初始化命令历史服务
   */
  initializeCommandHistoryService() {
    try {
      const commandHistory = configService.loadCommandHistory();
      commandHistoryService.initialize(commandHistory);
      logToFile(`Command history service initialized with ${commandHistory.length} entries`, "INFO");
    } catch (error) {
      logToFile(`Failed to initialize command history service: ${error.message}`, "ERROR");
    }
  }

  /**
   * 执行所有初始化
   */
  async initialize(dialog, shell) {
    this.initializeLogger();
    await this.configureSessionProxy();
    this.initializeConfigService();
    this.initializeSftpCore();
    this.initializeSftpTransfer(dialog, shell);
    this.initializeExternalEditorManager(shell);
    this.initializeFileCache();
    this.initializeConnectionManager();
    this.initializeCommandHistoryService();

    logToFile("Application initialization complete", "INFO");
  }
}

/**
 * 获取连接管理器实例（供其他模块使用）
 */
function getConnectionManager() {
  return connectionManager;
}

/**
 * 获取SFTP核心模块（供其他模块使用）
 */
function getSftpCore() {
  return sftpCore;
}

/**
 * 获取SFTP传输模块（供其他模块使用）
 */
function getSftpTransfer() {
  return sftpTransfer;
}

/**
 * 获取外部编辑器管理器（供其他模块使用）
 */
function getExternalEditorManager() {
  return externalEditorManager;
}

module.exports = {
  AppInitializer,
  getConnectionManager,
  getSftpCore,
  getSftpTransfer,
  getExternalEditorManager,
};
