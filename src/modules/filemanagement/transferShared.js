const { t: mainTranslate } = require("../../shared/mainI18n");

function buildCancelledError(message) {
  const error = new Error(
    message || mainTranslate("mainProcess.transfer.errors.cancelledByUser"),
  );
  error.cancelled = true;
  error.userCancelled = true;
  return error;
}

function toPosixPath(p) {
  return String(p || "").replace(/\\/g, "/");
}

function normalizeDroppedTransferRelativePath(relativePath) {
  return toPosixPath(relativePath || "")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

module.exports = {
  buildCancelledError,
  toPosixPath,
  normalizeDroppedTransferRelativePath,
};
