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
