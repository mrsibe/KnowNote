import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { LibrarySourceSummary } from '../../../../../shared/types/knowledge'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { ScrollArea } from '../../ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '../../ui/dialog'
import ConfirmActionDialog from '../../common/ConfirmActionDialog'

interface LibrarySourceDialogProps {
  notebookId: string
  onClose: () => void
  onAdded: () => Promise<void>
}

export default function LibrarySourceDialog({
  notebookId,
  onClose,
  onAdded
}: LibrarySourceDialogProps) {
  const { t } = useTranslation('ui')
  const [sources, setSources] = useState<LibrarySourceSummary[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<LibrarySourceSummary | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    window.api.knowledge.listLibrarySources(notebookId).then(
      (items) => {
        if (!cancelled) {
          setSources(items)
          setLoading(false)
        }
      },
      (reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason))
          setLoading(false)
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [notebookId, reload])

  const attach = async (source: LibrarySourceSummary) => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.knowledge.attachLibrarySource(notebookId, source.id)
      if (!result.success) throw new Error(result.error || t('unknownError'))
      await onAdded()
      toast.success(t(result.indexed ? 'librarySourceAdded' : 'librarySourceAddedPending'))
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const deleteUnused = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      const result = await window.api.knowledge.deleteLibrarySource(deleting.id, true)
      if (!result.success) throw new Error(result.error || t('unknownError'))
      setSources((items) => items.filter((item) => item.id !== deleting.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const matches = sources.filter((source) =>
    source.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  )

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t('fromLibrary')}</DialogTitle>
          <DialogDescription>{t('fromLibraryDesc')}</DialogDescription>
        </DialogHeader>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          disabled={busy}
        />
        {error && (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{error}</p>
            <Button
              variant="secondary"
              disabled={busy || loading}
              onClick={() => {
                setLoading(true)
                setError(null)
                setReload((value) => value + 1)
              }}
            >
              {t('libraryRetry')}
            </Button>
          </div>
        )}
        <ScrollArea className="max-h-80">
          {loading ? (
            <div role="status" className="flex justify-center py-8">
              <Loader2
                className="h-5 w-5 animate-spin text-muted-foreground"
                aria-label={t('processing')}
              />
            </div>
          ) : matches.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              {t(query ? 'searchNoResults' : 'libraryNoSources')}
            </p>
          ) : (
            <ul className="space-y-1">
              {matches.map((source) => (
                <li
                  key={source.id}
                  className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-hover"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground" title={source.title}>
                      {source.title}
                    </p>
                    <p className="text-xs text-subtle-foreground">
                      {t(
                        !source.hasContent
                          ? 'libraryNotParsed'
                          : source.canReuseIndex
                            ? 'libraryIndexReusable'
                            : 'libraryIndexRequired'
                      )}
                    </p>
                    <p className="text-xs text-subtle-foreground">
                      {t('libraryMemberships', { count: source.membershipCount })}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || !source.hasContent}
                    onClick={() => void attach(source)}
                  >
                    {t('add')}
                  </Button>
                  {source.membershipCount === 0 && (
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={busy}
                      title={t('deleteLibrarySource')}
                      aria-label={t('deleteLibrarySource')}
                      onClick={() => setDeleting(source)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
        <ConfirmActionDialog
          isOpen={deleting !== null}
          onClose={() => setDeleting(null)}
          onConfirm={deleteUnused}
          title={t('deleteLibrarySource')}
          description={t('confirmDeleteLibrarySource', { title: deleting?.title })}
          confirmLabel={t('common:delete')}
          isPending={busy}
        />
      </DialogContent>
    </Dialog>
  )
}
