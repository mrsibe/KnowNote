import { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, MessageSquare, type LucideIcon } from 'lucide-react'
import type {
  WorkspaceOverviewDocument,
  WorkspaceOverviewSession
} from '../../../../shared/types/workspace'
import type { RecentlyOpenedNotebook } from '../../lib/recentlyOpened'
import { formatRelativeDate } from '../../lib/relativeDate'
import { sourceKindOf, SOURCE_KIND_LABEL } from '../../lib/sourceKind'
import { SOURCE_KIND_ICON } from '../common/sourceIcon'

/**
 * A Home row: glyph, subject, demoted metadata.
 *
 * "Continue" and "Recently added" are both lists of *things that are not
 * notebooks*, so they share one row rather than two almost-identical ones. The
 * difference between them is what they are ordered by and what the metadata says,
 * not how a row looks.
 */
function HomeRow({
  icon: Icon,
  title,
  meta,
  onClick
}: {
  icon: LucideIcon
  title: string
  meta: string
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{title}</span>
      <span className="shrink-0 truncate text-xs text-subtle-foreground">{meta}</span>
    </button>
  )
}

interface ContinueSectionProps {
  /** The most recently touched active conversation, or null if there is none. */
  session: WorkspaceOverviewSession | null
  /** Recently opened notebooks, newest first. */
  openedNotebooks: RecentlyOpenedNotebook[]
  /** Resolves ids to titles. A notebook that no longer exists simply drops out. */
  notebooksById: Map<string, { id: string; title: string; sourceCount?: number }>
  onOpenNotebook: (notebookId: string) => void
}

interface ContinueEntry {
  key: string
  icon: LucideIcon
  title: string
  meta: string
  /** Milliseconds, used only to order the rows. */
  at: number
  open: () => void
}

/** How many rows "Continue" shows. Three is a reminder, not a history. */
const CONTINUE_LIMIT = 3

/**
 * "Continue" — where the user was, which is not the same question as "what changed".
 *
 * The Recent shelf is ordered by `notebooks.updatedAt`, so a notebook the user
 * renamed last week outranks the one they were reading an hour ago. This section is
 * ordered by *their* activity instead: the notebooks they opened (recorded in
 * `lib/recentlyOpened.ts`) and the conversation last written to, merged into one
 * list by real recency so the top row is the truest answer to "where was I".
 *
 * Continue *reading* is not here. Resuming a source needs the reading location
 * recorded alongside the open, and a row that can silently vanish when the source
 * falls outside the overview's window would be worse than no row. That is a
 * separate change with its own persistence.
 */
export default function ContinueSection({
  session,
  openedNotebooks,
  notebooksById,
  onOpenNotebook
}: ContinueSectionProps): ReactElement | null {
  const { t, i18n } = useTranslation('ui')

  const entries: ContinueEntry[] = []

  for (const entry of openedNotebooks) {
    const notebook = notebooksById.get(entry.notebookId)
    if (!notebook) continue
    entries.push({
      key: `notebook:${notebook.id}`,
      icon: BookOpen,
      title: notebook.title,
      meta: [
        notebook.sourceCount === undefined
          ? null
          : t('sourceCount', { count: notebook.sourceCount }),
        formatRelativeDate(new Date(entry.at), t, i18n.language)
      ]
        .filter((part): part is string => part !== null)
        .join(' · '),
      at: entry.at,
      open: () => onOpenNotebook(notebook.id)
    })
  }

  if (session) {
    entries.push({
      key: `session:${session.id}`,
      icon: MessageSquare,
      title: session.title,
      meta: `${session.notebookTitle} · ${formatRelativeDate(session.updatedAt, t, i18n.language)}`,
      at: session.updatedAt.getTime(),
      open: () => onOpenNotebook(session.notebookId)
    })
  }

  const visible = entries.sort((a, b) => b.at - a.at).slice(0, CONTINUE_LIMIT)
  if (visible.length === 0) return null

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-foreground">{t('continueSection')}</h2>
      <div className="flex flex-col gap-1">
        {visible.map((entry) => (
          <HomeRow
            key={entry.key}
            icon={entry.icon}
            title={entry.title}
            meta={entry.meta}
            onClick={entry.open}
          />
        ))}
      </div>
    </section>
  )
}

interface RecentSourcesProps {
  documents: WorkspaceOverviewDocument[]
  onOpenSource: (notebookId: string, documentId: string) => void
}

/** How many sources the list shows. A reminder of what arrived, not a browser. */
const RECENT_SOURCE_LIMIT = 6

/**
 * "Recently added" — the newest sources across every notebook.
 *
 * A list, not cards. Notebooks already use cards on this page, and repeating one
 * container for a different kind of thing is what makes a launcher read as a wall of
 * identical boxes: the same grammar for every object hides the difference between
 * "a place you work" and "a file that arrived".
 */
export function RecentSources({
  documents,
  onOpenSource
}: RecentSourcesProps): ReactElement | null {
  const { t, i18n } = useTranslation('ui')

  const visible = documents.slice(0, RECENT_SOURCE_LIMIT)
  if (visible.length === 0) return null

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-foreground">{t('recentlyAdded')}</h2>
      <div className="flex flex-col gap-1">
        {visible.map((document) => {
          const kind = sourceKindOf(document)
          return (
            <HomeRow
              key={document.id}
              icon={SOURCE_KIND_ICON[kind]}
              title={document.title}
              meta={`${document.notebookTitle} · ${t(SOURCE_KIND_LABEL[kind])} · ${formatRelativeDate(
                document.createdAt,
                t,
                i18n.language
              )}`}
              onClick={() => onOpenSource(document.notebookId, document.id)}
            />
          )
        })}
      </div>
    </section>
  )
}
