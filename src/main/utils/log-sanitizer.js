const SENSITIVE_KEY_PATTERN =
  /(password|passwd|token|secret|api[_-]?key|authorization)\s*[:=]\s*([^\s,;]+)/gi;
const BEARER_TOKEN_PATTERN = /\b(Bearer)\s+[A-Za-z0-9\-._~+/]+=*/gi;

function redactSensitiveText(input) {
  if (typeof input !== "string") {
    return "";
  }

  return input
    .replace(SENSITIVE_KEY_PATTERN, (match, key) => {
      if (!key) {
        return "<redacted>";
      }
      return `${key}=<redacted>`;
    })
    .replace(BEARER_TOKEN_PATTERN, "$1 <redacted>");
}

function sanitizePathForLog(pathValue) {
  if (typeof pathValue !== "string" || !pathValue.trim()) {
    return "<empty-path>";
  }

  const normalized = pathValue.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);

  if (parts.length <= 2) {
    return normalized;
  }

  const last = parts[parts.length - 1];
  const hasDrive = /^[a-zA-Z]:$/.test(parts[0]);
  const startsWithRoot = normalized.startsWith("/");

  if (hasDrive) {
    return `${parts[0]}/.../${last}`;
  }

  if (startsWithRoot) {
    return `/${parts[0]}/.../${last}`;
  }

  return `${parts[0]}/.../${last}`;
}

function sanitizeCommandForLog(command) {
  if (typeof command !== "string") {
    return "<invalid-command>";
  }

  const compactCommand = command.replace(/\s+/g, " ").trim();
  if (!compactCommand) {
    return "<empty-command>";
  }

  const redactedCommand = redactSensitiveText(compactCommand);
  const [program, ...args] = redactedCommand.split(" ");

  let summary = program;
  if (args.length > 0) {
    summary += ` <${args.length} args>`;
  }

  if (summary.length > 160) {
    summary = `${summary.slice(0, 157)}...`;
  }

  return summary;
}

module.exports = {
  redactSensitiveText,
  sanitizePathForLog,
  sanitizeCommandForLog,
};
