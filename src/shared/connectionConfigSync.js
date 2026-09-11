const CONNECTION_FIELDS = [
  "name",
  "host",
  "port",
  "username",
  "password",
  "authType",
  "privateKeyPath",
  "passphrase",
  "agentPath",
  "agentForward",
  "proxy",
  "protocol",
  "os",
  "connectionType",
  "updatedAt",
];
const SSH_AUTH_FIELDS = [
  "host",
  "port",
  "username",
  "password",
  "authType",
  "privateKeyPath",
  "passphrase",
  "agentPath",
  "agentForward",
  "proxy",
  "protocol",
];

function indexConnections(items, result = new Map()) {
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.type === "connection" && item.id) result.set(item.id, item);
    if (item?.type === "group") indexConnections(item.items, result);
  }
  return result;
}

// 仅应用用户实际修改的字段，保留当前会话中未持久化的认证答案和运行时信息。
function mergeSavedConnectionConfig(current, previous, next) {
  if (!current || !next) return current;
  let merged = current;
  for (const field of CONNECTION_FIELDS) {
    if (
      previous &&
      JSON.stringify(previous[field] ?? null) ===
        JSON.stringify(next[field] ?? null)
    )
      continue;
    if (
      JSON.stringify(current[field] ?? null) ===
      JSON.stringify(next[field] ?? null)
    )
      continue;
    if (merged === current) merged = { ...current };
    merged[field] = next[field];
  }
  if (
    merged !== current &&
    (merged.privateKeyPath !== current.privateKeyPath ||
      merged.authType !== current.authType)
  ) {
    merged.privateKey = undefined;
    if (merged.authType === "password") merged.privateKeyPath = "";
    if (merged.authType === "privateKey" || merged.authType === "agent")
      merged.password = "";
  }
  return merged;
}

module.exports = {
  indexConnections,
  mergeSavedConnectionConfig,
  SSH_AUTH_FIELDS,
};
