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
        {/* 제목 */}
        <h2 className="text-2xl font-semibold text-center text-foreground">
          {t('generatingQuiz')}
        </h2>

        {/* 진행가리키는보여주기 */}
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-16 h-16 animate-spin text-primary" />
          <div className="text-center space-y-2">
            <p className="text-3xl font-bold text-primary">{generationProgress?.progress || 0}%</p>
            <p className="text-base text-muted-foreground">
              {generationProgress?.stage && getStageText(generationProgress.stage)}
            </p>
          </div>
        </div>

        {/* 프로그레스 바 */}
        <div className="w-full bg-secondary rounded-full h-3">
          <div
            className="bg-primary h-3 rounded-full transition-all duration-300 ease-in-out"
            style={{ width: `${generationProgress?.progress || 0}%` }}
          />
        </div>

        {/* 힌트텍스트 */}
        <p className="text-center text-sm text-muted-foreground">{t('generatingHint')}</p>
      </div>
    </div>
  )
}
