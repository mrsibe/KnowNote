import { ReactElement, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import type { Notebook } from '../../types/notebook'
import { Button } from '../ui/button'
import NotebookCard from '../common/NotebookCard'

interface NotebookShelfProps {
  notebooks: Notebook[]
  sourceCounts: Map<string, number>
  onNotebookClick: (id: string) => void
  onNotebookDelete: (id: string) => void
  onNotebookRename: (id: string) => void
  onCreateNotebook: () => void
}

/** How many notebooks the shelf shows before it is expanded. Two rows of three. */
export const SHELF_SIZE = 6

/**
 * "Recent notebooks".
 *
 * It shows the newest few and expands in place to the whole list, because Home is
 * the only place notebooks are browsed: a shelf that showed six and offered no way
 * to the rest would strand every older notebook, with no rename or delete reachable
 * from anywhere. So the control beside the heading is a real disclosure, not a
 * "View all" link pointing at a page that does not exist.
 *
 * Source counts arrive as a map and may be missing while Home is still loading, so
 * a card without one omits the count instead of printing a zero it cannot vouch for.
 */
export default function NotebookShelf({
  notebooks,
  sourceCounts,
  onNotebookClick,
  onNotebookDelete,
  onNotebookRename,
  onCreateNotebook
}: NotebookShelfProps): ReactElement {
  const { t } = useTranslation('ui')
  const [isExpanded, setIsExpanded] = useState(false)

  const visible = isExpanded ? notebooks : notebooks.slice(0, SHELF_SIZE)
  const hasMore = notebooks.length > SHELF_SIZE

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">
          {isExpanded ? t('allNotebooks') : t('recentNotebooks')}
        </h2>
        <div className="flex items-center gap-1">
          {hasMore && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded((expanded) => !expanded)}
            >
              {isExpanded ? t('showRecent') : t('showAll', { count: notebooks.length })}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onCreateNotebook}>
            <Plus className="w-4 h-4" />
            {t('newNotebookAction')}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((notebook) => (
          <NotebookCard
            key={notebook.id}
            notebook={notebook}
            sourceCount={sourceCounts.get(notebook.id)}
            onClick={() => onNotebookClick(notebook.id)}
            onDelete={() => onNotebookDelete(notebook.id)}
            onRename={() => onNotebookRename(notebook.id)}
          />
        ))}
      </div>
    </section>
  )
}
