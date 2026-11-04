import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";

const require = createRequire(import.meta.url);
vi.mock("../../src/main/utils/logger", () => ({ logToFile: () => {} }));
const {
  NativeSshClient,
  toSshError,
  toNativeConfig,
} = require("../../src/main/connection/native/nativeSshClient");

/** Stands in for a core stream: records sent events, lets tests emit. */
function fakeStream(service) {
  const stream = new EventEmitter();
  stream.service = service;
  stream.sent = [];
  stream.stdin = new PassThrough();
  stream.stdout = new PassThrough();
  stream.stderr = new PassThrough();
  stream.sendEvent = (event) => stream.sent.push(event);
  stream.kill = () => stream.emit("close", null, "SIGTERM");
  return stream;
}

function createClient() {
  const streams = [];
  const client = new NativeSshClient({
    spawnService: (service) => {
      const stream = fakeStream(service);
      streams.push(stream);
      return stream;
    },
  });
  return { client, streams };
}

describe("NativeSshClient facade", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("maps core errors onto ssh2's code and level", () => {
    expect(
      toSshError("All configured authentication methods failed").level,
    ).toBe("client-authentication");
    const refused = toSshError(
      "SSH target TCP connect failed: refused (os error 10061)",
    );
    expect([refused.code, refused.level]).toEqual([
      "ECONNREFUSED",
      "client-socket",
    ]);
    expect(toSshError("Connection timed out: h:22")).toMatchObject({
      code: "ETIMEDOUT",
      level: "client-timeout",
    });
    expect(toSshError("SSH host key verification failed for h:22").level).toBe(
      "client-host-verification",
    );
  });

  it("translates ssh2 connect options, including agent-only forwarding", () => {
    expect(
      toNativeConfig({
        host: "h",
        username: "u",
        privateKey: Buffer.from("KEY"),
        agent: "pageant",
        agentForward: true,
        authHandler: ["none", "password", "keyboard-interactive"],
        tryKeyboard: true,
        keepaliveInterval: 5000,
        readyTimeout: 20000,
        proxy: { type: "socks5", host: "p", port: 1080 },
      }),
    ).toMatchObject({
      host: "h",
      port: 22,
      privateKey: "KEY",
      agent: "pageant",
      agentAuth: false,
      agentForward: true,
      tryKeyboard: true,
      keepaliveIntervalMs: 5000,
      readyTimeoutMs: 20000,
      proxy: { type: "socks5", host: "p", port: 1080 },
    });
  });

  it("asks hostVerifier with the sha256 hex digest and relays the decision", async () => {
    const { client, streams } = createClient();
    const verifier = vi.fn((hash, callback) =>
      setImmediate(() => callback(true)),
    );
    client.connect({
      host: "h",
      username: "u",
      hostHash: "sha256",
      hostVerifier: verifier,
    });
    const [connection] = streams;
    expect(connection.service).toBe("ssh-connection");
    expect(connection.sent[0]).toMatchObject({
      type: "connect",
      config: { host: "h" },
    });

    connection.emit("event", {
      type: "hostKey",
      id: 4,
      fingerprint: "SHA256:abcd",
      keyBase64: "AAAA",
    });
    expect(verifier.mock.calls[0][0]).toBe("abcd");
    await new Promise((resolve) => setImmediate(resolve));
    expect(connection.sent.at(-1)).toEqual({
      type: "hostKeyDecision",
      id: 4,
      trusted: true,
    });

    // Without hostHash the raw key blob is passed; a sync boolean is honoured.
    const other = createClient();
    other.client.connect({
      host: "h",
      username: "u",
      hostVerifier: (key) => Buffer.isBuffer(key) && false,
    });
    other.streams[0].emit("event", {
      type: "hostKey",
      id: 1,
      fingerprint: "SHA256:00",
      keyBase64: "AAAA",
    });
    expect(other.streams[0].sent.at(-1)).toEqual({
      type: "hostKeyDecision",
      id: 1,
      trusted: false,
    });
  });

  it("emits keyboard-interactive like ssh2 and cancels without a listener", () => {
    const { client, streams } = createClient();
    client.connect({ host: "h", username: "u" });
    const prompt = {
      type: "keyboard",
      id: 2,
      name: "otp",
      instructions: "Code",
      prompts: [{ prompt: "Code: ", echo: false }],
    };
    streams[0].emit("event", prompt);
    expect(streams[0].sent.at(-1)).toEqual({
      type: "keyboardAnswers",
      id: 2,
      answers: null,
    });

    client.on(
      "keyboard-interactive",
      (name, instructions, lang, prompts, finish) => {
        expect([name, instructions, lang, prompts]).toEqual([
          "otp",
          "Code",
          "",
          prompt.prompts,
        ]);
        finish([123456]);
      },
    );
    streams[0].emit("event", { ...prompt, id: 3 });
    expect(streams[0].sent.at(-1)).toEqual({
      type: "keyboardAnswers",
      id: 3,
      answers: ["123456"],
    });
  });

  it("opens channels with ssh2's argument overloads and forwards flow control", async () => {
    const { client, streams } = createClient();
    client.connect({ host: "h", username: "u", agentForward: true });
    streams[0].emit("event", { type: "ready", token: "ssh-9" });

    const opened = new Promise((resolve, reject) =>
      client.shell(
        { term: "xterm-256color", cols: 100, rows: 30 },
        (error, stream) => (error ? reject(error) : resolve(stream)),
      ),
    );
    const channelStream = streams[1];
    expect(channelStream.sent[0]).toEqual({
      type: "open",
      connection: "ssh-9",
      kind: "shell",
      pty: { term: "xterm-256color", cols: 100, rows: 30, width: 0, height: 0 },
      env: {},
      agentForward: true,
      credit: 256 * 1024,
    });
    channelStream.emit("event", { type: "opened" });
    const channel = await opened;
    expect(channel.pipeMode).toBe(false);

    channel.on("data", () => {});
    channel.pause();
    channel.pause();
    channel.resume();
    channel.setWindow(40, 120, 0, 0);
    // Repeated pauses and the implicit resume of attaching a listener are
    // not re-sent.
    expect(channelStream.sent.slice(1)).toEqual([
      { type: "pause" },
      { type: "resume" },
      { type: "resize", cols: 120, rows: 40, width: 0, height: 0 },
    ]);

    const closed = once(channel, "close");
    channelStream.emit("event", { type: "exit", code: 7 });
    channelStream.emit("event", { type: "closed" });
    expect(await closed).toEqual([7, null]);

    const error = await new Promise((resolve) => client.sftp(resolve));
    expect(error.message).toMatch(/native SFTP service/);
  });

  it("opens terminal pipe channels whose credit and pauses come from the caller", async () => {
    const { client, streams } = createClient();
    client.connect({ host: "h", username: "u" });
    streams[0].emit("event", { type: "ready", token: "ssh-1" });

    const opened = new Promise((resolve, reject) =>
      client.shell({}, { pipe: { rules: [] } }, (error, stream) =>
        error ? reject(error) : resolve(stream),
      ),
    );
    const core = streams[1];
    expect(core.sent[0]).toMatchObject({
      type: "open",
      pipe: { rules: [] },
      credit: 512 * 1024,
    });
    core.emit("event", { type: "opened" });
    const channel = await opened;
    expect(channel.pipeMode).toBe(true);

    const editor = [];
    const zmodem = [];
    channel.on("editorMode", (active) => editor.push(active));
    channel.on("zmodem", (kind, event) => zmodem.push([kind, event]));
    channel.on("data", () => {});
    core.stdout.write(Buffer.alloc(300 * 1024));
    core.emit("event", { type: "editorMode", active: true });
    core.emit("event", {
      type: "zmodem",
      kind: "offer",
      event: { fileName: "a" },
    });
    await new Promise((resolve) => setImmediate(resolve));

    channel.grantCredit(4096);
    channel.grantCredit(0);
    channel.pauseFor("renderer");
    channel.resumeFor("renderer");
    channel.sendZmodem({ type: "zmodemCancel" });
    // Reading does not renew credit in pipe mode; only grants do.
    expect(core.sent.slice(1)).toEqual([
      { type: "credit", bytes: 4096 },
      { type: "pause", reason: "renderer" },
      { type: "resume", reason: "renderer" },
      { type: "zmodemCancel" },
    ]);
    expect(editor).toEqual([true]);
    expect(zmodem).toEqual([["offer", { fileName: "a" }]]);
  });

  it("refuses channels before ready and reports close once", async () => {
    const { client, streams } = createClient();
    client.connect({ host: "h", username: "u" });
    const error = await new Promise((resolve) => client.exec("ls", resolve));
    expect(error.message).toBe("Not connected");
    const closed = vi.fn();
    client.on("close", closed);
    streams[0].emit("close", 0, null);
    streams[0].emit("close", 0, null);
    await new Promise((resolve) => setImmediate(resolve));
    expect(closed).toHaveBeenCalledTimes(1);
    expect(client.destroyed).toBe(true);
    expect(await client.checkTransport()).toBe(false);
  });

  it("creates native clients and fails clearly without the native host", () => {
    const factoryPath =
      require.resolve("../../src/main/connection/sshClientFactory");
    const servicesPath =
      require.resolve("../../src/main/native/nativeServices");
    const loadFactory = (hostPath) => {
      delete require.cache[factoryPath];
      const real = require.cache[servicesPath];
      require.cache[servicesPath] = {
        id: servicesPath,
        filename: servicesPath,
        loaded: true,
        exports: { getNativeServicesHostPath: () => hostPath },
      };
      try {
        return require(factoryPath);
      } finally {
        if (real) require.cache[servicesPath] = real;
        else delete require.cache[servicesPath];
        delete require.cache[factoryPath];
      }
    };
    expect(
      loadFactory("/bin/simpleshell-core").createSshClient(),
    ).toBeInstanceOf(NativeSshClient);
    expect(() => loadFactory(null).createSshClient()).toThrow(
      expect.objectContaining({ code: "ENATIVECORE" }),
    );
  });

  it("leaves no in-process SSH implementation in the app sources", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const root = path.resolve(__dirname, "../../src");
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (
          /\.(c|m)?jsx?$/.test(entry.name) &&
          /require\(["']ssh2(\/[^"']*)?["']\)|from\s+["']ssh2(\/[^"']*)?["']/.test(
            fs.readFileSync(file, "utf8"),
          )
        )
          offenders.push(path.relative(root, file));
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
