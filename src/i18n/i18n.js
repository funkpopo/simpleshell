import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translations
import translationEN from './locales/en-US.json';
import translationZH from './locales/zh-CN.json';

const resources = {
  'en-US': translationEN,
  'zh-CN': translationZH,
};

// Initialize i18next
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'zh-CN',
    debug: process.env.NODE_ENV === 'development',
    interpolation: {
      escapeValue: false, // not needed for React
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'language',
      caches: ['localStorage'],
    },
  });

// Function to change the language
export const changeLanguage = (lng) => {
  if (i18n.language !== lng) {
    i18n.changeLanguage(lng);
    localStorage.setItem('language', lng);
  }
};

export default i18n; 