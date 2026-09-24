import { ReactElement, useState } from 'react'
import { FileText, Network, Trash2, Loader2, Edit2, ClipboardList, Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable'
import type { Note } from '../../../../../shared/types'
import type { ItemDetail } from '../../../store/itemStore'
import { useItemStore } from '../../../store/itemStore'
import { Button } from '../../ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator
} from '../../ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../ui/dialog'
import { Input } from '../../ui/input'
import ConfirmDialog from '../../common/ConfirmDialog'

interface ItemListProps {
  items: ItemDetail[]
  currentNote: Note | null
  onSelectNote: (note: Note) => void
  onOpenMindMap: (mindMapId: string) => void
  onOpenQuiz?: (quizId: string) => void
  onOpenAnki?: (ankiCardId: string) => void
  onDeleteItem: (itemId: string) => void
  onRefresh?: () => void
}

// 单个可排序的 Item 组件
function SortableItemRow({
  item,
  currentNote,
  onSelectNote,
  onOpenMindMap,
  onOpenQuiz,
  onOpenAnki,
  onDeleteItem,
  onRefresh,
  t,
  i18n
}: {
  item: ItemDetail
  currentNote: Note | null
  onSelectNote: (note: Note) => void
  onOpenMindMap: (mindMapId: string) => void
  onOpenQuiz?: (quizId: string) => void
  onOpenAnki?: (ankiCardId: string) => void
  onDeleteItem: (itemId: string) => void
  onRefresh?: () => void
  t: any
  i18n: any
}) {
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id
  })

  const style = {
    transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
    transition,
    zIndex: isDragging ? 999 : undefined
  }

  const isNote = item.type === 'note'
  const isMindMap = item.type === 'mindmap'
  const isQuiz = item.type === 'quiz'
  const isAnki = item.type === 'anki'
  const note = isNote ? (item.resource as Note) : null
  const mindMap = isMindMap ? item.resource : null
  const quiz = isQuiz ? item.resource : null
  const ankiCard = isAnki ? item.resource : null
  const isCurrentNote = isNote && currentNote?.id === item.resourceId
  const isGenerating =
    (isMindMap || isQuiz || isAnki) &&
    (mindMap?.status === 'generating' ||
      quiz?.status === 'generating' ||
      ankiCard?.status === 'generating')
  const isFailed =
    (isMindMap || isQuiz || isAnki) &&
    (mindMap?.status === 'failed' || quiz?.status === 'failed' || ankiCard?.status === 'failed')

  const handleRename = () => {
    const currentTitle = isNote
      ? note?.title
      : isMindMap
        ? mindMap?.title
        : isQuiz
          ? quiz?.title
          : ankiCard?.title
    setNewTitle(currentTitle || '')
    setIsRenameDialogOpen(true)
  }

  const handleRenameConfirm = async () => {
    if (!newTitle.trim()) return

    try {
      if (isNote && note) {
        // 走 store，这样列表立即反映新标题，而不是只依赖 onRefresh 重新拉取。
        await useItemStore.getState().updateNote(note.id, { title: newTitle.trim() })
      } else if (isMindMap && mindMap) {
        await window.api.mindmap.update(mindMap.id, { title: newTitle.trim() })
      } else if (isQuiz && quiz) {
        await window.api.quiz.update(quiz.id, { title: newTitle.trim() })
      } else if (isAnki && ankiCard) {
        await window.api.anki.update(ankiCard.id, { title: newTitle.trim() })
      }
      setIsRenameDialogOpen(false)
      onRefresh?.()
    } catch (error) {
      console.error('Failed to rename:', error)
    }
  }

  const handleDelete = () => {
    setIsDeleteDialogOpen(true)
  }

  const handleConfirmDelete = () => {
    onDeleteItem(item.id)
  }

  const itemContent = (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => {
        if (isNote && note) {
          onSelectNote(note)
        } else if (isMindMap && mindMap && !isGenerating) {
          onOpenMindMap(mindMap.id)
        } else if (isQuiz && quiz && !isGenerating) {
          onOpenQuiz?.(quiz.id)
        } else if (isAnki && ankiCard && !isGenerating) {
          onOpenAnki?.(ankiCard.id)
        }
      }}
      className={`group grid grid-cols-[auto_1fr_auto] gap-2 items-start rounded-md border px-2 py-2 ${isDragging ? 'cursor-grabbing opacity-75' : 'cursor-grab hover:cursor-grab'} ${
        isGenerating
          ? 'bg-chart-1/5 border-chart-1/30 animate-pulse cursor-wait'
          : isFailed
            ? 'bg-destructive/5 border-destructive/30'
            : isCurrentNote
              ? 'bg-surface-selected border-transparent'
              : 'border-transparent hover:bg-surface-hover'
      }`}
    >
      {/* 图标列 - 固定宽度 */}
      <div className="flex items-center">
        {/* 图标 */}
        {isNote && <FileText className="w-4 h-4 text-muted-foreground" />}
        {isMindMap && !isGenerating && <Network className="w-4 h-4 text-chart-1" />}
        {isQuiz && !isGenerating && <ClipboardList className="w-4 h-4 text-chart-2" />}
        {isAnki && !isGenerating && <Layers className="w-4 h-4 text-chart-3" />}
        {(isMindMap || isQuiz || isAnki) && isGenerating && (
          <Loader2 className="w-4 h-4 text-chart-1 animate-spin" />
        )}
      </div>

      {/* 内容列 - 可被压缩 */}
      <div className="min-w-0 flex flex-col gap-1">
        {isNote && note && (
          <>
            <h3 className="text-sm font-medium truncate">{note.title}</h3>
            <p className="text-xs text-muted-foreground line-clamp-2">
              {note.content.replace(/^#.*\n/, '').slice(0, 100)}
            </p>
          </>
        )}
        {isMindMap && mindMap && (
          <>
            <h3 className="text-sm font-medium truncate flex items-center gap-2">
              {mindMap.title}
              {mindMap.status === 'generating' && (
                <span className="text-xs text-muted-foreground">{t('generating')}</span>
              )}
              {mindMap.status === 'failed' && (
                <span className="text-xs text-destructive">{t('failed')}</span>
              )}
            </h3>
            <p className="text-xs text-subtle-foreground">
              {t('mindMapVersion', { version: mindMap.version })}
            </p>
          </>
        )}
        {isQuiz && quiz && (
          <>
            <h3 className="text-sm font-medium truncate flex items-center gap-2">
              {quiz.title}
              {quiz.status === 'generating' && (
                <span className="text-xs text-muted-foreground">{t('generating')}</span>
              )}
              {quiz.status === 'failed' && (
                <span className="text-xs text-destructive">{t('failed')}</span>
              )}
            </h3>
            <p className="text-xs text-subtle-foreground">
              {t('quizVersion', { version: quiz.version })}
            </p>
          </>
        )}
        {isAnki && ankiCard && (
          <>
            <h3 className="text-sm font-medium truncate flex items-center gap-2">
              {ankiCard.title}
              {ankiCard.status === 'generating' && (
                <span className="text-xs text-muted-foreground">{t('generating')}</span>
              )}
              {ankiCard.status === 'failed' && (
                <span className="text-xs text-destructive">{t('failed')}</span>
              )}
            </h3>
            <p className="text-xs text-subtle-foreground">
              {ankiCard.status === 'generating'
                ? t('generatingCards')
                : t('ankiCards', { count: ankiCard.cardsData?.length || 0 })}
            </p>
          </>
        )}
        <p className="text-xs text-subtle-foreground">
          {new Date(item.updatedAt).toLocaleDateString(
            i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US'
          )}
        </p>
      </div>

      {/* 删除按钮列 - 固定宽度 */}
      <Button
        onClick={(e) => {
          e.stopPropagation()
          handleDelete()
        }}
        onPointerDown={(e) => e.stopPropagation()}
        variant="ghost"
        size="icon"
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 mt-0.5 text-destructive hover:bg-destructive/10 hover:text-destructive cursor-pointer"
        title={
          isNote
            ? t('deleteNote')
            : isMindMap
              ? t('deleteMindMap')
              : isQuiz
                ? t('deleteQuiz')
                : t('deleteAnki')
        }
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  )

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{itemContent}</ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem
            onClick={(e) => {
              e.stopPropagation()
              handleRename()
            }}
          >
            <Edit2 className="w-4 h-4 mr-2" />
            {t('rename')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={(e) => {
              e.stopPropagation()
              handleDelete()
            }}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            {t('delete')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isNote
                ? t('renameNote')
                : isMindMap
                  ? t('renameMindMap')
                  : isQuiz
                    ? t('renameQuiz')
                    : t('renameAnki')}
            </DialogTitle>
            <DialogDescription>
              {isNote
                ? t('renameNoteDesc')
                : isMindMap
                  ? t('renameMindMapDesc')
                  : isQuiz
                    ? t('renameQuizDesc')
                    : t('renameAnkiDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              id="title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRenameConfirm()
                }
              }}
              placeholder={
                isNote
                  ? t('noteTitlePlaceholder')
                  : isMindMap
                    ? t('mindMapTitlePlaceholder')
                    : isQuiz
                      ? t('quizTitlePlaceholder')
                      : t('ankiTitlePlaceholder')
              }
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRenameDialogOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleRenameConfirm} disabled={!newTitle.trim()}>
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认对话框 */}
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleConfirmDelete}
        title={
          isNote
            ? t('deleteNote')
            : isMindMap
              ? t('deleteMindMap')
              : isQuiz
                ? t('deleteQuiz')
                : t('deleteAnki')
        }
        message={
          isNote
            ? t('deleteNoteWarning')
            : isMindMap
              ? t('confirmDeleteMindMap')
              : isQuiz
                ? t('confirmDeleteQuiz')
                : t('confirmDeleteAnki')
        }
      />
    </>
  )
}

export default function ItemList({
  items,
  currentNote,
  onSelectNote,
  onOpenMindMap,
  onOpenQuiz,
  onOpenAnki,
  onDeleteItem,
  onRefresh
}: ItemListProps): ReactElement {
  const { t, i18n } = useTranslation('notebook')
  const [localItems, setLocalItems] = useState(items)

  // 配置传感器 - 避免轻微抖动触发拖拽
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5
      }
    })
  )

  // 处理拖拽结束
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = localItems.findIndex((item) => item.id === active.id)
      const newIndex = localItems.findIndex((item) => item.id === over.id)

      const newItems = arrayMove(localItems, oldIndex, newIndex)
      setLocalItems(newItems)

      // 批量更新 order 值
      const updates: Record<string, number> = {}
      newItems.forEach((item, index) => {
        updates[item.id] = index
      })

      try {
        await window.api.items.batchUpdateOrder(updates)
      } catch (error) {
        console.error('Failed to update item order:', error)
        // 如果更新失败，恢复原来的顺序
        setLocalItems(items)
      }
    }
  }

  // 当外部 items 改变时，更新本地状态（render 期间调整，避免 effect 级联渲染）
  const [syncedItems, setSyncedItems] = useState(items)
  if (syncedItems !== items) {
    setSyncedItems(items)
    setLocalItems(items)
  }

  if (items.length === 0) {
    return (
      <div className="flex select-none flex-col items-center justify-center h-full p-8 text-center gap-4">
        <FileText className="w-12 h-12 text-muted-foreground" />
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">{t('noNotesYet')}</p>
          <p className="text-xs text-muted-foreground">{t('noNotesYetDesc')}</p>
        </div>
      </div>
    )
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext
        items={localItems.map((item) => item.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="p-2 space-y-1 select-none">
          {localItems.map((item) => (
            <SortableItemRow
              key={item.id}
              item={item}
              currentNote={currentNote}
              onSelectNote={onSelectNote}
              onOpenMindMap={onOpenMindMap}
              onOpenQuiz={onOpenQuiz}
              onOpenAnki={onOpenAnki}
              onDeleteItem={onDeleteItem}
              onRefresh={onRefresh}
              t={t}
              i18n={i18n}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
