import {
  buildQuickConnectIdentityKey,
  collectSavedConnectionKeys,
} from "../../../shared/domain/quickConnect.js";

const TRANSIENT_STORAGE_KEY = "simpleshell.quickConnect.transients";
const MAX_TRANSIENT_QUICK_CONNECTS = 5;

let transientQuickConnectsMemory = [];

function readTransientStorage() {
  if (typeof window === "undefined") {
    return transientQuickConnectsMemory;
  }
  try {
    const raw = window.sessionStorage?.getItem(TRANSIENT_STORAGE_KEY);
    if (!raw) {
      return transientQuickConnectsMemory;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      transientQuickConnectsMemory = parsed.filter(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          typeof entry.host === "string" &&
          entry.host.trim() !== "",
      );
    }
  } catch {
    // Ignore storage read errors in restricted environments.
  }
  return transientQuickConnectsMemory;
}

function writeTransientStorage(items) {
  transientQuickConnectsMemory = items;
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage?.setItem(
      TRANSIENT_STORAGE_KEY,
      JSON.stringify(items),
    );
  } catch {
    // Ignore storage quota/access errors.
  }
  try {
    window.dispatchEvent(
      new CustomEvent("simpleshell:transientQuickConnectsChanged", {
        detail: { items },
      }),
    );
  } catch {
    // Ignore environments without CustomEvent.
  }
}

export function recordTransientQuickConnect(connection) {
  if (!connection || !connection.host) {
    return readTransientStorage();
  }
  const identityKey = buildQuickConnectIdentityKey(connection);
  const current = readTransientStorage();
  const next = [
    connection,
    ...current.filter(
      (entry) => buildQuickConnectIdentityKey(entry) !== identityKey,
    ),
  ].slice(0, MAX_TRANSIENT_QUICK_CONNECTS);
  writeTransientStorage(next);
  return next;
}

export function getTransientQuickConnects(savedConnections = []) {
  const savedKeys = collectSavedConnectionKeys(savedConnections);
  return readTransientStorage().filter(
    (entry) => !savedKeys.has(buildQuickConnectIdentityKey(entry)),
  );
}

export function dismissTransientQuickConnect(idOrConnection) {
  const current = readTransientStorage();
  const targetId =
    typeof idOrConnection === "string"
      ? idOrConnection
      : idOrConnection?.id || "";
  const targetKey =
    idOrConnection && typeof idOrConnection === "object" && idOrConnection.host
      ? buildQuickConnectIdentityKey(idOrConnection)
      : "";
  const next = current.filter((entry) => {
    if (targetId && entry.id === targetId) return false;
    if (targetKey && buildQuickConnectIdentityKey(entry) === targetKey) {
      return false;
    }
    return true;
  });
  writeTransientStorage(next);
  return next;
}

export function clearTransientQuickConnects() {
  writeTransientStorage([]);
}

export function getQuickConnectErrorText(t, errorCode) {
  switch (errorCode) {
    case "UNSUPPORTED_SCHEME":
      return t("connections.quickConnect.errorUnsupportedScheme");
    case "INVALID_PORT":
      return t("connections.quickConnect.errorInvalidPort");
    case "INVALID_IPV6":
      return t("connections.quickConnect.errorInvalidIpv6");
    case "EMPTY_USERNAME":
    case "INVALID_USERNAME":
      return t("connections.quickConnect.errorInvalidUsername");
    case "INVALID_WHITESPACE":
      return t("connections.quickConnect.errorWhitespace");
    case "EMPTY":
    case "EMPTY_HOST":
      return t("connections.quickConnect.errorEmpty");
    default:
      return t("connections.quickConnect.errorInvalidTarget");
  }
}
