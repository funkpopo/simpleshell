const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const ELECTRON_PATH = require.resolve("electron");
const IPC_RESPONSE_PATH = path.join(ROOT, "src", "core", "ipc", "ipcResponse");
const UPDATE_SERVICE_PATH = path.join(
  ROOT,
  "src",
  "core",
  "update",
  "updateService.js",
);

function clearRequire(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function installElectronMock(tempRoot) {
  const previous = require.cache[ELECTRON_PATH];
  const app = {
    isPackaged: false,
    getName() {
      return "SimpleShell";
    },
    getVersion() {
      return "1.0.0";
    },
    getPath(name) {
      if (name === "exe") {
        return path.join(tempRoot, "SimpleShell.exe");
      }
      return tempRoot;
    },
    getAppPath() {
      return ROOT;
    },
  };
  const ipcMain = {
    handlers: new Map(),
    handle(channel, handler) {
      this.handlers.set(channel, handler);
    },
    removeHandler(channel) {
      this.handlers.delete(channel);
    },
  };

  require.cache[ELECTRON_PATH] = {
    id: ELECTRON_PATH,
    filename: ELECTRON_PATH,
    loaded: true,
    exports: {
      BrowserWindow: {
        getAllWindows() {
          return [];
        },
      },
      app,
      dialog: { async showMessageBox() {} },
      ipcMain,
      net: {
        request() {
          throw new Error("Unexpected net.request in classification test");
        },
      },
      session: {
        defaultSession: {
          async resolveProxy() {
            return "DIRECT";
          },
        },
      },
      shell: { showItemInFolder() {} },
    },
  };

  return {
    app,
    ipcMain,
    restore() {
      if (previous) {
        require.cache[ELECTRON_PATH] = previous;
      } else {
        delete require.cache[ELECTRON_PATH];
      }
    },
  };
}

function createUpdateService(tempRoot) {
  clearRequire(UPDATE_SERVICE_PATH);
  const { UpdateService } = require(UPDATE_SERVICE_PATH);
  return new UpdateService({
    app: {
      isPackaged: false,
      getName() {
        return "SimpleShell";
      },
      getVersion() {
        return "1.0.0";
      },
      getPath() {
        return tempRoot;
      },
    },
    currentVersion: "1.0.0",
    tempDir: path.join(tempRoot, "updates"),
    dialog: { async showMessageBox() {} },
    shell: { showItemInFolder() {} },
    net: {
      request() {
        throw new Error("Unexpected update network request");
      },
    },
    session: {
      defaultSession: {
        async resolveProxy() {
          return "DIRECT";
        },
      },
    },
    spawn() {
      throw new Error("Unexpected spawn in classification test");
    },
    execFile() {
      throw new Error("Unexpected execFile in classification test");
    },
  });
}

function testClassificationPolicy() {
  const { ERROR_ACTIONS, ERROR_NOTIFICATION_LEVELS, classifyError } = require(
    path.join(ROOT, "src", "shared", "errorClassification"),
  );

  const recoverable = classifyError("permission denied");
  assert.equal(recoverable.category, ERROR_NOTIFICATION_LEVELS.RECOVERABLE);
  assert.equal(recoverable.action, ERROR_ACTIONS.RECOVER);
  assert.equal(recoverable.userRecoverable, true);
  assert.equal(recoverable.showDiagnostics, false);

  const retry = classifyError({ code: "ETIMEDOUT" });
  assert.equal(retry.category, ERROR_NOTIFICATION_LEVELS.RETRY);
  assert.equal(retry.action, ERROR_ACTIONS.RETRY);
  assert.equal(retry.retryable, true);
  assert.equal(retry.showDiagnostics, true);

  const feedback = classifyError(new Error("unexpected invariant violation"));
  assert.equal(feedback.category, ERROR_NOTIFICATION_LEVELS.FEEDBACK);
  assert.equal(feedback.action, ERROR_ACTIONS.FEEDBACK);
  assert.equal(feedback.reportable, true);
  assert.equal(feedback.reason, "feedback-signal");

  const unclassified = classifyError(new Error("unexpected internal shape"));
  assert.equal(unclassified.category, ERROR_NOTIFICATION_LEVELS.FEEDBACK);
  assert.equal(unclassified.action, ERROR_ACTIONS.FEEDBACK);
  assert.equal(unclassified.reason, "unclassified");

  const fatal = classifyError(new Error("Renderer process gone: crashed"), {
    type: "rendererCrash",
  });
  assert.equal(fatal.category, ERROR_NOTIFICATION_LEVELS.FATAL);
  assert.equal(fatal.action, ERROR_ACTIONS.RESTART);
  assert.equal(fatal.fatal, true);
  assert.equal(fatal.persistent, true);
}

function testErrorResponseContract() {
  const { buildErrorEvent, buildErrorResponse } = require(
    path.join(ROOT, "src", "core", "utils", "errorResponse"),
  );

  const response = buildErrorResponse(new Error("connect ETIMEDOUT"), {
    module: "test",
    operation: "connect",
  });
  assert.equal(response.success, false);
  assert.equal(response.errorCategory, "retry");
  assert.equal(response.errorAction, "retry");
  assert.equal(response.errorClassification.category, "retry");
  assert.equal(response.retryable, true);
  assert.equal(response.module, "test");
  assert.equal(response.operation, "connect");
  assert.equal(response.technicalMessage, "connect ETIMEDOUT");

  const event = buildErrorEvent(new Error("Renderer process gone: crashed"), {
    module: "window",
    operation: "render-process-gone",
    type: "rendererCrash",
  });
  assert.equal(event.type, "rendererCrash");
  assert.equal(event.errorCategory, "fatal");
  assert.equal(event.fatal, true);
  assert.equal(event.errorClassification.reason, "fatal-signal");
}

async function testIpcFailureNormalization() {
  clearRequire(IPC_RESPONSE_PATH);
  const { wrapIpcHandler } = require(IPC_RESPONSE_PATH);
  const wrapped = wrapIpcHandler(
    async () => ({
      success: false,
      error: "Invalid file path",
    }),
    { category: "file", channelName: "file:open" },
  );

  const response = await wrapped({}, {});
  assert.equal(response.success, false);
  assert.equal(response.error, "Invalid file path");
  assert.equal(response.errorCategory, "recoverable");
  assert.equal(response.errorAction, "recover");
  assert.equal(response.userRecoverable, true);
  assert.equal(response.errorClassification.code, "EINVAL");
  assert.equal(response.module, "file");
  assert.equal(response.operation, "file:open");
}

async function testUpdateErrorClassification(tempRoot) {
  const service = createUpdateService(tempRoot);
  const error = Object.assign(new Error("net::ERR_INTERNET_DISCONNECTED"), {
    code: "ERR_INTERNET_DISCONNECTED",
  });
  const record = await service.recordUpdateError("download", error);

  assert.equal(record.stage, "download");
  assert.equal(record.errorCategory, "retry");
  assert.equal(record.errorAction, "retry");
  assert.equal(record.retryable, true);
  assert.equal(record.errorClassification.category, "retry");
  assert.equal(fs.existsSync(service.updateErrorPath), true);

  const persisted = JSON.parse(
    fs.readFileSync(service.updateErrorPath, "utf8"),
  );
  assert.equal(persisted.errorCategory, "retry");
  assert.equal(persisted.errorAction, "retry");
  assert.equal(persisted.errorClassification.category, "retry");
}

function testDiagnosticSummaryIncludesClassification() {
  const { buildDiagnosticSummary } = require(
    path.join(ROOT, "src", "core", "utils", "diagnostics"),
  );
  const summary = buildDiagnosticSummary({
    generatedAt: "2026-05-27T00:00:00.000Z",
    app: { name: "SimpleShell", version: "1.0.0", packaged: false },
    runtime: { electron: "40.4.1", chrome: "140.0.0", node: "22.0.0" },
    platform: { os: "Windows_NT", release: "10.0.0", arch: "x64" },
    gpu: {},
    config: { schemaVersion: 1 },
    update: {
      status: "idle",
      lastUpdateError: {
        stage: "download",
        message: "net::ERR_INTERNET_DISCONNECTED",
        errorCategory: "retry",
        errorAction: "retry",
      },
    },
    sidecar: { exists: true, version: "test" },
    crashReporter: {
      started: true,
      recentRecords: [
        {
          kind: "marker",
          mtimeMs: Date.parse("2026-05-27T00:00:00.000Z"),
          name: "crash.json",
          marker: {
            generatedAt: "2026-05-27T00:00:00.000Z",
            module: "window",
            reason: "crashed",
            errorCategory: "fatal",
          },
        },
      ],
    },
    logs: { recentLines: [] },
    context: {
      source: "error-notification",
      title: "Retry needed",
      description: "connect ETIMEDOUT",
      errorCategory: "retry",
      errorAction: "retry",
      errorCode: "ETIMEDOUT",
      classificationReason: "retryable-signal",
    },
  });

  assert.match(summary, /Error category: retry/);
  assert.match(summary, /Error action: retry/);
  assert.match(summary, /Error code: ETIMEDOUT/);
  assert.match(summary, /Classification reason: retryable-signal/);
  assert.match(summary, /## Last update error/);
  assert.match(summary, /category: retry, action: retry/);
  assert.match(summary, /\[fatal\] window: crashed/);
}

async function run() {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "simpleshell-error-classification-"),
  );
  const electronMock = installElectronMock(tempRoot);
  const tests = [
    ["classification policy", () => testClassificationPolicy()],
    ["error response contract", () => testErrorResponseContract()],
    ["ipc failure normalization", () => testIpcFailureNormalization()],
    [
      "update error classification",
      () => testUpdateErrorClassification(tempRoot),
    ],
    [
      "diagnostic classification summary",
      () => testDiagnosticSummaryIncludesClassification(),
    ],
  ];

  try {
    for (const [name, fn] of tests) {
      await fn();
      console.log(`PASS error classification - ${name}`);
    }
    console.log(
      `\n${tests.length} error classification regression checks passed.`,
    );
  } finally {
    clearRequire(IPC_RESPONSE_PATH);
    clearRequire(UPDATE_SERVICE_PATH);
    electronMock.restore();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
