const fsp = require("node:fs/promises");
const native = require("../native/nativeSftpClient");
const checksumClient = require("../native/nativeChecksumClient");

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
  // Phase 1：委托原生 checksum-file 一次性命令；不静默回退到 Node 哈希。
  // 宿主缺失/过旧、读权限、源文件变化、取消和协议损坏均原样失败。
  const result = await checksumClient.invokeLocalChecksum({
    localPath,
    algorithm,
    segmentOffset,
    segmentLength: length,
    signal,
  });
  return result.digest;
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
