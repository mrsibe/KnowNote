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
            className={`group grid grid-cols-[auto_1fr_auto] gap-2 items-start p-3 rounded-lg border transition-colors cursor-pointer ${
              currentNote?.id === note.id
                ? 'bg-primary/10 border-primary/20'
                : 'border-transparent hover:bg-muted'
            }`}
          >
            {/* 도표컬럼 - 고정너비 */}
            <FileText className="w-4 h-4 mt-0.5 text-muted-foreground" />

            {/* 내용컬럼 - 압축 */}
            <div className="min-w-0 flex flex-col gap-1">
              <h3 className="text-sm font-medium truncate">{note.title}</h3>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {note.content.replace(/^#.*\n/, '').slice(0, 100)}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(note.updatedAt).toLocaleDateString(
                  i18n.language === 'ko-KR' ? 'ko-KR' : 'en-US'
                )}
              </p>
            </div>

            {/* 삭제버튼컬럼 - 고정너비 */}
            <Button
              onClick={(e) => {
                e.stopPropagation()
                setNoteToDelete(note.id)
                setShowDeleteDialog(true)
              }}
              variant="ghost"
              size="icon"
              className="opacity-0 group-hover:opacity-100 w-8 h-8 mt-0.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
              title={t('deleteNote')}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>

      {/* 노트 삭제확인다이얼로그 */}
      <DeleteNoteConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleConfirmDelete}
      />
    </>
  )
}
