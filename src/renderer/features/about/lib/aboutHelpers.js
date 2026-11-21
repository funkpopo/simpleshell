import { getMarkdownContentSx } from "../../../shared/ui/markdownContentSx.js";

export const updatePanelSx = {
  mt: 1,
  p: 1.5,
  borderRadius: "var(--radius-md, 6px)",
  border: "1px solid",
  borderColor: "divider",
  bgcolor: (theme) =>
    theme.palette.mode === "dark"
      ? "rgba(255, 255, 255, 0.025)"
      : "rgba(21, 23, 25, 0.02)",
};

// 更新日志容器属性（maxHeight/border/padding/overflow）；
// markdown 排版统一走 shared/ui/markdownContentSx.js（density: compact）
const releaseNoteContainerSx = {
  mt: 1.5,
  maxHeight: 220,
  overflow: "auto",
  borderRadius: "var(--radius-md, 6px)",
  border: "1px solid",
  borderColor: "divider",
  bgcolor: "background.default",
  p: 1.25,
};

export const releaseNoteSx = [
  releaseNoteContainerSx,
  getMarkdownContentSx({ density: "compact" }),
];

export const RELEASE_NOTE_ALLOWED_ELEMENTS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "p",
  "a",
  "code",
  "pre",
  "strong",
  "em",
  "del",
  "ul",
  "ol",
  "li",
  "blockquote",
  "hr",
  "br",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "input",
];

export const UPDATE_BUSY_STATUSES = new Set([
  "checking",
  "downloading",
  "installing",
]);

export const formatDateTime = (value, locale) => {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(locale || undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

/**
 * 将下载结果或 hasDownloadedInstaller 返回值统一为界面可用的安装包信息。
 * 下载阶段已完成哈希校验时，可直接用 result.installer 立即展示安装按钮。
 */
export const normalizeDownloadedInstallerInfo = (source, options = {}) => {
  if (!source || source.available === false) {
    return null;
  }

  const installerVersion = source.installerVersion || source.version || null;
  const filePath =
    typeof source.filePath === "string" && source.filePath
      ? source.filePath
      : "";
  const fileName =
    source.fileName ||
    source.assetName ||
    (filePath ? filePath.split(/[\\/]/).pop() : null) ||
    null;

  // hasDownloadedInstaller 成功结果；或下载返回的 installer 元数据
  const looksReady =
    source.available === true ||
    Boolean(installerVersion) ||
    Boolean(filePath) ||
    Boolean(fileName) ||
    Boolean(source.sha256);

  if (!looksReady) {
    return null;
  }

  return {
    available: true,
    installerVersion,
    currentVersion: source.currentVersion || options.currentVersion || null,
    fileName,
    size: source.size || 0,
    sha256: source.sha256 || null,
    expectedSha256: source.expectedSha256 || null,
    downloadedAt: source.downloadedAt || null,
    publishedAt: source.publishedAt || null,
    releaseName: source.releaseName || null,
    assetName: source.assetName || null,
    isSecurityUpdate: source.isSecurityUpdate === true,
    isImportantUpdate: source.isImportantUpdate === true,
    severity: source.severity || "normal",
    status: source.status || "downloaded",
    installerLogPath: source.installerLogPath || null,
    lastError: source.lastError || null,
  };
};
