import { ReactElement, useEffect, useRef, useState } from 'react'
import { Save, Trash2, ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useParams } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useItemStore } from '../../store/itemStore'
import { useUIStore } from '../../store/uiStore'
import { setupMindMapListeners } from '../../store/mindmapStore'
import NoteEditor from './note/NoteEditor'
import ItemList from './item/ItemList'
import { NOTE_TOOLS, type NoteTool, type NoteToolId } from './noteTools'
import QuizStartDialog, { QuizStartParams } from './quiz/QuizStartDialog'
import AnkiConfigDialog from './anki/AnkiConfigDialog'
import { ScrollArea } from '../ui/scroll-area'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { PanelHeader } from '../ui/panel-header'
import ConfirmActionDialog from '../common/ConfirmActionDialog'
import type { Note } from '../../../../shared/types'

// 编辑器面板子组件 - 管理编辑状态
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
  const panelRef = useRef<HTMLDivElement>(null)

  // 检测是否有未保存的修改
  useEffect(() => {
    const hasChanges = editTitle !== note.title || editContent !== note.content
    onUnsavedChange(hasChanges)
  }, [editTitle, editContent, note.title, note.content, onUnsavedChange])

  const handleSave = () => {
    // 如果标题为空或只有空格，使用默认标题
    const finalTitle = editTitle.trim() || t('untitledNote')
    // 更新显示的标题，让用户看到自动设置的标题
    if (!editTitle.trim()) {
      setEditTitle(finalTitle)
    }
    onSave(finalTitle, editContent)
  }

  // 快捷键保存：主进程拦截 Ctrl/Cmd+S 后只发送事件，焦点可能落在标题输入框或正文编辑器上，
  // 因此只要焦点还在这个面板内就保存（见 issue #25）。
  const handleSaveRef = useRef(handleSave)
  useEffect(() => {
    handleSaveRef.current = handleSave
  }, [handleSave])

  useEffect(() => {
    const handleSaveShortcut = (): void => {
      const active = document.activeElement
      if (active instanceof Node && panelRef.current?.contains(active)) {
        handleSaveRef.current()
      }
    }

    window.addEventListener('shortcut:save-note', handleSaveShortcut)
    return () => window.removeEventListener('shortcut:save-note', handleSaveShortcut)
  }, [])

  return (
    <div ref={panelRef} className="flex h-full flex-col overflow-hidden">
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

      {/* 编辑器内容 */}
      <div className="flex-1 overflow-hidden">
        <NoteEditor noteId={note.id} content={editContent} onChange={setEditContent} />
      </div>
    </div>
  )
}

// 创建工具卡片：图标在上、左对齐标签在下。悬停用合成填充（半透明 surface-hover
// 叠在彩色卡片上），不替换彩色底色。这些是动作按钮，没有持续选中态。
function NoteToolCard({
  tool,
  label,
  onClick
}: {
  tool: NoteTool
  label: string
  onClick: () => void
}): ReactElement {
  const { Icon } = tool
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={cn(
        'group relative h-auto w-full overflow-hidden flex-col items-start justify-start gap-2 whitespace-normal rounded-lg border border-border p-3 text-left',
        tool.surfaceClassName
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-surface-hover opacity-0 transition-opacity group-hover:opacity-100"
      />
      <span className="relative flex flex-col items-start gap-2">
        <Icon className="text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{label}</span>
      </span>
    </Button>
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

  // 管理未保存状态
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // 同步到 uiStore：关闭标签页、切到别的标签页或返回首页会卸载本面板，
  // 而只有编辑器知道它有未保存内容 —— 那几条路径都需要先问一句。
  const setHasUnsavedNoteChanges = useUIStore((state) => state.setHasUnsavedNoteChanges)

  useEffect(() => {
    setHasUnsavedNoteChanges(hasUnsavedChanges)
  }, [hasUnsavedChanges, setHasUnsavedNoteChanges])

  // 卸载时清掉，避免陈旧标志拦住之后的关闭操作
  useEffect(() => () => setHasUnsavedNoteChanges(false), [setHasUnsavedNoteChanges])

  // Dialog 状态管理
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showQuizStartDialog, setShowQuizStartDialog] = useState(false)
  const [showAnkiConfigDialog, setShowAnkiConfigDialog] = useState(false)

  // 监听Notebook切换，清空当前编辑状态
  useEffect(() => {
    if (notebookId) {
      // 清空当前编辑状态，避免显示旧Notebook的内容
      setCurrentNote(null)
      // 使用 setTimeout 将状态更新推迟到下一个事件循环
      setTimeout(() => setHasUnsavedChanges(false), 0)
    }
  }, [notebookId, setCurrentNote])

  // 设置思维导图进度监听器
  useEffect(() => {
    const unsubscribe = setupMindMapListeners()
    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [])

  // 加载 items 列表
  useEffect(() => {
    if (notebookId) {
      loadItems(notebookId)
    }
  }, [notebookId, loadItems])

  // 创建新笔记
  const handleCreateNote = async () => {
    if (!notebookId) return
    await createNote(notebookId, t('newNoteContent'), t('newNote'))
  }

  // 保存笔记
  const handleSave = async (title: string, content: string) => {
    if (!currentNote) return
    await updateNote(currentNote.id, { title, content })
    // One toast per note (#178): saving the same note again updates it rather than
    // stacking another "saved" line.
    toast.success(t('noteSaved'), { id: `note-saved:${currentNote.id}` })
  }

  // 删除笔记
  const handleDelete = async () => {
    if (!currentNote) return
    setShowDeleteDialog(true)
  }

  // 确认删除笔记
  const confirmDelete = async () => {
    if (!currentNote) return
    // 找到对应的 item
    const item = items.find((item) => item.type === 'note' && item.resourceId === currentNote.id)
    if (item) {
      await deleteItem(item.id, true) // 同时删除资源
    }
  }

  // 返回列表页面
  const handleBack = () => {
    // 如果有未保存的修改，提示用户
    if (hasUnsavedChanges) {
      setShowUnsavedDialog(true)
      return
    }
    setCurrentNote(null)
    setHasUnsavedChanges(false)
  }

  // 确认离开（有未保存修改时）
  const confirmLeave = () => {
    setCurrentNote(null)
    setHasUnsavedChanges(false)
  }

  // 打开思维导图窗口（查看特定版本）
  const handleOpenMindMap = async (mindMapId: string) => {
    try {
      if (notebookId) {
        await window.api.mindmap.openWindow(notebookId, mindMapId)
      }
    } catch (error) {
      console.error('[NotePanel] Failed to open mind map window:', error)
    }
  }

  // 打开答题窗口（查看特定版本）
  const handleOpenQuiz = async (quizId: string) => {
    try {
      if (notebookId) {
        await window.api.quiz.openWindow(notebookId, quizId)
      }
    } catch (error) {
      console.error('[NotePanel] Failed to open quiz window:', error)
    }
  }

  // 打开Anki卡片窗口（查看特定版本）
  const handleOpenAnki = async (ankiCardId: string) => {
    try {
      if (notebookId) {
        await window.api.anki.openWindow(notebookId, ankiCardId)
      }
    } catch (error) {
      console.error('[NotePanel] Failed to open anki window:', error)
    }
  }

  // 生成新思维导图（在后台生成，不打开窗口）
  const handleGenerateMindMap = async () => {
    if (notebookId) {
      try {
        // 立即开始生成（异步）
        void window.api.mindmap
          .generate(notebookId)
          .then((result) => {
            if (!result.success) throw new Error(result.error || t('ui:unknownError'))
            return loadItems(notebookId)
          })
          .catch((error) => {
            toast.error(
              t('ui:generationFailed', {
                error: error instanceof Error ? error.message : String(error)
              }),
              { duration: 10000 }
            )
          })

        // 等待一小段时间后刷新列表，以显示"正在生成"的 item
        setTimeout(() => {
          loadItems(notebookId)
        }, 500)
      } catch (error) {
        console.error('[NotePanel] Failed to generate mind map:', error)
        toast.error(
          t('ui:generationFailed', {
            error: error instanceof Error ? error.message : String(error)
          }),
          { duration: 10000 }
        )
      }
    }
  }

  // 打开Anki配置对话框
  const handleGenerateAnki = () => {
    setShowAnkiConfigDialog(true)
  }

  // 打开答题启动对话框
  const handleGenerateQuiz = () => {
    setShowQuizStartDialog(true)
  }

  // 四张工具卡片的动作，按 noteTools 中的顺序引用
  const toolActions: Record<NoteToolId, () => void> = {
    note: handleCreateNote,
    mindmap: handleGenerateMindMap,
    quiz: handleGenerateQuiz,
    anki: handleGenerateAnki
  }

  // 开始生成答题
  const handleQuizStart = async (params: QuizStartParams) => {
    if (!notebookId) return
    try {
      // 立即开始生成（异步）
      window.api.quiz
        .generate(notebookId, {
          questionCount: params.questionCount,
          difficulty: params.difficulty,
          customPrompt: params.customPrompt
        })
        .then((result) => {
          if (!result.success) throw new Error(result.error || t('ui:unknownError'))
          return loadItems(notebookId)
        })
        .catch((error) => {
          toast.error(
            t('ui:generationFailed', {
              error: error instanceof Error ? error.message : String(error)
            }),
            { duration: 10000 }
          )
        })

      // 等待一小段时间后刷新列表，以显示"正在生成"的 item
      setTimeout(() => {
        loadItems(notebookId)
      }, 500)
    } catch (error) {
      console.error('[NotePanel] Failed to start quiz:', error)
      toast.error(
        t('ui:generationFailed', { error: error instanceof Error ? error.message : String(error) }),
        { duration: 10000 }
      )
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface-base">
      {isEditing && currentNote ? (
        // 编辑器页面 - 使用 key 强制在切换笔记时重新挂载
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
        // 列表页面
        <>
          {/* 顶部标题栏：只保留标题，工具入口移到下方内容区 */}
          <PanelHeader
            draggable
            left={
              <span className="text-sm font-medium text-foreground truncate w-full select-none">
                {t('notes')}
              </span>
            }
          />

          {/* 内容区：工具卡片与条目列表共用同一个滚动区，矮窗口下一起滚动 */}
          <ScrollArea className="flex-1">
            <div className="grid grid-cols-2 gap-2 p-2">
              {NOTE_TOOLS.map((tool) => (
                <NoteToolCard
                  key={tool.id}
                  tool={tool}
                  label={t(tool.labelKey)}
                  onClick={toolActions[tool.id]}
                />
              ))}
            </div>
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

      {/* 未保存修改确认对话框 */}
      <ConfirmActionDialog
        isOpen={showUnsavedDialog}
        onClose={() => setShowUnsavedDialog(false)}
        onConfirm={confirmLeave}
        title={t('unsavedChangesTitle')}
        description={t('unsavedChangesWarning')}
        confirmLabel={t('leave')}
        confirmVariant="default"
      />

      {/* 删除笔记确认对话框 */}
      <ConfirmActionDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={confirmDelete}
        title={t('deleteNote')}
        description={t('deleteNoteWarning')}
        confirmLabel={t('common:delete')}
      />

      {/* 答题启动对话框 */}
      {notebookId && (
        <QuizStartDialog
          isOpen={showQuizStartDialog}
          onClose={() => setShowQuizStartDialog(false)}
          onStart={handleQuizStart}
        />
      )}

      {/* Anki卡片生成配置对话框 */}
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
