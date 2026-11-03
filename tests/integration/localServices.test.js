import { describe, it, expect, afterAll } from "vitest";
import { createRequire } from "node:module";
import { once } from "node:events";
import net from "node:net";

const require = createRequire(import.meta.url);
for (const [name, exports] of [
  ["logger", { logToFile: () => {} }],
  ["crashReporter", { recordCrashMarker: () => {} }],
]) {
  const filename = require.resolve(`../../src/main/utils/${name}`);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const { spawnPty } = require("../../src/main/native/nativePty");
const { NativeTelnet } = require("../../src/main/native/nativeTelnet");
const { NativeSerialPort } = require("../../src/main/native/nativeSerialPort");
const SerialConnectionPool = require("../../src/main/connection/serial-connection-pool");
const LocalTerminalManager = require("../../src/main/local-terminal/local-terminal-manager");
const TerminalIOMailboxManager = require("../../src/main/terminal/terminalIOMailboxManager");
const localSystem = require("../../src/main/system-info/local-system");
const metricsSample = require("../../src/main/system-info/metrics-sample");
const {
  shutdownCoreSupervisors,
} = require("../../src/main/native/coreSupervisor");

const isWindows = process.platform === "win32";
const ENTER = isWindows ? "\r\n" : "\n";

async function waitFor(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Answers ConPTY's start-up cursor query the way xterm.js does. */
function answerCursorQuery(text, write) {
  if (isWindows && text.includes("\x1b[6n")) write("\x1b[1;1R");
}

afterAll(() => shutdownCoreSupervisors());

describe("local services in simpleshell-core (replacing Node addons)", () => {
  it("runs a local shell on a pseudo terminal like node-pty", async () => {
    const pty = await spawnPty(
      isWindows ? "cmd.exe" : "/bin/sh",
      isWindows ? ["/Q"] : [],
      { cols: 100, rows: 30, env: { ...process.env, PTY_MARK: "m-7" } },
    );
    expect(pty.pid).toBeGreaterThan(0);
    let text = "";
    pty.onData((data) => {
      text += data;
      answerCursorQuery(data, (reply) => pty.write(reply));
    });
    const exited = new Promise((resolve) => pty.onExit(resolve));
    pty.write(
      isWindows ? `echo v=%PTY_MARK%${ENTER}` : `echo v=$PTY_MARK${ENTER}`,
    );
    await waitFor(() => text.includes("v=m-7"));
    pty.resize(120, 40);
    pty.write(`exit 3${ENTER}`);
    expect(await exited).toMatchObject({ exitCode: 3 });

    await expect(
      spawnPty("simpleshell-no-such-program", []),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("serves local terminal tabs through the mailbox", async () => {
    let output = "";
    const window = {
      isDestroyed: () => false,
      webContents: {
        send: (_channel, payload) => {
          for (const message of [].concat(payload)) {
            if (typeof message?.data === "string") output += message.data;
          }
        },
      },
    };
    const mailboxes = new TerminalIOMailboxManager({
      getMainWindow: () => window,
    });
    const manager = new LocalTerminalManager({
      terminalIOMailboxManager: mailboxes,
      getMainWindow: () => window,
    });
    const exits = [];
    manager.on("terminalExited", (event) => exits.push(event));
    const started = await manager.startEmbeddedTerminal(
      { type: isWindows ? "cmd" : "shell" },
      "local-tab-1",
      { cols: 100, rows: 30 },
    );
    const terminal = manager.activeTerminals.get("local-tab-1");
    expect(started.pid).toBeGreaterThan(0);
    await waitFor(() => output.length > 0 || !isWindows);
    answerCursorQuery(output, (reply) => terminal.process.write(reply));
    terminal.process.write(`echo local-ok${ENTER}`);
    await waitFor(() => output.includes("local-ok"));
    await manager.closeTerminal("local-tab-1");
    await waitFor(() => exits.length === 1 || !manager.activeTerminals.size);
  });

  it("connects, logs in and reports the window size over Telnet", async () => {
    const received = [];
    const server = net.createServer((socket) => {
      // DO NAWS, WILL ECHO; then a login exchange and an echoing prompt.
      socket.write(Buffer.from([255, 253, 31, 255, 251, 1]));
      socket.write("box login: ");
      let stage = 0;
      socket.on("data", (chunk) => {
        received.push(chunk);
        const text = Buffer.concat(received).toString("latin1");
        if (stage === 0 && text.includes("tester\r\n")) {
          stage = 1;
          socket.write("\r\nPassword: ");
        } else if (stage === 1 && text.includes("secret\r\n")) {
          stage = 2;
          socket.write("\r\nwelcome\r\n$ ");
        } else if (stage === 2 && text.includes("bye\r")) {
          socket.end("\r\nlogout\r\n");
        }
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const telnet = new NativeTelnet();
      let text = "";
      telnet.on("data", (chunk) => {
        text += chunk.toString("utf8");
      });
      await telnet.connect({
        host: "127.0.0.1",
        port: server.address().port,
        username: "tester",
        password: "secret",
        timeout: 5000,
      });
      await waitFor(() => text.includes("$ "));
      telnet.setWindow(40, 132);
      const sent = () => Buffer.concat(received);
      // NAWS: 132 x 40 once the server asked for it.
      await waitFor(() =>
        sent().includes(Buffer.from([255, 250, 31, 0, 132, 0, 40, 255, 240])),
      );
      const ended = once(telnet, "end");
      telnet.write("bye\r");
      await ended;
      expect(text).toContain("logout");

      const refused = new NativeTelnet();
      await expect(
        refused.connect({ host: "127.0.0.1", port: 1, timeout: 8000 }),
      ).rejects.toMatchObject({
        code: expect.stringMatching(/ECONNREFUSED|ETIMEDOUT/),
      });
    } finally {
      server.close();
    }
  });

  it("lists serial ports and classifies a missing one", async () => {
    const ports = await NativeSerialPort.list();
    expect(Array.isArray(ports)).toBe(true);

    const pool = new SerialConnectionPool({});
    const error = await pool
      .createConnection(
        { path: isWindows ? "COM239" : "/dev/simpleshell-no-such-tty" },
        "serial:test",
      )
      .catch((failure) => failure);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("ENOENT");
    expect(error.serialConfig).toMatchObject({ protocol: "serial" });
    expect(pool.connections.size).toBe(0);
  });

  it("samples local metrics with rates, processes and disks", async () => {
    const first = await metricsSample.getLocalMetricsSample();
    expect(first.cpu).toBeGreaterThanOrEqual(0);
    expect(first.memory.total).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = await metricsSample.getLocalMetricsSample();
    expect(typeof second.net.rxPerSec).toBe("number");
    expect(typeof second.diskIo.readPerSec).toBe("number");
    expect(second.disks.length).toBeGreaterThan(0);

    const disks = await metricsSample.getLocalDiskUsage();
    expect(disks[0]).toMatchObject({
      mount: expect.any(String),
      usedPercent: expect.any(Number),
    });
    const processes = await localSystem.getProcessList();
    expect(processes.some((entry) => entry.pid === process.pid)).toBe(true);
    expect(await localSystem.getCpuUsage()).toBeGreaterThanOrEqual(0);
  });
});
