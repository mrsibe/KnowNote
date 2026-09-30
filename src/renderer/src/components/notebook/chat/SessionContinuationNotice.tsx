import { ReactElement } from 'react'
import { Archive, ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../../store/chatStore'
import { Button } from '../../ui/button'

/**
 * The visible archive boundary of an automatic rollover (#97).
 *
 * When a session approaches the context budget, `SessionAutoSwitchService` archives
 * it and continues in a new one. That used to be invisible: the reader was moved to
 * a new thread and the old one could not be reached, so context appeared to vanish.
 *
 * The banner is rendered from `parentSessionId`, not from a one-shot event, so it
 * survives a reload: a session that was continued *is* a continuation, whenever it
 * is opened.
 */
export default function SessionContinuationNotice(): ReactElement | null {
  const { t } = useTranslation(['chat', 'ui'])
  const currentSession = useChatStore((state) => state.currentSession)
  const sessions = useChatStore((state) => state.sessions)
  const openSession = useChatStore((state) => state.openSession)

  const parentId = currentSession?.parentSessionId
  if (!currentSession || !parentId) return null

  const parent = sessions.find((session) => session.id === parentId)
  const parentTitle = parent?.title.trim() || t('chat:untitledSession')

  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2">
      <Archive className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">
          {t('chat:continuedFrom', { title: parentTitle })}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void openSession(parentId)}
          className="mt-1 h-7 gap-1.5 px-2 text-xs"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('chat:openArchivedSession')}
        </Button>
      </div>
    </div>
  )
}
