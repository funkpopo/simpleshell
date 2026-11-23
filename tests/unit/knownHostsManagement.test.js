// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import SecuritySettings from "../../src/renderer/features/settings/sections/SecuritySettings.jsx";

const require = createRequire(import.meta.url);
const SSHAuthenticationService = require("../../src/main/connection/sshAuthenticationService");
const SshKeyHandlers = require("../../src/main/ipc/handlers/sshKeyHandlers");
const {
  IPC_REQUEST_CHANNELS,
} = require("../../src/shared/contracts/ipc/channels");

const { translate, notifications } = vi.hoisted(() => ({
  translate: (key, options) => {
    if (options?.host) return `${key}:${options.host}`;
    if (options?.count !== undefined) return `${key}:${options.count}`;
    return key;
  },
  notifications: { showError: vi.fn(), showSuccess: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate, i18n: { language: "en-US" } }),
}));
vi.mock("../../src/renderer/i18n/i18n", () => ({
  default: { t: (key) => key },
  changeLanguage: vi.fn(),
}));
vi.mock("../../src/renderer/shared/notifications/NotificationContext", () => ({
  useNotification: () => notifications,
}));

function createFakeConfigService(initialKnownHosts = {}) {
  const store = { sshKnownHosts: { ...initialKnownHosts } };
  return {
    get: vi.fn((key) => store[key]),
    set: vi.fn((key, val) => {
      store[key] = val;
      return true;
    }),
    snapshot: () => store.sshKnownHosts,
  };
}

let tempDirs = [];
let mounted = [];

function createTempKnownHosts(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "simpleshell-kh-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "known_hosts");
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

async function mount(Component, props) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => {
    root.render(createElement(Component, props));
  });
  return host;
}

function setInputValue(inputElement, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
    inputElement,
    value,
  );
  inputElement.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  while (mounted.length > 0) {
    const { root, host } = mounted.pop();
    await act(async () => root.unmount());
    host.remove();
  }
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("SSH known_hosts backend service & IPC handlers", () => {
  it("lists stored and read-only system known_hosts with accurate SHA-256 fingerprints", async () => {
    const rawKey = Buffer.from("ssh-ed25519-sample-public-key-bytes");
    const base64Key = rawKey.toString("base64");
    const expectedFp = `SHA256:${crypto
      .createHash("sha256")
      .update(rawKey)
      .digest("base64")
      .replace(/=+$/, "")}`;

    const sysPath = createTempKnownHosts(
      [
        "# comment",
        `github.com,192.30.255.113 ssh-ed25519 ${base64Key}`,
        `[gitlab.internal]:2222 ssh-ed25519 ${base64Key}`,
        `@revoked revoked.host ssh-ed25519 ${base64Key}`,
        `!negated.host ssh-ed25519 ${base64Key}`,
      ].join("\n"),
    );

    const configService = createFakeConfigService({
      "prod.example.com:22": {
        fingerprint: "SHA256:prodFp123",
        updatedAt: "2026-01-10T08:00:00.000Z",
      },
      "[2001:db8::1]:2222": {
        fingerprint: "SHA256:v6Fp456",
        updatedAt: "2026-01-12T08:00:00.000Z",
      },
      "2001:db8:0:0:0:0:0:1:22": {
        fingerprint: "SHA256:v6FullFp",
        updatedAt: "2026-01-09T08:00:00.000Z",
      },
    });

    const result = await SSHAuthenticationService.listKnownHosts({
      configService,
      systemKnownHostsPath: sysPath,
    });

    expect(result.success).toBe(true);
    expect(result.systemHostsCount).toBe(3);

    const appEntries = result.hosts.filter((h) => h.source === "simpleshell");
    expect(appEntries.map((h) => h.hostKey)).toEqual([
      "[2001:db8::1]:2222",
      "prod.example.com:22",
      "2001:db8:0:0:0:0:0:1:22",
    ]);
    expect(appEntries[0]).toMatchObject({
      host: "2001:db8::1",
      port: 2222,
      editable: true,
    });
    expect(appEntries[2]).toMatchObject({
      host: "2001:db8:0:0:0:0:0:1",
      port: 22,
      editable: true,
    });

    const systemEntries = result.hosts.filter((h) => h.source === "system");
    expect(systemEntries).toHaveLength(3);
    expect(systemEntries[0]).toMatchObject({
      host: "github.com",
      port: 22,
      fingerprint: expectedFp,
      keyType: "ssh-ed25519",
      source: "system",
      editable: false,
    });
    expect(systemEntries[2]).toMatchObject({
      host: "gitlab.internal",
      port: 2222,
      fingerprint: expectedFp,
      editable: false,
    });
  });

  it("revokes single host, clears stored hosts, evicts active service memory, and validates input", async () => {
    const configService = createFakeConfigService({
      "alpha.test:22": {
        fingerprint: "SHA256:alpha",
        updatedAt: "2026-01-05T00:00:00.000Z",
      },
      "beta.test:2222": {
        fingerprint: "SHA256:beta",
        updatedAt: "2026-01-06T00:00:00.000Z",
      },
    });

    const authService = new SSHAuthenticationService({
      getMainWindow: () => null,
      configService,
      log: vi.fn(),
    });
    authService._ensureKnownHostsLoaded();
    authService.sessionTrustedHosts.set("alpha.test:22", {
      fingerprint: "SHA256:alpha",
      scope: "permanent",
    });
    authService.sessionTrustedHosts.set("ephemeral.test:22", {
      fingerprint: "SHA256:ephemeral",
      scope: "session",
    });

    expect(
      authService._checkHostKey("alpha.test", 22, "SHA256:alpha").known,
    ).toBe(true);

    const handlers = new SshKeyHandlers({
      configService,
      systemKnownHostsPath: null,
    });
    const registeredChannels = handlers.getHandlers().map((h) => h.channel);
    expect(registeredChannels).toEqual(
      expect.arrayContaining([
        IPC_REQUEST_CHANNELS.SSH_KNOWN_HOSTS_LIST,
        IPC_REQUEST_CHANNELS.SSH_KNOWN_HOSTS_REMOVE,
        IPC_REQUEST_CHANNELS.SSH_KNOWN_HOSTS_CLEAR,
      ]),
    );

    await expect(
      handlers.removeKnownHost({}, { hostKey: "   " }),
    ).rejects.toThrow(/Host key is required/i);
    await expect(handlers.removeKnownHost({}, null)).rejects.toThrow(
      /Host key is required/i,
    );

    const removeRes = await handlers.removeKnownHost(
      {},
      { hostKey: "alpha.test:22" },
    );
    expect(removeRes).toEqual({ success: true, removed: true });
    expect(configService.snapshot()).toEqual({
      "beta.test:2222": {
        fingerprint: "SHA256:beta",
        updatedAt: "2026-01-06T00:00:00.000Z",
      },
    });
    // Evicted immediately from active authentication cache
    expect(
      authService._checkHostKey("alpha.test", 22, "SHA256:alpha").known,
    ).toBe(false);

    const clearRes = await handlers.clearKnownHosts();
    expect(clearRes).toEqual({ success: true, clearedCount: 1 });
    expect(configService.snapshot()).toEqual({});
    expect(
      authService._checkHostKey("beta.test", 2222, "SHA256:beta").known,
    ).toBe(false);
    // Ephemeral session-only trust survives clearing stored hosts
    expect(
      authService._checkHostKey("ephemeral.test", 22, "SHA256:ephemeral").known,
    ).toBe(true);
  });

  it("throws when persistence returns false", () => {
    const failingConfig = {
      get: () => ({ "a.test:22": { fingerprint: "SHA256:a" } }),
      set: () => false,
    };
    expect(() =>
      SSHAuthenticationService.removeStoredKnownHost({
        configService: failingConfig,
        hostKey: "a.test:22",
      }),
    ).toThrow(/Failed to persist/i);
    expect(() =>
      SSHAuthenticationService.clearStoredKnownHosts({
        configService: failingConfig,
      }),
    ).toThrow(/Failed to clear/i);
  });
});

describe("SecuritySettings Known Hosts Manager UI", () => {
  it("renders searchable table, revokes single host with confirmation, clears all, and refreshes immediately", async () => {
    let dbHosts = [
      {
        id: "simpleshell:prod.example.com:22",
        hostKey: "prod.example.com:22",
        host: "prod.example.com",
        port: 22,
        fingerprint: "SHA256:prodFingerprint111",
        updatedAt: "2026-01-10T12:00:00.000Z",
        source: "simpleshell",
        editable: true,
      },
      {
        id: "simpleshell:stage.example.com:2222",
        hostKey: "stage.example.com:2222",
        host: "stage.example.com",
        port: 2222,
        fingerprint: "SHA256:stageFingerprint222",
        updatedAt: "2026-01-09T12:00:00.000Z",
        source: "simpleshell",
        editable: true,
      },
      {
        id: "system:1:0:github.com:22",
        hostKey: "github.com:22",
        host: "github.com",
        port: 22,
        fingerprint: "SHA256:systemGithubKey333",
        keyType: "ssh-ed25519",
        updatedAt: "2026-01-01T00:00:00.000Z",
        source: "system",
        editable: false,
      },
    ];

    window.terminalAPI = {
      listKnownHosts: vi.fn(async () => ({
        success: true,
        hosts: [...dbHosts],
      })),
      removeKnownHost: vi.fn(async (hostKey) => {
        dbHosts = dbHosts.filter((item) => item.hostKey !== hostKey);
        return { success: true, removed: true };
      }),
      clearKnownHosts: vi.fn(async () => {
        const before = dbHosts.length;
        dbHosts = dbHosts.filter((item) => item.source === "system");
        return { success: true, clearedCount: before - dbHosts.length };
      }),
    };

    const host = await mount(SecuritySettings, {
      initialValues: {
        masterPasswordEnabled: false,
        initialMasterPasswordEnabled: false,
        masterPassword: "",
        confirmMasterPassword: "",
      },
      open: true,
    });

    // Wait for initial async listKnownHosts() state update
    await act(async () => {
      await Promise.resolve();
    });

    expect(window.terminalAPI.listKnownHosts).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("prod.example.com:22");
    expect(host.textContent).toContain("SHA256:prodFingerprint111");
    expect(host.textContent).toContain("github.com:22");
    expect(host.textContent).toContain(
      "settings.security.knownHosts.sourceApp",
    );
    expect(host.textContent).toContain(
      "settings.security.knownHosts.sourceSystem",
    );

    // Search filters rows by fingerprint or host
    const searchInput = host.querySelector(
      'input[aria-label="settings.security.knownHosts.searchPlaceholder"]',
    );
    expect(searchInput).toBeTruthy();
    await act(async () => {
      setInputValue(searchInput, "prodFingerprint111");
    });
    expect(host.textContent).toContain("prod.example.com:22");
    expect(host.textContent).not.toContain("stage.example.com:2222");
    expect(host.textContent).not.toContain("github.com:22");

    // Clear search to show all 3
    await act(async () => {
      setInputValue(searchInput, "");
    });
    expect(host.textContent).toContain("stage.example.com:2222");

    // Click Revoke on first editable row (prod.example.com:22) -> confirms -> refreshes immediately
    const revokeBtns = [...host.querySelectorAll("button")].filter(
      (btn) => btn.textContent === "settings.security.knownHosts.revoke",
    );
    expect(revokeBtns).toHaveLength(2); // only app-trusted rows have Revoke
    await act(async () => {
      revokeBtns[0].click();
    });

    const dialogRevokeBtn = [
      ...document.querySelectorAll('[role="dialog"] button'),
    ].find((btn) => btn.textContent === "settings.security.knownHosts.revoke");
    expect(dialogRevokeBtn).toBeTruthy();
    await act(async () => {
      dialogRevokeBtn.click();
    });

    expect(window.terminalAPI.removeKnownHost).toHaveBeenCalledWith(
      "prod.example.com:22",
    );
    expect(window.terminalAPI.listKnownHosts).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain("prod.example.com:22");
    expect(host.textContent).toContain("stage.example.com:2222");

    // Click Clear All -> confirms -> removes remaining app-trusted host, keeps system host
    const clearAllBtn = [...host.querySelectorAll("button")].find((btn) =>
      btn.textContent.includes("settings.security.knownHosts.clearAll"),
    );
    expect(clearAllBtn.disabled).toBe(false);
    await act(async () => {
      clearAllBtn.click();
    });

    const dialogClearBtn = [
      ...document.querySelectorAll('[role="dialog"] button'),
    ].find(
      (btn) => btn.textContent === "settings.security.knownHosts.clearAll",
    );
    expect(dialogClearBtn).toBeTruthy();
    await act(async () => {
      dialogClearBtn.click();
    });

    expect(window.terminalAPI.clearKnownHosts).toHaveBeenCalledOnce();
    expect(window.terminalAPI.listKnownHosts).toHaveBeenCalledTimes(3);
    expect(host.textContent).not.toContain("stage.example.com:2222");
    expect(host.textContent).toContain("github.com:22");
    expect(clearAllBtn.disabled).toBe(true);
  });
});
