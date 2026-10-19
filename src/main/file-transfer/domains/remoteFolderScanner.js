/** RemoteFolderScanner: explicit dependencies supplied by the service facade. */
function createRemoteFolderScanner(
  dependencies,
  { toPosixPath, path, transferText, nativeSftpClient },
) {
  return new (class RemoteFolderScanner {
    constructor() {
      this.dependencies = dependencies;
    }
    _normalizeRemotePath(remotePath) {
      const raw = String(remotePath ?? "").trim();
      if (!raw || raw === "~") return ".";

      const normalized = toPosixPath(raw);
      if (normalized === "~") return ".";
      if (normalized.startsWith("~/")) return `./${normalized.slice(2)}`;
      return normalized;
    }
    _joinRemotePath(basePath, childName) {
      const base = this._normalizeRemotePath(basePath);
      if (!childName) return base;
      if (base === ".") return toPosixPath(childName);
      return path.posix.join(base, toPosixPath(childName));
    }
    async _ensureRemoteDirectories(
      tabId,
      remoteDirs,
      {
        transferKey = null,
        displayName = transferText("mainProcess.transfer.preparingUpload"),
        progressExtra = {},
      } = {},
    ) {
      const uniqueDirs = Array.from(
        new Set(
          (remoteDirs || [])
            .map((dir) => this._normalizeRemotePath(dir))
            .filter((dir) => dir && dir !== "." && dir !== "/"),
        ),
      );

      if (transferKey) {
        this.dependencies._setTransferPreparation(
          transferKey,
          uniqueDirs.length,
        );
      }

      if (uniqueDirs.length === 0) return;

      uniqueDirs.sort((a, b) => {
        const depthA = a.split("/").filter(Boolean).length;
        const depthB = b.split("/").filter(Boolean).length;
        return depthA - depthB;
      });

      for (let index = 0; index < uniqueDirs.length; index += 1) {
        const fullDirPath = uniqueDirs[index];
        if (transferKey) {
          this.dependencies._throwIfTransferCancelled(transferKey);
        }

        // Native createRemoteFolders is recursive and now runs on the same
        // persistent native SFTP session as the subsequent upload requests.
        await nativeSftpClient.createRemoteFolders(tabId, fullDirPath);

        if (transferKey) {
          const transfer =
            this.dependencies._advanceTransferPreparation(transferKey);
          this.dependencies._emitTransferProgress(transferKey, {
            fileName:
              displayName ||
              transferText("mainProcess.transfer.preparingUpload"),
            currentFile: transferText(
              "mainProcess.transfer.creatingDirectory",
              {
                index: index + 1,
                total: uniqueDirs.length,
                path: fullDirPath,
              },
            ),
            extra: {
              preparationCompleted: transfer?.preparationCompleted || 0,
              preparationTotal: transfer?.preparationTotal || uniqueDirs.length,
              ...progressExtra,
            },
          });
        }
      }

      if (transferKey) {
        const transfer = this.dependencies._getTransfer(transferKey);
        this.dependencies._emitTransferProgress(transferKey, {
          force: true,
          fileName:
            displayName || transferText("mainProcess.transfer.preparingUpload"),
          currentFile: transferText("mainProcess.transfer.directoryReady"),
          extra: {
            preparationCompleted: transfer?.preparationCompleted || 0,
            preparationTotal: transfer?.preparationTotal || uniqueDirs.length,
            ...progressExtra,
          },
        });
      }
    }
    async _scanRemoteFolderTree(tabId, remoteRootPath, transferKey = null) {
      const rootPath = this._normalizeRemotePath(remoteRootPath);
      if (transferKey) {
        this.dependencies._throwIfTransferCancelled(transferKey);
      }

      const result = await nativeSftpClient.scanRemoteFolderTree(
        tabId,
        rootPath,
      );
      if (!result?.success) {
        throw new Error(
          result?.error ||
            transferText("mainProcess.transfer.errors.scanRemoteFolderFailed"),
        );
      }

      if (transferKey) {
        this.dependencies._throwIfTransferCancelled(transferKey);
      }

      const rawFiles = Array.isArray(result?.files) ? result.files : [];
      const rawDirectories = Array.isArray(result?.directories)
        ? result.directories
        : [];

      return {
        schemaVersion: result?.schemaVersion || null,
        scanId: result?.scanId || null,
        rootPath: result?.rootPath || rootPath,
        truncated: result?.truncated === true,
        truncatedReason: result?.truncatedReason || null,
        maxEntriesHit:
          result?.maxEntriesHit === true || result?.maxFilesHit === true,
        maxDepthHit: result?.maxDepthHit === true,
        maxBytesHit: result?.maxBytesHit === true,
        files: rawFiles.map((file) => ({
          remotePath: this._normalizeRemotePath(file?.remotePath || ""),
          relativePath: toPosixPath(file?.relativePath || ""),
          fileName:
            file?.fileName ||
            path.posix.basename(
              toPosixPath(file?.relativePath || file?.remotePath || ""),
            ),
          size: Number.isFinite(file?.size) ? file.size : 0,
        })),
        directories: rawDirectories.map((entry) => toPosixPath(entry || "")),
        errors: Array.isArray(result?.errors) ? result.errors : [],
        totalBytes: Number.isFinite(result?.totalBytes)
          ? result.totalBytes
          : rawFiles.reduce(
              (sum, file) =>
                sum + (Number.isFinite(file?.size) ? file.size : 0),
              0,
            ),
      };
    }
    _getDownloadFolderName(remoteFolderPath) {
      const normalized = this._normalizeRemotePath(remoteFolderPath).replace(
        /\/+$/,
        "",
      );
      if (!normalized || normalized === "." || normalized === "/") {
        return "remote-folder";
      }
      return path.posix.basename(normalized);
    }
  })();
}
module.exports = createRemoteFolderScanner;
