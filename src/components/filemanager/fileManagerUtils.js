import { sleep } from "../../shared/common";

export const FILE_MANAGER_PATH_HISTORY_LIMIT = 50;

export const TRANSFER_CONFLICT_PREVIEW_LIMIT = 8;

export const CONFIRM_DIALOG_INITIAL_STATE = {
  open: false,
  title: "",
  message: "",
  detail: "",
  detailItems: [],
  detailFooter: "",
  onConfirm: null,
  confirmText: "",
  cancelText: "",
  confirmColor: "primary",
  defaultAction: "cancel",
};

export const joinPath = (basePath, childName) => {
  if (!childName) return basePath;

  if (basePath === "/") {
    return `/${childName}`;
  }

  if (basePath === "~") {
    return `~/${childName}`;
  }

  const normalizedBase = basePath.endsWith("/")
    ? basePath.slice(0, -1)
    : basePath;

  return `${normalizedBase}/${childName}`;
};

export const getParentPath = (targetPath) => {
  if (!targetPath || targetPath === "/" || targetPath === "~") {
    return targetPath || "/";
  }

  const normalizedPath =
    targetPath.length > 1 && targetPath.endsWith("/")
      ? targetPath.slice(0, -1)
      : targetPath;
  const lastSlashIndex = normalizedPath.lastIndexOf("/");

  if (lastSlashIndex <= 0) {
    return normalizedPath.startsWith("~") ? "~" : "/";
  }

  return normalizedPath.slice(0, lastSlashIndex);
};

export const withSftpRetry = async (operation, options = {}) => {
  const {
    maxRetries = 2,
    baseDelay = 300,
    fallbackError = "",
    treatErrorAsSuccess = null,
    onRetry = null,
    formatCaughtError = (error) => error?.message || fallbackError,
  } = options;

  const waitBeforeRetry = (attempt) => sleep(baseDelay * (attempt + 1));

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await operation();

      if (response?.success) {
        return { success: true, response };
      }

      const responseError = response?.error || fallbackError;

      if (treatErrorAsSuccess && treatErrorAsSuccess(responseError)) {
        return { success: true, response };
      }

      if (
        (responseError.includes("SFTP错误") ||
          /sftp\s*error/i.test(responseError)) &&
        attempt < maxRetries
      ) {
        onRetry?.(attempt + 1, maxRetries);
        await waitBeforeRetry(attempt);
        continue;
      }

      return { success: false, error: responseError };
    } catch (error) {
      if (attempt < maxRetries) {
        onRetry?.(attempt + 1, maxRetries);
        await waitBeforeRetry(attempt);
        continue;
      }

      return { success: false, error: formatCaughtError(error) };
    }
  }

  return { success: false, error: fallbackError };
};

export const getLocalPathBaseName = (localPath) => {
  const normalized = String(localPath || "").replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || "";
};

export const getDroppedEntryName = (entry) => {
  const name = typeof entry?.name === "string" ? entry.name : "";
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) {
    return "";
  }
  return name;
};

export const joinDroppedLocalPath = (basePath, childName) => {
  const base = String(basePath || "");
  const child = typeof childName === "string" ? childName : "";

  if (
    !base ||
    !child ||
    child === "." ||
    child === ".." ||
    /[\\/]/.test(child)
  ) {
    return "";
  }

  const separator = base.includes("\\") ? "\\" : "/";
  return `${base}${/[\\/]$/.test(base) ? "" : separator}${child}`;
};

export const normalizeNavigationState = (
  navigationState,
  currentPath = "/",
) => {
  const safeCurrentPath =
    typeof currentPath === "string" && currentPath.trim() ? currentPath : "/";

  let pathHistory = Array.isArray(navigationState?.pathHistory)
    ? navigationState.pathHistory.filter(
        (value) => typeof value === "string" && value.trim(),
      )
    : [];

  if (pathHistory.length > FILE_MANAGER_PATH_HISTORY_LIMIT) {
    pathHistory = pathHistory.slice(-FILE_MANAGER_PATH_HISTORY_LIMIT);
  }

  const currentPathIndex = pathHistory.lastIndexOf(safeCurrentPath);
  if (currentPathIndex === -1) {
    pathHistory = [...pathHistory, safeCurrentPath];
    if (pathHistory.length > FILE_MANAGER_PATH_HISTORY_LIMIT) {
      pathHistory = pathHistory.slice(-FILE_MANAGER_PATH_HISTORY_LIMIT);
    }
  }

  return {
    pathHistory,
    historyIndex: pathHistory.lastIndexOf(safeCurrentPath),
  };
};
