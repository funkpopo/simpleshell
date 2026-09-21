const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const SUFFIX = ".ssx-progress.json";
const VERSION = 1;

function resumeError(message, errorKind = "resume-conflict") {
  return Object.assign(new Error(message), { errorKind, retryable: false });
}

function connectionIdentity(config) {
  return {
    host: config.host.toLowerCase(),
    port: Number(config.port || 22),
    username: config.username,
    hostFingerprint: config.expectedHostFingerprint || null,
  };
}

function transferIdentity({ direction, localPath, remotePath, connection }) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        direction,
        path.resolve(localPath),
        remotePath,
        connection,
      ]),
    )
    .digest("hex");
}

function fingerprint(stats, local = false) {
  if (
    !stats ||
    !Number.isSafeInteger(stats.size) ||
    stats.size < 0 ||
    (local
      ? !stats.isFile()
      : stats.isDirectory || (stats.mode & 0o170000) !== 0o100000)
  ) {
    throw resumeError(
      "Transfer path must be a regular file with a safe byte size",
    );
  }
  const mtime = local ? stats.mtimeMs : stats.modifyTime;
  if (!Number.isFinite(mtime))
    throw resumeError("File modification time is unavailable");
  return { size: stats.size, mtime };
}

function sameFingerprint(a, b) {
  return !!a && !!b && a.size === b.size && a.mtime === b.mtime;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error instanceof SyntaxError)
      throw resumeError(
        `Invalid transfer manifest: ${filePath}`,
        "resume-manifest-invalid",
      );
    throw error;
  }
}

async function atomicWrite(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  const handle = await fsp.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsp.rename(temporary, filePath);
}

function validateManifest(manifest, record) {
  if (
    !manifest ||
    manifest.version !== VERSION ||
    manifest.id !== record.id ||
    transferIdentity(manifest) !== record.id ||
    manifest.localPath !== record.localPath ||
    manifest.remotePath !== record.remotePath ||
    manifest.direction !== record.direction ||
    JSON.stringify(manifest.connection) !== JSON.stringify(record.connection) ||
    !Number.isSafeInteger(manifest.totalSize) ||
    manifest.totalSize < 0 ||
    !Array.isArray(manifest.segments) ||
    !manifest.segments.length ||
    manifest.segments.length > 16 ||
    ![
      "preparing",
      "transferring",
      "validating",
      "resetting",
      "committing",
      "integrity-failed",
    ].includes(manifest.phase)
  ) {
    throw resumeError(
      `Invalid transfer manifest: ${record.manifestPath}`,
      "resume-manifest-invalid",
    );
  }
  let end = 0;
  for (const segment of manifest.segments) {
    if (
      segment.offset !== end ||
      !Number.isSafeInteger(segment.length) ||
      segment.length < 0 ||
      typeof segment.done !== "boolean"
    )
      throw resumeError(
        "Invalid transfer segment layout",
        "resume-manifest-invalid",
      );
    end += segment.length;
  }
  if (
    end !== manifest.totalSize ||
    manifest.source?.size !== manifest.totalSize ||
    !Number.isFinite(manifest.source?.mtime) ||
    ![null, "md5", "sha256"].includes(manifest.algorithm) ||
    ![0, 1].includes(manifest.integrityRetries) ||
    typeof manifest.dirty !== "boolean"
  ) {
    throw resumeError(
      "Invalid transfer manifest metadata",
      "resume-manifest-invalid",
    );
  }
  return manifest;
}

class TransferResumeStore {
  constructor(root) {
    this.root = path.resolve(root);
    this.writes = new Map();
    this.leases = new Set();
  }

  recordPath(id) {
    if (!/^[a-f0-9]{64}$/.test(id))
      throw resumeError("Invalid transfer identifier");
    return path.join(this.root, `${id}.json`);
  }

  describe(input) {
    const data = { ...input, localPath: path.resolve(input.localPath) };
    const id = transferIdentity(data);
    return {
      id,
      direction: data.direction,
      localPath: data.localPath,
      remotePath: data.remotePath,
      connection: data.connection,
      manifestPath:
        data.direction === "download"
          ? `${data.localPath}${SUFFIX}`
          : path.join(this.root, `${id}${SUFFIX}`),
      partPath:
        data.direction === "download"
          ? `${data.localPath}.part`
          : `${data.remotePath}.${id.slice(0, 12)}.part`,
    };
  }

  acquire(record) {
    const key =
      record.direction === "download"
        ? record.localPath.toLowerCase()
        : JSON.stringify([record.connection, record.remotePath]);
    if (this.leases.has(key))
      throw resumeError(
        "A transfer already owns this destination",
        "transfer-busy",
      );
    this.leases.add(key);
    return () => this.leases.delete(key);
  }

  async register(record) {
    await atomicWrite(this.recordPath(record.id), record);
  }

  async read(record) {
    const manifest = await readJson(record.manifestPath);
    return manifest === null ? null : validateManifest(manifest, record);
  }

  async write(record, manifest) {
    const previous = this.writes.get(record.id) || Promise.resolve();
    // Snapshot now; concurrent segment completions must never roll back newer state.
    const snapshot = JSON.parse(JSON.stringify(manifest));
    const next = previous.then(() =>
      atomicWrite(record.manifestPath, snapshot),
    );
    this.writes.set(record.id, next);
    try {
      await next;
    } finally {
      if (this.writes.get(record.id) === next) this.writes.delete(record.id);
    }
  }

  async remove(record) {
    await this.writes.get(record.id);
    await fsp.rm(record.manifestPath, { force: true });
    await fsp.rm(this.recordPath(record.id), { force: true });
    for (const filePath of [record.manifestPath, this.recordPath(record.id)]) {
      const directory = path.dirname(filePath);
      const prefix = `${path.basename(filePath)}.`;
      const entries = await fsp.readdir(directory);
      for (const entry of entries) {
        if (
          entry.startsWith(prefix) &&
          /^[a-f0-9-]{36}\.tmp$/.test(entry.slice(prefix.length))
        ) {
          await fsp.rm(path.join(directory, entry), { force: true });
        }
      }
    }
  }

  async getRecord(id) {
    const record = await readJson(this.recordPath(id));
    if (!record || record.id !== id || transferIdentity(record) !== id)
      throw resumeError("Transfer recovery record is missing or invalid");
    const expected = this.describe(record);
    if (
      expected.manifestPath !== record.manifestPath ||
      expected.partPath !== record.partPath
    )
      throw resumeError("Invalid recovery paths");
    return record;
  }

  async list() {
    let entries;
    try {
      entries = await fsp.readdir(this.root);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const records = [];
    for (const name of entries.filter((name) =>
      /^[a-f0-9]{64}\.json$/.test(name),
    )) {
      const record = await this.getRecord(name.slice(0, -5));
      try {
        const manifest = await this.read(record);
        records.push({
          ...record,
          manifest,
          error: manifest ? null : "Transfer manifest is missing",
        });
      } catch (error) {
        records.push({
          ...record,
          manifest: null,
          error: error.message,
          errorKind: error.errorKind,
        });
      }
    }
    return records;
  }
}

// The source is immutable. A clean destination must match its last settled
// fingerprint. After a process crash, validate retained ranges against the source
// before trusting them; sparse file length alone cannot prove a completed segment.
async function probeResumeState({
  direction,
  localPath,
  remotePath,
  fileSize,
  manifestPath,
  manifest,
  source,
  destination,
  verifyRange,
}) {
  void direction;
  void localPath;
  void remotePath;
  void manifestPath;
  if (!manifest) return { resumable: false, resumeOffset: 0 };
  if (
    !sameFingerprint(manifest.source, source) ||
    fileSize !== manifest.totalSize
  ) {
    throw resumeError(
      "Source size or modification time changed; restart this transfer",
      "source-changed",
    );
  }
  if (!destination || destination.size > fileSize)
    throw resumeError(
      "Partial destination is missing or oversized; restart this transfer",
    );
  if (!manifest.dirty && !sameFingerprint(manifest.destination, destination)) {
    throw resumeError(
      "Partial destination size or modification time changed; restart this transfer",
    );
  }
  const single = manifest.segments.length === 1;
  const resumeOffset = single ? Math.min(destination.size, fileSize) : 0;
  if (manifest.dirty) {
    const ranges = single
      ? [{ offset: 0, length: resumeOffset }]
      : manifest.segments.filter((segment) => segment.done);
    for (const range of ranges) {
      if (range.offset + range.length > destination.size)
        throw resumeError(
          "Completed segment is missing from partial destination",
        );
      if (range.length > 0) await verifyRange(range);
    }
  }
  return { resumable: true, resumeOffset, manifest };
}

module.exports = {
  TransferResumeStore,
  connectionIdentity,
  fingerprint,
  sameFingerprint,
  probeResumeState,
  resumeError,
  atomicWrite,
};
