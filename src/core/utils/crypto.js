const crypto = require("crypto");

const RANDOM_KEY_CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const RANDOM_KEY_LENGTH = 32;
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PAYLOAD_VERSION = "ssv2";
const MASTER_PASSWORD_VERIFIER_LABEL = "SimpleShellMasterPasswordVerifier";
const SECURITY_CONTEXT_PREFIX = "SimpleShellCredentialStore";

const securityState = {
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

  return {
    randomKey,
    masterPasswordEnabled: enabled,
    masterPasswordVerifier: enabled
      ? createMasterPasswordVerifier(randomKey, masterPassword)
      : "",
  };
}

function getSecurityStatus() {
  return {
    randomKeyConfigured: Boolean(securityState.randomKey),
    masterPasswordEnabled: securityState.masterPasswordEnabled,
    unlocked: securityState.unlocked,
    requiresUnlock:
      securityState.masterPasswordEnabled && !securityState.unlocked,
  };
}

function configureSecurity(securityConfig = {}) {
  const randomKey =
    typeof securityConfig?.randomKey === "string"
      ? securityConfig.randomKey.trim()
      : "";
  const masterPasswordEnabled =
    securityConfig?.masterPasswordEnabled === true &&
    typeof securityConfig?.masterPasswordVerifier === "string" &&
    securityConfig.masterPasswordVerifier.trim() !== "";

  securityState.randomKey = randomKey || generateRandomKey();
  securityState.masterPasswordEnabled = masterPasswordEnabled;
  securityState.masterPasswordVerifier = masterPasswordEnabled
    ? securityConfig.masterPasswordVerifier.trim()
    : "";

  if (masterPasswordEnabled) {
    securityState.unlocked = false;
    securityState.derivedKey = null;
  } else {
    securityState.derivedKey = deriveEncryptionKey(securityState.randomKey);
    securityState.unlocked = true;
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

function encryptText(text) {
  if (text === undefined || text === null || text === "") {
    return "";
  }

  try {
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
      PAYLOAD_VERSION,
      iv.toString("hex"),
      authTag.toString("hex"),
      encrypted.toString("hex"),
    ].join(":");
  } catch {
    return null;
  }
}

function decryptText(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return "";
  }

  try {
    const [version, ivHex, authTagHex, encryptedHex] = text.split(":");
    if (version !== PAYLOAD_VERSION || !ivHex || !authTagHex || !encryptedHex) {
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
  RANDOM_KEY_LENGTH,
};
