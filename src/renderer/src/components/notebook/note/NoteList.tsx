import { ReactElement, useState } from 'react'
import { FileText, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Note } from '../../../../../shared/types'
import { Button } from '../../ui/button'
import DeleteNoteConfirmDialog from '../../common/DeleteNoteConfirmDialog'

interface NoteListProps {
  notes: Note[]
  currentNote: Note | null
  onSelectNote: (note: Note) => void
  onDeleteNote: (noteId: string) => void
}

export default function NoteList({
  notes,
  currentNote,
  onSelectNote,
  onDeleteNote
}: NoteListProps): ReactElement {
  const { t, i18n } = useTranslation('notebook')
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null)

  const handleConfirmDelete = () => {
    if (noteToDelete) {
      onDeleteNote(noteToDelete)
    }
  }

  if (notes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-4">
        <FileText className="w-12 h-12 text-muted-foreground" />
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">{t('noNotesYet')}</p>
          <p className="text-xs text-muted-foreground">{t('noNotesYetDesc')}</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="p-2 space-y-1 select-none">
        {notes.map((note) => (
          <div
            key={note.id}
            onClick={() => onSelectNote(note)}
            className={`group grid grid-cols-[auto_1fr_auto] gap-2 items-start rounded-md px-2 py-2 transition-colors cursor-pointer ${
              currentNote?.id === note.id ? 'bg-surface-selected' : 'hover:bg-surface-hover'
            }`}
          >
            {/* 图标列 - 固定宽度 */}
            <FileText className="w-4 h-4 mt-0.5 text-muted-foreground" />

            {/* 内容列 - 可被压缩 */}
            <div className="min-w-0 flex flex-col gap-1">
              <h3 className="text-sm font-medium truncate">{note.title}</h3>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {note.content.replace(/^#.*\n/, '').slice(0, 100)}
              </p>
              <p className="text-xs text-subtle-foreground">
                {new Date(note.updatedAt).toLocaleDateString(
                  i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US'
                )}
              </p>
            </div>

            {/* 删除按钮列 - 固定宽度 */}
            <Button
              onClick={(e) => {
                e.stopPropagation()
                setNoteToDelete(note.id)
                setShowDeleteDialog(true)
              }}
              variant="ghost"
              size="icon"
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 mt-0.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
              title={t('deleteNote')}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>

      {/* 删除笔记确认对话框 */}
      <DeleteNoteConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleConfirmDelete}
      />
    </>
  )
}
