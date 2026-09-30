import { ReactElement, useCallback, useEffect, useRef, useState } from 'react'
import { Archive, Check, MessageSquare, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatMessageSearchHit } from '../../../../../shared/types/chat'
import { useChatStore } from '../../../store/chatStore'
import { useNotebookStore } from '../../../store/notebookStore'
import { useDismissOnOutsidePointer } from '../../../hooks/useDismissOnOutsidePointer'
import { formatRelativeDate } from '../../../lib/relativeDate'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'

/**
 * The notebook's chat sessions (#97).
 *
 * A notebook used to hold exactly one conversation, and `SessionAutoSwitchService`
 * rolled it over silently. This is the surface that makes the many-session model
 * real: a list beside the chat zone, `+ New chat`, per-session rename and delete,
 * and a search over message bodies — because the thing a reader remembers is what
 * was said, not the label that was put on the thread.
 *
 * The panel is anchored to the chat card rather than opened as a dialog: it is a
 * view of the current workspace, so the transcript stays visible behind it and
 * escaping it never hides where the reader was.
 */
export default function SessionSwitcher(): ReactElement {
  const { t, i18n } = useTranslation(['ui', 'chat', 'common'])
  const currentSession = useChatStore((state) => state.currentSession)
  const sessions = useChatStore((state) => state.sessions)
  const loadSessions = useChatStore((state) => state.loadSessions)
  const openSession = useChatStore((state) => state.openSession)
  const createSession = useChatStore((state) => state.createSession)
  const deleteSession = useChatStore((state) => state.deleteSession)
  const renameSession = useChatStore((state) => state.renameSession)
  const searchMessages = useChatStore((state) => state.searchMessages)
  const currentNotebook = useNotebookStore((state) => state.currentNotebook)

  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ChatMessageSearchHit[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const notebookId = currentNotebook?.id ?? currentSession?.notebookId
  const hasQuery = query.trim().length > 0

  const close = useCallback((): void => {
    setIsOpen(false)
    setQuery('')
    setHits([])
    setRenamingId(null)
    setConfirmingId(null)
  }, [])

  // Opening the list reads the authoritative order; the store may hold a stale one
  // after a rollover or a rename from elsewhere.
  useEffect(() => {
    if (isOpen && notebookId) void loadSessions(notebookId)
  }, [isOpen, notebookId, loadSessions])

  useEffect(() => {
    if (isOpen) searchRef.current?.focus()
  }, [isOpen])

  // A press anywhere outside the button or the panel closes it. This replaces the
  // full-viewport overlay, whose clicks the draggable panel header could swallow.
  useDismissOnOutsidePointer(isOpen, [triggerRef, panelRef], close)

  // Escape closes the panel. The rename input handles Escape itself and stops
  // nothing else, so this is the one place the whole panel closes.
  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, close])

  // Search message bodies, debounced. The list and the search are the same
  // surface: clearing the box returns to the sessions, it does not close it.
  // Stale results are never cleared here — they are hidden by `hasQuery` instead,
  // so an empty box does not synchronously set state from an effect.
  useEffect(() => {
    if (!isOpen || !notebookId || !hasQuery) return

    let cancelled = false
    const timer = setTimeout(async () => {
      setIsSearching(true)
      try {
        const result = await searchMessages(notebookId, query)
        if (!cancelled) setHits(result)
      } finally {
        if (!cancelled) setIsSearching(false)
      }
    }, 200)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [isOpen, notebookId, hasQuery, query, searchMessages])

  if (!currentSession) return <></>

  const titleOf = (session: (typeof sessions)[number]): string =>
    session.title.trim() || t('chat:untitledSession')

  const handleOpen = (sessionId: string): void => {
    close()
    void openSession(sessionId)
  }

  const handleNewChat = (): void => {
    if (!notebookId) return
    close()
    void createSession(notebookId, '')
  }

  const startRename = (sessionId: string, title: string): void => {
    setConfirmingId(null)
    setRenamingId(sessionId)
    setRenameValue(title)
  }

  const commitRename = (): void => {
    if (renamingId) void renameSession(renamingId, renameValue)
    setRenamingId(null)
  }

  const handleDelete = (sessionId: string): void => {
    setConfirmingId(null)
    void deleteSession(sessionId)
  }

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => (isOpen ? close() : setIsOpen(true))}
        title={t('chat:sessions')}
        aria-expanded={isOpen}
        className="h-8 min-w-0 max-w-full gap-1.5 px-2 text-xs font-normal"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{titleOf(currentSession)}</span>
        {currentSession.status === 'archived' && (
          <Archive className="h-3 w-3 shrink-0 text-subtle-foreground" />
        )}
      </Button>

      {isOpen && (
        <>
          <div
            ref={panelRef}
            role="dialog"
            aria-label={t('chat:sessions')}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="absolute left-2 top-11 z-40 flex max-h-[calc(100%-3rem)] w-[min(24rem,calc(100%-1rem))] flex-col overflow-hidden rounded-lg border border-border bg-surface-overlay shadow-elevation"
          >
            <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('chat:searchSessionsPlaceholder')}
                className="h-7 border-0 bg-transparent p-0 text-xs focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleNewChat}
                className="h-7 shrink-0 gap-1 px-2 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('chat:newChatTitle')}
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto py-1 themed-scrollbar">
              {hasQuery ? (
                <SearchResults
                  hits={hits}
                  isSearching={isSearching}
                  onOpen={handleOpen}
                  formatDate={(date) => formatRelativeDate(date, t, i18n.language)}
                />
              ) : (
                <ul>
                  {sessions.map((session) => (
                    <li key={session.id}>
                      {renamingId === session.id ? (
                        <div className="flex items-center gap-1 px-2 py-1">
                          <Input
                            autoFocus
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') commitRename()
                              if (event.key === 'Escape') {
                                event.stopPropagation()
                                setRenamingId(null)
                              }
                            }}
                            className="h-7 text-xs"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={commitRename}
                            title={t('common:save')}
                            className="h-7 w-7 shrink-0"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setRenamingId(null)}
                            title={t('common:cancel')}
                            className="h-7 w-7 shrink-0"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : confirmingId === session.id ? (
                        <div className="px-2 py-1.5">
                          <p className="mb-1.5 text-xs text-muted-foreground">
                            {t('chat:deleteSessionConfirm', { title: titleOf(session) })}
                          </p>
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmingId(null)}
                              className="h-7 px-2 text-xs"
                            >
                              {t('common:cancel')}
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => handleDelete(session.id)}
                              className="h-7 px-2 text-xs"
                            >
                              {t('common:delete')}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="group flex items-center gap-1 rounded-md px-1 hover:bg-accent">
                          <button
                            type="button"
                            onClick={() => handleOpen(session.id)}
                            className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md px-1.5 py-1.5 text-left"
                          >
                            <span className="flex w-full min-w-0 items-center gap-1.5">
                              <span className="truncate text-xs font-medium text-foreground">
                                {titleOf(session)}
                              </span>
                              {session.status === 'archived' && (
                                <span className="shrink-0 rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
                                  {t('chat:sessionArchived')}
                                </span>
                              )}
                            </span>
                            <span className="text-xs text-subtle-foreground">
                              {formatRelativeDate(
                                session.lastOpenedAt ?? session.updatedAt,
                                t,
                                i18n.language
                              )}
                            </span>
                          </button>
                          {session.id === currentSession.id && (
                            <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => startRename(session.id, session.title)}
                            title={t('chat:renameSession')}
                            className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setRenamingId(null)
                              setConfirmingId(session.id)
                            }}
                            title={t('chat:deleteSession')}
                            className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}

function SearchResults({
  hits,
  isSearching,
  onOpen,
  formatDate
}: {
  hits: ChatMessageSearchHit[]
  isSearching: boolean
  onOpen: (sessionId: string) => void
  formatDate: (date: Date) => string
}): ReactElement {
  const { t } = useTranslation(['chat', 'ui'])

  if (!isSearching && hits.length === 0) {
    return (
      <p className="px-3 py-3 text-xs text-subtle-foreground">{t('chat:sessionSearchNoResults')}</p>
    )
  }

  return (
    <div>
      <p className="px-3 py-1 text-xs uppercase tracking-wide text-subtle-foreground">
        {t('chat:sessionSearchHeading')}
      </p>
      <ul>
        {hits.map((hit) => (
          <li key={hit.id}>
            <button
              type="button"
              onClick={() => onOpen(hit.sessionId)}
              className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left hover:bg-accent"
            >
              <span className="flex w-full min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
                <span className="truncate">
                  {hit.sessionTitle.trim() || t('chat:untitledSession')}
                </span>
                <span className="shrink-0 text-xs font-normal text-subtle-foreground">
                  {formatDate(new Date(hit.createdAt))}
                </span>
              </span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{hit.content}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
