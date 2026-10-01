import { useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useAnkiStore } from '../../../store/ankiStore'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '../../ui/dialog'
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

  /** Restore the defaults: what a closed dialog should never carry back in. */
  const reset = (): void => {
    setCardCount(20)
    setDifficulty('medium')
    setCustomPrompt('')
  }

  /**
   * Closing without generating discards the temporary input, so X / Esc / the
   * overlay all mean Cancel rather than "remember what I typed".
   */
  const handleOpenChange = (open: boolean): void => {
    if (!open) reset()
    onOpenChange(open)
  }

  const handleGenerate = async () => {
    // 立即关闭对话框
    reset()
    onOpenChange(false)

    // 在后台开始生成（不等待完成）
    generateAnkiCards(notebookId, {
      cardCount,
      difficulty,
      customPrompt: customPrompt || undefined
    }).catch((error) => {
      console.error('Failed to generate anki cards:', error)
      toast.error(
        t('generateFailed', {
          error: error instanceof Error ? error.message : String(error)
        }),
        { duration: 10000 }
      )
    })

    // 等待一小段时间后触发回调，以显示"正在生成"的 item
    setTimeout(() => {
      onGenerateStart?.()
    }, 500)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t('generateCards')}</DialogTitle>
          <DialogDescription>{t('generateCardsDesc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* 卡片数量 */}
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

          {/* 难度选择 */}
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

          {/* 自定义提示词 */}
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
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={handleGenerate}>{t('startGenerate')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
