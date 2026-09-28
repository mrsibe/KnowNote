import { ReactElement } from 'react'
import { BookOpen, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Notebook } from '../../types/notebook'
import { formatRelativeDate } from '../../lib/relativeDate'
import { Card } from '../ui/card'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '../ui/context-menu'

interface NotebookCardProps {
  notebook: Notebook
  /**
   * How many sources it holds. Optional: Home may render the shelf from the
   * notebook store before the overview has answered, and a count is not something
   * to guess — without it the meta line shows just the date.
   */
  sourceCount?: number
  onClick: () => void
  onDelete: () => void
  onRename: () => void
}

/*
 * A notebook on the Home shelf.
 *
 * The name is the subject and everything else is demoted: no description (every
 * notebook carries the same creation-time filler, and nothing can author one — see
 * `NotebookHeader`), the source count and the date merged into one T3 line, and no
 * resting buttons. Rename and delete live in the context menu, which is where the
 * note list already keeps its per-row actions; a footer of icons was what made the
 * shelf read as a row of identical toolbars.
 *
 * DESIGN.md forbids colour-coded cards, so the vertical accent stripe this card
 * used to draw from `--chart-*` is gone: color marks state and action, not
 * identity.
 */
export default function NotebookCard({
  notebook,
  sourceCount,
  onClick,
  onDelete,
  onRename
}: NotebookCardProps): ReactElement {
  const { t, i18n } = useTranslation('ui')

  const meta = [
    sourceCount === undefined ? null : t('sourceCount', { count: sourceCount }),
    formatRelativeDate(notebook.updatedAt, t, i18n.language)
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Card
          onClick={onClick}
          className="group relative flex h-[148px] cursor-pointer flex-col justify-between overflow-hidden p-4 transition-[transform,box-shadow] duration-150 hover:-translate-y-px hover:shadow-control"
        >
          {/*
            Hover fill as an overlay, not as `hover:bg-surface-hover` on the card
            itself: the card is opaque `surface-raised`, so replacing its
            background with the translucent token would make it almost the same
            lightness as the page behind it in dark mode — an invisible hover.
            Compositing keeps it visible in both themes.
          */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-surface-hover opacity-0 transition-opacity group-hover:opacity-100"
          />

          <div className="relative flex h-9 w-9 items-center justify-center rounded-md bg-muted">
            <BookOpen className="w-4 h-4 text-muted-foreground" />
          </div>

          <div className="relative min-w-0">
            <h3 className="truncate text-base font-medium text-foreground">{notebook.title}</h3>
            <p className="mt-1 truncate text-xs text-subtle-foreground">{meta}</p>
          </div>
        </Card>
      </ContextMenuTrigger>

      {/* 右键菜单 */}
      <ContextMenuContent>
        <ContextMenuItem
          onClick={(e) => {
            e.stopPropagation()
            onRename()
          }}
        >
          <Pencil className="w-4 h-4 mr-2" />
          {t('renameNotebook')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="w-4 h-4 mr-2" />
          {t('deleteNotebook')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
