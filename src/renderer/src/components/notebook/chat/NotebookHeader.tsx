import { ReactElement, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Notebook } from '../../../types/notebook'
import { formatRelativeDate } from '../../../lib/relativeDate'
import { Input } from '../../ui/input'

interface NotebookHeaderProps {
  notebook: Notebook
  /** How many sources are in this notebook, for the metadata line. */
  sourceCount: number
  onRename: (title: string) => void | Promise<void>
}

/**
 * The notebook's document header (#65).
 *
 * The name used to be a `text-sm` label in the panel header, which is window
 * chrome: it made the workspace read as a tool window with a title bar rather
 * than as a document. The title now lives in the page, at `text-3xl`, and the
 * panel header above it carries nothing but the panel toggles — the notebook's
 * name is still always on screen, in the window's tab strip.
 *
 * It is rendered as the first block of the transcript's scroll area rather than
 * pinned above it, so it scrolls away with the answer the way a page title does.
 * That also keeps the transcript's geometry untouched: the scroll area, the
 * measured composer reserve and the follow-the-answer behaviour all read the same
 * boxes they read before.
 *
 * There is no subtitle. `notebooks.description` exists in the schema, but nothing
 * in the app can author one — every notebook carries the same creation-time
 * filler from `t('notebookDescription')`, so rendering it here would print a
 * sentence the user never wrote. Add the line when the field is editable.
 */
export default function NotebookHeader({
  notebook,
  sourceCount,
  onRename
}: NotebookHeaderProps): ReactElement {
  const { t, i18n } = useTranslation('ui')
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const startEditing = (): void => {
    setDraft(notebook.title)
    setIsEditing(true)
  }

  const save = async (): Promise<void> => {
    const next = draft.trim()
    setIsEditing(false)
    if (!next || next === notebook.title) return
    await onRename(next)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void save()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setIsEditing(false)
    }
  }

  return (
    <header className="pt-6 pb-2">
      {isEditing ? (
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void save()}
          onKeyDown={handleKeyDown}
          autoFocus
          aria-label={t('notebook:notebookName')}
          className="h-auto w-full rounded-md border-0 bg-transparent p-0 text-3xl font-semibold tracking-tight focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      ) : (
        // A button, not a span with a click handler: the title is the way into
        // renaming, so it has to be reachable and activatable by keyboard. The
        // text cursor is the affordance — the title must not look like a control
        // sitting on a document, so it takes no resting border and no hover fill.
        <button
          type="button"
          onClick={startEditing}
          title={t('clickToEditTitle')}
          className="block w-full cursor-text rounded-md text-left text-3xl font-semibold tracking-tight break-words text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {notebook.title}
        </button>
      )}

      <p className="mt-2 text-xs text-subtle-foreground">
        {t('sourceCount', { count: sourceCount })}
        <span aria-hidden="true"> · </span>
        {formatRelativeDate(notebook.updatedAt, t, i18n.language)}
      </p>
    </header>
  )
}
