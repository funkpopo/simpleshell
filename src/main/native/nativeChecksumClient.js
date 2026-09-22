const { spawn } = require("child_process");
const { getNativeServicesHostPath } = require("./nativeServices");

/**
 * 本地文件校验和一次性命令桥接（Phase 1）。
 *
 * 调用宿主一次性命令：
 *   checksum-file --path <absolute-path> --algorithm <md5|sha256> [--offset <bytes>] [--length <bytes>]
 *
 * 契约：stdout 恰好一行 JSON；成功退出码 0；业务/参数错误退出码非 0 且输出结构化失败。
 * 桥接层负责二进制定位、参数数组启动（禁止 shell 拼接）、stdout/stderr 缓冲上限、
 * 协议校验、AbortSignal 取消、排队与并发上限。
 */

const SUPPORTED_ALGORITHMS = new Set(["md5", "sha256"]);
const DIGEST_HEX_LENGTH = { md5: 32, sha256: 64 };
const CHECKSUM_SCHEMA_VERSION = 1;

// 进程并发上限：一次进程启动约 5-20ms（见 docs/migration-baseline.md），
// 大文件不套用短网络超时；默认 2，可用环境变量调整。
const MAX_CONCURRENT_PROCESSES = Math.max(
  1,
  Number.parseInt(
    process.env.SIMPLESHELL_CHECKSUM_MAX_CONCURRENCY || "2",
    10,
  ) || 2,
);
// 队列上限：超出直接拒绝，不能无限积压
const MAX_QUEUE_LENGTH = Math.max(
  MAX_CONCURRENT_PROCESSES,
  Number.parseInt(process.env.SIMPLESHELL_CHECKSUM_MAX_QUEUE || "32", 10) || 32,
);
// 总时限：可配置；长文件（1 GiB 约 0.1s 量级哈希 + 读取）默认 10 分钟，慢盘不误判
const DEFAULT_TOTAL_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.SIMPLESHELL_CHECKSUM_TIMEOUT_MS || "600000", 10),
);

const STDOUT_LIMIT_BYTES = 1024 * 1024;
const STDERR_LIMIT_BYTES = 64 * 1024;

const pendingQueue = [];
let activeCount = 0;

function createChecksumError(message, details = {}) {
  const error = new Error(message);
  error.errorCode = details.errorCode || "CHECKSUM_SIDECAR_ERROR";
  error.errorKind = details.errorKind || "sidecar";
  error.retryable = details.retryable !== false;
  error.module = details.module || "native-checksum-client";
  return error;
}

function normalizeErrorMessage(error) {
  if (!error) return "unknown error";
  return error.message || String(error);
}

/** JS 侧参数预校验：拒绝负数、小数、非安全整数和非法区间 */
function validateChecksumArgs({
  localPath,
  algorithm,
  segmentOffset = 0,
  segmentLength,
} = {}) {
  if (typeof localPath !== "string" || !localPath.trim()) {
    throw createChecksumError("Local path is required", {
      errorCode: "CHECKSUM_INVALID_REQUEST",
      errorKind: "validation",
      retryable: false,
    });
  }
  if (!SUPPORTED_ALGORITHMS.has(algorithm)) {
    throw createChecksumError(`Unsupported checksum algorithm: ${algorithm}`, {
      errorCode: "CHECKSUM_UNSUPPORTED_ALGORITHM",
      errorKind: "validation",
      retryable: false,
    });
  }
  for (const [name, value] of [
    ["segmentOffset", segmentOffset],
    ["segmentLength", segmentLength],
  ]) {
    if (value === undefined || value === null) continue;
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      (name === "segmentOffset" && value === 0 && segmentOffset !== 0)
    ) {
      throw createChecksumError(`Invalid checksum range: ${name}`, {
        errorCode: "CHECKSUM_INVALID_REQUEST",
        errorKind: "validation",
        retryable: false,
      });
    }
  }
}

/** 校验子进程 stdout JSON 契约：版本、算法、摘要长度/十六进制、bytesHashed */
function parseChecksumResponse(line, algorithm) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw createChecksumError("Native checksum sidecar returned invalid JSON", {
      errorCode: "CHECKSUM_INVALID_RESPONSE",
      errorKind: "protocol",
      retryable: false,
    });
  }

  if (parsed.schemaVersion !== CHECKSUM_SCHEMA_VERSION) {
    throw createChecksumError(
      `Unsupported native checksum schema version: ${parsed.schemaVersion}`,
      {
        errorCode: "CHECKSUM_PROTOCOL_VERSION",
        errorKind: "protocol",
        retryable: false,
      },
    );
  }

  if (parsed.success !== true) {
    throw createChecksumError(parsed.error || "Native checksum failed", {
      errorCode: parsed.errorCode || "CHECKSUM_SIDECAR_ERROR",
      errorKind: parsed.errorKind || "sidecar",
      retryable: parsed.retryable !== false,
    });
  }

  if (parsed.algorithm !== algorithm) {
    throw createChecksumError("Native checksum algorithm mismatch", {
      errorCode: "CHECKSUM_INVALID_RESPONSE",
      errorKind: "protocol",
      retryable: false,
    });
  }

  const digest = parsed.digest;
  const expectedLength = DIGEST_HEX_LENGTH[algorithm];
  if (
    typeof digest !== "string" ||
    digest.length !== expectedLength ||
    !/^[0-9a-f]+$/.test(digest)
  ) {
    throw createChecksumError("Native checksum digest format invalid", {
      errorCode: "CHECKSUM_INVALID_RESPONSE",
      errorKind: "protocol",
      retryable: false,
    });
  }

  if (!Number.isSafeInteger(parsed.bytesHashed) || parsed.bytesHashed < 0) {
    throw createChecksumError("Native checksum bytesHashed invalid", {
      errorCode: "CHECKSUM_INVALID_RESPONSE",
      errorKind: "protocol",
      retryable: false,
    });
  }

  return {
    algorithm: parsed.algorithm,
    digest,
    bytesHashed: parsed.bytesHashed,
  };
}

function scheduleNext() {
  if (activeCount >= MAX_CONCURRENT_PROCESSES || !pendingQueue.length) {
    return;
  }
  const next = pendingQueue.shift();
  next();
}

/**
 * 执行本地校验和。
 *
 * @param {object} options { localPath, algorithm, segmentOffset, segmentLength, signal }
 * @returns {Promise<{algorithm, digest, bytesHashed}>}
 */
async function invokeLocalChecksum({
  localPath,
  algorithm,
  segmentOffset = 0,
  segmentLength,
  signal,
} = {}) {
  validateChecksumArgs({ localPath, algorithm, segmentOffset, segmentLength });
  if (signal?.aborted) {
    throw createChecksumError("Native checksum was cancelled", {
      errorCode: "CHECKSUM_CANCELLED",
      errorKind: "cancelled",
      retryable: false,
    });
  }

  const hostPath = getNativeServicesHostPath();
  if (!hostPath) {
    return Promise.reject(
      createChecksumError(
        "Native services host is not available; prepare or update native services",
        {
          errorCode: "CHECKSUM_SIDECAR_MISSING",
          errorKind: "sidecar",
          retryable: false,
        },
      ),
    );
  }

  return new Promise((resolve, reject) => {
    let child = null;
    let settled = false;
    let stdoutData = "";
    let stdoutBytes = 0;
    let stderrData = "";
    let stderrBytes = 0;
    let timedOut = false;
    let removed = false;

    const args = [
      "checksum-file",
      "--path",
      localPath,
      "--algorithm",
      algorithm,
    ];
    if (segmentOffset) args.push("--offset", String(segmentOffset));
    if (segmentLength !== undefined)
      args.push("--length", String(segmentLength));

    const removeAbortListener = () => {
      if (removed || !signal) return;
      removed = true;
      signal.removeEventListener("abort", onAbort);
    };

    const cleanupListeners = () => {
      if (!child) return;
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
    };

    const finish = (error, value = null) => {
      if (settled) return;
      settled = true;
      removeAbortListener();
      cleanupListeners();
      if (error) reject(error);
      else resolve(value);
    };

    const killChild = () => {
      if (!child || child.exitCode !== null || child.signalCode !== null)
        return;
      try {
        child.kill();
      } catch {
        /* intentionally ignored */
      }
    };

    const onAbort = () => {
      if (settled) return;
      timedOut = false;
      killChild();
      finish(
        createChecksumError("Native checksum was cancelled", {
          errorCode: "CHECKSUM_CANCELLED",
          errorKind: "cancelled",
          retryable: false,
        }),
      );
    };

    const onError = (error) => {
      finish(
        createChecksumError(
          `Failed to start native checksum sidecar: ${normalizeErrorMessage(error)}`,
          {
            errorCode: "CHECKSUM_SIDECAR_START_FAILED",
            errorKind: "sidecar",
            retryable: false,
          },
        ),
      );
    };

    const onClose = (code, exitSignal) => {
      const line = stdoutData.trim();
      if (settled) return;
      if (timedOut) {
        finish(
          createChecksumError("Native checksum timed out", {
            errorCode: "CHECKSUM_TIMEOUT",
            errorKind: "timeout",
            retryable: true,
          }),
        );
        return;
      }
      if (!line) {
        finish(
          createChecksumError(
            `Native checksum sidecar exited without output (code ${code ?? exitSignal})`,
            {
              errorCode: "CHECKSUM_NO_OUTPUT",
              errorKind: "protocol",
              retryable: false,
            },
          ),
        );
        return;
      }
      // 恰好一行 JSON；多行时以最后一行完整协议行为准
      const lines = line.split(/\r?\n/);
      const protocolLine = lines[lines.length - 1];
      try {
        const value = parseChecksumResponse(protocolLine, algorithm);
        finish(null, value);
      } catch (error) {
        finish(error);
      }
    };

    const run = () => {
      if (settled) {
        scheduleNext();
        return;
      }
      if (signal?.aborted) {
        finish(
          createChecksumError("Native checksum was cancelled", {
            errorCode: "CHECKSUM_CANCELLED",
            errorKind: "cancelled",
            retryable: false,
          }),
        );
        scheduleNext();
        return;
      }
      activeCount += 1;
      try {
        child = spawn(hostPath, args, {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (error) {
        activeCount -= 1;
        onError(error);
        scheduleNext();
        return;
      }

      if (signal?.aborted) {
        // 启动前已取消：终止并回收
        killChild();
      }

      child.stdout.on("data", (chunk) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > STDOUT_LIMIT_BYTES) {
          killChild();
          finish(
            createChecksumError("Native checksum stdout exceeded limit", {
              errorCode: "CHECKSUM_OUTPUT_OVERFLOW",
              errorKind: "protocol",
              retryable: false,
            }),
          );
          return;
        }
        stdoutData += chunk.toString("utf8");
      });

      child.stderr.on("data", (chunk) => {
        stderrBytes += chunk.length;
        if (stderrBytes > STDERR_LIMIT_BYTES) {
          stderrData = `${stderrData.slice(0, STDERR_LIMIT_BYTES)}...`;
          try {
            child.stderr.destroy();
          } catch {
            /* intentionally ignored */
          }
          return;
        }
        stderrData += chunk.toString("utf8");
      });

      child.once("error", onError);
      child.once("close", (code, exitSignal) => {
        activeCount -= 1;
        scheduleNext();
        onClose(code, exitSignal);
      });

      child.stdin.on("error", () => {
        /* stdin 关闭错误不作为业务失败 */
      });
      child.stdin.end();

      if (DEFAULT_TOTAL_TIMEOUT_MS > 0) {
        const timer = setTimeout(() => {
          if (settled) return;
          timedOut = true;
          killChild();
        }, DEFAULT_TOTAL_TIMEOUT_MS);
        if (typeof timer.unref === "function") timer.unref();
        child.once("close", () => clearTimeout(timer));
      }
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    if (activeCount >= MAX_CONCURRENT_PROCESSES) {
      if (pendingQueue.length >= MAX_QUEUE_LENGTH) {
        finish(
          createChecksumError("Native checksum queue is full", {
            errorCode: "CHECKSUM_QUEUE_FULL",
            errorKind: "busy",
            retryable: true,
          }),
        );
        return;
      }
      pendingQueue.push(run);
    } else {
      run();
    }
  });
}

module.exports = {
  invokeLocalChecksum,
  validateChecksumArgs,
  createChecksumError,
  MAX_CONCURRENT_PROCESSES,
};
