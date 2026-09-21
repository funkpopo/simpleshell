const fsp = require("node:fs/promises");
const path = require("node:path");
const native = require("../native/nativeSftpClient");
const { verifyTransfer } = require("./transferIntegrity");
const {
  fingerprint,
  sameFingerprint,
  probeResumeState,
  resumeError,
} = require("./transferResume");

const isMissing = (error) =>
  error.code === "ENOENT" || error.errorCode === "NATIVE_SFTP_NOT_FOUND";

class ResumableTransfer {
  constructor({
    store,
    pool,
    record,
    sshConfig,
    tabId,
    transferKey,
    segments,
    signal,
    getAlgorithm,
    onProgress,
    onState,
    onRecord,
    maxConcurrency,
    log,
  }) {
    Object.assign(this, {
      store,
      pool,
      record,
      sshConfig,
      tabId,
      transferKey,
      segments,
      signal,
      getAlgorithm,
      onProgress,
      onState,
      onRecord,
      maxConcurrency,
      log,
    });
    this.manifest = null;
    this.bytes = new Map();
    this.networkBytes = 0;
    this.sessionKey = `transfer-metadata:${record.id}`;
  }

  check() {
    this.signal.throwIfAborted();
  }

  async remote(request) {
    this.check();
    let child;
    const abort = () => child?.kill();
    this.signal.addEventListener("abort", abort, { once: true });
    try {
      const result = await native.invokeNativeRequestWithConfig(
        this.sshConfig,
        request,
        {
          sessionKey: this.sessionKey,
          onSpawn: (process) => {
            child = process;
            if (this.signal.aborted) abort();
          },
        },
      );
      this.check();
      if (result?.success === false && result.retryable)
        native.closeNativeSession(this.sessionKey);
      return native.requireNativeSuccess(result);
    } finally {
      this.signal.removeEventListener("abort", abort);
    }
  }

  async stat(filePath, local) {
    try {
      return local
        ? fingerprint(await fsp.stat(filePath), true)
        : fingerprint(
            (await this.remote({ operation: "statFile", path: filePath }))
              .stats,
          );
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  sourceStat() {
    return this.record.direction === "upload"
      ? this.stat(this.record.localPath, true)
      : this.stat(this.record.remotePath, false);
  }

  destinationStat() {
    return this.stat(
      this.record.partPath,
      this.record.direction === "download",
    );
  }

  async verifyRange(range) {
    try {
      await this.verify("sha256", {
        segmentOffset: range.offset,
        segmentLength: range.length,
      });
    } catch (error) {
      if (error.errorKind === "integrity-mismatch") {
        error.errorKind = "resume-conflict";
        error.retryable = false;
        error.message = `Retained transfer bytes differ from the source; restart this transfer. ${error.message}`;
      }
      throw error;
    }
  }

  verify(algorithm, range = {}) {
    const { direction, localPath, remotePath, partPath } = this.record;
    return verifyTransfer({
      sshConfig: this.sshConfig,
      direction,
      localPath: direction === "download" ? partPath : localPath,
      remotePath: direction === "upload" ? partPath : remotePath,
      algorithm,
      signal: this.signal,
      sessionKey: `${this.sessionKey}:checksum`,
      ...range,
    });
  }

  async save() {
    await this.store.write(this.record, this.manifest);
  }

  async initializeTarget(exclusive) {
    this.check();
    if (this.record.direction === "download") {
      await fsp.mkdir(path.dirname(this.record.partPath), { recursive: true });
      const handle = await fsp.open(
        this.record.partPath,
        exclusive ? "wx" : "w",
      );
      try {
        if (this.manifest.segments.length > 1)
          await handle.truncate(this.manifest.totalSize);
        await handle.sync();
      } finally {
        await handle.close();
      }
    } else {
      if (exclusive && (await this.destinationStat()))
        throw resumeError(
          "An untracked remote partial file already exists; clean it or restart explicitly",
        );
      await this.remote({
        operation: "uploadFileToRemote",
        path: this.record.partPath,
        localPath: this.record.localPath,
        segmentOffset: 0,
        segmentLength: 0,
        remoteWriteFlags: "w",
        ensureParentDirectories: true,
      });
    }
    this.manifest.destination = await this.destinationStat();
    this.manifest.phase = "transferring";
    this.manifest.dirty = false;
    await this.save();
  }

  report() {
    this.onProgress(
      [...this.bytes.values()].reduce((sum, bytes) => sum + bytes, 0),
      this.manifest.totalSize,
      this.networkBytes,
    );
  }

  async probe() {
    const source = await this.sourceStat();
    return probeResumeState({
      ...this.record,
      fileSize: source?.size,
      manifest: this.manifest,
      source,
      destination: await this.destinationStat(),
      verifyRange: (range) => this.verifyRange(range),
    });
  }

  async run() {
    const release = this.store.acquire(this.record);
    try {
      this.manifest = await this.store.read(this.record);
      if (!this.manifest) {
        const source = await this.sourceStat();
        if (!source)
          throw resumeError(
            "Transfer source no longer exists",
            "source-changed",
          );
        this.manifest = {
          version: 1,
          ...this.record,
          totalSize: source.size,
          source,
          destination: null,
          segmentSize: this.segments(source.size)[0].length,
          segments: this.segments(source.size).map(({ offset, length }) => ({
            offset,
            length,
            done: false,
          })),
          algorithm: this.getAlgorithm(),
          integrityRetries: 0,
          phase: "preparing",
          dirty: false,
          createdAt: Date.now(),
        };
        await this.store.register(this.record);
        await this.save();
        await this.initializeTarget(true);
      } else {
        await this.store.register(this.record);
        if (this.manifest.phase === "preparing")
          throw resumeError(
            "Transfer initialization was interrupted; restart this transfer",
          );
        if (this.manifest.phase === "integrity-failed")
          throw resumeError(
            "Integrity verification failed twice; restart this transfer",
            "integrity-mismatch",
          );
        if (this.manifest.phase === "committing") return await this.commit();
        if (this.manifest.phase === "resetting")
          await this.initializeTarget(false);
      }
      this.onRecord(this.record.id);
      while (true) {
        this.check();
        const resume = await this.probe();
        const single = this.manifest.segments.length === 1;
        this.manifest.segments.forEach((segment, index) =>
          this.bytes.set(
            index,
            single ? resume.resumeOffset : segment.done ? segment.length : 0,
          ),
        );
        this.report();
        this.manifest.dirty = true;
        this.manifest.phase = "transferring";
        await this.save();
        const tasks = this.manifest.segments.flatMap((segment, index) =>
          segment.done
            ? []
            : [
                {
                  taskId: `${this.record.id}:${index}:${this.manifest.integrityRetries}`,
                  direction: this.record.direction,
                  localPath:
                    this.record.direction === "download"
                      ? this.record.partPath
                      : this.record.localPath,
                  remotePath:
                    this.record.direction === "upload"
                      ? this.record.partPath
                      : this.record.remotePath,
                  fileName: path.basename(this.record.localPath),
                  segmentIndex: index,
                  segmentCount: this.manifest.segments.length,
                  totalBytes: segment.length,
                  segmentOffset: segment.offset,
                  segmentLength: segment.length,
                  localWriteFlags: "r+",
                  remoteWriteFlags: "r+",
                  ensureParentDirectories: false,
                },
              ],
        );
        const attemptOffsets = new Map();
        const result = await this.pool.runTasks({
          transferKey: this.transferKey,
          tabId: this.tabId,
          sshConfig: this.sshConfig,
          tasks,
          maxConcurrency: this.maxConcurrency,
          beforeAttempt: async ({ task, attempt }) => {
            this.check();
            if (!sameFingerprint(await this.sourceStat(), this.manifest.source))
              throw resumeError("Transfer source changed", "source-changed");
            const segment = this.manifest.segments[task.segmentIndex];
            let offset = segment.offset;
            if (single) {
              const state = attempt === 1 ? resume : await this.probe();
              offset = state.resumeOffset;
            }
            attemptOffsets.set(task.segmentIndex, offset - segment.offset);
            this.bytes.set(task.segmentIndex, offset - segment.offset);
            this.report();
            this.log(
              `SFTP ${this.record.id} segment=${task.segmentIndex} attempt=${attempt} offset=${offset} length=${segment.offset + segment.length - offset}`,
            );
            return {
              ...task,
              segmentOffset: offset,
              segmentLength: segment.offset + segment.length - offset,
              skipTransfer:
                offset === this.manifest.totalSize &&
                this.manifest.totalSize > 0,
            };
          },
          onProgress: (message) => {
            const index = message.segmentIndex;
            const base = attemptOffsets.get(index) || 0;
            this.bytes.set(
              index,
              Math.min(
                this.manifest.segments[index].length,
                base + message.transferredBytes,
              ),
            );
            this.networkBytes += message.deltaBytes;
            this.report();
          },
          onTaskDone: async (message) => {
            const segment = this.manifest.segments[message.segmentIndex];
            segment.done = true;
            this.bytes.set(message.segmentIndex, segment.length);
            await this.save();
            this.report();
          },
        });
        this.check();
        const failure = result.results.find(
          (item) => item.status === "rejected",
        );
        if (failure) throw failure.reason;
        if (!sameFingerprint(await this.sourceStat(), this.manifest.source))
          throw resumeError("Transfer source changed", "source-changed");
        this.manifest.destination = await this.destinationStat();
        if (this.manifest.destination?.size !== this.manifest.totalSize)
          throw resumeError("Transferred file size is inconsistent");
        this.manifest.dirty = false;
        this.manifest.algorithm =
          this.getAlgorithm() || this.manifest.algorithm;
        this.manifest.phase = "validating";
        await this.save();
        let integrity = null;
        if (this.manifest.algorithm) {
          this.onState("validating", { algorithm: this.manifest.algorithm });
          try {
            integrity = await this.verify(this.manifest.algorithm);
          } catch (error) {
            if (error.errorKind !== "integrity-mismatch") throw error;
            this.manifest.integrity = {
              algorithm: error.algorithm,
              localHash: error.localHash,
              remoteHash: error.remoteHash,
              verified: false,
            };
            if (this.manifest.integrityRetries === 1) {
              this.manifest.phase = "integrity-failed";
              await this.save();
              throw error;
            }
            this.manifest.integrityRetries = 1;
            this.manifest.phase = "resetting";
            this.manifest.segments.forEach((segment) => {
              segment.done = false;
            });
            await this.save();
            this.onState("retransmitting", this.manifest.integrity);
            this.log(
              `SFTP ${this.record.id} integrity mismatch; full retransmission 1/1`,
            );
            await this.initializeTarget(false);
            this.bytes.clear();
            continue;
          }
        }
        this.manifest.integrity = integrity;
        this.manifest.phase = "committing";
        await this.save();
        return await this.commit();
      }
    } finally {
      // dirty=true is intentional on interrupted writes. Recovery verifies the
      // retained ranges, so an unavailable server never loses a checkpoint.
      release();
      native.closeNativeSession(this.sessionKey);
      native.closeNativeSession(`${this.sessionKey}:checksum`);
    }
  }

  async commit() {
    this.check();
    const partial = await this.destinationStat();
    if (partial) {
      if (!sameFingerprint(partial, this.manifest.destination))
        throw resumeError("Partial file changed before commit");
      if (this.record.direction === "download")
        await fsp.rename(this.record.partPath, this.record.localPath);
      else
        await this.remote({
          operation: "renameFile",
          sourcePath: this.record.partPath,
          targetPath: this.record.remotePath,
        });
    } else {
      const target = await this.stat(
        this.record.direction === "download"
          ? this.record.localPath
          : this.record.remotePath,
        this.record.direction === "download",
      );
      if (!sameFingerprint(target, this.manifest.destination))
        throw resumeError("Committed transfer target is missing or changed");
    }
    const integrity = this.manifest.integrity;
    await this.store.remove(this.record);
    this.onProgress(
      this.manifest.totalSize,
      this.manifest.totalSize,
      this.networkBytes,
    );
    this.onState("file-completed", integrity || {});
    return { ...integrity, totalBytes: this.manifest.totalSize, resumed: true };
  }
}

module.exports = ResumableTransfer;
