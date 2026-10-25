import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import config from "../../src/main/settings/configService.js";
import cryptoApi from "../../src/main/utils/crypto.js";

let directory;
beforeEach(() => {
  directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "simpleshell-config-domains-"),
  );
  const crypto = {
    ...cryptoApi,
    SECURITY_MODE_SAFE_STORAGE: "safeStorage",
    SECURITY_MODE_MASTER_PASSWORD: "masterPassword",
    SECURITY_MODE_LEGACY_RANDOM_KEY: "legacyRandomKey",
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
    encryptText: (value) =>
      value ? "sealed:" + Buffer.from(value).toString("base64") : "",
    decryptText: (value) =>
      value.startsWith("sealed:")
        ? Buffer.from(value.slice(7), "base64").toString()
        : null,
  };
  expect(
    config.init(
      {
        isPackaged: true,
        getPath: (name) =>
          name === "exe" ? path.join(directory, "old", "app.exe") : directory,
      },
      { logToFile: vi.fn() },
      crypto,
    ),
  ).toBe(true);
  config.initializeMainConfig();
});
afterEach(() => {
  const target = path.resolve(directory);
  if (!target.startsWith(path.resolve(os.tmpdir()) + path.sep))
    throw new Error("Unexpected config test directory");
  fs.rmSync(target, { recursive: true, force: true });
});

describe("configuration domains share one disk transaction boundary", () => {
  it("round trips connection and AI secrets while partial settings saves preserve other sections", () => {
    expect(
      config.saveConnections([
        {
          id: "server",
          type: "connection",
          name: "Server",
          host: "example.test",
          username: "admin",
          password: "private-value",
        },
      ]),
    ).toBe(true);
    expect(
      config.saveAISettings({
        configs: [{ id: "api", name: "API", apiKey: "provider-value" }],
        current: null,
      }),
    ).toBe(true);
    expect(config.saveUISettings({ fontSize: 16 })).toBe(true);
    const disk = fs.readFileSync(config.mainConfigPath, "utf8");
    expect(disk).not.toContain("private-value");
    expect(disk).not.toContain("provider-value");
    expect(config.loadConnections()[0].password).toBe("private-value");
    expect(config.loadAISettings().configs[0].apiKey).toBe("provider-value");
    expect(config.loadUISettings().fontSize).toBe(16);
    config._configCache = null;
    expect(config.loadConnections()[0].password).toBe("private-value");
  });
  it("rejects an invalid section without changing the serialized file or another section", () => {
    expect(config.saveUISettings({ fontSize: 16 })).toBe(true);
    const before = fs.readFileSync(config.mainConfigPath, "utf8");
    expect(config.saveUISettings({ fontSize: "invalid" })).toBe(false);
    expect(fs.readFileSync(config.mainConfigPath, "utf8")).toBe(before);
    expect(config.loadUISettings().fontSize).toBe(16);
  });
});

describe("connection secrets stay in the main process", () => {
  const savedConnection = () => ({
    id: "server",
    type: "connection",
    name: "Server",
    host: "example.test",
    username: "admin",
    authType: "password",
    password: "private-value",
    proxy: {
      type: "http",
      host: "proxy.test",
      port: 8080,
      username: "proxy-user",
      password: "proxy-value",
    },
  });

  it("encrypts proxy passwords at rest and still reads legacy plaintext", () => {
    expect(config.saveConnections([savedConnection()])).toBe(true);
    const disk = fs.readFileSync(config.mainConfigPath, "utf8");
    expect(disk).not.toContain("proxy-value");
    expect(config.loadConnections()[0].proxy.password).toBe("proxy-value");

    const raw = JSON.parse(disk);
    raw.connections[0].proxy.password = "legacy-plain";
    fs.writeFileSync(config.mainConfigPath, JSON.stringify(raw), "utf8");
    config._configCache = null;
    expect(config.loadConnections()[0].proxy.password).toBe("legacy-plain");
  });

  it("redacts renderer payloads and preserves secrets when redacted items are saved back", async () => {
    const { redactConnectionSecrets } =
      await import("../../src/main/settings/connectionSecrets.js");
    expect(config.saveConnections([savedConnection()])).toBe(true);

    const [redacted] = redactConnectionSecrets(config.loadConnections());
    expect(JSON.stringify(redacted)).not.toContain("private-value");
    expect(JSON.stringify(redacted)).not.toContain("proxy-value");
    expect(redacted.hasPassword).toBe(true);
    expect(redacted.proxy.hasPassword).toBe(true);
    expect(redacted.credentialRevision).toMatch(/^[a-f0-9]{16}$/);

    // 例如拖拽排序：渲染进程把整棵（已清空密钥的）树原样存回
    expect(config.saveConnections([{ ...redacted, name: "Renamed" }])).toBe(
      true,
    );
    const [reloaded] = config.loadConnections();
    expect(reloaded.name).toBe("Renamed");
    expect(reloaded.password).toBe("private-value");
    expect(reloaded.proxy.password).toBe("proxy-value");
    expect(reloaded.hasPassword).toBeUndefined();
    expect(reloaded.proxy.hasPassword).toBeUndefined();
    expect(redactConnectionSecrets([reloaded])[0].credentialRevision).toBe(
      redacted.credentialRevision,
    );
  });

  it("an explicitly cleared password is not resurrected", () => {
    expect(config.saveConnections([savedConnection()])).toBe(true);
    expect(
      config.saveConnections([
        { ...savedConnection(), password: "", proxy: null },
      ]),
    ).toBe(true);
    const [reloaded] = config.loadConnections();
    expect(reloaded.password).toBe("");
    expect(reloaded.proxy).toBeNull();
  });

  it("hydrates redacted renderer configs by connection id before connecting", async () => {
    const { hydrateConnectionSecrets, redactConnectionSecrets } =
      await import("../../src/main/settings/connectionSecrets.js");
    expect(config.saveConnections([savedConnection()])).toBe(true);
    const [redacted] = redactConnectionSecrets(config.loadConnections());

    const hydrated = hydrateConnectionSecrets(
      { ...redacted, tabId: "tab-1" },
      config,
    );
    expect(hydrated.password).toBe("private-value");
    expect(hydrated.proxy.password).toBe("proxy-value");
    expect(hydrated.tabId).toBe("tab-1");
    expect(hydrated.hasPassword).toBeUndefined();
    expect(hydrated.credentialRevision).toBeUndefined();
    expect(hydrated.proxy.hasPassword).toBeUndefined();

    // 会话内输入的密码优先于已保存密码
    expect(
      hydrateConnectionSecrets({ ...redacted, password: "typed" }, config)
        .password,
    ).toBe("typed");
    // 未知连接不补齐，由主进程照常弹出认证
    expect(
      hydrateConnectionSecrets({ ...redacted, id: "unknown" }, config).password,
    ).toBe("");
  });

  it("clearing credentials also removes proxy passwords", () => {
    expect(config.saveConnections([savedConnection()])).toBe(true);
    config.clearLocalConfigData({ sections: ["credentials"] });
    const disk = fs.readFileSync(config.mainConfigPath, "utf8");
    expect(disk).not.toContain("sealed:");
    const [reloaded] = config.loadConnections();
    expect(reloaded.password ?? "").toBe("");
    expect(reloaded.proxy.password ?? "").toBe("");
    expect(reloaded.proxy.host).toBe("proxy.test");
  });
});
