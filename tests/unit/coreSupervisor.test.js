import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";

const require = createRequire(import.meta.url);
vi.mock("../../src/main/utils/logger", () => ({ logToFile: () => {} }));
const protocol = require("../../src/main/native/coreProtocol");
const crashReporter = require("../../src/main/utils/crashReporter");
crashReporter.recordCrashMarker = () => null;
const { CoreSupervisor } = require("../../src/main/native/coreSupervisor");

/** In-process stand-in for `simpleshell-core serve`. */
class FakeCore extends EventEmitter {
  constructor(behavior = {}) {
    super();
    this.pid = 4000 + FakeCore.count++;
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.controls = [];
    this.data = new Map();
    this.behavior = behavior;
    const decoder = new protocol.FrameDecoder();
    this.stdin.on("data", (chunk) => {
      for (const frame of decoder.push(chunk)) this.onFrame(frame);
    });
    if (behavior.ready !== false)
      this.control({
        op: "ready",
        version: "test",
        pid: this.pid,
        role: "core",
        services: [],
      });
  }

  // Replies are asynchronous, as they are through a real pipe.
  control(message) {
    setImmediate(() => this.stdout.write(protocol.encodeControl(message)));
  }

  send(stream, text) {
    const frames = protocol.encodeData(stream, Buffer.from(text));
    setImmediate(() => frames.forEach((frame) => this.stdout.write(frame)));
  }

  onFrame(frame) {
    if (frame.kind === protocol.FRAME_KIND.DATA) {
      const text = frame.payload.toString();
      this.data.set(frame.stream, (this.data.get(frame.stream) || "") + text);
      if (this.behavior.echo) this.send(frame.stream, text);
      return;
    }
    const message = protocol.parseControl(frame.payload);
    this.controls.push(message);
    if (message.op === "eof")
      this.control({ op: "exit", stream: message.stream, code: 0 });
    if (message.op === "kill")
      this.control({
        op: "exit",
        stream: message.stream,
        code: null,
        signal: "SIGTERM",
      });
    if (message.op === "ping" && this.behavior.pong !== false)
      this.control({ op: "pong", id: message.id });
    if (message.op === "shutdown") this.crash(0, null);
  }

  crash(code = null, signal = "SIGKILL") {
    setImmediate(() => {
      this.stdout.end();
      this.emit("exit", code, signal);
    });
  }

  kill() {
    this.crash(null, "SIGTERM");
    return true;
  }
}
FakeCore.count = 0;

function createSupervisor(behavior, options = {}) {
  const cores = [];
  const supervisor = new CoreSupervisor({
    locate: () => "simpleshell-core",
    spawn: () => {
      const core = new FakeCore(behavior);
      cores.push(core);
      return core;
    },
    log: () => {},
    pingIntervalMs: 0,
    ...options,
  });
  return { supervisor, cores };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
// The fake core answers through setImmediate, which must stay real.
const TIMERS = {
  toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
};

describe("core frame protocol", () => {
  it("round-trips control and data frames across arbitrary chunk boundaries", () => {
    const bytes = Buffer.concat([
      protocol.encodeControl({
        op: "open",
        stream: 3,
        service: "zmodem-serve",
        args: [],
      }),
      ...protocol.encodeData(3, Buffer.from("中文😀\n")),
      protocol.encodeFrame(protocol.FRAME_KIND.DATA, 4, Buffer.alloc(0)),
    ]);
    const decoder = new protocol.FrameDecoder();
    const frames = [];
    for (const byte of bytes) frames.push(...decoder.push(Buffer.from([byte])));
    expect(frames).toHaveLength(3);
    expect(protocol.parseControl(frames[0].payload)).toEqual({
      schemaVersion: 1,
      op: "open",
      stream: 3,
      service: "zmodem-serve",
      args: [],
    });
    expect(frames[1]).toMatchObject({
      kind: protocol.FRAME_KIND.DATA,
      stream: 3,
    });
    expect(frames[1].payload.toString()).toBe("中文😀\n");
    expect(frames[2].payload.length).toBe(0);
  });

  it("splits large data and rejects malformed frames", () => {
    const frames = protocol.encodeData(
      1,
      Buffer.alloc(protocol.DATA_CHUNK_BYTES * 2 + 1),
    );
    expect(frames).toHaveLength(3);
    const decoded = new protocol.FrameDecoder().push(Buffer.concat(frames));
    expect(decoded.reduce((sum, frame) => sum + frame.payload.length, 0)).toBe(
      protocol.DATA_CHUNK_BYTES * 2 + 1,
    );

    const unknown = protocol.encodeFrame(
      protocol.FRAME_KIND.DATA,
      1,
      Buffer.from("x"),
    );
    unknown.writeUInt8(9, 4);
    expect(() => new protocol.FrameDecoder().push(unknown)).toThrow(
      /unknown frame kind/,
    );
    const huge = Buffer.alloc(4);
    huge.writeUInt32LE(protocol.MAX_FRAME_PAYLOAD + 6);
    expect(() => new protocol.FrameDecoder().push(huge)).toThrow(/exceeds/);
    expect(() =>
      protocol.parseControl(Buffer.from('{"schemaVersion":2,"op":"ping"}')),
    ).toThrow(/schemaVersion/);
  });
});

describe("CoreSupervisor", () => {
  afterEach(() => vi.useRealTimers());

  it("presents a service stream as a child process over one shared core", async () => {
    const { supervisor, cores } = createSupervisor({ echo: true });
    const first = supervisor.spawnService("diagnostic-echo");
    const second = supervisor.spawnService("sftp-session", ["--flag"]);
    await once(first, "spawn");
    expect(cores).toHaveLength(1);
    expect(first.pid).toBe(cores[0].pid);
    expect(second.pid).toBe(first.pid);
    expect(
      cores[0].controls.filter((message) => message.op === "open"),
    ).toEqual([
      {
        schemaVersion: 1,
        op: "open",
        stream: 1,
        service: "diagnostic-echo",
        args: [],
      },
      {
        schemaVersion: 1,
        op: "open",
        stream: 2,
        service: "sftp-session",
        args: ["--flag"],
      },
    ]);

    let output = "";
    first.stdout.on("data", (chunk) => {
      output += chunk;
    });
    first.stdin.write("hello\n");
    await vi.waitFor(() => expect(output).toBe("hello\n"));
    expect(cores[0].data.get(1)).toBe("hello\n");

    const events = [];
    first.on("exit", (code, signal) => events.push(["exit", code, signal]));
    first.on("close", (code, signal) => events.push(["close", code, signal]));
    first.stdin.end();
    await once(first, "close");
    expect(events).toEqual([
      ["exit", 0, null],
      ["close", 0, null],
    ]);
    expect(supervisor.getStats()).toMatchObject({
      openStreams: 1,
      running: true,
      restarts: 0,
    });
  });

  it("reports stream errors on stderr and kill as SIGTERM", async () => {
    const { supervisor, cores } = createSupervisor({});
    const failing = supervisor.spawnService("checksum-file");
    let stderr = "";
    failing.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    await tick();
    cores[0].control({
      op: "exit",
      stream: failing.streamId,
      code: 1,
      error: "bad request",
    });
    const [code] = await once(failing, "close");
    expect(code).toBe(1);
    expect(stderr).toBe("bad request\n");

    const killed = supervisor.spawnService("zmodem-serve");
    expect(killed.kill()).toBe(true);
    expect(killed.killed).toBe(true);
    const [killCode, signal] = await once(killed, "exit");
    expect([killCode, signal]).toEqual([null, "SIGTERM"]);
    expect(killed.kill()).toBe(false);
    // Writes after exit are dropped instead of raising EPIPE.
    killed.stdin.write("late");
  });

  it("ends every stream when the core dies and restarts on the next spawn", async () => {
    const { supervisor, cores } = createSupervisor({});
    const crashes = [];
    supervisor.on("crash", (event) => crashes.push(event));
    const streams = [
      supervisor.spawnService("zmodem-serve"),
      supervisor.spawnService("sftp-session"),
    ];
    await tick();
    const exits = streams.map((stream) => once(stream, "close"));
    let stderr = "";
    streams[0].stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    cores[0].crash(null, "SIGKILL");
    const results = await Promise.all(exits);
    expect(results).toEqual([
      [null, "SIGKILL"],
      [null, "SIGKILL"],
    ]);
    expect(stderr).toMatch(/simpleshell-core exited/);
    expect(crashes).toEqual([expect.objectContaining({ streams: 2 })]);

    const next = supervisor.spawnService("zmodem-serve");
    await once(next, "spawn");
    expect(cores).toHaveLength(2);
    expect(next.pid).toBe(cores[1].pid);
    expect(supervisor.restarts).toBe(1);
  });

  it("backs off restarts while the core keeps crashing", async () => {
    vi.useFakeTimers(TIMERS);
    const { supervisor, cores } = createSupervisor({});
    supervisor.spawnService("a");
    cores[0].crash();
    await tick();
    supervisor.spawnService("b");
    cores[1].crash();
    await tick();
    const delayed = supervisor.spawnService("c");
    expect(cores).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(249);
    expect(cores).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(cores).toHaveLength(3);
    expect(cores[2].controls).toContainEqual(
      expect.objectContaining({ op: "open", service: "c" }),
    );
    expect(delayed.pid).toBe(cores[2].pid);
  });

  it("fails streams with ENOENT when the binary is missing", async () => {
    const supervisor = new CoreSupervisor({
      locate: () => null,
      log: () => {},
    });
    const stream = supervisor.spawnService("zmodem-serve");
    const [error] = await once(stream, "error");
    expect(error.code).toBe("ENOENT");
  });

  it("kills a core that stops answering pings", async () => {
    vi.useFakeTimers(TIMERS);
    const { supervisor, cores } = createSupervisor(
      { pong: false },
      { pingIntervalMs: 1000, pingTimeoutMs: 500 },
    );
    const stream = supervisor.spawnService("zmodem-serve");
    const closed = once(stream, "close");
    await vi.advanceTimersByTimeAsync(1000);
    await tick();
    expect(cores[0].controls).toContainEqual({
      schemaVersion: 1,
      op: "ping",
      id: 1,
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(await closed).toEqual([null, "SIGTERM"]);
  });

  it("shuts the core down without reporting a crash", async () => {
    const { supervisor, cores } = createSupervisor({});
    const crash = vi.fn();
    supervisor.on("crash", crash);
    supervisor.spawnService("zmodem-serve");
    await supervisor.shutdown();
    expect(cores[0].controls).toContainEqual({
      schemaVersion: 1,
      op: "shutdown",
    });
    expect(crash).not.toHaveBeenCalled();
    expect(supervisor.getStats().running).toBe(false);
  });
});
