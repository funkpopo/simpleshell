import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// Import translations
import translationEN from "../../shared/locales/en-US.json";
import translationZH from "../../shared/locales/zh-CN.json";

const resources = {
  "en-US": translationEN,
  "zh-CN": translationZH,
};

const supportedLanguages = Object.keys(resources);

const normalizeLanguage = (lng) => {
  if (typeof lng !== "string" || !lng.trim()) {
    return "zh-CN";
  }

  const normalized = lng.trim();
  if (supportedLanguages.includes(normalized)) {
    return normalized;
  }

  const lower = normalized.toLowerCase();
  if (lower === "zh" || lower.startsWith("zh-")) {
    return "zh-CN";
  }
  if (lower === "en" || lower.startsWith("en-")) {
    return "en-US";
  }

  throw new Error(`Unsupported UI language: ${lng}`);
};

// Initialize i18next
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: false,
    supportedLngs: supportedLanguages,
    load: "currentOnly",
    returnNull: false,
    debug: process.env.NODE_ENV === "development",
    parseMissingKeyHandler: (key) => {
      throw new Error(`Missing translation key: ${key}`);
    },
    interpolation: {
      escapeValue: false, // not needed for React
    },
    detection: {
      order: ["navigator"],
      caches: [],
    },
  });

// Function to change the language
export const changeLanguage = (lng) => {
  const normalizedLanguage = normalizeLanguage(lng);
  if (i18n.language !== normalizedLanguage) {
    i18n.changeLanguage(normalizedLanguage);
    // 通知主进程按新语言重建系统菜单（文件/编辑/窗口等）
    try {
      window.terminalAPI?.rebuildSystemMenu?.();
    } catch {
      // IPC 桥未就绪时静默忽略（菜单保持启动时语言）
    }
  }
};

export default i18n;
