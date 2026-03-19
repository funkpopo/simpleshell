const { spawn } = require("child_process");

const processManager = require("../process/processManager");
const { getTransferNativeScannerPath } = require("./nativeTransferSidecar");
const { processSSHPrivateKeyAsync } = require("./ssh-utils");
const { logToFile } = require("./logger");

function normalizeErrorMessage(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  return error.message || String(error);
}

async function resolveSshConfig(tabId) {
  const processInfo = processManager.getProcess(tabId);
  const rawConfig = processInfo?.config;
  if (!rawConfig?.host || !rawConfig?.username) {
    logToFile(
      `Native SFTP: missing SSH config for tab ${tabId}`,
      "WARN",
    );
    throw new Error("SSH connection config is unavailable");
  }

  const sshConfig = await processSSHPrivateKeyAsync({
    host: rawConfig.host,
    port: rawConfig.port || 22,
    username: rawConfig.username,
    password: rawConfig.password || undefined,
    privateKey: rawConfig.privateKey || undefined,
    privateKeyPath: rawConfig.privateKeyPath || undefined,
    passphrase: rawConfig.passphrase || undefined,
  });

  return {
    host: sshConfig.host,
    port: sshConfig.port || 22,
    username: sshConfig.username,
    password: sshConfig.password || undefined,
    privateKey: sshConfig.privateKey || undefined,
    passphrase: sshConfig.passphrase || undefined,
  };
}

function invokeNativeRequest(tabId, request, options = {}) {
  const sidecarPath = getTransferNativeScannerPath();
  if (!sidecarPath) {
    logToFile(
      `Native SFTP: sidecar binary not found for ${request?.operation || "unknown-operation"}`,
      "ERROR",
    );
    return Promise.reject(
      new Error("Rust transfer sidecar was not found"),
    );
  }

  logToFile(
    `Native SFTP: invoking ${request?.operation || "unknown-operation"} for tab ${tabId} via ${sidecarPath}`,
    "INFO",
  );

  return resolveSshConfig(tabId).then((config) =>
    invokeNativeRequestWithConfig(config, request, options, sidecarPath),
  );
}

function invokeNativeRequestWithConfig(
  config,
  request,
  options = {},
  resolvedSidecarPath = null,
) {
  const sidecarPath = resolvedSidecarPath || getTransferNativeScannerPath();
  if (!sidecarPath) {
    logToFile(
      `Native SFTP: sidecar binary not found for ${request?.operation || "unknown-operation"}`,
      "ERROR",
    );
    return Promise.reject(
      new Error("Rust transfer sidecar was not found"),
    );
  }

  return new Promise((resolve, reject) => {
    const child = spawn(sidecarPath, ["sftp-request"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    if (typeof options.onSpawn === "function") {
      try {
        options.onSpawn(child);
      } catch {
        // ignore callback failures
      }
    }

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;
    let finalResult = null;

    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      logToFile(
        `Native SFTP: ${request?.operation || "unknown-operation"} failed - ${normalizeErrorMessage(error)}`,
        "ERROR",
      );
      reject(error);
    };

    const resolveOnce = (value) => {
      if (settled) return;
      settled = true;
      if (value?.success === false) {
        logToFile(
          `Native SFTP: ${request?.operation || "unknown-operation"} completed with error - ${value?.error || "unknown error"}`,
          "WARN",
        );
      } else {
        logToFile(
          `Native SFTP: ${request?.operation || "unknown-operation"} completed successfully`,
          "INFO",
        );
      }
      resolve(value);
    };

    const handleOutputLine = (line) => {
      if (!line) return;

      let payload;
      try {
        payload = JSON.parse(line);
      } catch (error) {
        rejectOnce(
          new Error(
            `Native SFTP sidecar returned invalid JSON: ${normalizeErrorMessage(error)}`,
          ),
        );
        return;
      }

      if (payload?.type === "progress") {
        if (typeof options.onProgress === "function") {
          options.onProgress(payload);
        }
        return;
      }

      if (payload?.type === "result") {
        finalResult = payload.result || null;
      }
    };

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        handleOutputLine(line.trim());
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      rejectOnce(
        new Error(
          `Failed to start native SFTP sidecar: ${normalizeErrorMessage(error)}`,
        ),
      );
    });

    child.on("close", (code) => {
      if (stdoutBuffer.trim()) {
        handleOutputLine(stdoutBuffer.trim());
      }

      if (code !== 0) {
        rejectOnce(
          new Error(
            stderrBuffer.trim() ||
              (finalResult && finalResult.error) ||
              `Native SFTP sidecar exited with code ${code}`,
          ),
        );
        return;
      }

      if (!finalResult) {
        rejectOnce(
          new Error(
            stderrBuffer.trim() ||
              "Native SFTP sidecar did not return a result payload",
          ),
        );
        return;
      }

      if (finalResult.success === false) {
        resolveOnce(finalResult);
        return;
      }

      resolveOnce(finalResult);
    });

    const envelope = JSON.stringify({
      config,
      request,
    });

    child.stdin.end(envelope, "utf8");
  });
}

async function listFiles(tabId, remotePath) {
  return invokeNativeRequest(tabId, {
    operation: "listFiles",
    path: remotePath,
  });
}

async function copyFile(tabId, sourcePath, targetPath) {
  return invokeNativeRequest(tabId, {
    operation: "copyFile",
    sourcePath,
    targetPath,
  });
}

async function moveFile(tabId, sourcePath, targetPath) {
  return invokeNativeRequest(tabId, {
    operation: "moveFile",
    sourcePath,
    targetPath,
  });
}

async function deleteFile(tabId, targetPath, isDirectory = false) {
  return invokeNativeRequest(tabId, {
    operation: "deleteFile",
    path: targetPath,
    isDirectory,
  });
}

async function createFolder(tabId, folderPath) {
  return invokeNativeRequest(tabId, {
    operation: "createFolder",
    path: folderPath,
  });
}

async function createFile(tabId, filePath) {
  return invokeNativeRequest(tabId, {
    operation: "createFile",
    path: filePath,
  });
}

async function renameFile(tabId, sourcePath, targetPath) {
  return invokeNativeRequest(tabId, {
    operation: "renameFile",
    sourcePath,
    targetPath,
  });
}

async function getFilePermissions(tabId, targetPath) {
  return invokeNativeRequest(tabId, {
    operation: "getFilePermissions",
    path: targetPath,
  });
}

async function getAbsolutePath(tabId, targetPath) {
  return invokeNativeRequest(tabId, {
    operation: "getAbsolutePath",
    path: targetPath,
  });
}

async function readFileContent(tabId, targetPath) {
  return invokeNativeRequest(tabId, {
    operation: "readFileContent",
    path: targetPath,
  });
}

async function readFileAsBase64(tabId, targetPath) {
  return invokeNativeRequest(tabId, {
    operation: "readFileAsBase64",
    path: targetPath,
  });
}

async function saveFileContent(tabId, targetPath, content) {
  return invokeNativeRequest(tabId, {
    operation: "saveFileContent",
    path: targetPath,
    contentBase64: Buffer.from(String(content ?? ""), "utf8").toString("base64"),
  });
}

async function setFilePermissions(tabId, targetPath, permissions) {
  return invokeNativeRequest(tabId, {
    operation: "setFilePermissions",
    path: targetPath,
    permissions: String(permissions || ""),
  });
}

async function setFileOwnership(tabId, targetPath, owner, group) {
  return invokeNativeRequest(tabId, {
    operation: "setFileOwnership",
    path: targetPath,
    owner,
    group,
  });
}

async function createRemoteFolders(tabId, folderPath) {
  return invokeNativeRequest(tabId, {
    operation: "createRemoteFolders",
    path: folderPath,
  });
}

async function getFilePermissionsBatch(tabId, filePaths) {
  const results = await Promise.all(
    (Array.isArray(filePaths) ? filePaths : []).map(async (filePath) => {
      const result = await getFilePermissions(tabId, filePath);
      return result?.success
        ? {
            path: filePath,
            success: true,
            permissions: result.permissions,
            mode: result.mode,
            uid: result.uid,
            gid: result.gid,
            stats: result.stats,
          }
        : {
            path: filePath,
            success: false,
            error: result?.error || "Failed to read permissions",
          };
    }),
  );

  return { success: true, results };
}

async function uploadFile(
  tabId,
  localPath,
  remotePath,
  options = {},
) {
  return invokeNativeRequest(tabId, {
    operation: "uploadFileToRemote",
    path: remotePath,
    localPath,
    segmentOffset: options.segmentOffset,
    segmentLength: options.segmentLength,
    remoteWriteFlags: options.remoteWriteFlags,
  }, options);
}

async function downloadFile(
  tabId,
  remotePath,
  localPath,
  options = {},
) {
  return invokeNativeRequest(tabId, {
    operation: "downloadFileToLocal",
    path: remotePath,
    localPath,
    segmentOffset: options.segmentOffset,
    segmentLength: options.segmentLength,
    localWriteFlags: options.localWriteFlags,
  }, options);
}

module.exports = {
  invokeNativeRequest,
  invokeNativeRequestWithConfig,
  listFiles,
  copyFile,
  moveFile,
  deleteFile,
  createFolder,
  createFile,
  renameFile,
  getFilePermissions,
  getFilePermissionsBatch,
  getAbsolutePath,
  readFileContent,
  readFileAsBase64,
  saveFileContent,
  setFilePermissions,
  setFileOwnership,
  createRemoteFolders,
  uploadFile,
  downloadFile,
};
