const path = require("path");
const { getNativeServicesHostPath } = require("../native/nativeServices");
const { execCoreService } = require("../native/coreSupervisor");
const { normalizeErrorMessage } = require("../utils/errorResponse");
const { toPosixPath } = require("./transferShared");
async function scanLocalFolderWithNativeSidecar(
  localFolderPath,
  translate,
  options = {},
) {
  if (!getNativeServicesHostPath()) {
    throw new Error(
      translate("mainProcess.transfer.errors.scannerHostMissing"),
    );
  }

  const args = ["--path", localFolderPath];
  const appendPositiveIntegerArg = (flag, value) => {
    const parsed = Math.floor(Number(value));
    if (Number.isFinite(parsed) && parsed > 0) {
      args.push(flag, String(parsed));
    }
  };

  appendPositiveIntegerArg("--max-entries", options.maxEntries);
  appendPositiveIntegerArg("--max-depth", options.maxDepth);
  appendPositiveIntegerArg("--max-bytes", options.maxBytes);

  let stdout;
  try {
    ({ stdout } = await execCoreService("scan-folder", args, {
      maxBuffer: 64 * 1024 * 1024,
      timeoutMs: 60000,
    }));
  } catch (error) {
    throw new Error(
      error.stderr?.trim() ||
        error.stdout?.trim() ||
        normalizeErrorMessage(error),
    );
  }

  const payload = String(stdout || "").trim();
  if (!payload) {
    throw new Error(
      translate("mainProcess.transfer.errors.scannerEmptyOutput"),
    );
  }
  try {
    return JSON.parse(payload);
  } catch (parseError) {
    throw new Error(
      translate("mainProcess.transfer.errors.scannerInvalidJson", {
        error: normalizeErrorMessage(parseError),
      }),
    );
  }
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
