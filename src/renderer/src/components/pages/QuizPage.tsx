import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useQuizStore, setupQuizListeners } from '../../store/quizStore'
import QuizGenerating from '../notebook/quiz/QuizGenerating'
import QuizQuestionView from '../notebook/quiz/QuizQuestionView'
import QuizResultView from '../notebook/quiz/QuizResultView'
import WindowTitleBar from '../common/WindowTitleBar'
import { TITLE_BAR_HEIGHT } from '../../../../shared/utils/windowChrome'

export default function QuizPage() {
  const { notebookId, quizId } = useParams<{ notebookId?: string; quizId?: string }>()
  const { t } = useTranslation('quiz')
  const { currentQuiz, isGenerating, isResultMode, loadLatestQuiz, loadQuiz, resetQuiz } =
    useQuizStore()

  const [isLoading, setIsLoading] = useState(true)

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
      <WindowTitleBar
        overlay
        className="border-b border-border"
        center={<span className="text-sm font-medium text-foreground">{t('quiz')}</span>}
      />

      {/* 内容区域 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          position: 'relative',
          paddingTop: TITLE_BAR_HEIGHT
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
