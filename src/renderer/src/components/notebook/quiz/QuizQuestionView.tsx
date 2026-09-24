import { useState } from 'react'
import { Lightbulb, Check, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useQuizStore } from '../../../store/quizStore'
import { Button } from '../../ui/button'
import { Checkbox } from '../../ui/checkbox'
import { cn } from '../../../lib/utils'

export default function QuizQuestionView() {
  const { t } = useTranslation('quiz')
  const {
    currentQuiz,
    currentQuestionIndex,
    setCurrentQuestionIndex,
    answers,
    setAnswer,
    showHints,
    toggleHint,
    getTotalQuestions,
    setResultMode,
    isReviewMode
  } = useQuizStore()

  const [showExplanation, setShowExplanation] = useState(false)

  if (!currentQuiz) return null

  const questions = currentQuiz.questionsData
  const currentQuestion = questions[currentQuestionIndex]
  const totalQuestions = getTotalQuestions()
  const selectedAnswer = answers[currentQuestion.id]
  const showHint = showHints[currentQuestion.id] || false

  // 查看详情模式下，始终显示解析
  const shouldShowExplanation = isReviewMode || showExplanation

  const handleSelectAnswer = (answerIndex: number) => {
    // 查看详情模式下不允许修改答案
    if (isReviewMode) return

    if (!showExplanation) {
      setAnswer(currentQuestion.id, answerIndex)
      setShowExplanation(true)
    }
  }

  const handleNext = () => {
    if (currentQuestionIndex < totalQuestions - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1)
      if (!isReviewMode) {
        setShowExplanation(false)
      }
    } else {
      // 最后一题，显示结果
      setResultMode(true)
    }
  }

  const handlePrevious = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1)
      if (!isReviewMode) {
        setShowExplanation(false)
      }
    }
  }

  const isCorrect = selectedAnswer === currentQuestion.correctAnswer

  return (
    <div className="h-full flex flex-col p-6">
      <div className="w-full flex flex-col gap-4 h-full">
        {/* 头部 */}
        <div className="flex justify-between items-center">
          <h2 className="text-base font-medium text-foreground">
            {t('question')} {currentQuestionIndex + 1}/{totalQuestions}
          </h2>
          <Button variant="ghost" size="sm" onClick={() => toggleHint(currentQuestion.id)}>
            <Lightbulb className="w-4 h-4 mr-1" />
            {showHint ? t('hideHint') : t('showHint')}
          </Button>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-auto flex flex-col gap-6">
          {/* 题目文本 */}
          <p className="text-base leading-relaxed font-medium text-foreground">
            {currentQuestion.questionText}
          </p>

          {/* 选项列表 */}
          <div className="flex flex-col gap-3">
            {currentQuestion.options.map((option, index) => {
              const isSelected = selectedAnswer === index
              const isCorrectOption = index === currentQuestion.correctAnswer
              const showResult = shouldShowExplanation

              return (
                <div
                  key={index}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-3 transition-colors',
                    // 查看详情模式：禁用点击
                    isReviewMode ? 'cursor-default' : 'cursor-pointer',
                    isSelected && !showResult && 'border-primary bg-surface-selected',
                    showResult && isCorrectOption && 'border-success bg-success/10',
                    showResult &&
                      isSelected &&
                      !isCorrectOption &&
                      'border-destructive bg-destructive/10',
                    !isSelected &&
                      !showResult &&
                      !isReviewMode &&
                      'border-border hover:bg-surface-hover'
                  )}
                  onClick={() => handleSelectAnswer(index)}
                >
                  <Checkbox checked={isSelected} disabled={showResult || isReviewMode} />
                  <span className="text-sm flex-1 text-foreground">
                    {String.fromCharCode(65 + index)}. {option}
                  </span>
                  {showResult && isCorrectOption && <Check className="w-5 h-5 text-success" />}
                  {showResult && isSelected && !isCorrectOption && (
                    <X className="w-5 h-5 text-destructive" />
                  )}
                </div>
              )
            })}
          </div>

          {/* 提示（可折叠） */}
          {showHint && (
            <div className="bg-muted border border-border rounded-lg p-4">
              <div className="flex items-start gap-2">
                <Lightbulb className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                  {currentQuestion.hints.map((hint, i) => (
                    <p key={i}>• {hint}</p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 答案解释（答题后或查看详情时显示） */}
          {shouldShowExplanation && selectedAnswer !== undefined && (
            <div
              className={cn(
                'rounded-lg border p-4',
                isCorrect ? 'border-success bg-success/10' : 'border-destructive bg-destructive/10'
              )}
            >
              <div className="flex items-start gap-2">
                <div
                  className={cn(
                    'w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
                    isCorrect ? 'bg-success' : 'bg-destructive'
                  )}
                >
                  {isCorrect ? (
                    <Check className="w-3 h-3 text-primary-foreground" />
                  ) : (
                    <X className="w-3 h-3 text-primary-foreground" />
                  )}
                </div>
                <div className="flex-1 flex flex-col gap-1">
                  <p
                    className={cn(
                      'text-sm font-medium',
                      isCorrect ? 'text-success' : 'text-destructive'
                    )}
                  >
                    {isCorrect ? t('correct') : t('incorrect')}
                  </p>
                  <p className="text-sm text-muted-foreground">{currentQuestion.explanation}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div
          className={cn(
            'border-t border-border pt-4',
            isReviewMode ? 'flex justify-between' : 'flex justify-end'
          )}
        >
          {isReviewMode && (
            <Button
              variant="outline"
              onClick={handlePrevious}
              disabled={currentQuestionIndex === 0}
            >
              {t('previous')}
            </Button>
          )}
          <Button onClick={handleNext} disabled={!isReviewMode && selectedAnswer === undefined}>
            {isReviewMode
              ? currentQuestionIndex === totalQuestions - 1
                ? t('backToResult')
                : t('next')
              : currentQuestionIndex === totalQuestions - 1
                ? t('viewResult')
                : t('next')}
          </Button>
        </div>
      </div>
    </div>
  )
}
