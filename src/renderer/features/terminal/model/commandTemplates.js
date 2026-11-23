/**
 * Pure utilities for parameterized shortcut command templates (`{{var}}` /
 * `{{var=default}}`), built-in session variable resolution (`host`, `user`,
 * `port`, `cwd`), and shortcut command tag normalization.
 */

export const BUILTIN_SESSION_VARS = Object.freeze([
  "host",
  "user",
  "port",
  "cwd",
]);

const BUILTIN_SESSION_VAR_SET = new Set(BUILTIN_SESSION_VARS);

// Matches `{{name}}` or `{{name=default}}` tokens without greedy over-matching
// across closing braces.
const TEMPLATE_TOKEN_RE =
  /\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*(?:=((?:(?!\}\}).)*))?\}\}/g;

/**
 * Parse a `{{var}}` / `{{var=default}}` command template and return ordered,
 * deduplicated variable descriptors.
 * @param {unknown} template
 */
export function parseCommandTemplate(template) {
  const raw = typeof template === "string" ? template : "";
  if (!raw || !raw.includes("{{")) {
    return {
      raw,
      variables: [],
      hasVariables: false,
      customVariables: [],
      builtinVariables: [],
    };
  }

  /** @type {Map<string, { name: string, defaultValue: string, hasDefault: boolean, isBuiltin: boolean, required: boolean, occurrences: number }>} */
  const byName = new Map();
  TEMPLATE_TOKEN_RE.lastIndex = 0;
  let match;
  while ((match = TEMPLATE_TOKEN_RE.exec(raw)) !== null) {
    const name = match[1];
    const hasDefault = match[2] !== undefined;
    const defaultValue = hasDefault ? match[2].trim() : "";
    const existing = byName.get(name);
    if (!existing) {
      byName.set(name, {
        name,
        defaultValue,
        hasDefault,
        isBuiltin: BUILTIN_SESSION_VAR_SET.has(name),
        required: !hasDefault,
        occurrences: 1,
      });
    } else {
      existing.occurrences += 1;
      if (!existing.hasDefault && hasDefault) {
        existing.hasDefault = true;
        existing.defaultValue = defaultValue;
        existing.required = false;
      }
    }
  }

  const variables = [...byName.values()];
  return {
    raw,
    variables,
    hasVariables: variables.length > 0,
    customVariables: variables.filter((v) => !v.isBuiltin),
    builtinVariables: variables.filter((v) => v.isBuiltin),
  };
}

/**
 * Extract `{ user, host, port }` from a formatted sidebar display string such as
 * `alice@prod.example.com:2222` or `[::1]:2222`.
 * @param {string} rawHost
 */
function parseFormattedSessionHost(rawHost) {
  const trimmed = String(rawHost || "").trim();
  if (!trimmed) {
    return { user: "", host: "", port: "" };
  }

  let user = "";
  let hostPort = trimmed;
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex > 0) {
    user = trimmed.slice(0, atIndex).trim();
    hostPort = trimmed.slice(atIndex + 1).trim();
  }

  if (hostPort.startsWith("[")) {
    const endBracket = hostPort.indexOf("]");
    if (endBracket > 0) {
      const host = hostPort.slice(1, endBracket).trim();
      const rest = hostPort.slice(endBracket + 1);
      const portMatch = rest.match(/^:(\d{1,5})$/);
      return { user, host, port: portMatch ? portMatch[1] : "" };
    }
  }

  const colonIndex = hostPort.lastIndexOf(":");
  if (colonIndex > 0) {
    const maybePort = hostPort.slice(colonIndex + 1).trim();
    if (/^\d{1,5}$/.test(maybePort)) {
      return {
        user,
        host: hostPort.slice(0, colonIndex).trim(),
        port: maybePort,
      };
    }
  }

  return { user, host: hostPort, port: "" };
}

/**
 * Build the built-in session variable context (`host`, `user`, `port`, `cwd`)
 * from the active session descriptor, sidebar summary context, and live CWD.
 * @param {{ activeSession?: Record<string, any> | null, sessionContext?: Record<string, any> | null, cwd?: string | null }} [input]
 */
export function buildSessionTemplateContext({
  activeSession = null,
  sessionContext = null,
  cwd = "",
} = {}) {
  const config = activeSession?.config || null;
  const isLocal =
    activeSession?.type === "local" ||
    String(sessionContext?.protocol || "").toUpperCase() === "LOCAL";

  let host = "";
  let user = "";
  let port = "";

  if (config && !isLocal) {
    host = typeof config.host === "string" ? config.host.trim() : "";
    user = typeof config.username === "string" ? config.username.trim() : "";
    if (
      config.port !== undefined &&
      config.port !== null &&
      config.port !== ""
    ) {
      port = String(config.port).trim();
    }
  } else if (sessionContext && !isLocal) {
    const parsed = parseFormattedSessionHost(sessionContext.host || "");
    host =
      (typeof sessionContext.rawHost === "string" &&
        sessionContext.rawHost.trim()) ||
      parsed.host;
    user =
      (typeof sessionContext.user === "string" && sessionContext.user.trim()) ||
      (typeof sessionContext.username === "string" &&
        sessionContext.username.trim()) ||
      parsed.user;
    port =
      sessionContext.port !== undefined &&
      sessionContext.port !== null &&
      sessionContext.port !== ""
        ? String(sessionContext.port).trim()
        : parsed.port;
  }

  const resolvedCwd =
    typeof cwd === "string" && cwd.length > 0
      ? cwd
      : typeof sessionContext?.cwd === "string"
        ? sessionContext.cwd
        : "";

  return {
    host,
    user,
    port,
    cwd: resolvedCwd,
  };
}

/**
 * Resolve all `{{var}}` / `{{var=default}}` tokens in a command template in a
 * single pass and report any missing required variables.
 * @param {unknown} template
 * @param {Record<string, unknown>} [values]
 * @param {Record<string, unknown>} [sessionContext]
 */
export function resolveCommandTemplate(
  template,
  values = {},
  sessionContext = {},
) {
  const parsed = parseCommandTemplate(template);
  const explicitValues = values && typeof values === "object" ? values : {};
  const contextValues =
    sessionContext && typeof sessionContext === "object" ? sessionContext : {};

  /** @type {Record<string, string>} */
  const valuesUsed = {};
  /** @type {string[]} */
  const missingVariables = [];

  for (const variable of parsed.variables) {
    let resolvedValue;
    if (
      Object.prototype.hasOwnProperty.call(explicitValues, variable.name) &&
      explicitValues[variable.name] !== undefined &&
      explicitValues[variable.name] !== null
    ) {
      resolvedValue = String(explicitValues[variable.name]);
    } else if (
      variable.isBuiltin &&
      contextValues[variable.name] !== undefined &&
      contextValues[variable.name] !== null &&
      String(contextValues[variable.name]) !== ""
    ) {
      resolvedValue = String(contextValues[variable.name]);
    } else if (variable.hasDefault) {
      resolvedValue = variable.defaultValue;
    } else {
      resolvedValue = "";
    }

    valuesUsed[variable.name] = resolvedValue;
    if (!variable.hasDefault && resolvedValue.trim() === "") {
      missingVariables.push(variable.name);
    }
  }

  if (!parsed.hasVariables) {
    return {
      command: parsed.raw,
      resolved: parsed.raw,
      missingVariables,
      valid: true,
      valuesUsed,
      variables: parsed.variables,
    };
  }

  TEMPLATE_TOKEN_RE.lastIndex = 0;
  const resolved = parsed.raw.replace(TEMPLATE_TOKEN_RE, (_full, name) =>
    Object.prototype.hasOwnProperty.call(valuesUsed, name)
      ? valuesUsed[name]
      : "",
  );

  return {
    command: parsed.raw,
    resolved,
    missingVariables,
    valid: missingVariables.length === 0,
    valuesUsed,
    variables: parsed.variables,
  };
}

/**
 * Determine whether a command can execute immediately (static or all built-in
 * variables resolved) or needs an interactive parameter prompt.
 * @param {unknown} template
 * @param {Record<string, unknown>} [sessionContext]
 */
export function prepareCommandExecution(template, sessionContext = {}) {
  const parsed = parseCommandTemplate(template);
  const contextValues =
    sessionContext && typeof sessionContext === "object" ? sessionContext : {};

  /** @type {Record<string, string>} */
  const initialValues = {};
  for (const variable of parsed.variables) {
    if (
      variable.isBuiltin &&
      contextValues[variable.name] !== undefined &&
      contextValues[variable.name] !== null &&
      String(contextValues[variable.name]) !== ""
    ) {
      initialValues[variable.name] = String(contextValues[variable.name]);
    } else if (variable.hasDefault) {
      initialValues[variable.name] = variable.defaultValue;
    } else {
      initialValues[variable.name] = "";
    }
  }

  const promptVariables = parsed.variables.filter(
    (variable) =>
      !variable.isBuiltin ||
      (initialValues[variable.name] === "" && !variable.hasDefault),
  );

  const preview = resolveCommandTemplate(
    parsed.raw,
    initialValues,
    contextValues,
  );

  return {
    needsPrompt: promptVariables.length > 0,
    parsed,
    initialValues,
    promptVariables,
    preview,
  };
}

/**
 * Normalize command tags from either an array or a comma-separated string.
 * Deduplicates case-insensitively while preserving first-seen casing.
 * @param {unknown} input
 * @returns {string[]}
 */
export function normalizeCommandTags(input) {
  const rawList = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[,，]/)
      : [];

  const seen = new Set();
  /** @type {string[]} */
  const result = [];
  for (const item of rawList) {
    const trimmed = String(item ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

/**
 * Format an array of tags into an editable comma-separated string.
 * @param {unknown} tags
 * @returns {string}
 */
export function formatTagsInput(tags) {
  return normalizeCommandTags(tags).join(", ");
}

/**
 * Collect sorted unique tags across all shortcut commands.
 * @param {Array<{ tags?: unknown }>} commands
 * @returns {string[]}
 */
export function collectAllCommandTags(commands) {
  const byLower = new Map();
  if (!Array.isArray(commands)) {
    return [];
  }
  for (const cmd of commands) {
    for (const tag of normalizeCommandTags(cmd?.tags)) {
      const key = tag.toLowerCase();
      if (!byLower.has(key)) {
        byLower.set(key, tag);
      }
    }
  }
  return [...byLower.values()].sort((a, b) => a.localeCompare(b));
}
