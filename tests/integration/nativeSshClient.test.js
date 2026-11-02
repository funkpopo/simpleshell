import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import { once } from "node:events";

const require = createRequire(import.meta.url);
for (const [name, exports] of [
  ["logger", { logToFile: () => {} }],
  ["crashReporter", { recordCrashMarker: () => {} }],
]) {
  const filename = require.resolve(`../../src/main/utils/${name}`);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const {
  NativeSshClient,
} = require("../../src/main/connection/native/nativeSshClient");
const SshTransportHealth = require("../../src/main/connection/ssh-transport-health");
const SSHPool = require("../../src/main/connection/ssh-pool");
const {
  shutdownCoreSupervisors,
} = require("../../src/main/native/coreSupervisor");
const { createSshShellServer } = require("../fixtures/ssh-shell-server");

async function waitFor(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function connect(server, overrides = {}) {
  const client = new NativeSshClient();
  const verified = [];
  client.connect({
    host: "127.0.0.1",
    port: server.port,
    username: overrides.username || "tester",
    password: "secret",
    hostHash: "sha256",
    hostVerifier: (hash, callback) => {
      verified.push(hash);
      setImmediate(() => callback(overrides.trust !== false));
    },
    ...overrides.options,
  });
  return { client, verified };
}

function openShell(
  client,
  window = { term: "xterm-256color", cols: 120, rows: 30 },
) {
  return new Promise((resolve, reject) =>
    client.shell(window, (error, stream) =>
      error ? reject(error) : resolve(stream),
    ),
  );
}

function collect(stream) {
  const state = { text: "", stderr: "" };
  stream.on("data", (chunk) => {
    state.text += chunk.toString("utf8");
  });
  stream.stderr.on("data", (chunk) => {
    state.stderr += chunk.toString("utf8");
  });
  return state;
}

describe("NativeSshClient (ssh2-compatible client on simpleshell-core)", () => {
  let server;

  beforeAll(async () => {
    server = await createSshShellServer();
  });

  afterAll(async () => {
    await shutdownCoreSupervisors();
    await server?.close();
  });

  it("verifies the host key, opens a pty shell and reports resize and exit", async () => {
    const { client, verified } = connect(server);
    await once(client, "ready");
    expect(verified).toEqual([server.fingerprintHex]);

    const shell = await openShell(client);
    const output = collect(shell);
    await waitFor(() => output.text.includes("$ "));
    shell.write("hello 中文\n");
    await waitFor(() => output.text.includes("hello 中文"));
    shell.setWindow(40, 100, 0, 0);
    await waitFor(() =>
      server.events.some(
        (event) => event.type === "window-change" && event.cols === 100,
      ),
    );
    expect(server.events).toContainEqual({
      type: "pty",
      term: "xterm-256color",
      cols: 120,
      rows: 30,
    });

    const exited = once(shell, "exit");
    const closed = once(shell, "close");
    shell.write("exit 3\n");
    expect(await exited).toEqual([3]);
    expect(await closed).toEqual([3, null]);

    const health = new SshTransportHealth({ timeoutMs: 2000 });
    expect(await health.check(client)).toBe(true);

    const ended = once(client, "close");
    client.end();
    await ended;
    expect(client.destroyed).toBe(true);
  });

  it("runs exec with stdout, stderr and exit status", async () => {
    const { client } = connect(server);
    await once(client, "ready");
    const stream = await new Promise((resolve, reject) =>
      client.exec("uptime", (error, channel) =>
        error ? reject(error) : resolve(channel),
      ),
    );
    const output = collect(stream);
    const [code] = await once(stream, "close");
    expect(code).toBe(0);
    expect(output.text).toBe("ran:uptime\n");
    expect(output.stderr).toBe("exec-stderr\n");
    client.end();
  });

  it("answers keyboard-interactive prompts through the ssh2 event", async () => {
    const client = new NativeSshClient();
    const prompts = [];
    client.on(
      "keyboard-interactive",
      (name, instructions, _lang, list, finish) => {
        prompts.push({ name, instructions, list });
        finish(["123456"]);
      },
    );
    client.connect({
      host: "127.0.0.1",
      port: server.port,
      username: "otp-user",
      tryKeyboard: true,
      hostHash: "sha256",
      hostVerifier: () => true,
    });
    await once(client, "ready");
    expect(prompts).toEqual([
      {
        name: "otp",
        instructions: "Enter your one-time code",
        list: [{ prompt: "Code: ", echo: false }],
      },
    ]);
    expect(server.events).toContainEqual({
      type: "auth",
      method: "keyboard-interactive",
    });
    client.end();
  });

  it("fails like ssh2 on rejected host keys and bad passwords", async () => {
    const rejected = connect(server, { username: "rejecting", trust: false });
    // events.once rejects on "error", so wait for "close" with a listener.
    const rejectedClosed = new Promise((resolve) =>
      rejected.client.once("close", resolve),
    );
    const [hostError] = await once(rejected.client, "error");
    expect(hostError.level).toBe("client-host-verification");
    await rejectedClosed;

    const client = new NativeSshClient();
    client.connect({
      host: "127.0.0.1",
      port: server.port,
      username: "wrong-password",
      password: "nope",
      hostVerifier: () => true,
    });
    const [authError] = await once(client, "error");
    expect(authError.message).toBe(
      "All configured authentication methods failed",
    );
    expect(authError.level).toBe("client-authentication");
  });

  it("shares one SSH connection between clients of the same account", async () => {
    const before = server.stats.connections;
    const first = connect(server, { username: "shared" });
    const second = connect(server, { username: "shared" });
    await Promise.all([
      once(first.client, "ready"),
      once(second.client, "ready"),
    ]);
    expect(server.stats.connections - before).toBe(1);
    // The reused connection still asks this client's verifier.
    expect(second.verified).toEqual([server.fingerprintHex]);

    // Ending one client leaves the other's channels working.
    const shell = await openShell(second.client);
    const output = collect(shell);
    first.client.end();
    await once(first.client, "close");
    shell.write("still here\n");
    await waitFor(() => output.text.includes("still here"));
    second.client.end();
  });

  it("closes the client when the connection drops", async () => {
    const { client } = connect(server, { username: "dropping" });
    await once(client, "ready");
    const shell = await openShell(client);
    const shellClosed = once(shell, "close");
    const clientClosed = once(client, "close");
    server.sever();
    await clientClosed;
    await shellClosed;
  });

  it("reconnects a pool connection on the native backend after a network drop", async () => {
    const pool = new SSHPool();
    pool.proxyManager = { resolveProxyConfigAsync: async () => null };
    pool.reconnectionManager.initialize();
    pool._setupReconnectionEvents();
    try {
      const connection = await pool.getConnection({
        host: "127.0.0.1",
        port: server.port,
        username: "reconnecting",
        password: "secret",
        tabId: "native-reconnect",
        hostHash: "sha256",
        hostVerifier: () => true,
      });
      const original = connection.client;
      expect(original).toBeInstanceOf(NativeSshClient);
      pool.addTabReference?.("native-reconnect", connection.key);

      server.sever();
      await waitFor(
        () => connection.client !== original && connection.ready,
        30000,
      );
      expect(connection.client).toBeInstanceOf(NativeSshClient);
      const shell = await openShell(connection.client);
      const output = collect(shell);
      await waitFor(() => output.text.includes("$ "));
    } finally {
      pool.cleanup();
    }
  });
});
