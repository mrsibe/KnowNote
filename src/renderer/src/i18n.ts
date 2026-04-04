import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// 모든 언어 리소스 가져오기
import zhCNCommon from './locales/ko-KR/common.json'
import zhCNChat from './locales/ko-KR/chat.json'
import zhCNSettings from './locales/ko-KR/settings.json'
import zhCNNotebook from './locales/ko-KR/notebook.json'
import zhCNUI from './locales/ko-KR/ui.json'
import zhCNQuiz from './locales/ko-KR/quiz.json'
import zhCNAnki from './locales/ko-KR/anki.json'
import zhCNShortcuts from './locales/ko-KR/shortcuts.json'

import enUSCommon from './locales/en-US/common.json'
import enUSChat from './locales/en-US/chat.json'
import enUSSettings from './locales/en-US/settings.json'
import enUSNotebook from './locales/en-US/notebook.json'
import enUSUI from './locales/en-US/ui.json'
import enUSQuiz from './locales/en-US/quiz.json'
import enUSAnki from './locales/en-US/anki.json'
import enUSShortcuts from './locales/en-US/shortcuts.json'

const resources = {
  'ko-KR': {
    common: zhCNCommon,
    chat: zhCNChat,
    settings: zhCNSettings,
    notebook: zhCNNotebook,
    ui: zhCNUI,
    quiz: zhCNQuiz,
    anki: zhCNAnki,
    shortcuts: zhCNShortcuts
  },
  'en-US': {
    common: enUSCommon,
    chat: enUSChat,
    settings: enUSSettings,
    notebook: enUSNotebook,
    ui: enUSUI,
    quiz: enUSQuiz,
    anki: enUSAnki,
    shortcuts: enUSShortcuts
  }
}

i18n
  .use(initReactI18next) // i18n 인스턴스를 react-i18next에 전달
  .init({
    resources,
    lng: 'ko-KR', // 기본 언어
    fallbackLng: 'ko-KR',
    interpolation: {
      escapeValue: false // React는 기본적으로 이스케이프됨
    },
    react: {
      useSuspense: false
    }
  })

export default i18n
