import { Dialog, DialogContent, DialogTitle } from '../../ui/dialog'
import { Button } from '../../ui/button'
import { RefreshCw, Loader2, ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useMindMapStore } from '../../../store/mindmapStore'
import MindMapCanvas from './MindMapCanvas'
import NodeDetailPanel from './NodeDetailPanel'

export default function MindMapDialog({ notebookId }: { notebookId: string }) {
  const { t } = useTranslation('notebook')
  const {
    isDialogOpen,
    setDialogOpen,
    currentMindMap,
    isGenerating,
    generationProgress,
    generateMindMap
  } = useMindMapStore()

  const handleGenerate = async () => {
    if (notebookId) {
      try {
        await generateMindMap(notebookId)
      } catch (error) {
        console.error('Failed to generate mind map:', error)
      }
    }
  }

  const handleClose = () => {
    console.log('[MindMapDialog] Close button clicked')
    setDialogOpen(false)
  }

  return (
    <Dialog open={isDialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent
        className="max-w-[90vw] p-0"
        style={{
          width: '90vw',
          height: '90vh',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative'
        }}
      >
        {/* 헤더부분 - 고정높이 */}
        <div
          className="p-6 pb-4 border-b border-border"
          style={{
            height: '80px',
            flexShrink: 0,
            position: 'relative',
            zIndex: 100,
            backgroundColor: 'hsl(var(--background))'
          }}
        >
          <div className="flex items-center justify-between h-full">
            <div className="flex items-center gap-3">
              <Button
                onClick={handleClose}
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                type="button"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <DialogTitle>{t('mindMap')}</DialogTitle>
            </div>
            <div className="flex items-center gap-2">
              {!currentMindMap && !isGenerating && (
                <Button onClick={handleGenerate} size="sm">
                  {t('generateMindMap')}
                </Button>
              )}
              {currentMindMap && !isGenerating && (
                <Button onClick={handleGenerate} size="sm" variant="outline">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {t('regenerate')}
                </Button>
              )}
              {isGenerating && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('generating')} ({generationProgress?.progress || 0}%)
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 내용영역 - 자동패딩남은나머지빈간격 */}
        <div
          style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative', zIndex: 1 }}
        >
          {currentMindMap ? (
            <>
              <div style={{ flex: 1, position: 'relative' }}>
                <MindMapCanvas mindMap={currentMindMap} />
              </div>
              <NodeDetailPanel />
            </>
          ) : (
            <div
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              className="text-muted-foreground"
            >
              {isGenerating ? t('generatingMindMap') : t('noMindMapYet')}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
