import { ReactElement, useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KnowledgeSearchResult } from '../../../../../shared/types/knowledge'
import { useNotebookStore } from '../../../store/notebookStore'
import { useSourceAnchorNavigation } from '../../../hooks/useSourceAnchorNavigation'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'

/**
 * Global search (#96).
 *
 * Two signals, presented separately and never fused: **matching text** is FTS/BM25
 * over the chunks — the only thing that finds an exact model name, id or number —
 * and **related passages** is vector search, which finds a paraphrase with no shared
 * words. Blending them into one score would hide which one answered the question.
 *
 * Chat retrieval (#77) *does* fuse them, because the model needs one ordered list.
 * The two must not share ranking semantics.
 */
export default function SearchPalette(): ReactElement | null {
  const { t } = useTranslation('ui')
  const currentNotebook = useNotebookStore((state) => state.currentNotebook)
  const { openSourceAnchor } = useSourceAnchorNavigation()

  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [literal, setLiteral] = useState<KnowledgeSearchResult[]>([])
  const [semantic, setSemantic] = useState<KnowledgeSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const notebookId = currentNotebook?.id

  const close = useCallback((): void => {
    setIsOpen(false)
    setQuery('')
    setLiteral([])
    setSemantic([])
  }, [])

  // Ctrl/Cmd+K opens from anywhere in the notebook; Escape closes.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setIsOpen((open) => !open)
        return
      }
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (isOpen) inputRef.current?.focus()
  }, [isOpen])

  // Debounced search. Both signals run for the same query; neither blocks the other
  // from showing what it found. State is only written from the async continuation —
  // an empty query simply stops the search and the results are hidden by `hasQuery`.
  useEffect(() => {
    if (!isOpen || !notebookId || query.trim().length === 0) return

    let cancelled = false
    const timer = setTimeout(async () => {
      setIsSearching(true)
      try {
        const [textResult, semanticResult] = await Promise.all([
          window.api.knowledge.searchText(notebookId, query, { limit: 10 }),
          window.api.knowledge.search(notebookId, query, { topK: 10, includeContent: true })
        ])
        if (cancelled) return
        if (textResult.success) setLiteral(textResult.results as KnowledgeSearchResult[])
        if (semanticResult.success) setSemantic(semanticResult.results as KnowledgeSearchResult[])
      } finally {
        if (!cancelled) setIsSearching(false)
      }
    }, 200)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [isOpen, notebookId, query])

  const openHit = (hit: KnowledgeSearchResult): void => {
    const block = hit.locator?.blocks[0]
    openSourceAnchor(
      {
        documentId: hit.documentId,
        location: {
          documentId: hit.documentId,
          page: hit.locator?.pageStart ?? block?.page ?? undefined,
          blockId: block?.blockId,
          startOffset: block?.startOffset,
          endOffset: block?.endOffset
        }
      },
      // The palette is unmounting as the reader opens; there is no origin element
      // to return focus to, so the reader owns the focus handoff.
      document.body
    )
    close()
  }

  if (!isOpen) return null

  const hasQuery = query.trim().length > 0
  // Stale results may still sit in state after the box is cleared; they are never
  // shown, so there is nothing to reset from inside an effect.
  const literalHits = hasQuery ? literal : []
  const semanticHits = hasQuery ? semantic : []
  const noResults =
    hasQuery && !isSearching && literalHits.length === 0 && semanticHits.length === 0

  const renderGroup = (label: string, hits: KnowledgeSearchResult[]): ReactElement | null => {
    if (hits.length === 0) return null
    return (
      <div className="mt-2">
        <p className="px-3 py-1 text-xs text-subtle-foreground">{label}</p>
        <ul>
          {hits.map((hit) => (
            <li key={`${hit.documentId}:${hit.chunkId}`}>
              <Button
                type="button"
                variant="ghost"
                onClick={() => openHit(hit)}
                className="h-auto w-full flex-col items-start gap-0.5 px-3 py-2 text-left font-normal"
              >
                <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
                  <FileText className="w-3 h-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{hit.documentTitle}</span>
                  {typeof hit.locator?.pageStart === 'number' && (
                    <span className="shrink-0 text-subtle-foreground">
                      {t('searchPage', { page: hit.locator.pageStart })}
                    </span>
                  )}
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{hit.content}</span>
              </Button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-scrim" onClick={close} />
      <div className="fixed left-1/2 top-24 z-50 w-[min(40rem,90vw)] -translate-x-1/2 rounded-lg border border-border bg-surface-overlay shadow-elevation">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="w-4 h-4 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-8 border-0 bg-transparent p-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>

        <div className="max-h-[60vh] overflow-y-auto pb-2">
          {!hasQuery && (
            <p className="px-3 py-3 text-xs text-subtle-foreground">{t('searchHint')}</p>
          )}
          {noResults && (
            <p className="px-3 py-3 text-xs text-subtle-foreground">{t('searchNoResults')}</p>
          )}
          {renderGroup(t('searchMatchingText'), literalHits)}
          {renderGroup(t('searchRelatedPassages'), semanticHits)}
        </div>
      </div>
    </>
  )
}
