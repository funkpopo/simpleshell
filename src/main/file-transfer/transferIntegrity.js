const fs = require("node:fs");
const fsp = require("node:fs/promises");
const crypto = require("node:crypto");
const native = require("../native/nativeSftpClient");

function validateAlgorithm(algorithm) {
  if (!["md5", "sha256"].includes(algorithm)) {
    throw Object.assign(
      new Error(`Unsupported checksum algorithm: ${algorithm}`),
      {
        errorKind: "validation",
        retryable: false,
      },
    );
  }
  return algorithm;
}

async function hashLocalFile(
  localPath,
  algorithm,
  { signal, segmentOffset = 0, segmentLength } = {},
) {
  validateAlgorithm(algorithm);
  const before = await fsp.stat(localPath);
  const length = segmentLength ?? before.size - segmentOffset;
  if (
    !before.isFile() ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    segmentOffset < 0 ||
    segmentOffset + length > before.size
  ) {
    throw new Error("Invalid local checksum range");
  }
  signal?.throwIfAborted();
  const hash = crypto.createHash(algorithm);
  if (length > 0) {
    const stream = fs.createReadStream(localPath, {
      start: segmentOffset,
      end: segmentOffset + length - 1,
      signal,
    });
    let read = 0;
    for await (const chunk of stream) {
      hash.update(chunk);
      read += chunk.length;
    }
    if (read !== length)
      throw new Error("Checksum source truncated while reading");
  }
  const after = await fsp.stat(localPath);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw Object.assign(new Error("Checksum source changed while reading"), {
      errorKind: "source-changed",
      retryable: false,
    });
  }
  return hash.digest("hex");
}

// A single SFTP protocol path supports shell-less servers and arbitrary filenames.
async function verifyTransfer({
  sshConfig,
  direction,
  localPath,
  remotePath,
  algorithm = "sha256",
  signal,
  sessionKey,
  segmentOffset,
  segmentLength,
}) {
  validateAlgorithm(algorithm);
  if (!["upload", "download"].includes(direction))
    throw new Error("Invalid transfer direction");
  signal?.throwIfAborted();
  let child;
  const abort = () => child?.kill();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const results = await Promise.allSettled([
      hashLocalFile(localPath, algorithm, {
        signal,
        segmentOffset,
        segmentLength,
      }),
      native
        .invokeNativeRequestWithConfig(
          sshConfig,
          {
            operation: "checksumFile",
            path: remotePath,
            algorithm,
            segmentOffset,
            segmentLength,
          },
          {
            sessionKey,
            onSpawn: (process) => {
              child = process;
              if (signal?.aborted) abort();
            },
          },
        )
        .then(native.requireNativeSuccess),
    ]);
    signal?.throwIfAborted();
    for (const result of results)
      if (result.status === "rejected") throw result.reason;
    const localHash = results[0].value;
    const remoteHash = results[1].value.digest;
    const result = {
      algorithm,
      localHash,
      remoteHash,
      verified: localHash === remoteHash,
    };
    if (!result.verified) {
      throw Object.assign(
        new Error(
          `${algorithm} integrity mismatch: local=${localHash}, remote=${remoteHash}`,
        ),
        {
          ...result,
          errorKind: "integrity-mismatch",
          retryable: true,
        },
      );
    }
    return result;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

module.exports = { validateAlgorithm, hashLocalFile, verifyTransfer };
