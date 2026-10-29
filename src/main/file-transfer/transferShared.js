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

// 文件名首尾空格是合法字符，只丢弃空段与 ./..，不能 trim
function normalizeDroppedTransferRelativePath(relativePath) {
  return toPosixPath(relativePath || "")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

/**
 * 远程（SFTP，POSIX）路径规范化：仅处理空值与 ~ 前缀。
 * 反斜杠与首尾空格在远程文件名中都是合法字符，保持原样。
 */
function normalizeRemoteTransferPath(remotePath) {
  const raw = String(remotePath ?? "");
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "~") return ".";
  if (raw.startsWith("~/")) return `./${raw.slice(2)}`;
  return raw;
}

// Windows 文件名限制：非法字符、结尾的点/空格、设备保留名
const WINDOWS_INVALID_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/** 把单个远程路径段转换为本地文件系统可用的名称 */
function sanitizeLocalPathSegment(segment, platform = process.platform) {
  let name = String(segment ?? "");
  if (platform === "win32") {
    name = name
      .replace(WINDOWS_INVALID_NAME_CHARS, "_")
      .replace(/[. ]+$/, (tail) => "_".repeat(tail.length));
    if (WINDOWS_RESERVED_NAME.test(name)) name = `_${name}`;
  } else {
    name = name.replace(/[/\u0000]/g, "_");
  }
  if (!name || name === "." || name === "..") return "_";
  return name;
}

const appendNameSuffix = (name, counter) => {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex > 0) {
    return `${name.slice(0, dotIndex)} (${counter})${name.slice(dotIndex)}`;
  }
  return `${name} (${counter})`;
};

/**
 * 远程相对路径 → 本地相对路径段分配器（同一批次内复用）。
 * - 每段做本地文件名安全化；
 * - 在大小写不敏感的平台上（Windows/macOS），同目录下 "A.txt"/"a.txt"
 *   或安全化后重名的条目追加 " (n)"，避免多个远程文件写入同一本地路径。
 */
function createLocalPathAllocator(platform = process.platform) {
  const caseInsensitive = platform === "win32" || platform === "darwin";
  const foldName = (name) => (caseInsensitive ? name.toLowerCase() : name);
  const directories = new Map();

  const getDirectory = (remoteDirKey) => {
    let directory = directories.get(remoteDirKey);
    if (!directory) {
      directory = { used: new Set(), mapping: new Map() };
      directories.set(remoteDirKey, directory);
    }
    return directory;
  };

  const resolveSegments = (remoteRelativePath) => {
    const segments = String(remoteRelativePath ?? "")
      .split("/")
      .filter((segment) => segment && segment !== "." && segment !== "..");
    const localSegments = [];
    let remoteDirKey = "";
    for (const segment of segments) {
      const directory = getDirectory(remoteDirKey);
      let localName = directory.mapping.get(segment);
      if (localName === undefined) {
        const baseName = sanitizeLocalPathSegment(segment, platform);
        localName = baseName;
        for (
          let counter = 1;
          directory.used.has(foldName(localName));
          counter += 1
        ) {
          localName = appendNameSuffix(baseName, counter);
        }
        directory.used.add(foldName(localName));
        directory.mapping.set(segment, localName);
      }
      localSegments.push(localName);
      remoteDirKey = remoteDirKey ? `${remoteDirKey}/${segment}` : segment;
    }
    return localSegments;
  };

  return { resolveSegments };
}

module.exports = {
  buildCancelledError,
  toPosixPath,
  normalizeDroppedTransferRelativePath,
  normalizeRemoteTransferPath,
  sanitizeLocalPathSegment,
  createLocalPathAllocator,
};
