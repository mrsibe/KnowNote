import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAnkiStore } from '../../store/ankiStore'
import FlashcardView from '../notebook/anki/FlashcardView'
import AnkiConfigDialog from '../notebook/anki/AnkiConfigDialog'
import { Button } from '../ui/button'

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
  const [platform, setPlatform] = useState<string>('')

  // 조회플랫폼정보
  useEffect(() => {
    const getPlatform = async () => {
      try {
        const platformName = await window.api.getPlatform()
        setPlatform(platformName)
      } catch (error) {
        console.error('Failed to get platform:', error)
      }
    }
    getPlatform()
  }, [])

  // 로드Anki카드데이터
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

  // 정리
  useEffect(() => {
    return () => {
      reset()
    }
  }, [reset])

  const handleExport = async () => {
    if (!currentAnkiCards) return

    try {
      // 열기시리즈통합저장파일다이얼로그
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
        // 사용자취소저장
        return
      }

      // 호출내보내기API
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
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      {/* 상단부분드래그제목바 */}
      <div
        className="absolute top-0 left-0 right-0 h-10 z-10 flex items-center justify-between px-4 bg-background border-b"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* macOS 왼쪽빈공백영역（남겨둠윈도우제어버튼） */}
        {platform === 'darwin' && <div className="w-16"></div>}
        {/* 비 macOS 왼쪽점유위치，보유지제목가운데 정렬 */}
        {platform !== 'darwin' && <div className="w-32"></div>}

        <span className="text-sm text-muted-foreground font-medium">
          {currentAnkiCards?.title || t('ankiCards')}
        </span>

        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {currentAnkiCards && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleExport}>
              <Download className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>

        {/* Windows / Linux 오른쪽빈공백영역（남겨둠윈도우제어버튼） */}
        {(platform === 'win32' || platform === 'linux') && <div className="w-32"></div>}
      </div>

      {/* 내용영역 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          position: 'relative',
          paddingTop: '40px'
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

      {/* 다이얼로그 */}
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
