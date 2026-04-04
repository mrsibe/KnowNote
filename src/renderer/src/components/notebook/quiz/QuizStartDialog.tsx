import { ReactElement, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../ui/dialog'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { Textarea } from '../../ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'

export interface QuizStartParams {
  questionCount: number
  difficulty: 'easy' | 'medium' | 'hard'
  customPrompt?: string
}

interface QuizStartDialogProps {
  isOpen: boolean
  onClose: () => void
  onStart: (params: QuizStartParams) => void
}

export default function QuizStartDialog({
  isOpen,
  onClose,
  onStart
}: QuizStartDialogProps): ReactElement {
  const { t } = useTranslation('quiz')
  const [questionCount, setQuestionCount] = useState(10)
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium')
  const [customPrompt, setCustomPrompt] = useState('')

  const handleStart = () => {
    const params: QuizStartParams = {
      questionCount,
      difficulty,
      customPrompt: customPrompt.trim() || undefined
    }
    onStart(params)
    // 재상태
    setQuestionCount(10)
    setDifficulty('medium')
    setCustomPrompt('')
    onClose()
  }

  const canStart = questionCount >= 5 && questionCount <= 20

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('generateQuiz')}</DialogTitle>
          <DialogDescription>{t('configureQuizSettings')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6 py-4">
          {/* 문제수량 */}
          <div className="flex flex-col gap-2">
            <label htmlFor="questionCount" className="text-sm font-medium">
              {t('questionCount')}
            </label>
            <Input
              id="questionCount"
              type="number"
              min={5}
              max={20}
              value={questionCount}
              onChange={(e) => setQuestionCount(parseInt(e.target.value) || 10)}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">{t('questionCountHint')}</p>
          </div>

          {/* 문제어려운도 */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">{t('difficulty')}</label>
            <Select value={difficulty} onValueChange={(value: any) => setDifficulty(value)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {difficulty === 'easy' && t('easy')}
                  {difficulty === 'medium' && t('medium')}
                  {difficulty === 'hard' && t('hard')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="easy">{t('easy')}</SelectItem>
                <SelectItem value="medium">{t('medium')}</SelectItem>
                <SelectItem value="hard">{t('hard')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 자체정의힌트 */}
          <div className="flex flex-col gap-2">
            <label htmlFor="customPrompt" className="text-sm font-medium">
              {t('customPrompt')} <span className="text-muted-foreground">({t('optional')})</span>
            </label>
            <Textarea
              id="customPrompt"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder={t('customPromptPlaceholder')}
              className="h-32 resize-none"
            />
            <p className="text-xs text-muted-foreground">{t('customPromptHint')}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={handleStart} disabled={!canStart}>
            {t('startGeneration')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
