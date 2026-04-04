import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// Import language resources
import koKRCommon from '../locales/ko-KR/common.json'
import koKRChat from '../locales/ko-KR/chat.json'
import koKRUi from '../locales/ko-KR/ui.json'
import koKRNotebook from '../locales/ko-KR/notebook.json'
import koKRSettings from '../locales/ko-KR/settings.json'
import koKRShortcuts from '../locales/ko-KR/shortcuts.json'

import enUSCommon from '../locales/en-US/common.json'
import enUSChat from '../locales/en-US/chat.json'
import enUSUi from '../locales/en-US/ui.json'
import enUSNotebook from '../locales/en-US/notebook.json'
import enUSSettings from '../locales/en-US/settings.json'
import enUSShortcuts from '../locales/en-US/shortcuts.json'

// Configure i18n
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en-US',
    lng: 'ko-KR', // 기본 언어
    debug: process.env.NODE_ENV === 'development',

    interpolation: {
      escapeValue: false // React already escapes
    },

    resources: {
      'ko-KR': {
        common: koKRCommon,
        chat: koKRChat,
        ui: koKRUi,
        notebook: koKRNotebook,
        settings: koKRSettings,
        shortcuts: koKRShortcuts
      },
      'en-US': {
        common: enUSCommon,
        chat: enUSChat,
        ui: enUSUi,
        notebook: enUSNotebook,
        settings: enUSSettings,
        shortcuts: enUSShortcuts
      }
    },

    detection: {
      order: ['localStorage'], // localStorage만 사용, 브라우저 감지 사용 안 함
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng'
    },

    // Default namespace
    defaultNS: 'common'
  })

export default i18n
