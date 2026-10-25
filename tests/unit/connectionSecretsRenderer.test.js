import { describe, expect, it } from "vitest";
import { mergeSavedConnectionConfig } from "../../src/shared/connectionConfigSync.js";
import { buildConnectionPayloadFromForm } from "../../src/renderer/features/connections/lib/connectionForm.js";

describe("renderer works with redacted connection secrets", () => {
  const saved = {
    id: "server",
    type: "connection",
    host: "example.test",
    username: "admin",
    authType: "password",
    password: "",
    hasPassword: true,
    credentialRevision: "rev-1",
    proxy: {
      type: "http",
      host: "proxy.test",
      port: 8080,
      password: "",
      hasPassword: true,
    },
  };

  it("drops a session password once the saved password revision changes", () => {
    const session = { ...saved, tabId: "tab-1", password: "typed" };
    const renamed = mergeSavedConnectionConfig(session, saved, {
      ...saved,
      name: "Renamed",
    });
    expect(renamed.password).toBe("typed");

    const rotated = mergeSavedConnectionConfig(session, saved, {
      ...saved,
      credentialRevision: "rev-2",
    });
    expect(rotated.credentialRevision).toBe("rev-2");
    expect(rotated.password).toBe("");
  });

  it("asks the main process to keep an untouched proxy password", () => {
    const formData = {
      protocol: "ssh",
      name: "Server",
      host: "example.test",
      port: 22,
      username: "admin",
      authType: "password",
      password: "********",
      passwordMasked: true,
      passwordTouched: false,
      enableProxy: true,
      proxyType: "http",
      proxyHost: "proxy.test",
      proxyPort: 8080,
      proxyPassword: "",
      proxyPasswordTouched: false,
      proxyUseDefault: false,
    };
    const payload = buildConnectionPayloadFromForm({
      formData,
      selectedItem: saved,
      dialogMode: "edit",
    });
    expect(payload._preservePassword).toBe(true);
    expect(payload.password).toBe("");
    expect(payload.proxy.hasPassword).toBe(true);
    expect(payload.proxy.password).toBeUndefined();

    const retyped = buildConnectionPayloadFromForm({
      formData: {
        ...formData,
        proxyPassword: "new-proxy",
        proxyPasswordTouched: true,
      },
      selectedItem: saved,
      dialogMode: "edit",
    });
    expect(retyped.proxy.password).toBe("new-proxy");
    expect(retyped.proxy.hasPassword).toBeUndefined();
  });
});
