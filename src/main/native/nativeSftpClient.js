const processManager = require("../process/processManager");
const { getNativeServicesHostPath } = require("./nativeServices");
const { spawnCoreService } = require("./coreSupervisor");
const { processSSHPrivateKeyAsync } = require("../connection/ssh-utils");
const { getTrustedHostFingerprint } = require("../connection/sshHostKeyTrust");
const { logToFile } = require("../utils/logger");
const { recordCrashMarker } = require("../diagnostics/crashReporter");
const {
  normalizeProxyConfig,
  buildNetworkPath,
  recordNativeSidecarNetworkPath,
  resolveNativeSidecarNetworkPath,
} = require("./nativeSidecarNetworkPath");
const { normalizeErrorMessage } = require("../utils/errorResponse");
const createSftpProtocol = require("./sftp/sftpProtocol");
const createSftpConfigResolver = require("./sftp/sftpConfigResolver");
const createSftpSessionPool = require("./sftp/sftpSessionPool");
const createSftpDirectoryWatch = require("./sftp/sftpDirectoryWatch");

const NATIVE_SFTP_SCHEMA_VERSION = 1;
const NATIVE_SFTP_SESSION_IDLE_TIMEOUT_MS = 30_000;

const clientApi = {};

const protocol = createSftpProtocol({
  NATIVE_SFTP_SCHEMA_VERSION,
  logToFile,
  normalizeErrorMessage,
});

const configResolver = createSftpConfigResolver({
  processManager,
  getNativeServicesHostPath,
  processSSHPrivateKeyAsync,
  getTrustedHostFingerprint,
  logToFile,
  normalizeProxyConfig,
  buildNetworkPath,
  resolveNativeSidecarNetworkPath,
  protocol,
});

const sessionPool = createSftpSessionPool({
  NATIVE_SFTP_SCHEMA_VERSION,
  NATIVE_SFTP_SESSION_IDLE_TIMEOUT_MS,
  spawnCoreService,
  logToFile,
  recordNativeSidecarNetworkPath,
  normalizeErrorMessage,
  protocol,
  configResolver,
  clientApi,
  buildCloseSessionRequest: () => ({
    operation: "closeSession",
    requestId: protocol.createNativeRequestId("close-session"),
  }),
});

const directoryWatch = createSftpDirectoryWatch({
  NATIVE_SFTP_SCHEMA_VERSION,
  recordCrashMarker,
  recordNativeSidecarNetworkPath,
  protocol,
  configResolver,
  sessionPool,
  buildWatchDirectoryRequest: (remotePath, watchIntervalMs) =>
    protocol.normalizeNativeRequest({
      operation: "watchDirectory",
      path: remotePath,
      watchIntervalMs,
    }),
});

const { requireNativeSuccess } = protocol;
const { resolveSshConfig, missingHostError } = configResolver;
const {
  closeNativeSession,
  invokeNativeRequestWithConfig,
  invokeNativeRequest,
} = sessionPool;
const { watchDirectoryWithConfig } = directoryWatch;

function watchDirectory(tabId, remotePath, options = {}) {
  const missing = missingHostError("watchDirectory");
  if (missing) return Promise.reject(missing);

  logToFile(`Native SFTP: starting directory watch for tab ${tabId}`, "INFO");

  return resolveSshConfig(tabId).then((config) =>
    watchDirectoryWithConfig(config, remotePath, options),
  );
}

async function statFile(tabId, remotePath, options = {}) {
  const result = await invokeNativeRequest(
    tabId,
    {
      operation: "statFile",
      path: remotePath,
    },
    options,
  );
  return requireNativeSuccess(result).stats;
}

async function checksumFile(tabId, remotePath, algorithm, options = {}) {
  if (!["md5", "sha256"].includes(algorithm)) {
    throw new Error(`Unsupported checksum algorithm: ${algorithm}`);
  }
  return requireNativeSuccess(
    await invokeNativeRequest(
      tabId,
      {
        operation: "checksumFile",
        path: remotePath,
        algorithm,
        segmentOffset: options.segmentOffset,
        segmentLength: options.segmentLength,
      },
      options,
    ),
  );
}

async function listFiles(tabId, remotePath, options = {}) {
  return invokeNativeRequest(
    tabId,
    {
      operation: "listFiles",
      path: remotePath,
      streamList: options.streamList === true,
    },
    options,
  );
}

async function scanRemoteFolderTree(tabId, remotePath, options = {}) {
  return invokeNativeRequest(
    tabId,
    {
      operation: "scanRemoteFolderTree",
      path: remotePath,
    },
    options,
  );
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

async function getFilePermissions(tabId, targetPath, options = {}) {
  return invokeNativeRequest(
    tabId,
    {
      operation: "getFilePermissions",
      path: targetPath,
    },
    options,
  );
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
    contentBase64: Buffer.from(String(content ?? ""), "utf8").toString(
      "base64",
    ),
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

/** 主进程：提交完整路径列表，不限制数量；逐文件 stat 与并发控制由 Rust 执行。 */
async function getFilePermissionsBatch(tabId, filePaths, options = {}) {
  const paths = Array.isArray(filePaths) ? filePaths : [];
  if (paths.length === 0) return { success: true, results: [] };

  return requireNativeSuccess(
    await invokeNativeRequest(
      tabId,
      { operation: "getFilePermissionsBatch", paths },
      options,
    ),
  );
}

async function uploadFile(tabId, localPath, remotePath, options = {}) {
  return invokeNativeRequest(
    tabId,
    {
      operation: "uploadFileToRemote",
      path: remotePath,
      localPath,
      segmentOffset: options.segmentOffset,
      segmentLength: options.segmentLength,
      remoteWriteFlags: options.remoteWriteFlags,
      ensureParentDirectories: options.ensureParentDirectories !== false,
    },
    options,
  );
}

async function downloadFile(tabId, remotePath, localPath, options = {}) {
  return invokeNativeRequest(
    tabId,
    {
      operation: "downloadFileToLocal",
      path: remotePath,
      localPath,
      segmentOffset: options.segmentOffset,
      segmentLength: options.segmentLength,
      localWriteFlags: options.localWriteFlags,
    },
    options,
  );
}

Object.assign(clientApi, {
  closeNativeSession,
  requireNativeSuccess,
  statFile,
  checksumFile,
  resolveSshConfig,
  invokeNativeRequestWithConfig,
  listFiles,
  watchDirectory,
  scanRemoteFolderTree,
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
});

module.exports = clientApi;
