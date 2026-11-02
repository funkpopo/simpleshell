import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "node:module";
import { once } from "node:events";

const require = createRequire(import.meta.url);
const { nativeHostPath } = require("../helpers/nativeHost");
const {
  CoreSupervisor,
  roleForService,
  getCoreSupervisor,
} = require("../../src/main/native/coreSupervisor");

const supervisors = [];
function createSupervisor(role = "core") {
  const supervisor = new CoreSupervisor({
    role,
    locate: nativeHostPath,
    log: () => {},
  });
  supervisors.push(supervisor);
  return supervisor;
}

function collect(stream) {
  const state = { text: "" };
  stream.stdout.on("data", (chunk) => {
    state.text += chunk.toString("utf8");
  });
  return state;
}

async function waitFor(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("simpleshell-core supervisor", () => {
  afterEach(async () => {
    await Promise.all(
      supervisors.splice(0).map((supervisor) => supervisor.shutdown()),
    );
  });

  it("hosts many streams in one process and isolates a panicking stream", async () => {
    const supervisor = createSupervisor();
    const first = supervisor.spawnService("diagnostic-echo");
    const second = supervisor.spawnService("diagnostic-echo");
    await once(first, "spawn");
    expect(first.pid).toBeGreaterThan(0);
    expect(second.pid).toBe(first.pid);

    const secondOutput = collect(second);
    let firstError = "";
    first.stderr.on("data", (chunk) => {
      firstError += chunk;
    });
    first.stdin.write("panic\n");
    const [code] = await once(first, "close");
    expect(code).toBe(101);
    expect(firstError).toMatch(/diagnostic panic requested/);

    second.stdin.write("still here 中文\n");
    await waitFor(() => secondOutput.text === "still here 中文\n");
    second.stdin.end();
    expect(await once(second, "close")).toEqual([0, null]);
    expect(supervisor.getStats()).toMatchObject({
      running: true,
      restarts: 0,
      openStreams: 0,
    });
  });

  it("kills a stream together with its background tasks", async () => {
    const supervisor = createSupervisor();
    const stream = supervisor.spawnService("diagnostic-echo");
    const output = collect(stream);
    stream.stdin.write("ticker\n");
    await waitFor(() => output.text.includes("tick"));
    stream.kill();
    expect(await once(stream, "exit")).toEqual([null, "SIGTERM"]);
    const after = output.text.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(output.text.length).toBe(after);
  });

  it("recovers from a killed core process on the next spawn", async () => {
    const supervisor = createSupervisor();
    const crashes = [];
    supervisor.on("crash", (event) => crashes.push(event));
    const stream = supervisor.spawnService("diagnostic-echo");
    await once(stream, "spawn");
    const firstPid = stream.pid;
    process.kill(firstPid);
    const [, signal] = await once(stream, "close");
    expect(
      signal === "SIGTERM" || signal === "SIGKILL" || signal === null,
    ).toBe(true);
    expect(crashes).toHaveLength(1);

    const next = supervisor.spawnService("diagnostic-echo");
    const output = collect(next);
    await once(next, "spawn");
    expect(next.pid).not.toBe(firstPid);
    next.stdin.write("back\n");
    await waitFor(() => output.text === "back\n");
    expect(supervisor.restarts).toBe(1);
  });

  it("runs one-shot services and routes auxiliary services to a separate role", async () => {
    expect(roleForService("latency-serve")).toBe("aux");
    expect(roleForService("ai-serve")).toBe("aux");
    expect(roleForService("sftp-session")).toBe("core");

    const core = createSupervisor("core");
    const aux = createSupervisor("aux");
    const zmodem = core.spawnService("zmodem-serve");
    const latency = aux.spawnService("latency-serve");
    const zmodemOutput = collect(zmodem);
    const latencyOutput = collect(latency);
    await waitFor(
      () =>
        zmodemOutput.text.includes('"ready"') &&
        latencyOutput.text.includes('"ready"'),
    );
    expect(zmodem.pid).not.toBe(latency.pid);
    expect(core.ready.role).toBe("core");
    expect(aux.ready.role).toBe("aux");

    const unknown = core.spawnService("no-such-service");
    let stderr = "";
    unknown.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    expect((await once(unknown, "close"))[0]).toBe(1);
    expect(stderr).toMatch(/unsupported service/);
  });

  it("re-establishes SFTP sessions after the shared core is killed", async () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const { createSftpLoopback } = require("../fixtures/sftp-loopback");
    const nativeSftp = require("../../src/main/native/nativeSftpClient");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "core-recovery-"));
    fs.writeFileSync(path.join(root, "file.txt"), "x");
    const server = await createSftpLoopback(root);
    const shared = getCoreSupervisor("core");
    try {
      const list = () =>
        nativeSftp.invokeNativeRequestWithConfig(
          server.config,
          { operation: "listFiles", path: "/" },
          { sessionKey: "core-recovery" },
        );
      expect((await list()).data.map((entry) => entry.name)).toEqual([
        "file.txt",
      ]);
      const firstPid = shared.getStats().pid;
      process.kill(firstPid);
      await waitFor(() => shared.getStats().running === false);
      // The dead session is retired; the next request opens a new one.
      const result = await list().catch(() => list());
      expect(result.data.map((entry) => entry.name)).toEqual(["file.txt"]);
      expect(shared.getStats().pid).not.toBe(firstPid);
      expect(server.stats.connections).toBe(2);
    } finally {
      nativeSftp.closeNativeSession("core-recovery");
      await shared.shutdown();
      await server.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
