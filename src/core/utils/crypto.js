const crypto = require("crypto");

let safeStorage = null;
try {
  const electron = require("electron");
  safeStorage = electron && electron.safeStorage ? electron.safeStorage : null;
} catch {
  safeStorage = null;
}

const RANDOM_KEY_CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const RANDOM_KEY_LENGTH = 32;
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PAYLOAD_VERSION = "ssv2";
const SAFE_STORAGE_PAYLOAD_VERSION = "ssv3s";
const MASTER_PASSWORD_PAYLOAD_VERSION = "ssv3m";
const MASTER_PASSWORD_VERIFIER_LABEL = "SimpleShellMasterPasswordVerifier";
const SECURITY_CONTEXT_PREFIX = "SimpleShellCredentialStore";
const SECURITY_MODE_SAFE_STORAGE = "safeStorage";
const SECURITY_MODE_MASTER_PASSWORD = "masterPassword";
const SECURITY_MODE_LEGACY_RANDOM_KEY = "legacyRandomKey";
const KDF_VERSION = 1;
const SCRYPT_PARAMS = Object.freeze({
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
});

const securityState = {
  mode: SECURITY_MODE_SAFE_STORAGE,
  randomKey: "",
  masterPasswordEnabled: false,
  masterPasswordVerifier: "",
  unlocked: false,
  derivedKey: null,
};

function generateRandomKey(length = RANDOM_KEY_LENGTH) {
  const normalizedLength = Math.max(1, Number(length) || RANDOM_KEY_LENGTH);
  const acceptedByteUpperBound =
    Math.floor(256 / RANDOM_KEY_CHARSET.length) * RANDOM_KEY_CHARSET.length;

  let result = "";
  while (result.length < normalizedLength) {
    const bytes = crypto.randomBytes(normalizedLength * 2);
    for (const value of bytes) {
      if (value >= acceptedByteUpperBound) {
        continue;
      }

      result += RANDOM_KEY_CHARSET[value % RANDOM_KEY_CHARSET.length];
      if (result.length >= normalizedLength) {
        break;
      }
    }
  }

  return result;
}

function deriveEncryptionKey(randomKey, masterPassword = "") {
  if (typeof randomKey !== "string" || !randomKey) {
    throw new Error("Random key is not configured");
  }

  if (typeof masterPassword === "string" && masterPassword) {
    return crypto.scryptSync(
      masterPassword,
      `${SECURITY_CONTEXT_PREFIX}:${randomKey}`,
      32,
      SCRYPT_PARAMS,
    );
  }

  return crypto
    .createHash("sha256")
    .update(`${SECURITY_CONTEXT_PREFIX}:${randomKey}`)
    .digest();
}

function createMasterPasswordVerifier(randomKey, masterPassword) {
  const derivedKey = deriveEncryptionKey(randomKey, masterPassword);
  return crypto
    .createHmac("sha256", derivedKey)
    .update(MASTER_PASSWORD_VERIFIER_LABEL)
    .digest("hex");
}

function createSecurityConfig({
  currentSecurity = {},
  masterPasswordEnabled = false,
  masterPassword = "",
} = {}) {
  const existingRandomKey =
    typeof currentSecurity?.randomKey === "string"
      ? currentSecurity.randomKey.trim()
      : "";
  const randomKey = existingRandomKey || generateRandomKey();
  const enabled = masterPasswordEnabled === true;

  if (!enabled) {
    return {
      mode: SECURITY_MODE_SAFE_STORAGE,
      masterPasswordEnabled: false,
      masterPasswordVerifier: "",
      kdf: null,
      randomKey: "",
    };
  }

  return {
    mode: SECURITY_MODE_MASTER_PASSWORD,
    randomKey,
    masterPasswordEnabled: enabled,
    masterPasswordVerifier: enabled
      ? createMasterPasswordVerifier(randomKey, masterPassword)
      : "",
    kdf: {
      algorithm: "scrypt",
      version: KDF_VERSION,
      ...SCRYPT_PARAMS,
    },
  };
}

function isSafeStorageAvailable() {
  return Boolean(
    safeStorage &&
    typeof safeStorage.isEncryptionAvailable === "function" &&
    safeStorage.isEncryptionAvailable() &&
    typeof safeStorage.encryptString === "function" &&
    typeof safeStorage.decryptString === "function",
  );
}

function getSecurityStatus() {
  return {
    mode: securityState.mode,
    safeStorageAvailable: isSafeStorageAvailable(),
    randomKeyConfigured: Boolean(securityState.randomKey),
    masterPasswordEnabled: securityState.masterPasswordEnabled,
    unlocked: securityState.unlocked,
    requiresUnlock:
      securityState.masterPasswordEnabled && !securityState.unlocked,
  };
}

function configureSecurity(securityConfig = {}) {
  const requestedMode =
    typeof securityConfig?.mode === "string"
      ? securityConfig.mode
      : securityConfig?.masterPasswordEnabled === true
        ? SECURITY_MODE_MASTER_PASSWORD
        : typeof securityConfig?.randomKey === "string" &&
            securityConfig.randomKey.trim()
          ? SECURITY_MODE_LEGACY_RANDOM_KEY
          : SECURITY_MODE_SAFE_STORAGE;
  const randomKey =
    typeof securityConfig?.randomKey === "string"
      ? securityConfig.randomKey.trim()
      : "";
  const masterPasswordEnabled =
    requestedMode === SECURITY_MODE_MASTER_PASSWORD &&
    securityConfig?.masterPasswordEnabled === true &&
    typeof securityConfig?.masterPasswordVerifier === "string" &&
    securityConfig.masterPasswordVerifier.trim() !== "";

  securityState.mode = requestedMode;
  securityState.randomKey =
    randomKey ||
    (requestedMode === SECURITY_MODE_MASTER_PASSWORD ||
    requestedMode === SECURITY_MODE_LEGACY_RANDOM_KEY
      ? generateRandomKey()
      : "");
  securityState.masterPasswordEnabled = masterPasswordEnabled;
  securityState.masterPasswordVerifier = masterPasswordEnabled
    ? securityConfig.masterPasswordVerifier.trim()
    : "";

  if (masterPasswordEnabled) {
    securityState.unlocked = false;
    securityState.derivedKey = null;
  } else if (requestedMode === SECURITY_MODE_LEGACY_RANDOM_KEY) {
    securityState.derivedKey = deriveEncryptionKey(securityState.randomKey);
    securityState.unlocked = true;
  } else if (requestedMode === SECURITY_MODE_SAFE_STORAGE) {
    if (!isSafeStorageAvailable()) {
      securityState.unlocked = false;
      securityState.derivedKey = null;
      throw new Error("Electron safeStorage encryption is not available");
    }
    securityState.derivedKey = null;
    securityState.unlocked = true;
  } else {
    throw new Error(`Unsupported credential security mode: ${requestedMode}`);
  }

  return getSecurityStatus();
}

function unlockWithMasterPassword(masterPassword) {
  if (!securityState.masterPasswordEnabled) {
    return { success: true, status: getSecurityStatus() };
  }

  if (typeof masterPassword !== "string" || masterPassword === "") {
    return { success: false, error: "Master password is required" };
  }

  try {
    const expected = Buffer.from(securityState.masterPasswordVerifier, "hex");
    const actual = Buffer.from(
      createMasterPasswordVerifier(securityState.randomKey, masterPassword),
      "hex",
    );

    if (
      expected.length === 0 ||
      expected.length !== actual.length ||
      !crypto.timingSafeEqual(expected, actual)
    ) {
      return { success: false, error: "Invalid master password" };
    }

    securityState.derivedKey = deriveEncryptionKey(
      securityState.randomKey,
      masterPassword,
    );
    securityState.unlocked = true;
    return { success: true, status: getSecurityStatus() };
  } catch {
    return { success: false, error: "Invalid master password" };
  }
}

function lockCredentialStore() {
  if (securityState.masterPasswordEnabled) {
    securityState.unlocked = false;
    securityState.derivedKey = null;
  }

  return getSecurityStatus();
}

function getActiveEncryptionKey() {
  if (!securityState.derivedKey) {
    throw new Error("Credential store is locked");
  }

  return securityState.derivedKey;
}

function encryptWithSafeStorage(text) {
  if (!isSafeStorageAvailable()) {
    throw new Error("Electron safeStorage encryption is not available");
  }

  const encrypted = safeStorage.encryptString(String(text));
  return `${SAFE_STORAGE_PAYLOAD_VERSION}:${encrypted.toString("base64")}`;
}

function decryptWithSafeStorage(encodedPayload) {
  if (!isSafeStorageAvailable()) {
    throw new Error("Electron safeStorage encryption is not available");
  }

  return safeStorage.decryptString(Buffer.from(encodedPayload, "base64"));
}

function encryptWithActiveKey(text, version = MASTER_PASSWORD_PAYLOAD_VERSION) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    ENCRYPTION_ALGORITHM,
    getActiveEncryptionKey(),
    iv,
    { authTagLength: AUTH_TAG_LENGTH },
  );
  const encrypted = Buffer.concat([
    cipher.update(String(text), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    version,
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

function decryptWithActiveKey(version, ivHex, authTagHex, encryptedHex) {
  if (
    ![PAYLOAD_VERSION, MASTER_PASSWORD_PAYLOAD_VERSION].includes(version) ||
    !ivHex ||
    !authTagHex ||
    !encryptedHex
  ) {
    return null;
  }

  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    getActiveEncryptionKey(),
    Buffer.from(ivHex, "hex"),
    { authTagLength: AUTH_TAG_LENGTH },
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function encryptText(text) {
  if (text === undefined || text === null || text === "") {
    return "";
  }

  try {
    if (securityState.mode === SECURITY_MODE_SAFE_STORAGE) {
      return encryptWithSafeStorage(text);
    }

    return encryptWithActiveKey(
      text,
      securityState.mode === SECURITY_MODE_LEGACY_RANDOM_KEY
        ? PAYLOAD_VERSION
        : MASTER_PASSWORD_PAYLOAD_VERSION,
    );
  } catch (error) {
    void error;
    return null;
  }
}

function decryptText(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return "";
  }

  try {
    const [version, ...payloadParts] = text.split(":");

    if (version === SAFE_STORAGE_PAYLOAD_VERSION) {
      const [encodedPayload] = payloadParts;
      if (!encodedPayload) {
        return null;
      }
      return decryptWithSafeStorage(encodedPayload);
    }

    const [ivHex, authTagHex, encryptedHex] = payloadParts;
    if (
      ![PAYLOAD_VERSION, MASTER_PASSWORD_PAYLOAD_VERSION].includes(version) ||
      !ivHex ||
      !authTagHex ||
      !encryptedHex
    ) {
      return null;
    }

    return decryptWithActiveKey(version, ivHex, authTagHex, encryptedHex);
  } catch {
    return null;
  }
}

module.exports = {
  encryptText,
  decryptText,
  generateRandomKey,
  createSecurityConfig,
  createMasterPasswordVerifier,
  configureSecurity,
  getSecurityStatus,
  unlockWithMasterPassword,
  lockCredentialStore,
  ENCRYPTION_ALGORITHM,
  IV_LENGTH,
  AUTH_TAG_LENGTH,
  PAYLOAD_VERSION,
  SAFE_STORAGE_PAYLOAD_VERSION,
  MASTER_PASSWORD_PAYLOAD_VERSION,
  RANDOM_KEY_LENGTH,
  KDF_VERSION,
  SCRYPT_PARAMS,
  SECURITY_MODE_SAFE_STORAGE,
  SECURITY_MODE_MASTER_PASSWORD,
  SECURITY_MODE_LEGACY_RANDOM_KEY,
  isSafeStorageAvailable,
};
