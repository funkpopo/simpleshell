import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Short idle timeout so reclaim is observable; set before the core starts.
process.env.SIMPLESHELL_HUB_IDLE_MS = "400";

const require = createRequire(import.meta.url);
for (const [name, exports] of [
  ["logger", { logToFile: () => {} }],
  ["crashReporter", { recordCrashMarker: () => {} }],
]) {
  const filename = require.resolve(`../../src/main/utils/${name}`);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const nativeSftp = require("../../src/main/native/nativeSftpClient");
const TransferScheduler = require("../../src/main/file-transfer/transferScheduler");
const {
  shutdownCoreSupervisors,
} = require("../../src/main/native/coreSupervisor");
const { createSftpLoopback } = require("../fixtures/sftp-loopback");

async function waitFor(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("SFTP over shared hub connections", () => {
  let root;
  let server;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-sharing-"));
    fs.mkdirSync(path.join(root, "remote"));
    fs.mkdirSync(path.join(root, "local"));
    server = await createSftpLoopback(path.join(root, "remote"));
  });

  afterAll(async () => {
    await shutdownCoreSupervisors();
    await server?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const list = (config, sessionKey) =>
    nativeSftp.invokeNativeRequestWithConfig(
      config,
      { operation: "listFiles", path: "/" },
      { sessionKey },
    );

  it("serves independent SFTP sessions from one SSH connection", async () => {
    const before = { ...server.stats };
    const results = await Promise.all(
      ["tab-a", "tab-b", "tab-c"].map((key) => list(server.config, key)),
    );
    expect(results.every((result) => result.success)).toBe(true);
    expect(server.stats.connections - before.connections).toBe(1);
    expect(server.stats.sftpChannels - before.sftpChannels).toBe(3);

    // Other credentials never share a connection.
    await list({ ...server.config, username: "someone-else" }, "tab-d");
    expect(server.stats.connections - before.connections).toBe(2);
    for (const key of ["tab-a", "tab-b", "tab-c", "tab-d"]) {
      nativeSftp.closeNativeSession(key);
    }
  });

  it("closes idle connections after their last session ends", async () => {
    await waitFor(() => server.stats.active === 0);
    await list(server.config, "idle-check");
    expect(server.stats.active).toBe(1);
    nativeSftp.closeNativeSession("idle-check");
    await waitFor(() => server.stats.active === 0);
  });

  it("runs a batch on one connection with one channel per concurrency slot", async () => {
    const count = 40;
    for (let index = 0; index < count; index += 1) {
      fs.writeFileSync(
        path.join(root, "local", `f${index}.txt`),
        `file ${index}`,
      );
    }
    const before = { ...server.stats };
    const scheduler = new TransferScheduler({ maxWorkers: 4 });
    try {
      const result = await scheduler.runTasks({
        transferKey: "batch",
        tabId: "tab-batch",
        sshConfig: server.config,
        maxConcurrency: 4,
        tasks: Array.from({ length: count }, (_, index) => ({
          taskId: String(index),
          direction: "upload",
          localPath: path.join(root, "local", `f${index}.txt`),
          remotePath: `/batch/f${index}.txt`,
        })),
      });
      expect(result.completed).toBe(count);
      expect(server.stats.connections - before.connections).toBe(1);
      expect(
        server.stats.sftpChannels - before.sftpChannels,
      ).toBeLessThanOrEqual(4);
      expect(
        fs.readFileSync(path.join(root, "remote", "batch", "f39.txt"), "utf8"),
      ).toBe("file 39");
    } finally {
      await scheduler.shutdown();
    }
  });
});
