import { ReactElement, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, Plus } from 'lucide-react'
import { ScrollArea } from '../ui/scroll-area'
import { Button } from '../ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '../ui/empty'
import type { Notebook } from '../../types/notebook'
import type { WorkspaceOverview } from '../../../../shared/types/workspace'
import type { RecentlyOpenedNotebook } from '../../lib/recentlyOpened'
import HomeSearch from './HomeSearch'
import NotebookShelf from './NotebookShelf'
import ContinueSection, { RecentSources } from './HomeSections'

interface HomeProps {
  notebooks: Notebook[]
  /** Null until the overview answers. Sections that need it render when it arrives. */
  overview: WorkspaceOverview | null
  /** What the user opened, newest first. Read from storage by the page. */
  recentlyOpened: RecentlyOpenedNotebook[]
  onNotebookClick: (id: string) => void
  onNotebookDelete: (id: string) => void
  onNotebookRename: (id: string) => void
  onCreateNotebook: () => void
  onOpenSource: (notebookId: string, documentId: string) => void
}

/** Morning / afternoon / evening, decided once per render. */
function greetingKey(hour: number): string {
  if (hour < 12) return 'goodMorning'
  if (hour < 18) return 'goodAfternoon'
  return 'goodEvening'
}

/**
 * Home — a starting desk, not a dashboard.
 *
 * Four sections at most, in the order they are used: a greeting, the search entry,
 * the notebooks, then what the user was doing and what recently arrived. The
 * greeting is small on purpose; the entry below it is the thing the eye should land
 * on, because a long-lived tool's Home is opened a hundred times and a hero banner
 * is paid for on every one of them.
 *
 * Every section is allowed to render nothing. A workspace with no conversations and
 * no sources shows a greeting, a search box and the shelf — not four empty boxes
 * with headings, which is what a launcher looks like when it is designed from a
 * template rather than from what the user actually has.
 */
export default function Home({
  notebooks,
  overview,
  recentlyOpened,
  onNotebookClick,
  onNotebookDelete,
  onNotebookRename,
  onCreateNotebook,
  onOpenSource
}: HomeProps): ReactElement {
  const { t } = useTranslation('ui')

  // Counts live in the overview; the notebook list itself comes from the store, so a
  // rename or a delete is reflected immediately instead of after a refetch.
  const sourceCounts = useMemo(
    () =>
      new Map((overview?.notebooks ?? []).map((notebook) => [notebook.id, notebook.sourceCount])),
    [overview]
  )

  const notebooksById = useMemo(
    () =>
      new Map(
        notebooks.map((notebook) => [
          notebook.id,
          { id: notebook.id, title: notebook.title, sourceCount: sourceCounts.get(notebook.id) }
        ])
      ),
    [notebooks, sourceCounts]
  )

  const header = (
    <header>
      <h1 className="text-xl font-medium tracking-tight text-foreground">
        {t(greetingKey(new Date().getHours()))}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('homePrompt')}</p>
    </header>
  )

  if (notebooks.length === 0) {
    return (
      <ScrollArea className="flex-1">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
          {header}
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BookOpen className="w-6 h-6" />
              </EmptyMedia>
              <EmptyTitle>{t('noNotebooks')}</EmptyTitle>
              <EmptyDescription>{t('noNotebooksDesc')}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={onCreateNotebook}>
                <Plus className="w-4 h-4" />
                {t('createFirstNotebook')}
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      </ScrollArea>
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-10">
        {header}

        <HomeSearch
          notebooks={notebooks}
          sources={overview?.recentDocuments ?? []}
          onOpenNotebook={onNotebookClick}
          onOpenSource={onOpenSource}
        />

        <NotebookShelf
          notebooks={notebooks}
          sourceCounts={sourceCounts}
          onNotebookClick={onNotebookClick}
          onNotebookDelete={onNotebookDelete}
          onNotebookRename={onNotebookRename}
          onCreateNotebook={onCreateNotebook}
        />

        <ContinueSection
          session={overview?.recentSessions[0] ?? null}
          openedNotebooks={recentlyOpened}
          notebooksById={notebooksById}
          onOpenNotebook={onNotebookClick}
        />

        <RecentSources documents={overview?.recentDocuments ?? []} onOpenSource={onOpenSource} />
      </div>
    </ScrollArea>
  )
}
