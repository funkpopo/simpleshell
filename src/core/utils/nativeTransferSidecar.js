const fs = require("fs");
const path = require("path");

const SIDECAR_BASENAME =
  process.platform === "win32"
    ? "transfer-sidecar.exe"
    : "transfer-sidecar";

function getTransferNativeScannerPath() {
  const overridePath = process.env.SIMPLESHELL_TRANSFER_SIDECAR_PATH;
  const platformArchDir = `${process.platform}-${process.arch}`;
  const candidates = [];

  if (overridePath) {
    candidates.push(path.resolve(overridePath));
  }

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, SIDECAR_BASENAME));
    candidates.push(
      path.join(process.resourcesPath, "bin", platformArchDir, SIDECAR_BASENAME),
    );
  }

  candidates.push(
    path.join(
      process.cwd(),
      "transfernative",
      "bin",
      platformArchDir,
      SIDECAR_BASENAME,
    ),
  );
  candidates.push(
    path.join(
      process.cwd(),
      "transfernative",
      "transfer-sidecar",
      "target",
      "release",
      SIDECAR_BASENAME,
    ),
  );

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

module.exports = {
  getTransferNativeScannerPath,
};
