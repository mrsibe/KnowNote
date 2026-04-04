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

  // 조회플랫폼정보
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

  // 로드퀴즈데이터
  useEffect(() => {
    const loadData = async (): Promise<void> => {
      setIsLoading(true)
      try {
        // 설정진행감시
        const cleanup = setupQuizListeners()

        if (quizId) {
          await loadQuiz(quizId)
        } else if (notebookId) {
          await loadLatestQuiz(notebookId)
        }

        // 정리감시
        cleanup()
      } catch (error) {
        console.error('[QuizPage] Failed to load quiz:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [notebookId, quizId, loadLatestQuiz, loadQuiz])

  // 정리
  useEffect(() => {
    return () => {
      resetQuiz()
    }
  }, [resetQuiz])

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      {/* 상단부분드래그제목바 */}
      <div
        className="absolute top-0 left-0 right-0 h-10 z-10 flex items-center justify-between px-4 bg-background"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* macOS 왼쪽빈공백영역（남겨둠윈도우제어버튼） */}
        {platform === 'darwin' && <div className="w-16"></div>}
        {/* 비 macOS 왼쪽빈공백영역 */}
        {platform !== 'darwin' && <div style={{ width: '100px' }}></div>}

        <span className="text-sm text-muted-foreground font-medium">{t('quiz')}</span>

        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* 으로내부추가작업버튼 */}
        </div>

        {/* Windows 오른쪽빈공백영역（남겨둠윈도우제어버튼） */}
        {platform === 'win32' && <div className="w-32"></div>}
      </div>

      {/* 내용영역 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          position: 'relative',
          paddingTop: '40px'
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
