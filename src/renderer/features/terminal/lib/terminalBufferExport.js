/**
 * Pure helpers for reading logical lines from an xterm.js buffer (reconstructing
 * soft-wrapped `isWrapped` rows) and formatting scrollback text/log exports.
 */

const DEFAULT_EXPORT_BASENAME = "terminal";

/**
 * Walk `term.buffer.active` from line 0 to `buffer.length - 1`, merge
 * soft-wrapped (`isWrapped`) rows into logical lines, trim trailing right-edge
 * padding on each logical line, and drop trailing blank lines.
 *
 * @param {Record<string, any> | null | undefined} term
 * @returns {string[]}
 */
export function extractBufferLogicalLines(term) {
  const buffer = term?.buffer?.active;
  if (!buffer || typeof buffer.getLine !== "function") {
    return [];
  }

  const totalRows = Math.max(0, Math.floor(Number(buffer.length) || 0));
  if (totalRows === 0) {
    return [];
  }

  /** @type {string[]} */
  const logicalLines = [];
  /** @type {string[]} */
  let currentSegments = [];
  let hasActiveLine = false;

  for (let row = 0; row < totalRows; row += 1) {
    const line = buffer.getLine(row);
    const isWrapped = row > 0 && Boolean(line?.isWrapped);
    const nextLine = row + 1 < totalRows ? buffer.getLine(row + 1) : null;
    const nextIsWrapped = Boolean(nextLine?.isWrapped);

    if (!isWrapped && hasActiveLine) {
      logicalLines.push(currentSegments.join("").replace(/[ \t]+$/g, ""));
      currentSegments = [];
    }

    hasActiveLine = true;
    if (line && typeof line.translateToString === "function") {
      // Preserve spaces at soft-wrap boundaries; trim padding only at the
      // terminating row of each logical line.
      currentSegments.push(line.translateToString(!nextIsWrapped));
    }
  }

  if (hasActiveLine) {
    logicalLines.push(currentSegments.join("").replace(/[ \t]+$/g, ""));
  }

  while (
    logicalLines.length > 0 &&
    logicalLines[logicalLines.length - 1] === ""
  ) {
    logicalLines.pop();
  }

  return logicalLines;
}

/**
 * Format an informational metadata header for exported scrollback transcripts.
 * @param {Record<string, any>} [metadata]
 * @param {Date | string | number} [timestamp]
 * @returns {string}
 */
export function formatScrollbackHeader(metadata = {}, timestamp = new Date()) {
  const meta = metadata && typeof metadata === "object" ? metadata : {};
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const isoTimestamp = Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();

  const host = typeof meta.host === "string" ? meta.host.trim() : "";
  const username =
    typeof meta.username === "string" ? meta.username.trim() : "";
  const port =
    meta.port !== undefined && meta.port !== null && meta.port !== ""
      ? String(meta.port).trim()
      : "";
  const label = typeof meta.label === "string" ? meta.label.trim() : "";
  const protocol =
    typeof meta.protocol === "string" && meta.protocol.trim()
      ? meta.protocol.trim().toUpperCase()
      : "";

  let sessionTarget = "";
  if (host) {
    sessionTarget = `${username ? `${username}@` : ""}${host}${port ? `:${port}` : ""}`;
  } else if (label) {
    sessionTarget = label;
  } else {
    sessionTarget = "local";
  }

  const lines = [
    "# SimpleShell Terminal Scrollback",
    `# Host: ${sessionTarget}${protocol ? ` (${protocol})` : ""}`,
    `# Timestamp: ${isoTimestamp}`,
    "# ----------------------------------------",
  ];
  return lines.join("\n");
}

/**
 * Build a sanitized default `.log` filename for native save dialogs.
 * @param {Record<string, any>} [metadata]
 * @param {Date | string | number} [timestamp]
 * @returns {string}
 */
export function buildScrollbackExportFilename(
  metadata = {},
  timestamp = new Date(),
) {
  const meta = metadata && typeof metadata === "object" ? metadata : {};
  const rawName =
    (typeof meta.host === "string" && meta.host.trim()) ||
    (typeof meta.label === "string" && meta.label.trim()) ||
    DEFAULT_EXPORT_BASENAME;
  const sanitized = rawName
    .replace(/[<>:"/\\|?*\x00-\x1f\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const safeBase = sanitized || DEFAULT_EXPORT_BASENAME;

  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = [
    validDate.getUTCFullYear(),
    pad(validDate.getUTCMonth() + 1),
    pad(validDate.getUTCDate()),
    "-",
    pad(validDate.getUTCHours()),
    pad(validDate.getUTCMinutes()),
    pad(validDate.getUTCSeconds()),
  ].join("");

  return `simpleshell-${safeBase}-${stamp}.log`;
}

/**
 * Extract full active scrollback text from an xterm instance, optionally
 * prepending a session metadata header.
 *
 * @param {Record<string, any> | null | undefined} term
 * @param {{ includeHeader?: boolean, metadata?: Record<string, any>, timestamp?: Date | string | number }} [options]
 */
export function extractTerminalScrollback(term, options = {}) {
  const {
    includeHeader = false,
    metadata = {},
    timestamp = new Date(),
  } = options;
  const lines = extractBufferLogicalLines(term);
  const body = lines.join("\n");
  const isEmpty = lines.length === 0;

  if (isEmpty) {
    return {
      text: "",
      body: "",
      header: includeHeader ? formatScrollbackHeader(metadata, timestamp) : "",
      lineCount: 0,
      isEmpty: true,
    };
  }

  if (!includeHeader) {
    return {
      text: body,
      body,
      header: "",
      lineCount: lines.length,
      isEmpty: false,
    };
  }

  const header = formatScrollbackHeader(metadata, timestamp);
  return {
    text: `${header}\n${body}\n`,
    body,
    header,
    lineCount: lines.length,
    isEmpty: false,
  };
}
