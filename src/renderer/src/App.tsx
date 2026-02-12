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
import { useProviderStore } from './store/providerStore'
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
  const initializeProviders = useProviderStore((state) => state.initialize)

  // 激活快捷键执行器
  useShortcutExecutor()

  // 初始化平台检测（预加载平台信息到缓存）
  useEffect(() => {
    initPlatform().catch((error) => {
      console.error('[App] Failed to initialize platform detection:', error)
    })
  }, [])

  // 初始化聊天监听器
  useEffect(() => {
    const cleanup = setupChatListeners()
    return cleanup
  }, [])

  // 初始化主题
  useEffect(() => {
    initTheme()
  }, [initTheme])

  // 初始化语言
  useEffect(() => {
    initLanguage()
  }, [initLanguage])

  // 监听语言变化
  useEffect(() => {
    if (language && i18n.language !== language) {
      i18n.changeLanguage(language)
    }
  }, [language])

  // 初始化笔记本数据（从数据库加载）
  useEffect(() => {
    console.log('[App] Loading notebooks on startup...')
    loadNotebooks().catch((error) => {
      console.error('[App] Failed to load notebooks:', error)
    })
  }, [loadNotebooks])

  // 初始化引导状态
  useEffect(() => {
    initOnboarding()
  }, [initOnboarding])

  // 初始化供应商配置
  useEffect(() => {
    console.log('[App] Initializing providers...')
    initializeProviders().catch((error) => {
      console.error('[App] Failed to initialize providers:', error)
    })
  }, [initializeProviders])

  // 如果正在加载引导状态，显示加载中
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
          {/* 引导页路由 */}
          {!hasCompletedOnboarding && <Route path="/onboarding" element={<OnboardingPage />} />}
          {/* 主应用路由 */}
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
