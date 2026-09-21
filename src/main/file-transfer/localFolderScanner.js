const path = require("path");
const { execFile } = require("child_process");
const { getNativeServicesHostPath } = require("../native/nativeServices");
const { normalizeErrorMessage } = require("../utils/errorResponse");
const { toPosixPath } = require("./transferShared");
async function scanLocalFolderWithNativeSidecar(
  localFolderPath,
  translate,
  options = {},
) {
  const scannerPath = getNativeServicesHostPath();
  if (!scannerPath) {
    throw new Error(
      translate("mainProcess.transfer.errors.scannerHostMissing"),
    );
  }

  const args = ["scan-folder", "--path", localFolderPath];
  const appendPositiveIntegerArg = (flag, value) => {
    const parsed = Math.floor(Number(value));
    if (Number.isFinite(parsed) && parsed > 0) {
      args.push(flag, String(parsed));
    }
  };

  appendPositiveIntegerArg("--max-entries", options.maxEntries);
  appendPositiveIntegerArg("--max-depth", options.maxDepth);
  appendPositiveIntegerArg("--max-bytes", options.maxBytes);

  return new Promise((resolve, reject) => {
    execFile(
      scannerPath,
      args,
      {
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024, // 目录扫描输出缓冲区上限（根据系统内存自动调整，非固定值）
        timeout: 60000,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              stderr?.trim() || stdout?.trim() || normalizeErrorMessage(error),
            ),
          );
          return;
        }

        const payload = String(stdout || "").trim();
        if (!payload) {
          reject(
            new Error(
              translate("mainProcess.transfer.errors.scannerEmptyOutput"),
            ),
          );
          return;
        }

        try {
          resolve(JSON.parse(payload));
        } catch (parseError) {
          reject(
            new Error(
              translate("mainProcess.transfer.errors.scannerInvalidJson", {
                error: normalizeErrorMessage(parseError),
              }),
            ),
          );
        }
      },
    );
  });
}

async function scanLocalFolder(localFolderPath, translate) {
  const normalizedRoot = path.resolve(localFolderPath);
  const normalizeScanResult = (scanResult) => {
    const rawFiles = Array.isArray(scanResult?.files) ? scanResult.files : [];
    const files = rawFiles.map((file) => {
      const relativePath = toPosixPath(
        file?.relativePath || file?.path || file?.name || "",
      );
      const localPath = file?.localPath || file?.path || "";
      return {
        localPath,
        relativePath,
        fileName:
          file?.fileName ||
          file?.name ||
          path.basename(localPath || relativePath),
        size: Number.isFinite(file?.size) ? file.size : 0,
      };
    });

    const totalBytesFromPayload =
      Number.isFinite(scanResult?.totalBytes) && scanResult.totalBytes >= 0
        ? scanResult.totalBytes
        : Number.isFinite(scanResult?.totalSize) && scanResult.totalSize >= 0
          ? scanResult.totalSize
          : files.reduce(
              (sum, file) => sum + (Number.isFinite(file.size) ? file.size : 0),
              0,
            );

    return {
      schemaVersion: scanResult?.schemaVersion || null,
      scanId: scanResult?.scanId || null,
      rootPath: scanResult?.rootPath || normalizedRoot,
      truncated: scanResult?.truncated === true,
      truncatedReason: scanResult?.truncatedReason || null,
      maxEntriesHit:
        scanResult?.maxEntriesHit === true || scanResult?.maxFilesHit === true,
      maxDepthHit: scanResult?.maxDepthHit === true,
      maxBytesHit: scanResult?.maxBytesHit === true,
      files,
      directories: Array.isArray(scanResult?.directories)
        ? scanResult.directories.map((entry) => toPosixPath(entry || ""))
        : [],
      errors: Array.isArray(scanResult?.errors) ? scanResult.errors : [],
      totalBytes: totalBytesFromPayload,
    };
  };
  const nativeScan = await scanLocalFolderWithNativeSidecar(
    normalizedRoot,
    translate,
  );
  return normalizeScanResult(nativeScan);
}
module.exports = { scanLocalFolder };
