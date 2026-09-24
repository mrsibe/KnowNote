import { useState, ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Field, FieldLabel } from '../ui/field'

interface RenameDialogProps {
  isOpen: boolean
  currentTitle: string
  onClose: () => void
  onConfirm: (newTitle: string) => void
}

export default function RenameDialog({
  isOpen,
  currentTitle,
  onClose,
  onConfirm
}: RenameDialogProps): ReactElement | null {
  const { t } = useTranslation(['common', 'notebook'])
  const [title, setTitle] = useState(currentTitle)

  // 当外部标题变化时重置输入框（React 推荐的 render 期间调整模式，避免 effect 级联渲染）
  const [syncedTitle, setSyncedTitle] = useState(currentTitle)
  if (syncedTitle !== currentTitle) {
    setSyncedTitle(currentTitle)
    setTitle(currentTitle)
  }

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    const trimmedTitle = title.trim()
    if (trimmedTitle && trimmedTitle !== currentTitle) {
      onConfirm(trimmedTitle)
      onClose()
    }
  }

  const canSubmit = title.trim() && title.trim() !== currentTitle

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md **:data-radix-dialog-close:text-foreground **:data-radix-dialog-close:opacity-100">
        <DialogHeader>
          <DialogTitle className="text-foreground">{t('notebook:renameNotebook')}</DialogTitle>
          <DialogDescription>{t('notebook:enterNotebookName')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <Field>
            <FieldLabel htmlFor="notebook-title" className="text-foreground">
              {t('notebook:notebookName')}
            </FieldLabel>
            <Input
              id="notebook-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-foreground"
            />
          </Field>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="text-foreground">
                {t('common:cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!canSubmit}>
              {t('common:confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
