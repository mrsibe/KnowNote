import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, FileText, Search } from 'lucide-react'
import type { WorkspaceOverviewDocument } from '../../../../shared/types/workspace'
import { isMac } from '../../lib/platform'
import { sourceKindOf, SOURCE_KIND_LABEL } from '../../lib/sourceKind'

interface HomeSearchProps {
  notebooks: Array<{ id: string; title: string }>
  sources: WorkspaceOverviewDocument[]
  onOpenNotebook: (notebookId: string) => void
  onOpenSource: (notebookId: string, documentId: string) => void
}

interface Match {
  key: string
  /** Grouped headings are rendered from this, so the flat list keeps its order. */
  kind: 'notebook' | 'source'
  title: string
  meta: string
  open: () => void
}

/** How many of each group a query may return. More than this is not a launcher. */
const MATCH_LIMIT = 5

/**
 * The Home entry point.
 *
 * What it does today is **filter notebooks and sources by name**, in the renderer,
 * over data Home already has. It is deliberately not wired to retrieval: searching
 * the *text* of the library and asking a question across all notebooks needs a
 * notebook-free search path (`searchChunksFts` is scoped to one notebook, and every
 * notebook has its own vector table), and that is a separate change. The placeholder
 * says what the control actually does until then — a box labelled "ask your
 * knowledge" that quietly only matches titles would be worse than no box.
 *
 * It also owns the `Cmd/Ctrl+K` binding on Home, so the hint it renders is a
 * shortcut that works rather than decoration.
 */
export default function HomeSearch({
  notebooks,
  sources,
  onOpenNotebook,
  onOpenSource
}: HomeSearchProps): ReactElement {
  const { t } = useTranslation('ui')
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const matches = useMemo((): Match[] => {
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return []

    const notebookMatches = notebooks
      .filter((notebook) => notebook.title.toLowerCase().includes(needle))
      .slice(0, MATCH_LIMIT)
      .map((notebook) => ({
        key: `notebook:${notebook.id}`,
        kind: 'notebook' as const,
        title: notebook.title,
        meta: t('notebook'),
        open: () => onOpenNotebook(notebook.id)
      }))

    const sourceMatches = sources
      .filter((document) => document.title.toLowerCase().includes(needle))
      .slice(0, MATCH_LIMIT)
      .map((document) => ({
        key: `source:${document.id}`,
        kind: 'source' as const,
        title: document.title,
        meta: `${document.notebookTitle} · ${t(SOURCE_KIND_LABEL[sourceKindOf(document)])}`,
        open: () => onOpenSource(document.notebookId, document.id)
      }))

    return [...notebookMatches, ...sourceMatches]
  }, [query, notebooks, sources, onOpenNotebook, onOpenSource, t])

  const showPanel = isOpen && query.trim().length > 0

  // A new query is a new list; keeping the old index would highlight an unrelated
  // row. Set from the key handler rather than an effect so the first row is active
  // on the same render the results appear.
  const handleChange = useCallback((value: string): void => {
    setQuery(value)
    setActiveIndex(0)
    setIsOpen(true)
  }, [])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (query.length > 0) {
          setQuery('')
          setActiveIndex(0)
          return
        }
        setIsOpen(false)
        return
      }
      if (matches.length === 0) return

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((index) => (index + 1) % matches.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((index) => (index - 1 + matches.length) % matches.length)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        matches[activeIndex]?.open()
        setIsOpen(false)
      }
    },
    [matches, activeIndex, query.length]
  )

  return (
    <div className="relative">
      <div className="relative flex h-12 items-center rounded-lg border border-border bg-surface-raised transition-colors focus-within:border-ring">
        <Search className="pointer-events-none absolute left-3 w-4 h-4 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => handleChange(event.target.value)}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setIsOpen(false)}
          onKeyDown={handleKeyDown}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          aria-expanded={showPanel}
          aria-controls="home-search-results"
          role="combobox"
          aria-autocomplete="list"
          aria-activedescendant={
            showPanel && matches.length > 0 ? `home-search-option-${activeIndex}` : undefined
          }
          className="h-full w-full bg-transparent pl-9 pr-16 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <kbd className="pointer-events-none absolute right-3 select-none text-[11px] text-subtle-foreground">
          {isMac() ? '⌘ K' : 'Ctrl K'}
        </kbd>
      </div>

      {showPanel && (
        // `onMouseDown` is prevented so the click does not blur the input first and
        // unmount the row that was clicked.
        <div
          id="home-search-results"
          role="listbox"
          aria-label={t('searchResults')}
          className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-surface-overlay p-1 shadow-elevation"
        >
          {matches.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">{t('searchNoResults')}</p>
          ) : (
            matches.map((match, index) => (
              <button
                key={match.key}
                id={`home-search-option-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  match.open()
                  setIsOpen(false)
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                  index === activeIndex ? 'bg-surface-selected' : 'hover:bg-surface-hover'
                }`}
              >
                {match.kind === 'notebook' ? (
                  <BookOpen className="w-4 h-4 shrink-0 text-muted-foreground" />
                ) : (
                  <FileText className="w-4 h-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {match.title}
                </span>
                <span className="shrink-0 truncate text-xs text-subtle-foreground">
                  {match.meta}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
