import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useQuizStore, setupQuizListeners } from '../../store/quizStore'
import QuizGenerating from '../notebook/quiz/QuizGenerating'
import QuizQuestionView from '../notebook/quiz/QuizQuestionView'
import QuizResultView from '../notebook/quiz/QuizResultView'

export default function QuizPage() {
  const { notebookId, quizId } = useParams<{ notebookId?: string; quizId?: string }>()
  const { t } = useTranslation('quiz')
  const { currentQuiz, isGenerating, isResultMode, loadLatestQuiz, loadQuiz, resetQuiz } =
    useQuizStore()

  const [isLoading, setIsLoading] = useState(true)
  const [platform, setPlatform] = useState<string>('')

  // 获取平台信息
  useEffect(() => {
    const getPlatform = async () => {
      try {
        const platformName = await window.api.getPlatform()
        setPlatform(platformName)
      } catch (error) {
        console.error('Failed to get platform:', error)
      }
    }
    getPlatform()
  }, [])

  // 加载答题数据
  useEffect(() => {
    const loadData = async (): Promise<void> => {
      setIsLoading(true)
      try {
        // 设置进度监听
        const cleanup = setupQuizListeners()

        if (quizId) {
          await loadQuiz(quizId)
        } else if (notebookId) {
          await loadLatestQuiz(notebookId)
        }

        // 清理监听器
        cleanup()
      } catch (error) {
        console.error('[QuizPage] Failed to load quiz:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [notebookId, quizId, loadLatestQuiz, loadQuiz])

  // 清理
  useEffect(() => {
    return () => {
      resetQuiz()
    }
  }, [resetQuiz])

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-surface-base">
      {/* 顶部可拖拽标题栏 */}
      <div
        className="absolute top-0 left-0 right-0 h-11 z-10 flex items-center justify-between px-3 bg-surface-base border-b border-border"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* macOS 左侧空白区域（留给窗口控制按钮） */}
        {platform === 'darwin' && <div className="w-16"></div>}
        {/* 非 macOS 左侧空白区域 */}
        {platform !== 'darwin' && <div style={{ width: '100px' }}></div>}

        <span className="text-sm font-medium text-foreground">{t('quiz')}</span>

        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* 可以在这里添加操作按钮 */}
        </div>

        {/* Windows 右侧空白区域（留给窗口控制按钮） */}
        {platform === 'win32' && <div className="w-32"></div>}
      </div>

      {/* 内容区域 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          position: 'relative',
          paddingTop: '44px'
        }}
      >
        {isLoading ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            className="text-muted-foreground"
          >
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : isGenerating ? (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <QuizGenerating />
          </div>
        ) : currentQuiz ? (
          <div style={{ flex: 1, overflow: 'auto' }}>
            {isResultMode ? <QuizResultView /> : <QuizQuestionView />}
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            className="text-muted-foreground"
          >
            {t('noQuizYet')}
          </div>
        )}
      </div>
    </div>
  )
}
