import { ScrollArea } from '../../ui/scroll-area'
import { Button } from '../../ui/button'
import { X, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useMindMapStore } from '../../../store/mindmapStore'
import { useChatStore } from '../../../store/chatStore'
import ReactMarkdown from 'react-markdown'

export default function NodeDetailPanel() {
  const { t } = useTranslation('notebook')
  const { selectedNodeId, nodeChunks, setSelectedNodeId, setNodeChunks, setDialogOpen } =
    useMindMapStore()
  const { currentSession, sendMessage } = useChatStore()

  if (!selectedNodeId || !nodeChunks) return null

  const handleClose = () => {
    setSelectedNodeId(null)
    setNodeChunks(null)
  }

  const handleAskQuestion = async (chunkContent: string) => {
    if (!currentSession) return

    const question = `기반이하내용,요청상세설명:\n\n${chunkContent}`
    await sendMessage(currentSession.id, question)

    // 닫기마인드맵Dialog,집중포커스에대화패널
    setDialogOpen(false)
  }

  return (
    <div className="w-96 border-l border-border flex flex-col bg-background">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h3 className="font-semibold text-sm">{t('nodeSource')}</h3>
        <Button variant="ghost" size="icon" className="w-8 h-8" onClick={handleClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 p-4">
        {nodeChunks.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('noSourceContent')}</p>
        ) : (
          <div className="space-y-4">
            {nodeChunks.map((chunk) => (
              <div key={chunk.id} className="border border-border rounded-lg p-3 space-y-2">
                <div className="text-xs text-muted-foreground">
                  {t('source')}: {chunk.documentTitle}
                </div>
                <div className="text-sm prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown>{chunk.content}</ReactMarkdown>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => handleAskQuestion(chunk.content)}
                >
                  <MessageSquare className="w-3 h-3 mr-2" />
                  {t('askInDepth')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
