import { generateId } from "../../../../shared/common";

export const squareIconButtonSx = {
  width: 40,
  height: 40,
  flexShrink: 0,
  border: 1,
  borderColor: "divider",
  borderRadius: 1,
};
const parsePortValue = (value, fallback = 22) => {
  const port = Number.parseInt(value, 10);
  return Number.isFinite(port) ? port : fallback;
};

const isPortValid = (value) => {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
};

const hasWhitespace = (value) => /\s/.test(String(value || ""));
export const SAVED_PASSWORD_MASK = "********";

export const CONNECTION_COLOR_TAG_OPTIONS = Object.freeze([
  { id: "red", color: "#ef4444" },
  { id: "orange", color: "#f97316" },
  { id: "amber", color: "#eab308" },
  { id: "green", color: "#22c55e" },
  { id: "teal", color: "#14b8a6" },
  { id: "blue", color: "#3b82f6" },
  { id: "purple", color: "#a855f7" },
  { id: "pink", color: "#ec4899" },
]);

export const normalizeConnectionTags = (input) => {
  const rawList = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];
  const seen = new Set();
  const result = [];
  for (const raw of rawList) {
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
};

export const normalizeColorTag = (value) =>
  typeof value === "string" ? value.trim() : "";

// 串口常用波特率
export const SERIAL_BAUD_RATES = [
  300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200, 230400,
  460800, 921600,
];
export const DEFAULT_SERIAL_FORM = {
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
  flowControl: "none",
};

export const DEFAULT_MOSH_FORM = {
  moshBinaryPath: "",
  moshUseWsl: false,
  moshPredict: "adaptive",
  moshServerPort: "",
};

const parseBaudRate = (value) => {
  const baud = Number.parseInt(value, 10);
  return SERIAL_BAUD_RATES.includes(baud) ? baud : DEFAULT_SERIAL_FORM.baudRate;
};

export const buildConnectionPayloadFromForm = ({
  formData,
  id,
  selectedItem,
  dialogMode,
}) => {
  const protocol = formData.protocol || "ssh";
  const fallbackPort = protocol === "telnet" ? 23 : 22;

  const shouldPreservePassword =
    protocol !== "serial" &&
    protocol !== "mosh" &&
    dialogMode === "edit" &&
    selectedItem?.type === "connection" &&
    (formData.passwordMasked === true || formData.passwordTouched !== true) &&
    formData.passwordRevealed !== true;

  const pinned = formData.pinned === true;
  const tags = normalizeConnectionTags(formData.tags);
  const colorTag = normalizeColorTag(formData.colorTag);

  // 串口连接：host 字段存端口路径（如 COM3 / /dev/ttyUSB0），无端口/认证概念
  if (protocol === "serial") {
    return {
      id:
        id ||
        (dialogMode === "add"
          ? generateId("conn")
          : selectedItem?.id || generateId("conn")),
      type: "connection",
      name: String(formData.name || "").trim(),
      host: String(formData.host || "").trim(),
      port: null,
      username: "",
      password: "",
      protocol: "serial",
      baudRate: parseBaudRate(formData.baudRate),
      dataBits: Number(formData.dataBits) || DEFAULT_SERIAL_FORM.dataBits,
      stopBits: Number(formData.stopBits) || DEFAULT_SERIAL_FORM.stopBits,
      parity: formData.parity || DEFAULT_SERIAL_FORM.parity,
      flowControl: formData.flowControl || DEFAULT_SERIAL_FORM.flowControl,
      os: formData.os,
      connectionType: formData.connectionType,
      pinned,
      tags,
      colorTag,
      proxy: null,
    };
  }

  // Mosh 连接：port 字段为 SSH 引导端口（mosh 先经 SSH 启动 mosh-server），
  // 认证由 mosh 客户端在终端内交互完成，不保存密码
  if (protocol === "mosh") {
    return {
      id:
        id ||
        (dialogMode === "add"
          ? generateId("conn")
          : selectedItem?.id || generateId("conn")),
      type: "connection",
      name: String(formData.name || "").trim(),
      host: String(formData.host || "").trim(),
      port: parsePortValue(formData.port, 22),
      username: String(formData.username || "").trim(),
      password: "",
      protocol: "mosh",
      moshBinaryPath: String(formData.moshBinaryPath || "").trim(),
      moshUseWsl: formData.moshUseWsl === true,
      moshPredict: formData.moshPredict || DEFAULT_MOSH_FORM.moshPredict,
      moshServerPort: String(formData.moshServerPort || "").trim(),
      os: formData.os,
      connectionType: formData.connectionType,
      pinned,
      tags,
      colorTag,
      proxy: null,
    };
  }

  // 已保存的代理密码只存在于主进程；未修改时以 hasPassword 标记请求主进程沿用
  const shouldPreserveProxyPassword =
    dialogMode === "edit" &&
    selectedItem?.type === "connection" &&
    formData.proxyPasswordTouched !== true;
  const savedProxyHasPassword =
    selectedItem?.proxy?.hasPassword === true ||
    Boolean(selectedItem?.proxy?.password);

  return {
    id:
      id ||
      (dialogMode === "add"
        ? generateId("conn")
        : selectedItem?.id || generateId("conn")),
    type: "connection",
    name: String(formData.name || "").trim(),
    host: String(formData.host || "").trim(),
    port: parsePortValue(formData.port, fallbackPort),
    username: String(formData.username || "").trim(),
    password:
      formData.authType === "password"
        ? shouldPreservePassword
          ? selectedItem?.password || ""
          : formData.password || ""
        : "",
    _preservePassword:
      formData.authType === "password" && shouldPreservePassword,
    authType: formData.authType || "password",
    privateKeyPath:
      formData.authType === "privateKey"
        ? String(formData.privateKeyPath || "").trim()
        : "",
    agentPath: String(formData.agentPath || "").trim(),
    agentForward: formData.agentForward === true,
    enableCompression: formData.enableCompression === true,
    os: formData.os,
    connectionType: formData.connectionType,
    protocol,
    pinned,
    tags,
    colorTag,
    proxy: formData.enableProxy
      ? {
          type: formData.proxyType,
          host: String(formData.proxyHost || "").trim(),
          port: parsePortValue(formData.proxyPort, 8080),
          username: formData.proxyUsername || undefined,
          password: shouldPreserveProxyPassword
            ? selectedItem?.proxy?.password || undefined
            : formData.proxyPassword || undefined,
          ...(shouldPreserveProxyPassword && savedProxyHasPassword
            ? { hasPassword: true }
            : {}),
          useDefault: formData.proxyUseDefault,
        }
      : null,
  };
};

const collectExistingConnectionNames = (items, names = new Set()) => {
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "group") {
      collectExistingConnectionNames(item.items || [], names);
      continue;
    }
    if (item.type === "connection" && item.name) {
      names.add(String(item.name).trim().toLowerCase());
    }
  }
  return names;
};

export const buildDuplicateConnectionPayload = (
  connection,
  existingConnections = [],
  copyLabel = "Copy",
) => {
  const existingNames = collectExistingConnectionNames(existingConnections);
  const baseName = String(
    connection?.name || connection?.host || "Connection",
  ).trim();
  const suffix = String(copyLabel || "Copy").trim() || "Copy";
  let candidateName = `${baseName} (${suffix})`;
  let counter = 2;
  while (existingNames.has(candidateName.toLowerCase())) {
    candidateName = `${baseName} (${suffix} ${counter})`;
    counter += 1;
  }

  const clonedProxy =
    connection?.proxy && typeof connection.proxy === "object"
      ? {
          ...connection.proxy,
          password: "",
          hasPassword: false,
        }
      : null;

  const cleanConnection = { ...(connection || {}) };
  delete cleanConnection.depth;
  delete cleanConnection.parentGroup;
  delete cleanConnection.parentGroupId;
  delete cleanConnection.isTransient;
  delete cleanConnection.createdAt;
  delete cleanConnection.updatedAt;
  delete cleanConnection.lastUsedAt;
  delete cleanConnection._passwordAlreadyEncrypted;

  return {
    ...cleanConnection,
    id: generateId("conn"),
    type: "connection",
    name: candidateName,
    password: "",
    hasPassword: false,
    credentialRevision: "",
    _preservePassword: false,
    pinned: connection?.pinned === true,
    tags: normalizeConnectionTags(connection?.tags),
    colorTag: normalizeColorTag(connection?.colorTag),
    proxy: clonedProxy,
  };
};

export const getConnectionValidationSteps = (t, formData, privateKeyCheck) => {
  if ((formData.protocol || "ssh") !== "ssh") {
    return [];
  }

  const host = String(formData.host || "").trim();
  const username = String(formData.username || "").trim();
  const proxyHost = String(formData.proxyHost || "").trim();
  const privateKeyPath = String(formData.privateKeyPath || "").trim();
  const authType = formData.authType || "password";
  const isPrivateKeyAuth = authType === "privateKey";
  const privateKeyUnsafe =
    privateKeyCheck?.permissions &&
    /^[0-7]{3,4}$/.test(privateKeyCheck.permissions) &&
    (Number.parseInt(privateKeyCheck.permissions, 8) & 0o077) !== 0;

  return [
    {
      key: "host",
      title: t("connectionManager.validation.host"),
      ok: Boolean(host) && !hasWhitespace(host),
      message: !host
        ? t("connectionManager.validation.hostMissing")
        : hasWhitespace(host)
          ? t("connectionManager.validation.hostWhitespace")
          : t("connectionManager.validation.hostOk"),
    },
    {
      key: "port",
      title: t("connectionManager.validation.port"),
      ok: isPortValid(formData.port),
      message: isPortValid(formData.port)
        ? t("connectionManager.validation.portOk")
        : t("connectionManager.validation.portInvalid"),
    },
    {
      key: "username",
      title: t("connectionManager.validation.username"),
      ok: Boolean(username),
      message: username
        ? t("connectionManager.validation.usernameOk")
        : t("connectionManager.validation.usernameMissing"),
    },
    {
      key: "auth",
      title: t("connectionManager.validation.auth"),
      ok:
        authType === "password" ||
        authType === "agent" ||
        (isPrivateKeyAuth && Boolean(privateKeyPath)),
      message:
        authType === "agent"
          ? t("connectionManager.validation.agentAuthOk")
          : authType === "password"
            ? t("connectionManager.validation.passwordAuthOk")
            : privateKeyPath
              ? t("connectionManager.validation.privateKeySelected")
              : t("connectionManager.validation.privateKeyMissing"),
    },
    {
      key: "proxy",
      title: t("connectionManager.validation.proxy"),
      ok:
        !formData.enableProxy ||
        formData.proxyUseDefault ||
        (Boolean(proxyHost) && isPortValid(formData.proxyPort)),
      message: !formData.enableProxy
        ? t("connectionManager.validation.proxyDisabled")
        : formData.proxyUseDefault
          ? t("connectionManager.validation.proxyDefault")
          : !proxyHost
            ? t("connectionManager.validation.proxyHostMissing")
            : !isPortValid(formData.proxyPort)
              ? t("connectionManager.validation.proxyPortInvalid")
              : t("connectionManager.validation.proxyOk"),
    },
    {
      key: "privateKey",
      title: t("connectionManager.validation.privateKey"),
      ok:
        !isPrivateKeyAuth ||
        privateKeyCheck?.status === "ok" ||
        privateKeyCheck?.status === "warning",
      severity:
        isPrivateKeyAuth &&
        privateKeyUnsafe &&
        privateKeyCheck?.status !== "error"
          ? "warning"
          : privateKeyCheck?.status === "checking"
            ? "checking"
            : "default",
      message: !isPrivateKeyAuth
        ? t("connectionManager.validation.privateKeyNotUsed")
        : !privateKeyPath
          ? t("connectionManager.validation.privateKeyMissing")
          : privateKeyCheck?.status === "checking"
            ? t("connectionManager.validation.privateKeyChecking")
            : privateKeyCheck?.status === "error"
              ? privateKeyCheck.message ||
                t("connectionManager.validation.privateKeyUnreadable")
              : privateKeyUnsafe
                ? t("connectionManager.validation.privateKeyUnsafe", {
                    permissions: privateKeyCheck.permissions,
                  })
                : t("connectionManager.validation.privateKeyOk"),
    },
  ];
};
