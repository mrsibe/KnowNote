import { useTranslation } from 'react-i18next'
import DOMPurify from 'dompurify'
import type { AnkiCardItem } from '../../../../../shared/types'
import { Card, CardContent, CardHeader } from '../../ui/card'
import { Badge } from '../../ui/badge'
import { ScrollArea } from '../../ui/scroll-area'
import { Separator } from '../../ui/separator'

interface AnkiCardListProps {
  cards: AnkiCardItem[]
}

export default function AnkiCardList({ cards }: AnkiCardListProps) {
  const { t } = useTranslation('anki')

  const getCardTypeLabel = (type: string): string => {
    const typeMap: Record<string, string> = {
      basic: t('basicCard'),
      cloze: t('clozeCard'),
      'fill-blank': t('fillBlankCard')
    }
    return typeMap[type] || type
  }

  const getCardTypeColor = (type: string): string => {
    const colorMap: Record<string, string> = {
      basic: 'bg-chart-1',
      cloze: 'bg-chart-2',
      'fill-blank': 'bg-chart-5'
    }
    return colorMap[type] || 'bg-muted-foreground'
  }

  const renderCardContent = (card: AnkiCardItem): React.ReactNode => {
    switch (card.type) {
      case 'basic':
        return (
          <div className="space-y-3">
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">{t('question')}</div>
              <div className="text-base">{card.front}</div>
            </div>
            <Separator />
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">{t('answer')}</div>
              <div className="text-base">{card.back}</div>
            </div>
          </div>
        )
      case 'cloze':
        return (
          <div className="space-y-3">
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">{t('clozeText')}</div>
              <div
                className="text-base"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(
                    card.text.replace(
                      /\{\{c\d+::(.*?)\}\}/g,
                      '<span class="font-bold text-primary">$1</span>'
                    )
                  )
                }}
              />
            </div>
            {card.backExtra && (
              <>
                <Separator />
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">
                    {t('extraInfo')}
                  </div>
                  <div className="text-sm text-muted-foreground">{card.backExtra}</div>
                </div>
              </>
            )}
          </div>
        )
      case 'fill-blank':
        return (
          <div className="space-y-3">
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">{t('sentence')}</div>
              <div
                className="text-base"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(
                    card.sentence.replace(
                      /_{3,}/g,
                      '<span class="font-bold text-primary">_____</span>'
                    )
                  )
                }}
              />
            </div>
            <Separator />
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">{t('answer')}</div>
              <div className="text-base font-semibold">{card.answer}</div>
              {card.hint && (
                <div className="text-sm text-muted-foreground mt-1">
                  {t('hint')}: {card.hint}
                </div>
              )}
            </div>
          </div>
        )
    }
  }

  return (
    <div className="h-full">
      <ScrollArea className="h-full">
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium">{t('cardList')}</h2>
            <Badge variant="secondary" className="text-lg px-3 py-1">
              {cards.length} {t('cards')}
            </Badge>
          </div>

          {cards.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">{t('noCards')}</div>
          ) : (
            <div className="grid gap-4">
              {cards.map((card, index) => (
                <Card key={card.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-subtle-foreground">#{index + 1}</span>
                        <Badge variant="outline" className="gap-1.5">
                          <span
                            className={`size-1.5 shrink-0 rounded-full ${getCardTypeColor(card.type)}`}
                          />
                          {getCardTypeLabel(card.type)}
                        </Badge>
                        {card.tags && card.tags.length > 0 && (
                          <div className="flex gap-1">
                            {card.tags.map((tag, tagIndex) => (
                              <Badge key={tagIndex} variant="outline" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      {card.metadata?.difficulty && (
                        <Badge variant="outline">{t(card.metadata.difficulty)}</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>{renderCardContent(card)}</CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
