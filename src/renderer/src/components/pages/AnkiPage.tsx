import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAnkiStore } from '../../store/ankiStore'
import FlashcardView from '../notebook/anki/FlashcardView'
import AnkiConfigDialog from '../notebook/anki/AnkiConfigDialog'
import { Button } from '../ui/button'
import WindowTitleBar from '../common/WindowTitleBar'
import { TITLE_BAR_HEIGHT } from '../../../../shared/utils/windowChrome'

export default function AnkiPage() {
  const { notebookId, ankiCardId } = useParams<{ notebookId?: string; ankiCardId?: string }>()
  const { t } = useTranslation('anki')
  const {
    currentAnkiCards,
    loadLatestAnkiCards,
    loadAnkiCards,
    reset,
    isConfigDialogOpen,
    setConfigDialogOpen
  } = useAnkiStore()

  const [isLoading, setIsLoading] = useState(true)

  // 加载Anki卡片数据
  useEffect(() => {
    let cancelled = false

    const loadData = async (): Promise<void> => {
      if (cancelled) return
      setIsLoading(true)
      try {
        if (ankiCardId) {
          await loadAnkiCards(ankiCardId)
        } else if (notebookId) {
          await loadLatestAnkiCards(notebookId)
        }
      } catch (error) {
        if (!cancelled) console.error('[AnkiPage] Failed to load anki cards:', error)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadData()

    return () => {
      cancelled = true
    }
  }, [notebookId, ankiCardId, loadLatestAnkiCards, loadAnkiCards])

  // 清理
  useEffect(() => {
    return () => {
      reset()
    }
  }, [reset])

  const handleExport = async () => {
    if (!currentAnkiCards) return

    try {
      // 打开系统保存文件对话框
      const filePath = await window.api.dialog.saveFile({
        title: t('exportCards'),
        defaultPath: `${currentAnkiCards.title || 'anki-cards'}.apkg`,
        filters: [
          {
            name: 'Anki Package',
            extensions: ['apkg']
          }
        ]
      })

      if (!filePath) {
        // 用户取消了保存
        return
      }

      // 调用导出API
      const result = await window.api.anki.exportToPath(currentAnkiCards.id, filePath)

      if (!result.success) {
        console.error('Export failed:', result.error)
        alert(t('exportFailed', { error: result.error }))
      }
    } catch (error) {
      console.error('Failed to export cards:', error)
      alert(t('exportFailed', { error: (error as Error).message }))
    }
  }

  const handleConfig = () => {
    if (!notebookId) return
    setConfigDialogOpen(true)
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-surface-base">
      <WindowTitleBar
        overlay
        className="border-b border-border"
        center={
          <span className="truncate text-sm font-medium text-foreground">
            {currentAnkiCards?.title || t('ankiCards')}
          </span>
        }
        right={
          currentAnkiCards ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleExport}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <Download className="w-4 h-4" />
            </Button>
          ) : undefined
        }
      />

      {/* 内容区域 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          position: 'relative',
          paddingTop: TITLE_BAR_HEIGHT
        }}
      >
        {isLoading ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            className="text-muted-foreground"
          >
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : currentAnkiCards ? (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <FlashcardView
              cards={currentAnkiCards.cardsData as any}
              onClose={() => window.close()}
            />
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '16px'
            }}
            className="text-muted-foreground"
          >
            <p>{t('noCardsYet')}</p>
            <Button variant="default" onClick={handleConfig} disabled={!notebookId}>
              {t('generateCards')}
            </Button>
          </div>
        )}
      </div>

      {/* 对话框 */}
      {isConfigDialogOpen && notebookId && (
        <AnkiConfigDialog
          notebookId={notebookId}
          open={isConfigDialogOpen}
          onOpenChange={(open) => setConfigDialogOpen(open)}
        />
      )}
    </div>
  )
}
