/**
 * Main-process / shared translation helper.
 * Loads the same locale JSON files as the renderer and supports {{var}} interpolation.
 * Safe to require from Electron main, workers, and shared CJS modules.
 */

const { isZhLanguage } = require("./connectionErrorAdvice");

const SUPPORTED_LANGUAGES = Object.freeze(["zh-CN", "en-US"]);
const DEFAULT_LANGUAGE = "zh-CN";

let resourcesByLanguage = null;

function loadLocaleResources() {
  if (resourcesByLanguage) {
    return resourcesByLanguage;
  }

  const zhCN = require("../i18n/locales/zh-CN.json");
  const enUS = require("../i18n/locales/en-US.json");

  resourcesByLanguage = {
    "zh-CN": zhCN.translation || zhCN,
    "en-US": enUS.translation || enUS,
  };
  return resourcesByLanguage;
}

function normalizeLanguage(language) {
  if (typeof language !== "string" || !language.trim()) {
    return DEFAULT_LANGUAGE;
  }

  const normalized = language.trim();
  if (SUPPORTED_LANGUAGES.includes(normalized)) {
    return normalized;
  }

  const lower = normalized.toLowerCase();
  if (lower === "zh" || lower.startsWith("zh-")) {
    return "zh-CN";
  }
  if (lower === "en" || lower.startsWith("en-")) {
    return "en-US";
  }

  return isZhLanguage(normalized) ? "zh-CN" : "en-US";
}

function resolvePath(root, key) {
  if (!root || typeof key !== "string" || !key) {
    return undefined;
  }

  return key.split(".").reduce((current, part) => {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    return current[part];
  }, root);
}

function interpolate(template, params = {}) {
  if (typeof template !== "string") {
    return template;
  }

  return template.replace(/{{\s*([A-Za-z0-9_.-]+)\s*}}/g, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(params, name)) {
      const value = params[name];
      return value == null ? "" : String(value);
    }
    return match;
  });
}

/**
 * Translate a key for the given language.
 * @param {string} key - Dot-path key under translation root
 * @param {object} [options]
 * @param {string} [options.lng] - Language code
 * @param {string} [options.language] - Alias of lng
 * @returns {string}
 */
function t(key, options = {}) {
  const params = options && typeof options === "object" ? { ...options } : {};
  const language = normalizeLanguage(params.lng || params.language);
  delete params.lng;
  delete params.language;

  const resources = loadLocaleResources();
  const primary = resolvePath(resources[language], key);
  if (typeof primary === "string") {
    return interpolate(primary, params);
  }

  // Strict parity fallback only across supported locales (never mix UI languages silently
  // for missing keys in production paths — prefer explicit English technical fallback).
  const fallbackLanguage = language === "zh-CN" ? "en-US" : "zh-CN";
  const secondary = resolvePath(resources[fallbackLanguage], key);
  if (typeof secondary === "string") {
    return interpolate(secondary, params);
  }

  return key;
}

/**
 * Resolve UI language from configService when available.
 * @param {object} [configService]
 * @returns {string}
 */
function getUiLanguage(configService) {
  try {
    if (configService && typeof configService.loadUISettings === "function") {
      const settings = configService.loadUISettings();
      if (settings?.language) {
        return normalizeLanguage(settings.language);
      }
    }
  } catch {
    // Config may not be initialized yet during early startup.
  }
  return DEFAULT_LANGUAGE;
}

/**
 * Resolve language from connection/session config, then UI settings.
 * @param {object} [sessionOrConfig]
 * @param {object} [configService]
 * @returns {string}
 */
function resolveLanguage(sessionOrConfig, configService) {
  const fromSession =
    sessionOrConfig?.language ||
    sessionOrConfig?.config?.language ||
    sessionOrConfig?.sshConfig?.language ||
    sessionOrConfig?.telnetConfig?.language;
  if (fromSession) {
    return normalizeLanguage(fromSession);
  }
  return getUiLanguage(configService);
}

module.exports = {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  normalizeLanguage,
  t,
  getUiLanguage,
  resolveLanguage,
  isZhLanguage,
  interpolate,
};
