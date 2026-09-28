const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { fork, execFileSync } = require("node:child_process");
const { once } = require("node:events");
const { performance, monitorEventLoopDelay } = require("node:perf_hooks");
const { Client } = require("ssh2");
const {
  NativePortForwardingClient,
} = require("../src/main/native/nativePortForwardingClient");
const HOST = [127, 0, 0, 1].join(".");

const binary =
  process.env.SIMPLESHELL_NATIVE_SERVICES_PATH ||
  path.resolve(
    __dirname,
    "../native-services/desktop-host/target/release",
    process.platform === "win32"
      ? "simpleshell-native-services.exe"
      : "simpleshell-native-services",
  );
const fixturePath = path.join(
  __dirname,
  "fixtures/port-forwarding-benchmark.js",
);
function child(file) {
  return fork(file, [], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "inherit", "ipc"],
  });
}
function reply(worker, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.kill();
      reject(new Error("benchmark worker timeout"));
    }, 60000);
    const received = (value) => {
      clearTimeout(timeout);
      worker.removeListener("exit", exited);
      resolve(value);
    };
    const exited = () => {
      clearTimeout(timeout);
      worker.removeListener("message", received);
      reject(new Error("benchmark worker exited"));
    };
    worker.once("message", received);
    worker.once("exit", exited);
    worker.send(message);
  });
}
function peakWorkingSet(pid) {
  if (process.platform !== "win32") return null;
  return Number(
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Process -Id ${Number(pid)}).PeakWorkingSet64`,
      ],
      { windowsHide: true, encoding: "utf8" },
    ).trim(),
  );
}
async function sample(mode, bytes) {
  const server = child(fixturePath);
  const traffic = child(fixturePath);
  const native = new NativePortForwardingClient({ locate: () => binary });
  const baseline = new Client();
  let listener;
  const sockets = new Set();
  try {
    const fixture = await reply(server, { kind: "server" });
    // The product's previous path reused an already authenticated terminal transport.
    if (mode === "node") {
      baseline.connect({
        ...fixture.ssh,
        hostHash: "sha256",
        hostVerifier: (hash) =>
          `SHA256:${hash}` === fixture.ssh.expectedHostFingerprint,
      });
      await once(baseline, "ready");
    }
    const startup = performance.now();
    let port;
    if (mode === "native") {
      const result = await native.start("benchmark", 1, fixture.ssh, [
        {
          id: "L",
          type: "local",
          listenHost: HOST,
          listenPort: 0,
          targetHost: HOST,
          targetPort: fixture.targetPort,
        },
      ]);
      port = result.bindings[0].port;
    } else {
      listener = net.createServer({ allowHalfOpen: true }, (socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        baseline.forwardOut(
          HOST,
          socket.remotePort,
          HOST,
          fixture.targetPort,
          (error, stream) => {
            if (error) return socket.destroy(error);
            socket.on("error", () => stream.destroy());
            stream.on("error", () => socket.destroy());
            socket.pipe(stream).pipe(socket);
          },
        );
      });
      listener.listen(0, HOST);
      await once(listener, "listening");
      port = listener.address().port;
    }
    const startupMs = performance.now() - startup;
    const loop = monitorEventLoopDelay({ resolution: 1 });
    loop.enable();
    const cpu = process.cpuUsage();
    const start = performance.now();
    const transfer = await reply(traffic, { kind: "traffic", port, bytes });
    const elapsedMs = performance.now() - start;
    const usedCpu = process.cpuUsage(cpu);
    loop.disable();
    assert.equal(transfer.verified, true);
    const mainPeakBytes =
      peakWorkingSet(process.pid) || process.resourceUsage().maxRSS * 1024;
    const nativePeakBytes = native.child ? peakWorkingSet(native.child.pid) : 0;
    return {
      mode,
      bytes,
      startupMs,
      elapsedMs,
      throughputMiBs: bytes / 1048576 / (elapsedMs / 1000),
      mainCpuMs: (usedCpu.user + usedCpu.system) / 1000,
      eventLoopP95Ms: loop.percentile(95) / 1e6,
      mainPeakBytes,
      nativePeakBytes,
      peakWorkingSetSumBytes:
        nativePeakBytes === null ? null : mainPeakBytes + nativePeakBytes,
    };
  } finally {
    await native.stop();
    for (const socket of sockets) socket.destroy();
    listener?.close();
    baseline.end();
    if (server.connected) server.disconnect();
    traffic.kill();
    const exited = new Promise((resolve) => {
      if (server.exitCode !== null) resolve();
      else server.once("exit", resolve);
    });
    const timer = setTimeout(() => server.kill(), 3000);
    await exited;
    clearTimeout(timer);
  }
}

async function main() {
  const samples = [];
  for (let repeat = 0; repeat < 3; repeat++) {
    for (const mode of ["node", "native"]) {
      const worker = child(__filename);
      try {
        const result = await reply(worker, { mode, bytes: 128 * 1024 * 1024 });
        samples.push(result);
        console.log(
          `${mode} #${repeat + 1}: ${result.throughputMiBs.toFixed(1)} MiB/s, main CPU ${result.mainCpuMs.toFixed(1)} ms, p95 ${result.eventLoopP95Ms.toFixed(2)} ms`,
        );
      } finally {
        if (worker.connected) worker.disconnect();
      }
    }
  }
  const report = {
    date: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    fixture:
      "separate SSH server and traffic processes, 128 MiB upload via -L, SHA-256 verified; Node uses a preconnected SSH transport; native includes a new process and handshake in startupMs",
    memory:
      "sum of per-process peak working sets, an upper bound rather than simultaneous process-tree RSS; fixture and traffic workers excluded",
    samples,
  };
  const output = process.argv[2];
  if (output) fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  else console.log(JSON.stringify(report, null, 2));
}

if (process.send)
  process.once("message", async ({ mode, bytes }) => {
    try {
      process.send(await sample(mode, bytes));
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
      process.disconnect();
    }
  });
else
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
