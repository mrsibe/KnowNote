import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { AnkiCardItem } from '../../../../../shared/types'
import { Button } from '../../ui/button'
import { Card, CardContent } from '../../ui/card'
import { Badge } from '../../ui/badge'

interface FlashcardViewProps {
  cards: AnkiCardItem[]
  onClose: () => void
}

export default function FlashcardView({ cards, onClose }: FlashcardViewProps) {
  const { t } = useTranslation('anki')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <div className="text-center space-y-4">
          <p className="text-lg text-muted-foreground">{t('noCards')}</p>
          <Button variant="outline" onClick={onClose}>
            {t('back')}
          </Button>
        </div>
      </div>
    )
  }

  const currentCard = cards[currentIndex]
  const progress = ((currentIndex + 1) / cards.length) * 100

  // 获取卡片的正面内容
  const getFrontContent = (card: AnkiCardItem): string => {
    switch (card.type) {
      case 'basic':
        return card.front
      case 'cloze':
        return card.text.replace(/\{\{c\d+::(.*?)\}\}/g, '[...]')
      case 'fill-blank':
        return card.sentence
    }
  }

  // 获取卡片的背面内容
  const getBackContent = (card: AnkiCardItem): string => {
    switch (card.type) {
      case 'basic':
        return card.back
      case 'cloze':
        return card.text
      case 'fill-blank':
        return `${card.sentence}\n\n${t('answer')}: ${card.answer}`
    }
  }

  const handleNext = () => {
    setIsFlipped(false)
    setCurrentIndex((prev) => (prev + 1) % cards.length)
  }

  const handlePrevious = () => {
    setIsFlipped(false)
    setCurrentIndex((prev) => (prev - 1 + cards.length) % cards.length)
  }

  const handleFlip = () => {
    setIsFlipped(!isFlipped)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 防止按键重复触发（按住不放）
    if (e.repeat) {
      return
    }

    switch (e.key) {
      case ' ':
      case 'Enter':
        e.preventDefault()
        handleFlip()
        break
      case 'ArrowRight':
        e.preventDefault()
        handleNext()
        break
      case 'ArrowLeft':
        e.preventDefault()
        handlePrevious()
        break
    }
  }

  return (
    <div className="flex flex-col h-full focus:outline-none" onKeyDown={handleKeyDown} tabIndex={0}>
      {/* 卡片区域 */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-2xl min-h-96 cursor-pointer" onClick={handleFlip}>
          <Card className="w-full h-96">
            <CardContent className="h-full flex items-center justify-center p-8">
              <div className="text-center space-y-4 max-w-lg">
                {!isFlipped ? (
                  <>
                    <Badge variant="secondary" className="mb-4">
                      {t('question')}
                    </Badge>
                    <p className="text-xl whitespace-pre-wrap">{getFrontContent(currentCard)}</p>
                  </>
                ) : (
                  <>
                    <Badge variant="secondary" className="mb-4">
                      {t('answer')}
                    </Badge>
                    <p className="text-xl whitespace-pre-wrap">{getBackContent(currentCard)}</p>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 进度条 */}
      <div className="h-1 bg-muted relative">
        <div
          className="h-full bg-primary transition-[width] duration-300"
          style={{ width: `${progress}%` }}
        />
        <div className="absolute top-0 left-0 right-0 text-center text-xs text-muted-foreground -mt-5">
          {currentIndex + 1} / {cards.length}
        </div>
      </div>

      {/* 底部控制栏 */}
      <div className="flex items-center justify-center gap-4 p-4 border-t">
        <Button
          variant="outline"
          size="icon"
          onClick={handlePrevious}
          disabled={cards.length <= 1}
          aria-label="Previous card"
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>

        <Button variant="default" onClick={handleFlip}>
          {isFlipped ? t('showQuestion') : t('showAnswer')}
        </Button>

        <Button
          variant="outline"
          size="icon"
          onClick={handleNext}
          disabled={cards.length <= 1}
          aria-label="Next card"
        >
          <ChevronRight className="w-5 h-5" />
        </Button>
      </div>
    </div>
  )
}
