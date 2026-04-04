import { ReactElement, useEffect, useState } from 'react'
import { Save, Trash2, ArrowLeft, Network, FileText, ClipboardCheck, Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useParams } from 'react-router-dom'
import { useItemStore } from '../../store/itemStore'
import { setupMindMapListeners } from '../../store/mindmapStore'
import NoteEditor from './note/NoteEditor'
import ItemList from './item/ItemList'
import QuizStartDialog, { QuizStartParams } from './quiz/QuizStartDialog'
import AnkiConfigDialog from './anki/AnkiConfigDialog'
import { ScrollArea } from '../ui/scroll-area'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { PanelHeader } from '../ui/panel-header'
import UnsavedChangesDialog from '../common/UnsavedChangesDialog'
import DeleteNoteConfirmDialog from '../common/DeleteNoteConfirmDialog'
import type { Note } from '../../../../shared/types'

// 편집기패널자컴포넌트 - 관리편편집상태
interface NoteEditorPanelProps {
  note: Note
  isSaving: boolean
  onSave: (title: string, content: string) => void
  onDelete: () => void
  onBack: () => void
  hasUnsavedChanges: boolean
  onUnsavedChange: (hasChanges: boolean) => void
}

function NoteEditorPanel({
  note,
  isSaving,
  onSave,
  onDelete,
  onBack,
  onUnsavedChange
}: NoteEditorPanelProps) {
  const { t } = useTranslation('notebook')
  const [editTitle, setEditTitle] = useState(note.title)
  const [editContent, setEditContent] = useState(note.content)

  // 감지예아니오있는미저장의수정수정
  useEffect(() => {
    const hasChanges = editTitle !== note.title || editContent !== note.content
    onUnsavedChange(hasChanges)
  }, [editTitle, editContent, note.title, note.content, onUnsavedChange])

  const handleSave = () => {
    // 만약제목빈또는있는빈격，사용기본제목
    const finalTitle = editTitle.trim() || t('untitledNote')
    // 업데이트표시의제목，사용자보기에자동설정의제목
    if (!editTitle.trim()) {
      setEditTitle(finalTitle)
    }
    onSave(finalTitle, editContent)
  }

  return (
    <>
      <PanelHeader
        draggable
        left={
          <Button
            onClick={onBack}
            variant="ghost"
            size="icon"
            className="w-8 h-8 shrink-0"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            title={t('backToList')}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
        }
        center={
          <Input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="bg-transparent border-0 text-sm font-medium p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            placeholder={t('noteTitle')}
          />
        }
        right={
          <>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              variant="ghost"
              size="icon"
              className="w-8 h-8"
              title={t('save')}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <Save className="w-4 h-4" />
            </Button>
            <Button
              onClick={onDelete}
              variant="ghost"
              size="icon"
              className="w-8 h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
              title={t('delete')}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </>
        }
      />

      {/* 편집기내용 */}
      <div className="flex-1 overflow-hidden">
        <NoteEditor content={editContent} onChange={setEditContent} onSave={handleSave} />
      </div>
    </>
  )
}

export default function NotePanel(): ReactElement {
  const { t } = useTranslation('notebook')
  const { id: notebookId } = useParams()
  const {
    items,
    currentNote,
    isEditing,
    isSaving,
    loadItems,
    createNote,
    updateNote,
    deleteItem,
    setCurrentNote
  } = useItemStore()

  // 관리미저장상태
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Dialog 상태 관리
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showQuizStartDialog, setShowQuizStartDialog] = useState(false)
  const [showAnkiConfigDialog, setShowAnkiConfigDialog] = useState(false)

  // 감시Notebook전환，비우기현재편편집상태
  useEffect(() => {
    if (notebookId) {
      // 비우기현재편편집상태，회피면표시이전Notebook의내용
      setCurrentNote(null)
      // 사용 setTimeout 상태업데이트추지연에아래하나개이벤트순환환
      setTimeout(() => setHasUnsavedChanges(false), 0)
    }
  }, [notebookId, setCurrentNote])

  // 설정마인드맵진행감시
  useEffect(() => {
    const unsubscribe = setupMindMapListeners()
    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [])

  // 로드 items 목록
  useEffect(() => {
    if (notebookId) {
      loadItems(notebookId)
    }
  }, [notebookId, loadItems])

  // 생성새노트
  const handleCreateNote = async () => {
    if (!notebookId) return
    await createNote(notebookId, t('newNoteContent'), t('newNote'))
  }

  // 저장노트
  const handleSave = async (title: string, content: string) => {
    if (!currentNote) return
    await updateNote(currentNote.id, { title, content })
    toast.success(t('noteSaved'))
  }

  // 노트 삭제
  const handleDelete = async () => {
    if (!currentNote) return
    setShowDeleteDialog(true)
  }

  // 확인노트 삭제
  const confirmDelete = async () => {
    if (!currentNote) return
    // 찾에의 item
    const item = items.find((item) => item.type === 'note' && item.resourceId === currentNote.id)
    if (item) {
      await deleteItem(item.id, true) // 동시삭제리소스
    }
  }

  // 반환목록페이지
  const handleBack = () => {
    // 만약있는미저장의수정수정，힌트사용자
    if (hasUnsavedChanges) {
      setShowUnsavedDialog(true)
      return
    }
    setCurrentNote(null)
    setHasUnsavedChanges(false)
  }

  // 확인떠나기열기（있는미저장수정수정시）
  const confirmLeave = () => {
    setCurrentNote(null)
    setHasUnsavedChanges(false)
  }

  // 열기마인드맵윈도우（조회보기특정버전）
  const handleOpenMindMap = async (mindMapId: string) => {
    try {
      if (notebookId) {
        await window.api.mindmap.openWindow(notebookId, mindMapId)
      }
    } catch (error) {
      console.error('[NotePanel] Failed to open mind map window:', error)
    }
  }

  // 열기퀴즈윈도우（조회보기특정버전）
  const handleOpenQuiz = async (quizId: string) => {
    try {
      if (notebookId) {
        await window.api.quiz.openWindow(notebookId, quizId)
      }
    } catch (error) {
      console.error('[NotePanel] Failed to open quiz window:', error)
    }
  }

  // 열기Anki카드윈도우（조회보기특정버전）
  const handleOpenAnki = async (ankiCardId: string) => {
    try {
      if (notebookId) {
        await window.api.anki.openWindow(notebookId, ankiCardId)
      }
    } catch (error) {
      console.error('[NotePanel] Failed to open anki window:', error)
    }
  }

  // 생성새마인드맵（후대생성，아닌열기윈도우）
  const handleGenerateMindMap = async () => {
    if (notebookId) {
      try {
        // 즉시시작생성（비동기）
        window.api.mindmap.generate(notebookId).then((result) => {
          if (result.success) {
            // 생성완료후재새로드목록
            loadItems(notebookId)
          }
        })

        // 등대기하나작은단시간후새로고침목록，으로표시"현재생성"의 item
        setTimeout(() => {
          loadItems(notebookId)
        }, 500)
      } catch (error) {
        console.error('[NotePanel] Failed to generate mind map:', error)
      }
    }
  }

  // 열기Anki설정다이얼로그
  const handleGenerateAnki = () => {
    setShowAnkiConfigDialog(true)
  }

  // 열기퀴즈시작동다이얼로그
  const handleGenerateQuiz = () => {
    setShowQuizStartDialog(true)
  }

  // 시작생성퀴즈
  const handleQuizStart = async (params: QuizStartParams) => {
    if (!notebookId) return
    try {
      // 즉시시작생성（비동기）
      window.api.quiz
        .generate(notebookId, {
          questionCount: params.questionCount,
          difficulty: params.difficulty,
          customPrompt: params.customPrompt
        })
        .then((result) => {
          if (result.success) {
            // 생성완료후재새로드목록
            loadItems(notebookId)
          }
        })

      // 등대기하나작은단시간후새로고침목록，으로표시"현재생성"의 item
      setTimeout(() => {
        loadItems(notebookId)
      }, 500)
    } catch (error) {
      console.error('[NotePanel] Failed to start quiz:', error)
    }
  }

  return (
    <div className="flex flex-col bg-card rounded-xl overflow-hidden h-full shadow-md">
      {isEditing && currentNote ? (
        // 편집기페이지 - 사용 key 강제전환노트시재새마운트
        <NoteEditorPanel
          key={currentNote.id}
          note={currentNote}
          isSaving={isSaving}
          onSave={handleSave}
          onDelete={handleDelete}
          onBack={handleBack}
          hasUnsavedChanges={hasUnsavedChanges}
          onUnsavedChange={setHasUnsavedChanges}
        />
      ) : (
        // 목록페이지
        <>
          {/* 상단부분도구 모음 */}
          <PanelHeader
            draggable
            left={
              <span className="text-sm text-foreground truncate w-full select-none">
                {t('creativeSpace')}
              </span>
            }
            right={
              <>
                <Button
                  onClick={handleGenerateMindMap}
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  title={t('generateMindMap')}
                >
                  <Network className="w-4 h-4" />
                </Button>
                <Button
                  onClick={handleGenerateQuiz}
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  title={t('generateQuiz')}
                >
                  <ClipboardCheck className="w-4 h-4" />
                </Button>
                <Button
                  onClick={handleGenerateAnki}
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  title={t('generateAnki')}
                >
                  <Layers className="w-4 h-4" />
                </Button>
                <Button
                  onClick={handleCreateNote}
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  title={t('createNote')}
                >
                  <FileText className="w-4 h-4" />
                </Button>
              </>
            }
          />

          {/* Items 목록（노트 + 마인드맵등） */}
          <ScrollArea className="flex-1">
            <ItemList
              items={items}
              currentNote={currentNote}
              onSelectNote={setCurrentNote}
              onOpenMindMap={handleOpenMindMap}
              onOpenQuiz={handleOpenQuiz}
              onOpenAnki={handleOpenAnki}
              onDeleteItem={(itemId) => deleteItem(itemId, true)}
              onRefresh={() => notebookId && loadItems(notebookId)}
            />
          </ScrollArea>
        </>
      )}

      {/* 미저장수정수정확인다이얼로그 */}
      <UnsavedChangesDialog
        isOpen={showUnsavedDialog}
        onClose={() => setShowUnsavedDialog(false)}
        onConfirm={confirmLeave}
      />

      {/* 노트 삭제확인다이얼로그 */}
      <DeleteNoteConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={confirmDelete}
      />

      {/* 퀴즈시작동다이얼로그 */}
      {notebookId && (
        <QuizStartDialog
          isOpen={showQuizStartDialog}
          onClose={() => setShowQuizStartDialog(false)}
          onStart={handleQuizStart}
        />
      )}

      {/* Anki카드생성설정다이얼로그 */}
      {notebookId && (
        <AnkiConfigDialog
          notebookId={notebookId}
          open={showAnkiConfigDialog}
          onOpenChange={setShowAnkiConfigDialog}
          onGenerateStart={() => loadItems(notebookId)}
        />
      )}
    </div>
  )
}
