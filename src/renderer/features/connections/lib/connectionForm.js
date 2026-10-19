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
      proxy: null,
    };
  }

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
    os: formData.os,
    connectionType: formData.connectionType,
    protocol,
    proxy: formData.enableProxy
      ? {
          type: formData.proxyType,
          host: String(formData.proxyHost || "").trim(),
          port: parsePortValue(formData.proxyPort, 8080),
          username: formData.proxyUsername || undefined,
          password:
            dialogMode === "edit" &&
            selectedItem?.type === "connection" &&
            formData.proxyPasswordTouched !== true
              ? selectedItem?.proxy?.password || undefined
              : formData.proxyPassword || undefined,
          useDefault: formData.proxyUseDefault,
        }
      : null,
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
