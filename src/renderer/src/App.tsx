import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import NotebookLayout from './components/notebook/NotebookLayout'
import NotebookListPage from './components/pages/NotebookListPage'
import OnboardingPage from './components/pages/OnboardingPage'
import MindMapPage from './components/pages/MindMapPage'
import QuizPage from './components/pages/QuizPage'
import AnkiPage from './components/pages/AnkiPage'
import SettingsDialog from './components/settings/SettingsDialog'
import { setupChatListeners } from './store/chatStore'
import { useThemeStore } from './store/themeStore'
import { useNotebookStore } from './store/notebookStore'
import { useI18nStore } from './store/i18nStore'
import { useOnboardingStore } from './store/onboardingStore'
import { useShortcutExecutor } from './hooks/useShortcutExecutor'
import { initPlatform } from './lib/platform'
import i18n from './i18n'

function App(): React.JSX.Element {
  const initTheme = useThemeStore((state) => state.initTheme)
  const loadNotebooks = useNotebookStore((state) => state.loadNotebooks)
  const { language, initLanguage } = useI18nStore()
  const {
    hasCompletedOnboarding,
    isLoading: onboardingLoading,
    initOnboarding
  } = useOnboardingStore()

  // 활성화단축키실행행
  useShortcutExecutor()

  // 초기화플랫폼감지（미리로드플랫폼정보에캐시）
  useEffect(() => {
    initPlatform().catch((error) => {
      console.error('[App] Failed to initialize platform detection:', error)
    })
  }, [])

  // 초기화채팅감시
  useEffect(() => {
    const cleanup = setupChatListeners()
    return cleanup
  }, [])

  // 초기화테마
  useEffect(() => {
    initTheme()
  }, [initTheme])

  // 초기화언어
  useEffect(() => {
    initLanguage()
  }, [initLanguage])

  // 감시언어변경
  useEffect(() => {
    if (language && i18n.language !== language) {
      i18n.changeLanguage(language)
    }
  }, [language])

  // 초기화노트북데이터（에서데이터베이스로드）
  useEffect(() => {
    console.log('[App] Loading notebooks on startup...')
    loadNotebooks().catch((error) => {
      console.error('[App] Failed to load notebooks:', error)
    })
  }, [loadNotebooks])

  // 초기화온보딩상태
  useEffect(() => {
    initOnboarding()
  }, [initOnboarding])

  // 만약현재로드온보딩상태，표시로딩 중
  if (onboardingLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-foreground">Loading...</div>
      </div>
    )
  }

  return (
    <I18nextProvider i18n={i18n}>
      <HashRouter>
        <Routes>
          {/* 온보딩페이지라우트 */}
          {!hasCompletedOnboarding && <Route path="/onboarding" element={<OnboardingPage />} />}
          {/* 메인앱라우트 */}
          <Route
            path="/"
            element={
              hasCompletedOnboarding ? <NotebookListPage /> : <Navigate to="/onboarding" replace />
            }
          />
          <Route path="/notebook/:id" element={<NotebookLayout />} />
          <Route path="/mindmap/:notebookId" element={<MindMapPage />} />
          <Route path="/mindmap/view/:mindMapId" element={<MindMapPage />} />
          <Route path="/quiz/:notebookId" element={<QuizPage />} />
          <Route path="/quiz/view/:quizId" element={<QuizPage />} />
          <Route path="/anki/:notebookId" element={<AnkiPage />} />
          <Route path="/anki/view/:ankiCardId" element={<AnkiPage />} />
        </Routes>
        <SettingsDialog />
      </HashRouter>
    </I18nextProvider>
  )
}

export default App
