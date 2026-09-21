const os = require("os");
const { SESSION_CONFIG, TRANSFER_CONFIG } = require("./sftpConfig");
const CHUNK_PARALLEL_THRESHOLD_BYTES = 128 * 1024 * 1024;
const CHUNK_PARALLEL_TARGET_CHUNK_BYTES = 32 * 1024 * 1024;
const CHUNK_PARALLEL_MAX_SEGMENTS = 16;
const CHUNK_PARALLEL_MIN_SEGMENTS = 2;
function _chooseConcurrency(
  totalFiles,
  totalBytes,
  isFolderLike = false,
  direction = "download",
) {
  const files = Math.max(1, totalFiles || 1);
  const bytes = Math.max(0, totalBytes || 0);
  const cpu = Math.max(2, os.cpus()?.length || 4);
  const isUpload = direction === "upload";
  const configuredDirectionLimit = isUpload
    ? TRANSFER_CONFIG?.PARALLEL_FILES_UPLOAD
    : TRANSFER_CONFIG?.PARALLEL_FILES_DOWNLOAD;
  const directionLimit =
    Number.isFinite(configuredDirectionLimit) && configuredDirectionLimit > 0
      ? Math.floor(configuredDirectionLimit)
      : files;
  const sessionLimit =
    Number.isFinite(SESSION_CONFIG?.MAX_SESSIONS_PER_TAB) &&
    SESSION_CONFIG.MAX_SESSIONS_PER_TAB > 0
      ? Math.floor(SESSION_CONFIG.MAX_SESSIONS_PER_TAB)
      : files;

  let concurrency = Math.max(2, Math.floor(cpu / 2));
  if (bytes >= 8 * 1024 * 1024 * 1024) {
    concurrency = Math.min(concurrency, 4);
  } else if (bytes >= 2 * 1024 * 1024 * 1024) {
    concurrency = Math.min(concurrency, 5);
  } else {
    concurrency = Math.min(concurrency + 1, 8);
  }

  if (isFolderLike && files > 200) {
    concurrency = Math.min(concurrency + 2, 10);
  }

  return Math.max(
    1,
    Math.min(concurrency, files, directionLimit, sessionLimit),
  );
}

function _shouldUseChunkParallel(totalBytes) {
  const size = Number.isFinite(totalBytes) ? totalBytes : 0;
  return size >= CHUNK_PARALLEL_THRESHOLD_BYTES;
}

function _buildChunkSegments(totalBytes) {
  const size = Number.isFinite(totalBytes) ? Math.floor(totalBytes) : 0;
  if (size <= 0 || !_shouldUseChunkParallel(size)) {
    return [];
  }

  const estimatedCount = Math.ceil(size / CHUNK_PARALLEL_TARGET_CHUNK_BYTES);
  const segmentCount = Math.max(
    CHUNK_PARALLEL_MIN_SEGMENTS,
    Math.min(CHUNK_PARALLEL_MAX_SEGMENTS, estimatedCount),
  );
  const segmentSize = Math.max(1, Math.ceil(size / segmentCount));
  const segments = [];
  let offset = 0;
  let index = 0;

  while (offset < size) {
    const remaining = size - offset;
    const length = Math.min(segmentSize, remaining);
    segments.push({
      index,
      offset,
      length,
    });
    offset += length;
    index += 1;
  }

  return segments;
}

function _buildFileTaskKey(direction, remotePath, localPath, index) {
  return `${direction || "transfer"}::${index}::${remotePath || ""}::${localPath || ""}`;
}
module.exports = {
  _chooseConcurrency,
  _shouldUseChunkParallel,
  _buildChunkSegments,
  _buildFileTaskKey,
};
