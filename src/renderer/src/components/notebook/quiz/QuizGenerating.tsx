import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useQuizStore } from '../../../store/quizStore'

export default function QuizGenerating() {
  const { t } = useTranslation('quiz')
  const { generationProgress } = useQuizStore()

  const getStageText = (stage: string) => {
    return t(`progress.${stage}`) || stage
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <div className="max-w-md w-full space-y-8">
        {/* 标题 */}
        <h2 className="text-lg font-medium text-center text-foreground">{t('generatingQuiz')}</h2>

        {/* 进度指示器 */}
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 animate-spin text-muted-foreground" />
          <div className="text-center space-y-2">
            <p className="text-2xl font-medium text-foreground">
              {generationProgress?.progress || 0}%
            </p>
            <p className="text-base text-muted-foreground">
              {generationProgress?.stage && getStageText(generationProgress.stage)}
            </p>
          </div>
        </div>

        {/* 进度条 */}
        <div className="w-full bg-muted rounded-full h-2">
          <div
            className="bg-primary h-2 rounded-full transition-[width] duration-300 ease-in-out"
            style={{ width: `${generationProgress?.progress || 0}%` }}
          />
        </div>

        {/* 提示文本 */}
        <p className="text-center text-sm text-muted-foreground">{t('generatingHint')}</p>
      </div>
    </div>
  )
}
