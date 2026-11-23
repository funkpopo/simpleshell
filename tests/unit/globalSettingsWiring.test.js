// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import Settings from "../../src/renderer/features/settings/Settings.jsx";
import {
  NotificationProvider,
  useNotification,
} from "../../src/renderer/shared/notifications/NotificationContext.jsx";
import loadSettingsSnapshot from "../../src/renderer/features/settings/lib/loadSettingsSnapshot.js";
import {
  getCachedDirectory,
  storeCachedDirectory,
} from "../../src/renderer/features/file-manager/lib/directoryListing.js";
import {
  applyTerminalUiOptionsToInstance,
  shouldEnableTerminalPerfMonitor,
} from "../../src/renderer/features/terminal/runtime/terminalBootstrap.js";
import { renderHook } from "../helpers/reactHarness.js";

const require = createRequire(import.meta.url);

const { translate } = vi.hoisted(() => ({
  translate: (key) => key,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate, i18n: { language: "en-US" } }),
}));
vi.mock("../../src/renderer/i18n/i18n", () => ({
  default: { t: (key) => key },
  changeLanguage: vi.fn(),
}));

const configService = require("../../src/main/settings/configService.js");
const cryptoApi = require("../../src/main/utils/crypto.js");
const uiDefaults = require("../../src/shared/settings/uiSettingsDefaults.js");
const commandHistoryService = require("../../src/main/terminal/command-history.js");
const localTerminalConfig = require("../../src/main/local-terminal/local-terminal-config.js");
const {
  ZmodemTransferService,
} = require("../../src/main/terminal/zmodemTransferService.js");
const {
  resolveSshNetworkProfile,
} = require("../../src/main/connection/ssh-network-profile.js");
const BaseConnectionPool = require("../../src/main/connection/base-connection-pool.js");
const ReconnectionManager = require("../../src/main/connection/reconnection-manager.js");
const NetworkLatencyService = require("../../src/main/services/networkLatencyService.js");
const sftpConfig = require("../../src/main/file-transfer/sftpConfig.js");
const createSftpSessionPool = require("../../src/main/native/sftp/sftpSessionPool.js");
const fileCache = require("../../src/main/storage/fileCache.js");
const fileSnapshotStore = require("../../src/main/storage/fileSnapshotStore.js");
const {
  applyRuntimeUISettings,
} = require("../../src/main/settings/runtimeSettingsSync.js");
const logger = require("../../src/main/utils/logger.js");

let tempDir;

function initTempConfigService() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "simpleshell-goal4-"));
  const fakeCrypto = {
    ...cryptoApi,
    createSecurityConfig: () => ({
      mode: "safeStorage",
      masterPasswordEnabled: false,
      masterPasswordVerifier: "",
      randomKey: "",
      kdf: null,
    }),
    configureSecurity: vi.fn(),
    getSecurityStatus: () => ({
      unlocked: true,
      masterPasswordEnabled: false,
      safeStorageAvailable: true,
    }),
    encryptText: (value) => value || "",
    decryptText: (value) => value || "",
  };
  const fakeApp = {
    isPackaged: true,
    getPath: (name) =>
      name === "exe" ? path.join(tempDir, "old", "app.exe") : tempDir,
  };
  configService.init(fakeApp, { logToFile: vi.fn() }, fakeCrypto);
  configService.initializeMainConfig();
  return fakeApp;
}

describe("Goal 4 global settings schema, persistence & wiring", () => {
  let fakeApp;

  beforeEach(() => {
    fakeApp = initTempConfigService();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    tempDir = null;
  });

  it("enforces defaults, deep-merge partial saves, AJV bounds, and legacy log/perf migration", async () => {
    const defaults = uiDefaults.createDefaultUISettings();
    const loadedUi = configService.loadUISettings();
    const loadedLogs = configService.loadLogSettings();

    expect(loadedUi.updates).toEqual(defaults.updates);
    expect(loadedUi.ssh).toEqual(defaults.ssh);
    expect(loadedUi.reconnect).toEqual(defaults.reconnect);
    expect(loadedUi.sftp).toEqual(defaults.sftp);
    expect(loadedUi.fileManager).toEqual(defaults.fileManager);
    expect(loadedUi.storage).toEqual(defaults.storage);
    expect(loadedUi.performance).toEqual({
      hardwareAcceleration: true,
      webglEnabled: true,
      cacheEnabled: true,
      terminalPerfMonitor: false,
    });
    expect(loadedLogs).toEqual({
      level: "INFO",
      maxFileSize: 5242880,
      maxFiles: 5,
      compressOldLogs: true,
      cleanupIntervalDays: 7,
    });

    // Partial nested update preserves sibling keys
    expect(
      configService.saveUISettings({
        resourceMonitor: { displayMode: "trend" },
      }),
    ).toBe(true);
    expect(configService.loadUISettings().resourceMonitor).toEqual({
      displayMode: "trend",
      systemRefreshSeconds: 5,
      processRefreshSeconds: 15,
      maxVisibleProcesses: 50,
    });

    // Invalid bounds must fail AJV validation and leave disk untouched
    const beforeInvalid = fs.readFileSync(configService.mainConfigPath, "utf8");
    expect(
      configService.saveUISettings({ notificationDurationSeconds: 1 }),
    ).toBe(false);
    expect(configService.saveUISettings({ recentConnectionsLimit: 21 })).toBe(
      false,
    );
    expect(
      configService.saveUISettings({ ssh: { keepaliveIntervalSeconds: 2 } }),
    ).toBe(false);
    expect(configService.saveUISettings({ sftp: { parallelUploads: 9 } })).toBe(
      false,
    );
    expect(
      configService.saveUISettings({ fileManager: { maxPreviewSizeMB: 99 } }),
    ).toBe(false);
    expect(configService.saveLogSettings({ maxFiles: 51 })).toBe(false);
    expect(fs.readFileSync(configService.mainConfigPath, "utf8")).toBe(
      beforeInvalid,
    );

    // Legacy keys (cleanupInterval, imageSupported, prefetchEnabled) load cleanly
    const legacyDisk = JSON.parse(beforeInvalid);
    legacyDisk.logSettings = {
      level: "DEBUG",
      maxFileSize: 5242880,
      maxFiles: 12,
      compressOldLogs: false,
      cleanupInterval: 14,
      flushIntervalMs: 20,
      batchSize: 1,
    };
    legacyDisk.uiSettings.performance = {
      hardwareAcceleration: true,
      imageSupported: false,
      prefetchEnabled: false,
    };
    fs.writeFileSync(
      configService.mainConfigPath,
      JSON.stringify(legacyDisk),
      "utf8",
    );
    configService._configCache = null;

    const migratedLogs = configService.loadLogSettings();
    expect(migratedLogs.cleanupIntervalDays).toBe(14);
    expect(migratedLogs.cleanupInterval).toBeUndefined();
    expect(migratedLogs.maxFiles).toBe(12);
    expect(migratedLogs.compressOldLogs).toBe(false);

    const logDir = path.join(tempDir, "log");
    fs.mkdirSync(logDir, { recursive: true });
    const appLogPath = path.join(logDir, "app.log");
    const ts20d = new Date(Date.now() - 20 * 86400_000).toISOString();
    const ts10d = new Date(Date.now() - 10 * 86400_000).toISOString();
    const tsNow = new Date().toISOString();
    fs.writeFileSync(
      appLogPath,
      `[${ts20d}] [INFO] too-old\n[${ts10d}] [INFO] keep-within-14\n[${tsNow}] [INFO] fresh\n`,
      "utf8",
    );
    logger.initLogger(fakeApp);
    const cleanedLogText = fs.readFileSync(logger.getLogFilePath(), "utf8");
    expect(cleanedLogText).not.toContain("too-old");
    expect(cleanedLogText).toContain("keep-within-14");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fs.readFileSync(logger.getLogFilePath(), "utf8")).toContain(
      "older than 14 days.",
    );
    logger.updateLogConfig({ flushIntervalMs: 60000 });
  });

  it("wires command history, local shell allowlists, and ZMODEM save root", () => {
    commandHistoryService.initialize([]);
    commandHistoryService.configure({
      maxHistorySize: 100,
      minCommandLength: 5,
      suggestionsEnabled: true,
      defaultSuggestionLimit: 3,
    });
    expect(commandHistoryService.addCommand("lsla")).toBe(false);
    expect(commandHistoryService.addCommand("docker ps -a")).toBe(true);
    expect(commandHistoryService.addCommand("docker images")).toBe(true);
    expect(commandHistoryService.addCommand("docker logs app")).toBe(true);
    expect(commandHistoryService.addCommand("docker stats")).toBe(true);
    expect(commandHistoryService.getSuggestions("docker")).toHaveLength(3);

    commandHistoryService.configure({ suggestionsEnabled: false });
    expect(commandHistoryService.getSuggestions("docker")).toEqual([]);
    // Restore defaults for subsequent tests
    commandHistoryService.configure({
      maxHistorySize: 1000,
      minCommandLength: 3,
      suggestionsEnabled: true,
      defaultSuggestionLimit: 10,
    });

    // Local shell allowlist enforcement
    const winDefault = localTerminalConfig.resolveDefaultLocalShellConfig(
      "pwsh.exe",
      [{ name: "PowerShell", type: "powershell", executable: "pwsh.exe" }],
      { platform: "win32", env: {}, homeDirectory: "C:\\Users\\tester" },
    );
    expect(winDefault.command).toBe("pwsh.exe");

    const winBlocked = localTerminalConfig.resolveDefaultLocalShellConfig(
      "calc.exe",
      [{ name: "Command Prompt", type: "cmd", executable: "cmd.exe" }],
      { platform: "win32", env: {}, homeDirectory: "C:\\Users\\tester" },
    );
    expect(winBlocked.command).toBe("cmd.exe");

    const posixBlocked = localTerminalConfig.resolveDefaultLocalShellConfig(
      "/tmp/evil-shell",
      [],
      {
        platform: "linux",
        env: { SHELL: "/bin/bash" },
        homeDirectory: "/home/u",
      },
    );
    expect(posixBlocked.command).toBe("/bin/bash");

    // ZMODEM custom directory & fallback
    const service = new ZmodemTransferService();
    const customDir = path.join(tempDir, "zmodem-custom");
    configService.saveUISettings({ zmodem: { saveDirectory: customDir } });
    expect(service._getSaveRoot()).toBe(path.resolve(customDir));

    configService.saveUISettings({
      zmodem: { saveDirectory: "relative/path" },
    });
    const fallbackSaveRoot = service._getSaveRoot();
    expect(fallbackSaveRoot.endsWith(path.join(path.sep, "zmodem"))).toBe(true);
    expect(fallbackSaveRoot).not.toContain("relative");
  });

  it("wires SSH network profile, connection pool timeouts/recent limit, reconnect, latency, remote cache TTL, SFTP & storage", async () => {
    expect(
      configService.saveUISettings({
        recentConnectionsLimit: 12,
        resourceMonitor: {
          systemRefreshSeconds: 2,
          processRefreshSeconds: 5,
          maxVisibleProcesses: 100,
        },
        ssh: {
          keepaliveIntervalSeconds: 25,
          keepaliveCountMax: 12,
          readyTimeoutSeconds: 45,
          connectionTimeoutSeconds: 22,
          idleTimeoutMinutes: 90,
        },
        reconnect: {
          maxRetries: 4,
          initialDelayMs: 2500,
          totalTimeCapSeconds: 180,
          fastReconnectEnabled: false,
        },
        networkLatency: { checkIntervalSeconds: 0 },
        sftp: {
          parallelUploads: 2,
          parallelDownloads: 8,
          maxRetries: 4,
          sessionIdleTimeoutMinutes: 25,
        },
        storage: {
          fileCacheMaxMB: 256,
          fileCacheMaxAgeMinutes: 120,
          snapshotMaxPerFile: 10,
          snapshotRetentionDays: 7,
        },
        performance: {
          cacheEnabled: false,
          hardwareAcceleration: true,
          webglEnabled: true,
          terminalPerfMonitor: false,
        },
      }),
    ).toBe(true);

    // SSH network profile falls back to uiSettings.ssh while honoring connection overrides
    const globalProfile = resolveSshNetworkProfile({});
    expect(globalProfile.keepaliveInterval).toBe(25000);
    expect(globalProfile.keepaliveCountMax).toBe(12);
    expect(globalProfile.readyTimeout).toBe(45000);
    const customProfile = resolveSshNetworkProfile({ keepaliveInterval: 7000 });
    expect(customProfile.keepaliveInterval).toBe(7000);

    // BaseConnectionPool applies connection/idle timeouts and recent connections limit (up to 20, including 0)
    const pool = new BaseConnectionPool({ protocolType: "SSH" });
    expect(pool.config.connectionTimeout).toBe(22000);
    expect(pool.config.idleTimeout).toBe(90 * 60 * 1000);
    for (let i = 1; i <= 15; i++) {
      pool.recordLastConnection(`host-${i}:22:user`);
    }
    expect(pool.getLastConnections()).toHaveLength(12);
    configService.saveUISettings({ recentConnectionsLimit: 0 });
    expect(pool.getLastConnections()).toEqual([]);

    // ReconnectionManager applies uiSettings.reconnect
    const reconnectManager = new ReconnectionManager();
    expect(reconnectManager.config.maxRetries).toBe(4);
    expect(reconnectManager.config.initialDelay).toBe(2500);
    expect(reconnectManager.config.totalTimeCapMs).toBe(180000);
    expect(reconnectManager.config.fastReconnect.enabled).toBe(false);

    // NetworkLatencyService honors pause (0) & positive intervals
    const latency = new NetworkLatencyService();
    expect(latency.checkInterval).toBe(0);
    latency.setCheckIntervalSeconds(30);
    expect(latency.checkInterval).toBe(30000);
    expect(latency._getCheckIntervalForQuality("good")).toBe(30000);

    // Runtime sync applies SFTP, fileCache, and fileSnapshotStore
    fileCache.init(vi.fn(), fakeApp);
    fileSnapshotStore.init(vi.fn(), fakeApp);
    applyRuntimeUISettings(configService.loadUISettings());

    expect(sftpConfig.TRANSFER_CONFIG.PARALLEL_FILES_UPLOAD).toBe(2);
    expect(sftpConfig.TRANSFER_CONFIG.PARALLEL_FILES_DOWNLOAD).toBe(8);
    expect(sftpConfig.RETRY_CONFIG.MAX_RETRIES).toBe(4);
    expect(sftpConfig.RETRY_CONFIG.MAX_OPERATION_ATTEMPTS).toBe(5);
    expect(sftpConfig.SESSION_CONFIG.SESSION_IDLE_TIMEOUT).toBe(25 * 60 * 1000);

    // SftpSessionPool dynamic idle timeout
    const idleTimeoutFromPool = createSftpSessionPool({
      NATIVE_SFTP_SCHEMA_VERSION: 1,
      NATIVE_SFTP_SESSION_IDLE_TIMEOUT_MS: 30000,
      getIdleTimeoutMs: () => sftpConfig.SESSION_CONFIG.SESSION_IDLE_TIMEOUT,
      spawnCoreService: vi.fn(),
      logToFile: vi.fn(),
      recordNativeSidecarNetworkPath: vi.fn(),
      normalizeErrorMessage: (e) => String(e),
      protocol: {},
      configResolver: {},
      clientApi: {},
      buildCloseSessionRequest: () => ({}),
    });
    expect(idleTimeoutFromPool).toBeTruthy();

    expect(fileCache.settings.enabled).toBe(false);
    expect(fileCache.settings.maxTotalBytes).toBe(256 * 1024 * 1024);
    expect(fileCache.settings.maxAgeMs).toBe(120 * 60 * 1000);
    expect(fileSnapshotStore.settings.maxEntries).toBe(10);
    expect(fileSnapshotStore.settings.maxAgeMs).toBe(7 * 24 * 60 * 60 * 1000);

    // Reset SFTP & cache defaults cleanly
    applyRuntimeUISettings(uiDefaults.createDefaultUISettings());
  });

  it("wires remote system cache TTL, renderer snapshot, NotificationProvider, directory cache, and terminal options", async () => {
    // remote-system cache TTL respects 2s refresh setting
    configService.saveUISettings({
      resourceMonitor: { systemRefreshSeconds: 2, processRefreshSeconds: 5 },
    });
    const remoteSystem = require("../../src/main/system-info/remote-system.js");
    let execCount = 0;
    const fakeClient = {
      _sock: { destroyed: false, writable: true },
      exec(cmd, cb) {
        execCount += 1;
        const stream = {
          on(event, fn) {
            if (event === "data") {
              setTimeout(() => fn(Buffer.from('PRETTY_NAME="Ubuntu"\n')), 0);
            }
            if (event === "close") {
              setTimeout(() => fn(0), 1);
            }
            return stream;
          },
          stderr: { on: () => stream },
        };
        cb(null, stream);
      },
    };
    await remoteSystem.getRemoteSystemInfo(fakeClient);
    const firstExecs = execCount;
    await remoteSystem.getRemoteSystemInfo(fakeClient);
    expect(execCount).toBe(firstExecs); // cached inside 1000ms window

    // directoryListing cache & TTL = 0 bypass
    const dirCache = new Map();
    storeCachedDirectory(dirCache, "/var", [{ name: "log" }], false);
    expect(dirCache.size).toBe(0);
    storeCachedDirectory(dirCache, "/var", [{ name: "log" }], true);
    expect(getCachedDirectory(dirCache, "/var", 0)).toBeNull();
    expect(getCachedDirectory(dirCache, "/var", 10000)).toEqual([
      { name: "log" },
    ]);

    // Terminal UI options + perf monitor
    const fakeTerm = { options: {} };
    applyTerminalUiOptionsToInstance(fakeTerm, {
      cursorStyle: "bar",
      cursorBlink: false,
      letterSpacing: 1.5,
      fontWeightBold: 800,
      copyOnSelect: true,
      rightClickSelectsWord: true,
      middleClickPaste: false,
      macOptionIsMeta: true,
    });
    expect(fakeTerm.options).toEqual(
      expect.objectContaining({
        cursorStyle: "bar",
        cursorBlink: false,
        letterSpacing: 1.5,
        fontWeightBold: 800,
        copyOnSelect: true,
        rightClickSelectsWord: true,
        macOptionIsMeta: true,
      }),
    );
    expect(fakeTerm.__simpleShellMiddleClickPaste).toBe(false);
    expect(shouldEnableTerminalPerfMonitor(true)).toBe(true);

    // NotificationProvider picks up notificationDurationSeconds & live settingsChanged
    window.terminalAPI = {
      loadUISettings: vi.fn(async () => ({
        notificationDurationSeconds: 9,
      })),
    };
    const hook = await renderHook(
      () => useNotification(),
      {},
      NotificationProvider,
    );
    await act(async () => {});
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("settingsChanged", {
          detail: { notificationDurationSeconds: 3 },
        }),
      );
      hook.current.showSuccess("Saved");
    });
    expect(document.body.textContent).toContain("Saved");
    await hook.unmount();

    // loadSettingsSnapshot picks up INFO log level fallback and new Goal 4 defaults
    window.terminalAPI = {
      loadUISettings: vi.fn(async () => ({})),
      loadLogSettings: vi.fn(async () => ({})),
    };
    const snapshot = await loadSettingsSnapshot();
    expect(snapshot.logLevel).toBe("INFO");
    expect(snapshot.maxFiles).toBe(5);
    expect(snapshot.compressOldLogs).toBe(true);
    expect(snapshot.webglEnabled).toBe(true);
    expect(snapshot.terminalPerfMonitor).toBe(false);
    expect("imageSupported" in snapshot).toBe(false);
    expect("prefetchEnabled" in snapshot).toBe(false);
    expect(snapshot.fileManagerMaxPreviewSizeMB).toBe(10);
  });

  it("renders Settings with Connection & SFTP tab, removes dead toggles, decouples WebGL, and commits new settings", async () => {
    window.terminalAPI = {
      loadUISettings: vi.fn(async () => ({
        language: "en-US",
        editorFont: "system",
        performance: {
          hardwareAcceleration: true,
          webglEnabled: true,
          cacheEnabled: true,
          terminalPerfMonitor: false,
        },
      })),
      saveUISettings: vi.fn(async () => ({ success: true })),
      loadLogSettings: vi.fn(async () => ({
        level: "INFO",
        maxFileSize: 5 * 1024 * 1024,
        maxFiles: 8,
        compressOldLogs: false,
        cleanupIntervalDays: 7,
      })),
      saveLogSettings: vi.fn(async () => ({ success: true })),
      getErrorReportingSettings: vi.fn(async () => ({
        success: true,
        settings: { enabled: false },
      })),
      saveErrorReportingSettings: vi.fn(async () => ({ success: true })),
      getCredentialSecurityStatus: vi.fn(async () => ({
        success: true,
        status: { masterPasswordEnabled: false },
      })),
      detectLocalTerminals: vi.fn(async () => [
        {
          id: "pwsh",
          name: "PowerShell",
          type: "powershell",
          executable: "pwsh.exe",
        },
      ]),
    };

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          createElement(
            NotificationProvider,
            null,
            createElement(Settings, { open: true, onClose: vi.fn() }),
          ),
        );
      });
      await act(async () => {});

      const connTab = [
        ...document.querySelectorAll('button,[role="button"]'),
      ].find((el) => el.textContent === "settings.connectionSftp.title");
      expect(connTab).toBeTruthy();

      const perfTab = [
        ...document.querySelectorAll('button,[role="button"]'),
      ].find((el) => el.textContent === "settings.performanceSettings");
      await act(async () => perfTab.click());

      const findToggleByLabel = (labelText) =>
        [...document.querySelectorAll("label")]
          .find((label) => label.textContent?.includes(labelText))
          ?.querySelector('input[type="checkbox"]') ?? null;

      expect(findToggleByLabel("settings.enableImageSupport")).toBeNull();
      expect(findToggleByLabel("settings.enablePrefetch")).toBeNull();
      const webglCheckbox = findToggleByLabel("settings.enableWebgl");
      const gpuCheckbox = findToggleByLabel(
        "settings.enableHardwareAcceleration",
      );
      expect(webglCheckbox).toBeTruthy();
      expect(
        findToggleByLabel("settings.enableTerminalPerfMonitor"),
      ).toBeTruthy();

      // Decoupled WebGL: disabling hardwareAcceleration disables WebGL toggle without losing state
      expect(webglCheckbox.disabled).toBe(false);
      expect(webglCheckbox.checked).toBe(true);
      await act(async () => gpuCheckbox.click());
      const webglDisabled = findToggleByLabel("settings.enableWebgl");
      expect(webglDisabled.disabled).toBe(true);
      expect(webglDisabled.checked).toBe(false);
      await act(async () =>
        findToggleByLabel("settings.enableHardwareAcceleration").click(),
      );
      const webglRestored = findToggleByLabel("settings.enableWebgl");
      expect(webglRestored.disabled).toBe(false);
      expect(webglRestored.checked).toBe(true);

      const saveBtn = [...document.querySelectorAll("button")].find(
        (el) => el.textContent === "settings.save",
      );
      await act(async () => saveBtn.click());

      expect(window.terminalAPI.saveUISettings).toHaveBeenCalledWith(
        expect.objectContaining({
          updates: { autoCheckOnStartup: false, reminderIntervalHours: 4 },
          notificationDurationSeconds: 5,
          recentConnectionsLimit: 5,
          terminalCursorStyle: "block",
          defaultLocalShell: "auto",
          zmodem: { saveDirectory: "" },
          ssh: expect.objectContaining({ keepaliveIntervalSeconds: 10 }),
          reconnect: expect.objectContaining({ maxRetries: 10 }),
          networkLatency: { checkIntervalSeconds: 60 },
          sftp: expect.objectContaining({ parallelUploads: 4 }),
          fileManager: expect.objectContaining({ maxPreviewSizeMB: 10 }),
          storage: expect.objectContaining({ fileCacheMaxMB: 128 }),
        }),
      );
      expect(window.terminalAPI.saveLogSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          maxFiles: 8,
          compressOldLogs: false,
        }),
      );
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
