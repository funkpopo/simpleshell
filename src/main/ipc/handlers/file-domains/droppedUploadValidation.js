/** Drag-and-drop upload item validation and remote overwrite preflight checks. */
function createDroppedUploadValidationMethods({
  fs,
  path,
  nativeSftpClient,
  processManager,
  toPosixPath,
  normalizeDroppedTransferRelativePath,
  normalizeRemoteTransferPath,
  fileText,
}) {
  const joinDroppedRemotePath = (basePath, childPath) => {
    const base = normalizeRemoteTransferPath(basePath);
    const child = toPosixPath(childPath || "").replace(/^\/+/, "");
    if (!child) return base;
    if (base === ".") return child;
    return path.posix.join(base, child);
  };

  const normalizeDroppedRelativePath = (relativePath, name = "") =>
    normalizeDroppedTransferRelativePath(relativePath || name);

  const normalizeDroppedFolderRelativePath = (folderData) =>
    normalizeDroppedRelativePath(folderData?.relativePath);

  async function validateDroppedItems(event, items) {
    const sourceItems = Array.isArray(items) ? items : [];
    const files = [];
    const folders = [];
    const rejected = [];

    for (const item of sourceItems) {
      // 首尾空格是合法文件名字符，名称与本地路径都不能 trim
      const name =
        typeof item?.name === "string" && item.name.trim()
          ? item.name
          : path.basename(String(item?.localPath || ""));
      const localPath =
        typeof item?.localPath === "string" && item.localPath.trim()
          ? item.localPath
          : "";
      const relativePath = normalizeDroppedRelativePath(item?.relativePath);

      if (!relativePath) {
        rejected.push({
          name,
          localPath,
          relativePath: "",
          reason: "invalid-relative-path",
          message: "Dropped item has no valid relative path",
        });
        continue;
      }

      if (!localPath) {
        rejected.push({
          name: name || relativePath,
          relativePath,
          reason: "missing-local-path",
          message: "Dropped item has no verifiable local path",
        });
        continue;
      }

      try {
        const resolvedPath = path.resolve(localPath);
        const stats = fs.statSync(resolvedPath);
        fs.accessSync(resolvedPath, fs.constants.R_OK);
        const expectsFile = item?.isFile === true;
        const expectsDirectory = item?.isDirectory === true;

        const descriptor = {
          name: name || path.basename(resolvedPath),
          localPath: resolvedPath,
          relativePath,
          size: Number.isFinite(stats.size) ? stats.size : 0,
          lastModified: Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : 0,
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
        };

        if (expectsFile && !descriptor.isFile) {
          rejected.push({
            name: descriptor.name,
            localPath: resolvedPath,
            relativePath,
            reason: "unsupported-file-type",
            message:
              "Dropped item was declared as a file but is not a regular file",
          });
          continue;
        }

        if (expectsDirectory && !descriptor.isDirectory) {
          rejected.push({
            name: descriptor.name,
            localPath: resolvedPath,
            relativePath,
            reason: "unsupported-file-type",
            message:
              "Dropped item was declared as a directory but is not a directory",
          });
          continue;
        }

        if (descriptor.isFile) {
          files.push(descriptor);
          continue;
        }

        if (descriptor.isDirectory) {
          if (item?.directoryReadable === false) {
            rejected.push({
              name: descriptor.name,
              localPath: resolvedPath,
              relativePath,
              reason: "not-readable",
              message: "Dropped directory could not be enumerated",
            });
            continue;
          }

          fs.readdirSync(resolvedPath);
          folders.push(descriptor);
          continue;
        }

        rejected.push({
          name: descriptor.name,
          localPath: resolvedPath,
          relativePath,
          reason: "unsupported-file-type",
          message: "Dropped item is not a regular file or directory",
        });
      } catch (error) {
        rejected.push({
          name: name || relativePath,
          localPath,
          relativePath,
          reason:
            error?.code === "EACCES" || error?.code === "EPERM"
              ? "permission-denied"
              : "not-readable",
          message: error?.message || "Dropped item is not readable",
        });
      }
    }

    return {
      success: rejected.length === 0,
      files,
      folders,
      rejected,
      totalItems: sourceItems.length,
    };
  }

  async function checkDroppedUploadConflicts(
    event,
    tabId,
    targetFolder,
    uploadData,
  ) {
    const processInfo = processManager.getProcess(tabId);
    if (
      !processInfo ||
      !processInfo.config ||
      !processInfo.process ||
      processInfo.type !== "ssh"
    ) {
      throw new Error(fileText("mainProcess.file.sshConnectionInvalid"));
    }

    const normalizedTarget = normalizeRemoteTransferPath(targetFolder);
    const rawFiles = Array.isArray(uploadData?.files) ? uploadData.files : [];
    const rawFolders = Array.isArray(uploadData?.folders)
      ? uploadData.folders
      : [];
    const candidates = [];

    for (const fileData of rawFiles) {
      const relativePath = normalizeDroppedRelativePath(fileData?.relativePath);
      if (!relativePath) {
        throw new Error(
          fileText("mainProcess.file.dropFileMissingRelativePath"),
        );
      }

      candidates.push({
        type: "file",
        name: path.posix.basename(relativePath),
        relativePath,
        remotePath: joinDroppedRemotePath(normalizedTarget, relativePath),
      });
    }

    for (const folderData of rawFolders) {
      const relativePath = normalizeDroppedFolderRelativePath(folderData);
      if (!relativePath) {
        throw new Error(
          fileText("mainProcess.file.dropFolderMissingRelativePath"),
        );
      }

      candidates.push({
        type: "directory",
        name: path.posix.basename(relativePath),
        relativePath,
        remotePath: joinDroppedRemotePath(normalizedTarget, relativePath),
      });
    }

    const dedupedCandidates = Array.from(
      new Map(
        candidates.map((candidate) => [candidate.remotePath, candidate]),
      ).values(),
    );
    const conflicts = [];
    const { results } = await nativeSftpClient.getFilePermissionsBatch(
      tabId,
      dedupedCandidates.map((candidate) => candidate.remotePath),
    );
    for (const [index, result] of results.entries()) {
      if (result.success) {
        conflicts.push({
          ...dedupedCandidates[index],
          mode: result.mode,
          permissions: result.permissions,
          isDirectory: result.stats?.isDirectory === true,
        });
      } else if (result.errorCode !== "NATIVE_SFTP_NOT_FOUND") {
        nativeSftpClient.requireNativeSuccess(result);
      }
    }

    return {
      success: true,
      hasConflicts: conflicts.length > 0,
      conflicts,
    };
  }

  return {
    validateDroppedItems,
    checkDroppedUploadConflicts,
  };
}

module.exports = createDroppedUploadValidationMethods;
