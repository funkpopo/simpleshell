const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { fork } = require("node:child_process");
const { createSftpLoopback } = require("./fixtures/sftp-loopback");
const { loadTransferRuntime } = require("./fixtures/sftp-transfer-runtime");
const { loadFileService } = require("./fixtures/sftp-service-runtime");

async function main() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "simpleshell-sftp-"));
  const remoteRoot = path.join(root, "remote");
  await fsp.mkdir(remoteRoot);
  const server = await createSftpLoopback(remoteRoot);
  const runtime = loadTransferRuntime();
  const evidence = [];
  const { config } = server;
  const data = crypto.randomBytes(4 * 1024 * 1024 + 173);
  const source = path.join(root, "source.bin");
  await fsp.writeFile(source, data);
  await fsp.writeFile(server.resolve("/source.bin"), data);
  const call = (request) =>
    runtime.native
      .invokeNativeRequestWithConfig(config, request, {
        sessionKey: "fixture-primitives",
      })
      .then(runtime.native.requireNativeSuccess);
  const run = (options) => runtime.createRunner({ root, config, ...options });
  const check = async (name, test) => {
    await test();
    evidence.push(name);
    console.log(`[sftp] PASS ${name}`);
  };
  try {
    await check(
      "native stat, MD5, SHA-256, ranges, missing and unsupported errors",
      async () => {
        const stat = await call({ operation: "statFile", path: "/source.bin" });
        assert.equal(stat.stats.size, data.length);
        for (const algorithm of ["md5", "sha256"]) {
          const result = await call({
            operation: "checksumFile",
            path: "/source.bin",
            algorithm,
          });
          assert.equal(
            result.digest,
            crypto.createHash(algorithm).update(data).digest("hex"),
          );
        }
        const result = await call({
          operation: "checksumFile",
          path: "/source.bin",
          algorithm: "sha256",
          segmentOffset: 31,
          segmentLength: 717,
        });
        assert.equal(
          result.digest,
          crypto
            .createHash("sha256")
            .update(data.subarray(31, 748))
            .digest("hex"),
        );
        await assert.rejects(
          call({ operation: "statFile", path: "/absent" }),
          (error) => error.errorCode === "NATIVE_SFTP_NOT_FOUND",
        );
        await assert.rejects(
          call({
            operation: "checksumFile",
            path: "/source.bin",
            algorithm: "sha1",
          }),
          (error) => !error.retryable,
        );
      },
    );

    for (const direction of ["download", "upload"]) {
      await check(
        `${direction}: sidecar kill retries from a nonzero offset`,
        async () => {
          let killed = false;
          let context;
          const localPath =
            direction === "upload"
              ? source
              : path.join(root, "kill-download.bin");
          const remotePath =
            direction === "upload" ? "/kill-upload.bin" : "/source.bin";
          context = run({
            direction,
            localPath,
            remotePath,
            algorithm: "sha256",
            onProgress: (bytes) => {
              if (!killed && bytes >= 256 * 1024 && bytes < data.length) {
                killed = true;
                for (const entry of context.pool.runningTasks.values())
                  entry.child?.kill();
              }
            },
          });
          const logStart = runtime.logs.length;
          const result = await context.runner.run();
          assert.ok(killed && result.verified);
          const retry = runtime.logs
            .slice(logStart)
            .find((line) => /attempt=2 offset=[1-9]/.test(line));
          assert.ok(
            retry,
            runtime.logs
              .slice(logStart)
              .filter((line) => /segment=|failure/.test(line))
              .join("\n"),
          );
          const target =
            direction === "download" ? localPath : server.resolve(remotePath);
          assert.deepEqual(await fsp.readFile(target), data);
          assert.equal(await context.store.read(context.record), null);
          await context.pool.shutdown();
        },
      );

      await check(
        `${direction}: pause retains manifest, fresh store resumes with verification disabled`,
        async () => {
          let paused = false;
          let context;
          const options = {
            direction,
            localPath:
              direction === "upload"
                ? source
                : path.join(root, "pause-download.bin"),
            remotePath:
              direction === "upload" ? "/pause-upload.bin" : "/source.bin",
          };
          context = run({
            ...options,
            onProgress: (bytes) => {
              if (!paused && bytes >= 256 * 1024) {
                paused = true;
                context.controller.abort(new Error("paused"));
                context.pool.cancelTransfer(context.transferKey);
              }
            },
          });
          await assert.rejects(context.runner.run());
          assert.ok(paused);
          const manifest = await context.store.read(context.record);
          assert.ok(manifest.dirty);
          assert.ok(!JSON.stringify(manifest).includes("password"));
          await context.pool.shutdown();
          const resumed = run(options);
          assert.equal(
            (await resumed.store.list()).filter(
              (item) => item.id === context.record.id,
            ).length,
            1,
          );
          const logStart = runtime.logs.length;
          await resumed.runner.run();
          assert.ok(
            runtime.logs
              .slice(logStart)
              .some((line) => /attempt=1 offset=[1-9]/.test(line)),
          );
          assert.deepEqual(
            await fsp.readFile(
              direction === "upload"
                ? server.resolve(options.remotePath)
                : options.localPath,
            ),
            data,
          );
          await resumed.pool.shutdown();
        },
      );
    }

    await check(
      "parallel segments: a failed segment retries without replaying completed segments",
      async () => {
        let disconnected = false;
        server.control.before = async (operation, client) => {
          if (
            !disconnected &&
            operation.name === "READ" &&
            operation.path === "/source.bin" &&
            operation.offset >= 1024 * 1024 &&
            operation.offset < 2 * 1024 * 1024
          ) {
            disconnected = true;
            client.end();
          }
        };
        const context = run({
          direction: "download",
          localPath: path.join(root, "chunks.bin"),
          remotePath: "/source.bin",
          segmentSize: 1024 * 1024,
          algorithm: "md5",
        });
        const logStart = runtime.logs.length;
        const result = await context.runner.run();
        assert.ok(disconnected && result.verified);
        const retries = runtime.logs
          .slice(logStart)
          .filter((line) => /SFTP .* segment=.*attempt=2/.test(line));
        assert.equal(retries.length, 1);
        assert.match(retries[0], /segment=1 /);
        assert.deepEqual(await fsp.readFile(context.record.localPath), data);
        server.control.before = null;
        await context.pool.shutdown();
      },
    );

    await check(
      "sparse partial download: restart skips persisted completed segments",
      async () => {
        let context;
        let paused = false;
        context = run({
          direction: "download",
          localPath: path.join(root, "sparse.bin"),
          remotePath: "/source.bin",
          segmentSize: 1024 * 1024,
          onProgress: () => {
            if (
              !paused &&
              context.runner.manifest.segments.some((segment) => segment.done)
            ) {
              paused = true;
              context.controller.abort(new Error("paused"));
              context.pool.cancelTransfer(context.transferKey);
            }
          },
        });
        await assert.rejects(context.runner.run());
        const manifest = await context.store.read(context.record);
        const completed = manifest.segments
          .map((segment, index) => (segment.done ? index : -1))
          .filter((index) => index >= 0);
        assert.ok(completed.length > 0);
        assert.equal(
          (await fsp.stat(context.record.partPath)).size,
          data.length,
        );
        await context.pool.shutdown();
        const resumed = run({
          direction: "download",
          localPath: context.record.localPath,
          remotePath: "/source.bin",
          segmentSize: 1024 * 1024,
        });
        const logStart = runtime.logs.length;
        await resumed.runner.run();
        for (const index of completed)
          assert.ok(
            !runtime.logs
              .slice(logStart)
              .some((line) => line.includes(`segment=${index} attempt=`)),
          );
        assert.deepEqual(await fsp.readFile(context.record.localPath), data);
        await resumed.pool.shutdown();
      },
    );

    await check(
      "integrity mismatch: exactly one whole-file retransmission then two hashes in error",
      async () => {
        const localPath = path.join(root, "mismatch.bin");
        let validations = 0;
        const context = run({
          direction: "download",
          localPath,
          remotePath: "/source.bin",
          algorithm: "sha256",
          onState: (state) => {
            if (state !== "validating") return;
            validations += 1;
            const handle = fs.openSync(`${localPath}.part`, "r+");
            fs.writeSync(handle, Buffer.from([validations]), 0, 1, 0);
            fs.closeSync(handle);
          },
        });
        await assert.rejects(
          context.runner.run(),
          (error) =>
            error.errorKind === "integrity-mismatch" &&
            error.localHash !== error.remoteHash &&
            error.retryable === true,
        );
        assert.equal(validations, 2);
        assert.equal(
          (await context.store.read(context.record)).phase,
          "integrity-failed",
        );
        assert.ok(!fs.existsSync(localPath));
        await context.pool.shutdown();
      },
    );

    await check(
      "integrity retransmission succeeds when a single corruption is removed",
      async () => {
        const localPath = path.join(root, "repair.bin");
        let validations = 0;
        const context = run({
          direction: "download",
          localPath,
          remotePath: "/source.bin",
          algorithm: "md5",
          onState: (state) => {
            if (state !== "validating" || ++validations !== 1) return;
            const handle = fs.openSync(`${localPath}.part`, "r+");
            fs.writeSync(handle, Buffer.from([0xff]), 0, 1, 0);
            fs.closeSync(handle);
          },
        });
        const result = await context.runner.run();
        assert.ok(result.verified);
        assert.equal(validations, 2);
        assert.deepEqual(await fsp.readFile(localPath), data);
        await context.pool.shutdown();
      },
    );

    await check(
      "verification disabled: zero checksum requests on uninterrupted transfer",
      async () => {
        const context = run({
          direction: "download",
          localPath: path.join(root, "unchecked.bin"),
          remotePath: "/source.bin",
        });
        const logStart = runtime.logs.length;
        await context.runner.run();
        assert.ok(
          !runtime.logs
            .slice(logStart)
            .some((line) => line.includes("checksumFile")),
        );
        await context.pool.shutdown();
      },
    );

    await check(
      "empty file, Unicode and shell metacharacters preserve exact paths",
      async () => {
        const empty = path.join(root, "empty.bin");
        await fsp.writeFile(empty, "");
        const remotePath = "/空 格 ' $ ; .txt";
        const context = run({
          direction: "upload",
          localPath: empty,
          remotePath,
          algorithm: "sha256",
        });
        assert.ok((await context.runner.run()).verified);
        assert.equal((await fsp.stat(server.resolve(remotePath))).size, 0);
        await context.pool.shutdown();
      },
    );

    for (const direction of ["download", "upload"]) {
      await check(
        `${direction}: process restart recovers persisted state in a new runtime`,
        async () => {
          const options = {
            root,
            config,
            direction,
            localPath:
              direction === "upload"
                ? source
                : path.join(root, "process-restart.bin"),
            remotePath:
              direction === "upload" ? "/process-restart.bin" : "/source.bin",
            algorithm: "sha256",
          };
          server.control.readDelay = 5;
          server.control.writeDelay = 5;
          const childRun = (interrupt) =>
            new Promise((resolve, reject) => {
              const child = fork(
                path.join(__dirname, "fixtures", "sftp-restart-client.js"),
                [],
                { silent: true, windowsHide: true },
              );
              let result;
              let stderr = "";
              child.stderr.on("data", (data) => {
                stderr += data;
              });
              const timer = setTimeout(() => {
                child.kill();
                reject(new Error("Restart fixture timed out"));
              }, 30000);
              child.on("message", async (message) => {
                if (message.type === "checkpoint" && interrupt) {
                  result = message;
                  if (direction === "upload") {
                    const record = new runtime.TransferResumeStore(
                      path.join(root, "registry"),
                    ).describe({
                      ...options,
                      connection: runtime.connectionIdentity(config),
                    });
                    for (
                      let wait = 0;
                      wait < 100 &&
                      fs.statSync(server.resolve(record.partPath)).size === 0;
                      wait += 1
                    ) {
                      await new Promise((ready) => setTimeout(ready, 5));
                    }
                    assert.ok(
                      fs.statSync(server.resolve(record.partPath)).size > 0,
                    );
                  }
                  child.kill();
                  for (const pid of message.pids) {
                    try {
                      process.kill(pid);
                    } catch (error) {
                      if (error.code !== "ESRCH") reject(error);
                    }
                  }
                } else result = message;
              });
              child.on("exit", () => {
                clearTimeout(timer);
                result?.type === "error" || !result
                  ? reject(new Error(result?.error || stderr))
                  : resolve(result);
              });
              child.send({ ...options, interrupt });
            });
          assert.equal((await childRun(true)).type, "checkpoint");
          const resumed = await childRun(false);
          assert.equal(resumed.type, "done");
          assert.ok(resumed.result.verified);
          assert.ok(
            resumed.logs.some((line) => /attempt=1 offset=[1-9]/.test(line)),
          );
          assert.deepEqual(
            await fsp.readFile(
              direction === "upload"
                ? server.resolve(options.remotePath)
                : options.localPath,
            ),
            data,
          );
          server.control.readDelay = 0;
          server.control.writeDelay = 0;
        },
      );
    }

    await check(
      "source changes, corrupt manifests and modified retained bytes fail without truncation",
      async () => {
        for (const kind of ["source", "manifest", "destination"]) {
          const localPath = path.join(root, `conflict-${kind}.bin`);
          const remotePath = `/conflict-${kind}.bin`;
          await fsp.writeFile(server.resolve(remotePath), data);
          let context;
          let paused = false;
          context = run({
            direction: "download",
            localPath,
            remotePath,
            onProgress: (bytes) => {
              if (!paused && bytes >= 256 * 1024) {
                paused = true;
                context.controller.abort(new Error("paused"));
                context.pool.cancelTransfer(context.transferKey);
              }
            },
          });
          await assert.rejects(context.runner.run());
          await context.pool.shutdown();
          if (kind === "source")
            await fsp.appendFile(server.resolve(remotePath), "changed");
          if (kind === "manifest")
            await fsp.writeFile(context.record.manifestPath, "{broken");
          if (kind === "destination") {
            const file = await fsp.open(context.record.partPath, "r+");
            await file.write(Buffer.from([data[0] ^ 0xff]), 0, 1, 0);
            await file.close();
          }
          const retained = await fsp.readFile(context.record.partPath);
          const resumed = run({ direction: "download", localPath, remotePath });
          await assert.rejects(resumed.runner.run(), (error) =>
            [
              "source-changed",
              "resume-manifest-invalid",
              "resume-conflict",
            ].includes(error.errorKind),
          );
          assert.deepEqual(
            await fsp.readFile(context.record.partPath),
            retained,
          );
          await resumed.pool.shutdown();
        }
      },
    );

    await check(
      "remote upload corruption is detected and reports both digests",
      async () => {
        let context;
        let count = 0;
        context = run({
          direction: "upload",
          localPath: source,
          remotePath: "/remote-corrupt.bin",
          algorithm: "sha256",
          onState: (state) => {
            if (state !== "validating") return;
            count += 1;
            const file = fs.openSync(
              server.resolve(context.record.partPath),
              "r+",
            );
            fs.writeSync(file, Buffer.from([data[0] ^ 0xff]), 0, 1, 0);
            fs.closeSync(file);
          },
        });
        await assert.rejects(
          context.runner.run(),
          (error) =>
            error.errorKind === "integrity-mismatch" &&
            error.localHash !== error.remoteHash,
        );
        assert.equal(count, 2);
        assert.ok(!fs.existsSync(server.resolve("/remote-corrupt.bin")));
        await context.pool.shutdown();
      },
    );

    await check(
      "file service: single-task opt-in, pause discovery, resume, restart and cleanup",
      async () => {
        const fixture = loadFileService(root, config);
        const { service, settings, selections, event, events, control, tabId } =
          fixture;
        selections.save = path.join(root, "service-opt-in.bin");
        let enabled = false;
        control.onEvent = (channel, payload) => {
          if (
            channel === "sftp:transfer-state" &&
            !enabled &&
            payload.transferredBytes > 0
          ) {
            enabled = true;
            void service.setTransferIntegrity(
              event,
              tabId,
              payload.transferKey,
              "md5",
            );
          }
        };
        assert.ok(
          (await service.downloadFile(event, tabId, "/source.bin", data.length))
            .success,
        );
        assert.ok(enabled);
        assert.ok(
          events.some(
            (entry) => entry.status === "validating" && entry.progress < 100,
          ),
        );
        assert.ok(
          events.some(
            (entry) =>
              entry.status === "completed" &&
              entry.verified &&
              entry.algorithm === "md5",
          ),
        );
        settings.transferIntegrity = true;
        selections.save = path.join(root, "service-pause.bin");
        let paused = false;
        control.onEvent = (channel, payload) => {
          if (
            channel === "sftp:transfer-state" &&
            !paused &&
            payload.transferredBytes > 0
          ) {
            paused = true;
            void service.cancelTransfer(event, tabId, payload.transferKey);
          }
        };
        const pause = await service.downloadFile(
          event,
          tabId,
          "/source.bin",
          data.length,
        );
        assert.ok(pause.cancelled);
        control.onEvent = null;
        let tasks = (await service.listResumableTransfers()).tasks;
        const task = tasks.find((item) => item.localPath === selections.save);
        assert.equal(task.tabId, tabId);
        assert.ok(
          (await service.resumeTransfer(event, tabId, task.id)).success,
        );
        assert.deepEqual(await fsp.readFile(selections.save), data);
        tasks = (await service.listResumableTransfers()).tasks;
        assert.ok(!tasks.some((item) => item.id === task.id));
        const pauseAgain = async (name) => {
          paused = false;
          selections.save = path.join(root, name);
          control.onEvent = (channel, payload) => {
            if (
              channel === "sftp:transfer-state" &&
              !paused &&
              payload.transferredBytes > 0
            ) {
              paused = true;
              void service.cancelTransfer(event, tabId, payload.transferKey);
            }
          };
          assert.ok(
            (
              await service.downloadFile(
                event,
                tabId,
                "/source.bin",
                data.length,
              )
            ).cancelled,
          );
          control.onEvent = null;
          return (await service.listResumableTransfers()).tasks.find(
            (item) => item.localPath === selections.save,
          );
        };
        const invalid = await pauseAgain("service-invalid.bin");
        const invalidRecord = await service.resumeStore.getRecord(invalid.id);
        await fsp.writeFile(invalidRecord.manifestPath, "{broken");
        assert.ok(
          (
            await service.resumeTransfer(event, tabId, invalid.id, {
              restart: true,
            })
          ).success,
        );
        const disposable = await pauseAgain("service-cleanup.bin");
        assert.ok(
          (await service.discardResumableTransfer(event, tabId, disposable.id))
            .success,
        );
        assert.ok(
          !(await service.listResumableTransfers()).tasks.some(
            (item) => item.id === disposable.id,
          ),
        );
        service.cleanup();
      },
    );

    await check(
      "128 MiB uploads and downloads use four persisted 32 MiB segments through the service",
      async () => {
        const { service, selections, event, tabId, settings } = loadFileService(
          root,
          config,
        );
        settings.transferIntegrity = false;
        const largeLocal = path.join(root, "large.bin");
        const handle = await fsp.open(largeLocal, "w");
        const block = crypto.randomBytes(1024 * 1024);
        try {
          for (let i = 0; i < 128; i += 1) await handle.write(block);
        } finally {
          await handle.close();
        }
        const expected = await runtime.hashLocalFile(largeLocal, "sha256");
        await fsp.copyFile(largeLocal, server.resolve("/large.bin"));
        selections.save = path.join(root, "large-download.bin");
        const logStart = runtime.logs.length;
        assert.ok(
          (
            await service.downloadFile(
              event,
              tabId,
              "/large.bin",
              128 * 1024 * 1024,
            )
          ).success,
        );
        selections.open = [largeLocal];
        const upload = await service.uploadFile(
          event,
          tabId,
          "/large-upload",
          "upload-progress-fixture",
        );
        assert.ok(upload.success, JSON.stringify(upload));
        const transferLogs = runtime.logs
          .slice(logStart)
          .filter((line) => /SFTP .* segment=/.test(line));
        assert.equal(transferLogs.length, 8);
        assert.ok(
          transferLogs.every((line) => line.endsWith("length=33554432")),
        );
        assert.equal(
          await runtime.hashLocalFile(selections.save, "sha256"),
          expected,
        );
        assert.equal(
          await runtime.hashLocalFile(
            server.resolve("/large-upload/large.bin"),
            "sha256",
          ),
          expected,
        );
        service.cleanup();
      },
    );

    await check(
      "batch, folder and dropped-file paths preserve files, empty directories and verification",
      async () => {
        const { service, selections, event, tabId, settings, events } =
          loadFileService(root, config);
        settings.transferIntegrity = true;
        const folder = path.join(root, "upload-tree");
        await fsp.mkdir(path.join(folder, "nested"), { recursive: true });
        await fsp.mkdir(path.join(folder, "empty"));
        const sample = data.subarray(0, 32 * 1024 + 7);
        await fsp.writeFile(path.join(folder, "a.bin"), sample);
        await fsp.writeFile(path.join(folder, "nested", "b.bin"), sample);
        selections.open = [folder];
        const upload = await service.uploadFolder(
          event,
          tabId,
          "/tree-test",
          "upload-progress-tree",
        );
        assert.ok(upload.success, JSON.stringify(upload));
        assert.deepEqual(
          await fsp.readFile(
            server.resolve("/tree-test/upload-tree/nested/b.bin"),
          ),
          sample,
        );
        assert.ok(
          (
            await fsp.stat(server.resolve("/tree-test/upload-tree/empty"))
          ).isDirectory(),
        );
        const downloadRoot = path.join(root, "folder-download");
        await fsp.mkdir(downloadRoot);
        selections.open = [downloadRoot];
        const download = await service.downloadFolder(
          event,
          tabId,
          "/tree-test/upload-tree",
        );
        assert.ok(download.success, JSON.stringify(download));
        assert.deepEqual(
          await fsp.readFile(path.join(downloadRoot, "upload-tree", "a.bin")),
          sample,
        );
        assert.ok(
          (
            await fsp.stat(path.join(downloadRoot, "upload-tree", "empty"))
          ).isDirectory(),
        );
        const batch = await service.downloadFiles(event, tabId, [
          {
            remotePath: "/tree-test/upload-tree/a.bin",
            fileName: "batch-a.bin",
            size: sample.length,
          },
          {
            remotePath: "/tree-test/upload-tree/nested/b.bin",
            fileName: "batch-b.bin",
            size: sample.length,
          },
        ]);
        assert.equal(batch.completed, 2);
        const dropped = await service.uploadDroppedFiles(
          event,
          tabId,
          "/dropped",
          {
            files: [
              {
                localPath: path.join(folder, "a.bin"),
                relativePath: "nested/a.bin",
              },
            ],
            folders: [
              { localPath: path.join(folder, "empty"), relativePath: "empty" },
            ],
          },
          "upload-progress-drop-fixture",
        );
        assert.ok(dropped.success, JSON.stringify(dropped));
        assert.deepEqual(
          await fsp.readFile(server.resolve("/dropped/nested/a.bin")),
          sample,
        );
        assert.ok(
          (await fsp.stat(server.resolve("/dropped/empty"))).isDirectory(),
        );
        assert.equal(
          events.filter(
            (entry) =>
              entry.channel === "sftp:transfer-state" &&
              entry.status === "completed" &&
              entry.verified,
          ).length,
          4,
        );
        const expectPreparationFailure = async (operation) => {
          const eventStart = events.length;
          const result = await operation();
          assert.equal(result.success, false, JSON.stringify(result));
          const states = events
            .slice(eventStart)
            .filter((entry) => entry.channel === "sftp:transfer-state");
          assert.ok(states.length > 0, "Preparation must register a transfer");
          assert.equal(states.at(-1).status, "error");
          assert.ok(states.at(-1).error);
          assert.equal(states.at(-1).operationComplete, true);
          assert.ok(states.every((entry) => entry.status !== "completed"));
        };

        // A selected folder may disappear before its asynchronous scan starts.
        selections.open = [path.join(root, "missing-upload-folder")];
        await expectPreparationFailure(() =>
          service.uploadFolder(
            event,
            tabId,
            "/tree-test",
            "upload-progress-tree",
          ),
        );

        // Existing files cannot be used as local or remote parent directories.
        selections.open = [source];
        await expectPreparationFailure(() =>
          service.downloadFolder(event, tabId, "/tree-test/upload-tree"),
        );
        selections.open = [folder];
        await expectPreparationFailure(() =>
          service.uploadFolder(
            event,
            tabId,
            "/source.bin",
            "upload-progress-tree",
          ),
        );
        assert.deepEqual(await fsp.readFile(source), data);
        assert.deepEqual(
          await fsp.readFile(server.resolve("/source.bin")),
          data,
        );
        service.cleanup();
      },
    );

    await fsp.mkdir(path.join(__dirname, "..", ".cache"), { recursive: true });
    await fsp.writeFile(
      path.join(
        __dirname,
        "..",
        ".cache",
        `sftp-validation-${process.platform}.json`,
      ),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          passed: evidence,
          transferLogs: runtime.logs.filter((line) => /^SFTP /.test(line)),
        },
        null,
        2,
      ),
    );
    console.log(`[sftp] ${evidence.length} integration scenarios passed`);
  } finally {
    runtime.close();
    await server.close();
    assert.ok(
      path.dirname(root) === path.resolve(os.tmpdir()) &&
        path.basename(root).startsWith("simpleshell-sftp-"),
      "Unsafe fixture cleanup path",
    );
    await fsp.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
