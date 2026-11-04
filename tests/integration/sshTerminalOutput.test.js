import { describe, it, expect, vi } from "vitest";
import { RendererTerminalIOMailbox } from "../../src/renderer/features/terminal/io/RendererTerminalIOMailbox.js";
import { createRequire } from "node:module";
import { once } from "node:events";
import { generateKeyPairSync } from "node:crypto";
import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
// ssh2 (npm) serves as the remote SSH server of these tests.
const { Server } = require("ssh2");
const {
  NativeSshClient,
} = require("../../src/main/connection/native/nativeSshClient");
const SSHPool = require("../../src/main/connection/ssh-pool");
const SshTransportHealth = require("../../src/main/connection/ssh-transport-health");
const TerminalIOMailboxManager = require("../../src/main/terminal/terminalIOMailboxManager");
const createTerminalOutput = require("../../src/main/ipc/handlers/domains/terminalOutput");
const { Terminal } = require("@xterm/xterm");
const {
  ZmodemTransferService,
} = require("../../src/main/terminal/zmodemTransferService");
const {
  IPC_EVENT_CHANNELS,
} = require("../../src/shared/contracts/ipc/channels");
const {
  getTerminalIOMailboxOutputChannel,
} = require("../../src/shared/contracts/terminalIOMailboxProtocol");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (predicate) => {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("SSH fixture timed out");
    await delay(5);
  }
};

/** `pipe`: a terminal pipe channel; `raw`: a plain shell channel. */
async function createFixture(mode = "pipe") {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  let remote;
  let remoteStream;
  const server = new Server(
    {
      hostKeys: [privateKey.export({ type: "pkcs1", format: "pem" })],
    },
    (connection) => {
      remote = connection;
      connection.on("error", () => {});
      connection.on("authentication", (auth) => auth.accept());
      connection.on("request", (_accept, reject) => reject?.());
      connection.on("session", (accept) => {
        const session = accept();
        session.on("pty", (acceptPty) => acceptPty());
        session.on("shell", (acceptShell) => {
          remoteStream = acceptShell();
          remoteStream.on("error", () => {});
        });
      });
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const client = new NativeSshClient();
  client.on("error", () => {});
  const ready = once(client, "ready");
  client.connect({
    host: "127.0.0.1",
    port: server.address().port,
    username: "output",
    keepaliveInterval: 0,
  });
  await ready;
  // `pipe`: the core processes output (no highlight rules: text = bytes).
  const options = mode === "pipe" ? { pipe: {} } : {};
  const stream = await new Promise((resolve, reject) =>
    client.shell({}, options, (error, channel) =>
      error ? reject(error) : resolve(channel),
    ),
  );
  stream.on("error", () => {});
  await until(() => remoteStream);
  return {
    client,
    stream,
    get remote() {
      return remote;
    },
    get remoteStream() {
      return remoteStream;
    },
    async close() {
      stream.destroy();
      client.destroy();
      remote?._sock.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

describe("SSH terminal output under load", () => {
  it.each([
    ["stdout", 510000],
    ["stderr", 160000],
  ])(
    "terminal pipe retains large Unicode %s output through SSH, core processing, renderer parsing and credit",
    async (kind, lines) => {
      const fixture = await createFixture("pipe");
      const term = new Terminal({ cols: 120, rows: 30, scrollback: 500000 });
      const processId = 77;
      const channel = getTerminalIOMailboxOutputChannel(processId);
      const stats = {
        pauses: 0,
        receivedBytes: 0,
        ackBytes: 0,
        peakPending: 0,
        peakInFlight: 0,
        creditGrants: 0,
        healthChecks: 0,
        healthFailures: 0,
      };
      const emitted = createHash("sha256");
      const rendered = createHash("sha256");
      const stderrText = [];
      const expected = createHash("sha256");
      let onOutput;
      let closing = false;
      const mainWindow = {
        isDestroyed: () => closing,
        webContents: {
          send: (name, payload) => {
            if (name !== channel) return;
            for (const message of Array.isArray(payload)
              ? payload
              : [payload]) {
              stats.receivedBytes += Buffer.byteLength(message.data);
              stats.peakInFlight = Math.max(
                stats.peakInFlight,
                stats.receivedBytes - stats.ackBytes,
              );
              emitted.update(message.data);
              queueMicrotask(() => onOutput?.(message));
            }
          },
        },
      };
      const manager = new TerminalIOMailboxManager({
        getMainWindow: () => mainWindow,
      });
      const api = {
        onTerminalMailboxMessage: (_id, callback) => {
          onOutput = callback;
          return () => {
            onOutput = null;
          };
        },
        postTerminalMailboxMessage: (id, message) => {
          if (message.type === "ack") stats.ackBytes += message.bytes;
          return manager.handleRendererMessage(id, message);
        },
      };
      vi.stubGlobal("window", { terminalAPI: api });
      const renderer = new RendererTerminalIOMailbox({
        term: {
          write: (data, callback) => {
            rendered.update(data);
            if (kind === "stderr") stderrText.push(data);
            // Simulate a busy renderer while keeping xterm's real parser/buffer.
            setTimeout(() => term.write(data, callback), 2);
          },
        },
      });
      renderer.attachProcess(processId);
      const transfer = new ZmodemTransferService({ emitIpc() {} });
      const connectionInfo = {
        key: "ssh-output",
        ready: true,
        closeReason: "user",
      };
      const deps = {
        terminalIOMailboxManager: manager,
        childProcesses: new Map([
          [processId, { stream: fixture.stream, ready: true }],
        ]),
        _getMainWindow: () => mainWindow,
        connectionManager: { releaseSSHConnection() {} },
        _unbindConnectionProcess() {},
        _unbindConnectionProcessByProcess() {},
      };
      const output = createTerminalOutput(deps, {
        getTerminalProcessOutputChannel: () => channel,
        IPC_EVENT_CHANNELS,
        getTerminalText: (_config, key) => key,
        StringDecoder,
        logToFile() {},
        zmodemTransferService: transfer,
        filemanagementService: { cleanupTransfersForTab() {} },
      });
      output._setupStreamEventListeners(
        fixture.stream,
        processId,
        { tabId: "ssh-output" },
        connectionInfo,
      );
      const mailbox = manager._getMailbox(processId);
      const { ack, pause } = mailbox.remoteFlow;
      mailbox.remoteFlow.ack = (bytes) => {
        stats.creditGrants++;
        stats.peakPending = Math.max(
          stats.peakPending,
          mailbox.pendingAckBytes + mailbox.bufferedBytes,
        );
        ack(bytes);
      };
      mailbox.remoteFlow.pause = (reason) => {
        stats.pauses++;
        pause(reason);
      };
      const started = performance.now();
      const health = new SshTransportHealth({ timeoutMs: 1000 });
      const healthTimer = setInterval(() => {
        stats.healthChecks++;
        void health.check(fixture.client).then((healthy) => {
          if (healthy === false) stats.healthFailures++;
        });
      }, 100);
      try {
        const writer =
          kind === "stderr"
            ? fixture.remoteStream.stderr
            : fixture.remoteStream;
        for (let row = 0; row < lines; row += 1000) {
          const text = Array.from(
            { length: Math.min(1000, lines - row) },
            (_, i) =>
              `row-${String(row + i).padStart(6, "0")} 中文😀 history\r\n`,
          ).join("");
          expected.update(text);
          await new Promise((resolve, reject) => {
            const timer = setTimeout(
              () =>
                reject(new Error(`SSH ${kind} write stalled at row ${row}`)),
              5000,
            );
            writer.write(text, (error) => {
              clearTimeout(timer);
              if (error) reject(error);
              else resolve();
            });
          });
        }
        await until(() =>
          term.buffer.active
            .getLine(term.buffer.active.baseY + term.buffer.active.cursorY - 1)
            ?.translateToString(true)
            .startsWith(`row-${String(lines - 1).padStart(6, "0")}`),
        );
        await until(
          () =>
            !renderer.activeWrite &&
            renderer.pendingWriteBytes === 0 &&
            renderer.writeQueue.queuedBytes === 0 &&
            stats.ackBytes >= stats.receivedBytes,
        );
        expect(rendered.copy().digest("hex")).toBe(
          emitted.copy().digest("hex"),
        );
        expect(stats.ackBytes).toBe(stats.receivedBytes);
        expect(mailbox.pendingAckBytes).toBe(0);
        expect(fixture.client.destroyed).toBe(false);
        expect(stats.healthChecks).toBeGreaterThan(0);
        expect(stats.healthFailures).toBe(0);
        // Renderer ACKs are the core's credit: output in flight stays near
        // the mailbox threshold without any pause in the main process.
        expect(stats.creditGrants).toBeGreaterThan(0);
        expect(stats.pauses).toBe(0);
        expect(stats.peakInFlight).toBeLessThan(640 * 1024);
        expect(stats.peakPending).toBeLessThan(8 * 1024 * 1024);
        if (kind === "stdout") {
          expect(emitted.copy().digest("hex")).toBe(
            expected.copy().digest("hex"),
          );
          expect(term.buffer.normal.length).toBe(500000 + term.rows);
        } else {
          const plain = stderrText.join("").replace(/\x1b\[[0-9;]*m/g, "");
          expect(createHash("sha256").update(plain).digest("hex")).toBe(
            expected.digest("hex"),
          );
        }
        console.log(
          `SSH_OUTPUT pipe ${kind}`,
          JSON.stringify({
            ...stats,
            lines,
            elapsedMs: Math.round(performance.now() - started),
          }),
        );
      } finally {
        clearInterval(healthTimer);
        health.dispose();
        closing = true;
        renderer.destroy();
        manager.destroyProcess(processId);
        transfer.destroyAll();
        await fixture.close();
        term.dispose();
        vi.unstubAllGlobals();
      }
    },
  );
  it("keeps a busy SSH transport alive, then detects a real half-open connection", async () => {
    const fixture = await createFixture("raw");
    const pool = new SSHPool();
    const key = "output-fixture";
    const conn = {
      key,
      client: fixture.client,
      ready: true,
      refCount: 1,
      lastUsed: Date.now(),
      config: { host: "127.0.0.1", port: 22, username: "output" },
    };
    pool.connections.set(key, conn);
    pool.transportHealth.timeoutMs = 150;
    const lost = [];
    pool.on("connectionLost", (event) => lost.push(event));
    let received = 0;
    fixture.stream.on("data", (data) => {
      received += data.length;
    });
    try {
      for (let i = 0; i < 4; i++) {
        const check = pool.performHealthCheck();
        fixture.remoteStream.write(Buffer.alloc(64 * 1024, 65 + i));
        await check;
        expect(received).toBeGreaterThan(0);
        expect(
          conn.ready,
          "receiving shell output proves the SSH transport is alive",
        ).toBe(true);
        expect(lost).toHaveLength(0);
      }
      await pool.performHealthCheck();
      expect(conn.ready).toBe(true);

      fixture.remote._sock.pause();
      await pool.performHealthCheck();
      expect(conn.ready).toBe(false);
      expect(lost).toHaveLength(1);
    } finally {
      pool.cleanup();
      await fixture.close();
    }
  });
});
