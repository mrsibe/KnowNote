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

  /** Restore the defaults: what a closed dialog should never carry back in. */
  const reset = (): void => {
    setQuestionCount(10)
    setDifficulty('medium')
    setCustomPrompt('')
  }

  const handleStart = () => {
    const params: QuizStartParams = {
      questionCount,
      difficulty,
      customPrompt: customPrompt.trim() || undefined
    }
    onStart(params)
    // 成功开始后恢复默认值
    reset()
    onClose()
  }

  /**
   * Closing without starting discards the temporary input.
   *
   * Otherwise a half-configured dialog that stayed mounted "remembers" its value
   * by accident: X, Esc and the overlay must all mean Cancel, not Save.
   */
  const handleOpenChange = (open: boolean): void => {
    if (!open) {
      reset()
      onClose()
    }
  }

  const canStart = questionCount >= 5 && questionCount <= 20

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('generateQuiz')}</DialogTitle>
          <DialogDescription>{t('configureQuizSettings')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6 py-4">
          {/* 题目数量 */}
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

          {/* 题目难度 */}
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

          {/* 自定义提示词 */}
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
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
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
