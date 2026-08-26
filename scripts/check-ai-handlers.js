const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const HANDLER_PATH = path.join(
  ROOT,
  "src",
  "core",
  "ipc",
  "handlers",
  "aiHandlers.js",
);
const CONFIG_SERVICE_PATH = path.join(
  ROOT,
  "src",
  "services",
  "configService.js",
);

const clone = (value) => JSON.parse(JSON.stringify(value));

function createHandler(initialSettings) {
  let settings = clone(initialSettings);
  const savedSettings = [];
  const appliedProxies = [];
  const configService = {
    loadAISettings: () => clone(settings),
    saveAISettings: (nextSettings) => {
      settings = clone(nextSettings);
      savedSettings.push(clone(nextSettings));
      return true;
    },
  };
  const workerManager = {
    updateAIProxy: (proxy) => appliedProxies.push(clone(proxy)),
  };
  const logger = { logToFile: () => {} };
  const mainI18n = {
    t: (key) => key,
    getUiLanguage: () => "en-US",
  };
  const originalLoad = Module._load;
  const normalizeRequest = (request) => request.replaceAll("\\", "/");

  Module._load = function load(request, parent, isMain) {
    const normalizedRequest = normalizeRequest(request);
    if (normalizedRequest.endsWith("services/configService")) {
      return configService;
    }
    if (normalizedRequest.endsWith("utils/logger")) {
      return logger;
    }
    if (normalizedRequest.endsWith("workers/aiWorkerManager")) {
      return workerManager;
    }
    if (normalizedRequest.endsWith("shared/mainI18n")) {
      return mainI18n;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[require.resolve(HANDLER_PATH)];
  try {
    const AIHandlers = require(HANDLER_PATH);
    return {
      handler: new AIHandlers(),
      getSettings: () => clone(settings),
      savedSettings,
      appliedProxies,
    };
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(HANDLER_PATH)];
  }
}

async function run() {
  const ConfigService = require(CONFIG_SERVICE_PATH);
  const configService = ConfigService;
  configService.crypto = {
    encryptText: (value) => `enc:${value}`,
    decryptText: (value) =>
      value.startsWith("enc:") ? value.slice("enc:".length) : null,
  };
  configService._isCredentialStoreLocked = () => false;
  configService._log = () => {};

  const encryptedSettings = configService._processAISettingsForSave({
    proxyConfig: {
      enabled: true,
      host: "proxy",
      port: 8080,
      password: "secret",
    },
  });
  assert.equal(encryptedSettings.proxyConfig.password, "enc:secret");
  assert.equal(
    configService._processAISettingsForLoad(encryptedSettings).proxyConfig
      .password,
    "secret",
  );
  assert.equal(
    configService._processAISettingsForLoad({
      proxyConfig: {
        enabled: true,
        host: "proxy",
        port: 8080,
        password: "legacy-secret",
      },
    }).proxyConfig.password,
    "",
    "plaintext proxy credentials must not be accepted",
  );

  const harness = createHandler({
    configs: [],
    current: null,
    proxyConfig: {
      enabled: true,
      type: "http",
      host: "127.0.0.1",
      port: 7890,
      username: "proxy-user",
      password: "stored-password",
    },
  });
  const { handler } = harness;

  const safeSettings = handler._toRendererSafeSettings(harness.getSettings());
  assert.equal(safeSettings.proxyConfig.password, "");
  assert.equal(safeSettings.proxyConfig.hasProxyPassword, true);

  await handler.saveSettings(null, {
    ...safeSettings,
    windowSize: { width: 600, height: 700 },
  });
  assert.equal(
    harness.getSettings().proxyConfig.password,
    "stored-password",
    "generic AI settings saves must preserve masked proxy passwords",
  );

  const directSave = await handler.saveProxyConfig(null, {
    enabled: true,
    type: "http",
    host: "127.0.0.1",
    port: 7891,
    username: "proxy-user",
    password: "",
    hasProxyPassword: true,
  });
  assert.equal(directSave, true);
  assert.equal(harness.getSettings().proxyConfig.port, 7891);
  assert.equal(harness.getSettings().proxyConfig.password, "stored-password");
  assert.deepEqual(harness.appliedProxies.at(-1), {
    type: "http",
    host: "127.0.0.1",
    port: 7891,
    username: "proxy-user",
    password: "stored-password",
  });

  await handler.saveProxyConfig(null, {
    enabled: true,
    type: "https",
    host: "proxy.example.test",
    port: 8443,
    username: "proxy-user",
    password: " pass with spaces ",
  });
  assert.equal(
    harness.getSettings().proxyConfig.password,
    " pass with spaces ",
    "proxy passwords must not be trimmed",
  );
  assert.equal(harness.getSettings().proxyConfig.type, "https");

  const beforeInvalidSave = harness.getSettings();
  assert.equal(
    await handler.saveProxyConfig(null, {
      enabled: true,
      type: "http",
      host: "",
      port: 7890,
    }),
    false,
  );
  assert.deepEqual(
    harness.getSettings(),
    beforeInvalidSave,
    "invalid proxy configuration must not be persisted",
  );

  assert.equal(
    await handler.saveProxyConfig(null, {
      enabled: true,
      type: "http",
      host: "127.0.0.1",
      port: 65536,
    }),
    false,
  );
  assert.deepEqual(harness.getSettings(), beforeInvalidSave);

  assert.equal(
    await handler.saveProxyConfig(null, {
      enabled: false,
      type: "http",
      host: "",
      port: 0,
      password: "",
    }),
    true,
  );
  assert.equal(harness.getSettings().proxyConfig.enabled, false);
  assert.equal(harness.getSettings().proxyConfig.password, "");
  assert.equal(harness.appliedProxies.at(-1), null);

  assert.ok(harness.savedSettings.length >= 4);
  console.log("PASS check-ai-handlers");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
