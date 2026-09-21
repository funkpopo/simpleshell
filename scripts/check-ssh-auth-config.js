const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const fs = require("node:fs");
const vm = require("node:vm");
const babel = require("@babel/core");
const {
  mergeSavedConnectionConfig,
} = require("../src/shared/connectionConfigSync");
const {
  attachKeyboardInteractiveSupport,
  resolveKeyboardInteractiveAnswers,
  autoAnswerPrompt,
} = require("../src/main/connection/ssh-interactive-auth");
const SSHPool = require("../src/main/connection/ssh-pool");
const {
  setTrustedHostFingerprint,
  getTrustedHostFingerprint,
} = require("../src/main/utils/sshHostKeyTrust");

const tick = () => new Promise((resolve) => setImmediate(resolve));
const processes = new Map();
const pool = new EventEmitter();
pool.connections = new Map();
pool.reconnectionManager = { sessions: new Map() };
const sent = [];
const mainWindow = {
  isDestroyed: () => false,
  webContents: { send: (channel, data) => sent.push({ channel, ...data }) },
};
let savedConnections = [];
const configService = {
  loadConnections: () => structuredClone(savedConnections),
  saveConnections: (connections) => {
    savedConnections = structuredClone(connections);
    return true;
  },
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const normalized = request.replaceAll("\\", "/");
  if (normalized.endsWith("settings/configService")) return configService;
  if (normalized.endsWith("utils/logger")) return { logToFile() {} };
  if (normalized.endsWith("window/windowManager"))
    return {
      getPrimaryWindow: () => mainWindow,
      broadcastToAllWindows() {},
    };
  if (normalized.endsWith("file-transfer/filemanagementService")) return {};
  if (normalized.endsWith("terminal/zmodemTransferService"))
    return { zmodemTransferService: {} };
  if (normalized === "./" && parent?.filename.endsWith("connectionManager.js"))
    return { sshConnectionPool: pool };
  if (normalized.endsWith("process/processManager"))
    return { getProcess: (id) => processes.get(id) };
  return originalLoad.call(this, request, parent, isMain);
};
let SSHHandlers, connectionManager, nativeSftpClient, TerminalHandlers;
try {
  SSHHandlers = require("../src/main/ipc/handlers/sshHandlers");
  connectionManager = require("../src/main/connection/connectionManager");
  nativeSftpClient = require("../src/main/native/nativeSftpClient");
  TerminalHandlers = require("../src/main/ipc/handlers/terminalHandlers");
} finally {
  Module._load = originalLoad;
}

async function checkAuthQueue() {
  const handler = new SSHHandlers({
    childProcesses: processes,
    connectionManager,
  });
  const first = handler._requestUserAuth("tab-a", {
    step: "keyboardInteractive",
  });
  const second = handler._requestUserAuth("tab-b", {
    step: "keyboardInteractive",
  });
  assert.equal(sent.length, 1, "Only one authentication dialog may be active");
  const requestId = sent[0].requestId;
  await handler.handleAuthResponse(null, { requestId, answers: ["first OTP"] });
  assert.deepEqual(await first, { answers: ["first OTP"] });
  assert.equal(sent.length, 2);
  const cancelled = assert.rejects(second, /cancelled/);
  await handler.handleAuthResponse(null, {
    requestId: sent[1].requestId,
    cancelled: true,
  });
  await cancelled;
  assert.equal(handler.pendingAuthRequests.size, 0);
  assert.equal(handler.activeAuthRequestId, null);
  await assert.rejects(
    handler.handleAuthResponse(null, { requestId }),
    /Invalid request ID/,
  );

  const controller = new AbortController();
  const closed = assert.rejects(
    handler._requestUserAuth("tab-a", {}, controller.signal),
    /connection closed/,
  );
  controller.abort();
  await closed;
  assert.equal(
    sent.at(-1).cancelled,
    true,
    "Closed transports dismiss their obsolete dialog",
  );

  savedConnections = [{ id: "saved", type: "connection", password: "old" }];
  const stale = assert.rejects(
    handler._requestUserAuth("tab-a", { connectionId: "saved" }),
    { code: "SSH_CONFIG_CHANGED" },
  );
  pool.emit("savedConnectionsChanged", {
    previousConnections: savedConnections,
    connections: [{ ...savedConnections[0], password: "new" }],
  });
  await stale;
  assert.equal(handler.pendingAuthRequests.size, 0);

  let finishStart;
  let starts = 0;
  handler._startSSH = () => {
    starts++;
    return new Promise((resolve) => {
      finishStart = resolve;
    });
  };
  const startA = handler.startSSH(null, { tabId: "same-tab" });
  const startB = handler.startSSH(null, { tabId: "same-tab" });
  assert.equal(starts, 1, "Concurrent starts for one tab share authentication");
  finishStart(123);
  assert.deepEqual(await Promise.all([startA, startB]), [123, 123]);
  assert.equal(handler.pendingSSHStarts.size, 0);
}

async function checkInteractiveAuth() {
  const config = { password: "saved-password" };
  assert.equal(
    autoAnswerPrompt({ prompt: "Password:", echo: false }, config),
    "saved-password",
  );
  assert.equal(
    autoAnswerPrompt({ prompt: "One-time password:", echo: false }, config),
    null,
  );
  assert.equal(
    autoAnswerPrompt({ prompt: "Passcode:", echo: false }, config),
    null,
  );
  const runtime = {
    keyboardInteractiveResponder: async () => ({
      answers: ["corrected-password", "123456"],
    }),
  };
  assert.deepEqual(
    await resolveKeyboardInteractiveAnswers({
      prompts: [
        { prompt: "Password:", echo: false },
        { prompt: "OTP:", echo: false },
      ],
      sshConfig: runtime,
    }),
    ["corrected-password", "123456"],
  );
  assert.equal(
    runtime.password,
    "corrected-password",
    "Only password answers become session credentials",
  );

  const client = new EventEmitter();
  client.end = () => client.emit("close");
  const errors = [];
  client.on("error", (error) => errors.push(error));
  const cancelled = {
    keyboardInteractiveResponder: async () => ({ cancelled: true }),
  };
  attachKeyboardInteractiveSupport(client, cancelled);
  attachKeyboardInteractiveSupport(client, cancelled);
  assert.equal(client.listenerCount("keyboard-interactive"), 1);
  client.emit(
    "keyboard-interactive",
    "",
    "",
    "",
    [{ prompt: "OTP:" }],
    () => {},
  );
  await tick();
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /cancelled/);

  const sshPool = new SSHPool();
  sshPool._logInfo = () => {};
  const ssh = new EventEmitter();
  const connection = {
    client: ssh,
    config: { tabId: "tab-a" },
    key: "test",
    refCount: 1,
    ready: false,
  };
  ssh.end = () => ssh.emit("close");
  ssh.on("close", () => sshPool._handleSSHClose(connection, "test", ssh));
  sshPool.connections.set("test", connection);
  let rejected;
  sshPool._failOrReconnectInitial(
    new Error("All configured authentication methods failed"),
    connection.config,
    false,
    "test",
    ssh,
    connection,
    () => assert.fail("Must not reconnect"),
    (error) => {
      rejected = error;
    },
  );
  assert.ok(rejected);
  assert.equal(
    sshPool.reconnectionManager.sessions.size,
    0,
    "Failed authentication close must not start another retry loop",
  );
  assert.equal(sshPool.connections.size, 0);
}

async function checkLoopbackAuthenticationFailure() {
  const { Server } = require("ssh2");
  const { privateKey } = require("node:crypto").generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const clients = new Set();
  const server = new Server({ hostKeys: [privateKey] }, (client) => {
    clients.add(client);
    client.on("error", () => {});
    client.on("close", () => clients.delete(client));
    client.on("authentication", (request) => {
      if (request.username === "wrong-password") {
        request.reject(["password"]);
        return;
      }
      if (request.method === "keyboard-interactive") {
        request.prompt([{ prompt: "Verification code:", echo: false }], () =>
          request.reject(),
        );
      } else {
        request.reject(["keyboard-interactive"]);
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const sshPool = new SSHPool();
  sshPool._logInfo = () => {};
  sshPool.proxyManager = { resolveProxyConfigAsync: async () => null };
  let prompts = 0;
  let timeout;
  try {
    await assert.rejects(
      Promise.race([
        sshPool.getConnection({
          host: "127.0.0.1",
          port: server.address().port,
          username: "test",
          tabId: "loopback",
          keyboardInteractiveResponder: async () => {
            prompts++;
            return { cancelled: true };
          },
        }),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Loopback auth test timed out")),
            5000,
          );
        }),
      ]),
      /cancelled/i,
    );
    await tick();
    assert.equal(prompts, 1);
    assert.equal(sshPool.connections.size, 0);
    assert.equal(sshPool.reconnectionManager.sessions.size, 0);
    clearTimeout(timeout);

    await assert.rejects(
      Promise.race([
        sshPool.getConnection({
          host: "127.0.0.1",
          port: server.address().port,
          username: "wrong-password",
          password: "rejected-password",
          tabId: "loopback-auth-failure",
        }),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Loopback password rejection timed out")),
            5000,
          );
        }),
      ]),
      (error) => {
        assert.equal(error.connectionFailureKind, "auth");
        assert.equal(error.connectionFailure.kind, "auth");
        assert.match(
          error.originalError.message,
          /authentication methods failed/i,
        );
        assert.doesNotMatch(error.message, /not a function/i);
        return true;
      },
    );
    await tick();
    assert.equal(sshPool.connections.size, 0);
    assert.equal(sshPool.reconnectionManager.sessions.size, 0);
  } finally {
    clearTimeout(timeout);
    sshPool.cleanup();
    for (const client of clients) client.end();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function checkMinifiedConnectionError() {
  const path = require("node:path");
  const webpack = require("webpack");
  const outputDirectory = fs.mkdtempSync(
    path.join(require("node:os").tmpdir(), "simpleshell-auth-error-"),
  );
  const compiler = webpack({
    mode: "production",
    target: "node",
    devtool: false,
    entry: path.resolve(
      __dirname,
      "../src/main/connection/base-connection-pool.js",
    ),
    output: {
      path: outputDirectory,
      filename: "connection-pool.cjs",
      library: { type: "commonjs2" },
    },
  });
  try {
    await new Promise((resolve, reject) =>
      compiler.run((error, stats) => {
        if (error) return reject(error);
        if (stats.hasErrors())
          return reject(
            new Error(stats.toString({ all: false, errors: true })),
          );
        resolve();
      }),
    );
    const filename = path.join(outputDirectory, "connection-pool.cjs");
    const bundledModule = new Module(filename, module);
    bundledModule.filename = filename;
    bundledModule.paths = module.paths;
    bundledModule._compile(fs.readFileSync(filename, "utf8"), filename);
    const connectionPool = new bundledModule.exports();
    const originalError = new Error(
      "All configured authentication methods failed",
    );
    const enhancedError = connectionPool._buildEnhancedConnectionError({
      message: "SSH 认证失败",
      err: originalError,
      connectionKey: "tab:test:127.0.0.1:22:test",
      configKey: "sshConfig",
      protocol: "ssh",
      config: {
        host: "127.0.0.1",
        port: 22,
        username: "test",
        language: "zh-CN",
      },
    });
    assert.equal(enhancedError.connectionFailureKind, "auth");
    assert.equal(enhancedError.originalError, originalError);
    assert.match(enhancedError.connectionAdvice, /用户名、密码\/私钥/);
    assert.equal(enhancedError.message, "SSH 认证失败");
  } finally {
    await new Promise((resolve, reject) =>
      compiler.close((error) => (error ? reject(error) : resolve())),
    );
    // 仅移除本次检查生成的文件与空目录。
    for (const entry of fs.readdirSync(outputDirectory, {
      withFileTypes: true,
    })) {
      if (entry.isFile()) fs.unlinkSync(path.join(outputDirectory, entry.name));
    }
    fs.rmdirSync(outputDirectory);
  }
}

async function checkLiveConfigSync() {
  const before = {
    id: "server",
    type: "connection",
    host: "host-a",
    port: 22,
    username: "root",
    password: "old",
    authType: "password",
    protocol: "ssh",
  };
  const runtime = {
    ...before,
    password: "temporary",
    tabId: "tab-a",
    hostVerifier() {},
  };
  const renamed = mergeSavedConnectionConfig(runtime, before, {
    ...before,
    name: "Renamed",
  });
  assert.equal(
    renamed.password,
    "temporary",
    "Unrelated saves must preserve session-only credentials",
  );
  const switched = mergeSavedConnectionConfig(
    { ...runtime, privateKey: "cached-key" },
    before,
    { ...before, authType: "privateKey", privateKeyPath: "/new-key" },
  );
  assert.equal(switched.privateKey, undefined);
  assert.equal(switched.password, "");

  setTrustedHostFingerprint(runtime, "SHA256:trusted");
  let endCalls = 0;
  const connection = {
    config: runtime,
    ready: true,
    client: {
      end() {
        endCalls++;
      },
    },
  };
  processes.set("tab-a", { config: runtime, connectionInfo: connection });
  const reconnectConfig = { ...runtime };
  pool.connections.set("tab:tab-a", connection);
  pool.reconnectionManager.sessions.set("tab:tab-a", {
    config: reconnectConfig,
  });
  const after = { ...before, password: "new" };
  savedConnections = [{ type: "group", id: "group", items: [before] }];
  const terminalHandlers = new TerminalHandlers({
    connectionManager,
    processManager: { getProcessMap: () => processes },
  });
  assert.equal(
    await terminalHandlers.saveConnections(null, [
      { type: "group", id: "group", items: [after] },
    ]),
    true,
  );
  assert.equal(runtime.password, "new");
  assert.equal(reconnectConfig.password, "new");
  assert.equal(runtime.tabId, "tab-a");
  assert.equal(typeof runtime.hostVerifier, "function");
  assert.equal(
    endCalls,
    0,
    "Changing credentials preserves healthy SSH transport",
  );
  assert.equal(
    (await nativeSftpClient.resolveSshConfig("tab-a")).password,
    "new",
    "SFTP must resolve the newly saved password",
  );

  const moved = { ...after, host: "host-b", port: 2222 };
  await terminalHandlers.saveConnections(null, [moved]);
  assert.equal(runtime.host, "host-b");
  assert.equal(
    endCalls,
    1,
    "Changing the destination rebuilds the SSH transport",
  );
  assert.equal(
    getTrustedHostFingerprint(runtime),
    null,
    "New destination must obtain its own host trust",
  );
  setTrustedHostFingerprint(runtime, "SHA256:new-host");
  const sftpConfig = await nativeSftpClient.resolveSshConfig("tab-a");
  assert.equal(sftpConfig.host, "host-b");
  assert.equal(sftpConfig.port, 2222);

  const revision = runtime._connectionConfigRevision;
  runtime.username = "session-only-user";
  await terminalHandlers.saveConnections(null, [{ ...moved, name: "Renamed" }]);
  assert.equal(runtime.username, "session-only-user");
  assert.equal(runtime._connectionConfigRevision, revision);
  assert.equal(
    endCalls,
    1,
    "Renaming a connection must not repeat authentication",
  );
}

async function checkSavedConfigReplacesPendingAuth() {
  const before = {
    id: "editing",
    type: "connection",
    host: "host",
    port: 22,
    username: "root",
    password: "",
    protocol: "ssh",
  };
  savedConnections = [before];
  const handler = new SSHHandlers({
    childProcesses: new Map(),
    connectionManager,
    getNextProcessId: () => 123,
  });
  handler._assertSSHReachableBeforeAuth = async () => {};
  handler._createSSHShell = async () => 123;
  handler._emitSshTabConnectionStatus = () => {};
  handler._registerConnectionProcess = () => {};
  let receivedConfig;
  const originalGetConnection = connectionManager.getSSHConnection;
  connectionManager.getSSHConnection = async (config) => {
    receivedConfig = config;
    return { ready: true, client: {}, key: "test" };
  };
  try {
    const start = handler.startSSH(null, { ...before, tabId: "editing-tab" });
    await tick();
    assert.equal(handler.pendingAuthRequests.size, 1);
    savedConnections = [{ ...before, password: "corrected" }];
    pool.emit("savedConnectionsChanged", {
      previousConnections: [before],
      connections: savedConnections,
    });
    assert.equal(await start, 123);
    assert.equal(receivedConfig.password, "corrected");
    assert.equal(
      handler.pendingAuthRequests.size,
      0,
      "Saving the missing credentials resolves the old authentication flow",
    );
  } finally {
    connectionManager.getSSHConnection = originalGetConnection;
  }
}

async function checkRendererAuthHandoff() {
  const source = fs.readFileSync(
    require("node:path").join(
      __dirname,
      "../src/renderer/components/app/hooks/useSSHAuthentication.js",
    ),
    "utf8",
  );
  const ast = babel.parseSync(source, {
    filename: "app.jsx",
    configFile: false,
    babelrc: false,
    presets: ["@babel/preset-react"],
  });
  const callbacks = {};
  babel.traverse(ast, {
    VariableDeclarator({ node }) {
      if (
        ["handleSSHAuthConfirm", "handleSSHAuthClose"].includes(node.id.name)
      ) {
        callbacks[node.id.name] = source.slice(node.init.start, node.init.end);
      }
    },
  });
  for (const name of Object.keys(callbacks)) {
    const request = { current: "current-request" };
    let open = true;
    const context = {
      React: { useCallback: (callback) => callback },
      sshAuthRequestIdRef: request,
      sshAuthData: {},
      sshAuthConnectionConfig: null,
      dispatch() {},
      setSshAuthDialogOpen: (value) => {
        open = value;
      },
      setSshAuthData() {},
      setSshAuthConnectionConfig() {},
      window: {
        terminalAPI: {
          respondSSHAuth: async (response) => {
            assert.equal(response.requestId, "current-request");
            assert.equal(
              request.current,
              null,
              "Consume the request before responding to IPC",
            );
            // The backend may issue the next challenge before the previous IPC resolves.
            request.current = "next-request";
            open = true;
          },
        },
      },
      console,
    };
    const callback = vm.runInNewContext(callbacks[name], context);
    await callback({ answers: ["OTP"] });
    assert.equal(request.current, "next-request");
    assert.equal(
      open,
      true,
      "The old response must not dismiss the next dialog",
    );
  }
  assert.equal(Object.keys(callbacks).length, 2);
}

async function run() {
  await checkAuthQueue();
  await checkInteractiveAuth();
  await checkLoopbackAuthenticationFailure();
  await checkMinifiedConnectionError();
  await checkLiveConfigSync();
  await checkSavedConfigReplacesPendingAuth();
  await checkRendererAuthHandoff();
  const load = require("./lib/load-renderer-module")();
  const { areWebTerminalPropsEqual } = load(
    "src/renderer/components/web-terminal/terminalHelpers.js",
  );
  const props = {
    tabId: "tab-a",
    sshConfig: { host: "host", password: "old" },
  };
  assert.equal(
    areWebTerminalPropsEqual(props, {
      ...props,
      sshConfig: { ...props.sshConfig, password: "new" },
    }),
    false,
  );
  console.log(
    "SSH authentication failure (including production minification), cancellation, live configuration and SFTP checks passed.",
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
