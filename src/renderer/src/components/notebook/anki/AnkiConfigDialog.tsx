import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAnkiStore } from '../../../store/ankiStore'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../ui/dialog'
import { Button } from '../../ui/button'
import { Label } from '../../ui/label'
import { Slider } from '../../ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { Textarea } from '../../ui/textarea'

interface AnkiConfigDialogProps {
  notebookId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onGenerateStart?: () => void
}

export default function AnkiConfigDialog({
  notebookId,
  open,
  onOpenChange,
  onGenerateStart
}: AnkiConfigDialogProps) {
  const { t } = useTranslation('anki')
  const { generateAnkiCards } = useAnkiStore()

  const [cardCount, setCardCount] = useState(20)
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium')
  const [customPrompt, setCustomPrompt] = useState('')

  const handleGenerate = async () => {
    // 즉시닫기다이얼로그
    onOpenChange(false)

    // 후대시작생성（아닌등대기완료）
    generateAnkiCards(notebookId, {
      cardCount,
      difficulty,
      customPrompt: customPrompt || undefined
    }).catch((error) => {
      console.error('Failed to generate anki cards:', error)
    })

    // 등대기하나작은단시간후트리거콜백，으로표시"현재생성"의 item
    setTimeout(() => {
      onGenerateStart?.()
    }, 500)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t('generateCards')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* 카드수량 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="card-count">{t('cardCount')}</Label>
              <span className="text-sm text-muted-foreground">{cardCount}</span>
            </div>
            <Slider
              id="card-count"
              min={5}
              max={50}
              step={5}
              value={[cardCount]}
              onValueChange={(value) => setCardCount(value[0])}
            />
          </div>

          {/* 어려운도선택 */}
          <div className="space-y-2">
            <Label htmlFor="difficulty">{t('difficulty')}</Label>
            <Select
              value={difficulty}
              onValueChange={(value) => setDifficulty(value as 'easy' | 'medium' | 'hard')}
            >
              <SelectTrigger id="difficulty">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="easy">{t('easy')}</SelectItem>
                <SelectItem value="medium">{t('medium')}</SelectItem>
                <SelectItem value="hard">{t('hard')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 자체정의힌트 */}
          <div className="space-y-2">
            <Label htmlFor="custom-prompt">{t('customPrompt')}</Label>
            <Textarea
              id="custom-prompt"
              placeholder={t('customPromptPlaceholder')}
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">{t('customPromptHint')}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={handleGenerate}>{t('startGenerate')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
