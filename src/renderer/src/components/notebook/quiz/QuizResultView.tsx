import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuizStore } from '../../../store/quizStore'
import { Button } from '../../ui/button'
import { Trophy, RefreshCw } from 'lucide-react'

export default function QuizResultView() {
  const { t } = useTranslation('quiz')
  const {
    currentQuiz,
    getCorrectCount,
    getTotalQuestions,
    resetQuiz,
    setResultMode,
    setReviewMode,
    submitQuiz
  } = useQuizStore()

  // 提交答题会话（保存到数据库）
  // 首次进入结果页自动提交，且只提交一次
  const hasSubmittedRef = useRef(false)
  useEffect(() => {
    if (currentQuiz && !hasSubmittedRef.current) {
      hasSubmittedRef.current = true
      void submitQuiz()
    }
  }, [currentQuiz, submitQuiz])

  if (!currentQuiz) return null

  const correctCount = getCorrectCount()
  const totalQuestions = getTotalQuestions()
  const wrongCount = totalQuestions - correctCount
  const percentage = Math.round((correctCount / totalQuestions) * 100)

  const getEncouragementText = () => {
    if (percentage >= 90) return t('greatJob')
    if (percentage >= 60) return t('keepGoing')
    return t('reviewMore')
  }

  const handleReview = () => {
    setResultMode(false)
    setReviewMode(true)
    useQuizStore.setState({ currentQuestionIndex: 0 })
  }

  const handleRetry = () => {
    resetQuiz()
    setResultMode(false)
    setReviewMode(false)
  }

  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="w-full space-y-6">
        {/* 标题 */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Trophy className="w-6 h-6 text-muted-foreground" />
            <h2 className="text-lg font-medium text-foreground">{t('quizCompleted')}</h2>
          </div>
        </div>

        {/* 分数展示 */}
        <div className="text-center space-y-3">
          <div className="text-4xl font-semibold text-foreground">
            {correctCount}/{totalQuestions}
          </div>
          <p className="text-sm text-muted-foreground">
            {t('accuracy')}: {percentage}%
          </p>
        </div>

        {/* 统计网格 */}
        <div className="grid grid-cols-3 gap-6 text-center py-6">
          <div className="space-y-2">
            <p className="text-2xl font-medium text-success">{correctCount}</p>
            <p className="text-sm text-muted-foreground">{t('correctCount')}</p>
          </div>
          <div className="space-y-2">
            <p className="text-2xl font-medium text-destructive">{wrongCount}</p>
            <p className="text-sm text-muted-foreground">{t('wrongCount')}</p>
          </div>
          <div className="space-y-2">
            <p className="text-2xl font-medium text-foreground">{totalQuestions}</p>
            <p className="text-sm text-muted-foreground">{t('totalQuestions')}</p>
          </div>
        </div>

        {/* 鼓励文案 */}
        <div className="text-center">
          <p className="text-xl font-medium text-primary">{getEncouragementText()}</p>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-3 justify-center pt-4">
          <Button variant="outline" size="lg" onClick={handleReview}>
            {t('viewDetails')}
          </Button>
          <Button variant="outline" size="lg" onClick={handleRetry}>
            <RefreshCw className="w-4 h-4 mr-2" />
            {t('retry')}
          </Button>
        </div>
      </div>
    </div>
  )
}
