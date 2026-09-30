import { ReactElement, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '../ui/alert-dialog'

/**
 * One confirmation dialog for every destructive or discard action.
 *
 * This used to be four near-copies (`ConfirmDialog`, `DeleteConfirmDialog`,
 * `DeleteNoteConfirmDialog`, `UnsavedChangesDialog`) split across two primitives:
 * the generic one rendered a normal `Dialog` while the notebook delete used
 * `AlertDialog`, so the same "are you sure?" question looked and behaved
 * differently depending on what was being deleted. Destructive confirmations are
 * always `AlertDialog` — it is the primitive that owns the role, the focus trap,
 * and the escape/overlay contract for an interrupting question.
 */
export interface ConfirmActionDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: 'default' | 'destructive'
  /** Caller-owned busy state; the dialog also tracks an async `onConfirm` itself. */
  isPending?: boolean
}

export default function ConfirmActionDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  confirmVariant = 'destructive',
  isPending
}: ConfirmActionDialogProps): ReactElement {
  const { t } = useTranslation('common')
  const [internalPending, setInternalPending] = useState(false)
  const pending = Boolean(isPending) || internalPending

  const handleConfirm = async (event: React.MouseEvent): Promise<void> => {
    // Keep the dialog mounted until the work finishes, so a slow delete cannot be
    // submitted twice and the reader keeps seeing that something is happening.
    event.preventDefault()
    if (pending) return

    setInternalPending(true)
    try {
      await onConfirm()
    } finally {
      setInternalPending(false)
      onClose()
    }
  }

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel ?? t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={pending}
            className={
              confirmVariant === 'destructive'
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : undefined
            }
          >
            {pending && <Loader2 className="w-4 h-4 animate-spin" />}
            {confirmLabel ?? t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
