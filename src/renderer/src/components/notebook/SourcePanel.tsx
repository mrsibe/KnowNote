import { useState, useEffect, useCallback, ReactElement } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, FileText, Globe, FileUp, Loader2, StickyNote, ArrowLeft } from 'lucide-react'
import { useKnowledgeStore, setupKnowledgeListeners } from '../../store/knowledgeStore'
import { useItemStore } from '../../store/itemStore'
import { useUIStore } from '../../store/uiStore'
import { ScrollArea } from '../ui/scroll-area'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Card } from '../ui/card'
import { PanelHeader } from '../ui/panel-header'
import DocumentList from './source/DocumentList'
import SourceReader from './source/reader/SourceReader'
import type { KnowledgeDocument } from '../../../../shared/types/knowledge'
import type { ReaderAnchor } from '../../../../shared/types/source'
import {
  sourceAnchorFromSearchParams,
  sourceAnchorsEqual
} from '../../../../shared/utils/sourceAnchor'
import { useSourceAnchorNavigation } from '../../hooks/useSourceAnchorNavigation'

// 添加来源类型
type AddSourceType = 'file' | 'url' | 'text' | 'note'

// 添加来源弹窗组件
interface AddSourceModalProps {
  type: AddSourceType
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: { title?: string; content?: string; url?: string; noteId?: string }) => void
  isLoading: boolean
  notes: { id: string; title: string }[]
}

function AddSourceModal({
  type,
  isOpen,
  onClose,
  onSubmit,
  isLoading,
  notes
}: AddSourceModalProps) {
  const { t } = useTranslation('ui')
  // 状态会在组件重新挂载时自动重置（通过父组件的 key 属性）
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [url, setUrl] = useState('')
  const [selectedNoteId, setSelectedNoteId] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (type === 'url' && url) {
      onSubmit({ url })
    } else if (type === 'text' && title && content) {
      onSubmit({ title, content })
    } else if (type === 'note' && selectedNoteId) {
      onSubmit({ noteId: selectedNoteId })
    }
  }

  // 判断是否可以提交
  const canSubmit =
    !isLoading &&
    ((type === 'url' && url.trim()) ||
      (type === 'text' && title.trim() && content.trim()) ||
      (type === 'note' && selectedNoteId))

  const getTitle = () => {
    if (type === 'url') return t('importUrl')
    if (type === 'text') return t('pasteText')
    if (type === 'note') return t('importNote')
    return ''
  }

  return (
    <Dialog open={isOpen} onOpenChange={isLoading ? undefined : onClose}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {type === 'url' && (
            <Input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('urlPlaceholder')}
              className="text-base"
              required
              autoFocus
              disabled={isLoading}
            />
          )}

          {type === 'text' && (
            <div className="flex flex-col gap-4">
              <Input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('documentTitle')}
                className="text-base"
                required
                autoFocus
                disabled={isLoading}
              />
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t('textPlaceholder')}
                className="text-base h-60 resize-none"
                required
                disabled={isLoading}
              />
            </div>
          )}

          {type === 'note' && (
            <Select value={selectedNoteId} onValueChange={setSelectedNoteId} disabled={isLoading}>
              <SelectTrigger className="text-base">
                <SelectValue placeholder={t('selectSession')} />
              </SelectTrigger>
              <SelectContent>
                {notes.map((note) => (
                  <SelectItem key={note.id} value={note.id}>
                    {note.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={isLoading}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              {isLoading ? t('processing') : t('add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// 索引进度组件
function IndexingProgress() {
  const { t } = useTranslation('ui')
  const { indexProgress, isIndexing } = useKnowledgeStore()

  if (!isIndexing || !indexProgress) return null

  return (
    <div className="px-4 py-3 border-b border-border">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('indexing')} ({indexProgress.progress}%)
      </div>
    </div>
  )
}

// 文档预览面板组件
interface DocumentViewerPanelProps {
  document: KnowledgeDocument
  anchor?: ReaderAnchor | null
  onBack: () => void
}

function DocumentViewerPanel({ document, anchor, onBack }: DocumentViewerPanelProps) {
  const { t } = useTranslation('ui')

  // Esc 是返回按钮的键盘等价物。它不是「关闭笔记本」快捷键（那个已经刻意不再绑到裸
  // Escape），并且会先把 Escape 让给已经打开的对话框。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (window.document.querySelector('[role="dialog"][data-state="open"]')) return
      onBack()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onBack])

  return (
    <>
      <PanelHeader
        draggable
        left={
          <Button
            onClick={onBack}
            variant="ghost"
            size="icon"
            className="w-8 h-8"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            title={t('backToList')}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
        }
        center={<span className="text-sm font-medium truncate">{document.title}</span>}
      />

      {/* 来源阅读器（#71）：PDF 渲染原页，其余格式走文本回退，两者同一契约。
          `anchor`（#72）把引用定位传进来，reader 自己决定页/块/偏移的优先级。 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <SourceReader document={document} anchor={anchor} />
      </div>
    </>
  )
}

export default function SourcePanel(): ReactElement {
  const { t } = useTranslation('ui')
  const { id: notebookId } = useParams()
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [modalType, setModalType] = useState<AddSourceType | null>(null)
  const [hasEmbeddingModel, setHasEmbeddingModel] = useState(false)
  const [selectedDocument, setSelectedDocument] = useState<KnowledgeDocument | null>(null)

  const {
    documents,
    documentsLoaded,
    isLoading,
    isIndexing,
    loadDocuments,
    loadStats,
    addDocument,
    addDocumentFromFile,
    addDocumentFromUrl,
    addNoteToKnowledge,
    deleteDocument,
    selectFiles
  } = useKnowledgeStore()

  const { notes, loadNotes } = useItemStore()

  const { openSettings } = useUIStore()

  // Embedding 是基础设施：没有远程 connection 时由内置本地模型承担（首次 RAG 使用按需下载）。
  // 因此可用性取决于真实后端状态，而不是 connections.embedding 是否存在——内置模式不会写入 connection。
  useEffect(() => {
    const loadEmbeddingAvailability = async (): Promise<void> => {
      try {
        const status = await window.api.embedding.getStatus()
        setHasEmbeddingModel(status.activeBackend === 'local' || status.remoteConfigured)
      } catch (error) {
        console.error('[SourcePanel] Failed to load embedding status:', error)
        setHasEmbeddingModel(false)
      }
    }
    void loadEmbeddingAvailability()

    // 远程/内置切换、模型安装状态变化都会影响可用性
    const unsubscribeConnections = window.api.connections.onChanged(() => {
      void loadEmbeddingAvailability()
    })
    const unsubscribeProgress = window.api.embedding.onDownloadProgress(() => {
      void loadEmbeddingAvailability()
    })

    return () => {
      unsubscribeConnections()
      unsubscribeProgress()
    }
  }, [])

  // 设置监听器
  useEffect(() => {
    const cleanup = setupKnowledgeListeners()
    return cleanup
  }, [])

  // 加载文档和笔记
  useEffect(() => {
    if (notebookId) {
      loadDocuments(notebookId)
      loadStats(notebookId)
      loadNotes(notebookId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId])

  // 当 notebook 切换时清空选中的文档（render 期间调整，避免 effect 级联渲染）
  const [selectionNotebookId, setSelectionNotebookId] = useState(notebookId)
  if (selectionNotebookId !== notebookId) {
    setSelectionNotebookId(notebookId)
    setSelectedDocument(null)
  }

  // 对话里的引用/来源被点击时，在这里把对应文档与定位打开。
  // 右栏的对话和左栏的知识库是兄弟节点，所以请求走 uiStore；URL query 是它的持久副本。
  const focusedSource = useUIStore((state) => state.focusedSource)
  const setFocusedSource = useUIStore((state) => state.openSourceAnchor)
  const { closeSourceAnchor } = useSourceAnchorNavigation()
  const [searchParams] = useSearchParams()

  // reload / 冷启动：把 URL 里的定位水合进 store。这是「持久化的一份」与「运行时的一份」
  // 之间唯一的同步点；`sourceAnchorsEqual` 保证不会因为 query 重渲染而反复写入。
  useEffect(() => {
    const fromUrl = sourceAnchorFromSearchParams(searchParams)
    if (!fromUrl) return
    if (sourceAnchorsEqual(useUIStore.getState().focusedSource, fromUrl)) return
    setFocusedSource(fromUrl)
  }, [searchParams, setFocusedSource])

  const focusedDocument = focusedSource
    ? (documents.find((doc) => doc.id === focusedSource.documentId) ?? null)
    : null

  // deep-link 指向已删除来源：列表读完后仍找不到文档就回到列表，并清掉失效 query，
  // 而不是停在一个永远打不开的阅读器上。
  const focusedDocumentMissing =
    focusedSource !== null && documentsLoaded && focusedDocument === null
  useEffect(() => {
    if (focusedDocumentMissing) closeSourceAnchor()
  }, [focusedDocumentMissing, closeSourceAnchor])

  // 引用/来源请求优先于列表里选中的文档：列表选择会调 `closeSourceAnchor()` 把它清掉，
  // 所以两者不会同时有效；反过来点引用时，它必须能覆盖仍然打开着的上一份文档。
  const openDocument = focusedDocument ?? selectedDocument
  const readerAnchor =
    focusedSource && openDocument && focusedSource.documentId === openDocument.id
      ? focusedSource.location
      : null

  // 处理文件上传
  const handleFileUpload = useCallback(async () => {
    if (!notebookId) return

    // 检查是否配置了默认嵌入模型
    if (!hasEmbeddingModel) {
      alert(t('noEmbeddingModelConfigured'))
      return
    }

    const files = await selectFiles()
    for (const filePath of files) {
      await addDocumentFromFile(notebookId, filePath)
    }
    setShowAddMenu(false)
  }, [notebookId, hasEmbeddingModel, selectFiles, addDocumentFromFile, t])

  // 处理 URL 导入
  const handleUrlImport = useCallback(
    async (data: { url?: string }) => {
      if (!notebookId || !data.url) return

      // 检查是否配置了默认嵌入模型
      if (!hasEmbeddingModel) {
        alert(t('noEmbeddingModelConfigured'))
        setModalType(null)
        return
      }

      await addDocumentFromUrl(notebookId, data.url)
      setModalType(null)
    },
    [notebookId, hasEmbeddingModel, addDocumentFromUrl, t]
  )

  // 处理文本粘贴
  const handleTextPaste = useCallback(
    async (data: { title?: string; content?: string }) => {
      if (!notebookId || !data.title || !data.content) return

      // 检查是否配置了默认嵌入模型
      if (!hasEmbeddingModel) {
        alert(t('noEmbeddingModelConfigured'))
        setModalType(null)
        return
      }

      await addDocument(notebookId, {
        title: data.title,
        type: 'text',
        content: data.content
      })
      setModalType(null)
    },
    [notebookId, hasEmbeddingModel, addDocument, t]
  )

  // 处理笔记导入
  const handleNoteImport = useCallback(
    async (data: { noteId?: string }) => {
      if (!notebookId || !data.noteId) return

      // 检查是否配置了默认嵌入模型
      if (!hasEmbeddingModel) {
        alert(t('noEmbeddingModelConfigured'))
        setModalType(null)
        return
      }

      try {
        await addNoteToKnowledge(notebookId, data.noteId)
        setModalType(null)
      } catch (error) {
        // 检查是否是空笔记错误
        const errorMessage = (error as Error).message || ''
        if (errorMessage.toLowerCase().includes('empty')) {
          alert(t('emptyNoteCannotImport'))
        } else {
          alert(errorMessage || t('embeddingFailed', { title: '' }))
        }
        setModalType(null)
      }
    },
    [notebookId, hasEmbeddingModel, addNoteToKnowledge, t]
  )

  // 处理删除文档
  const handleDelete = useCallback(
    async (documentId: string) => {
      if (!notebookId) return
      await deleteDocument(notebookId, documentId)
    },
    [notebookId, deleteDocument]
  )

  // 处理打开设置
  const handleOpenSettings = useCallback(() => {
    openSettings()
  }, [openSettings])

  // 处理打开源文件
  const handleOpenSource = useCallback(async (documentId: string) => {
    try {
      await window.api.knowledge.openSource(documentId)
    } catch (error) {
      console.error('Error opening source:', error)
    }
  }, [])

  // 处理文档点击
  const handleSelectDocument = useCallback(
    (document: KnowledgeDocument) => {
      // 文本和笔记类型可以预览，直接显示预览页面
      if (document.type === 'text' || document.type === 'note') {
        setSelectedDocument(document)
        // 列表里的选择优先，清掉对话/URL 那边可能还挂着的请求
        closeSourceAnchor()
      } else {
        // 其他类型（文件、URL）直接打开
        handleOpenSource(document.id)
      }
    },
    [handleOpenSource, closeSourceAnchor]
  )

  // 返回列表
  const handleBack = useCallback(() => {
    setSelectedDocument(null)
    closeSourceAnchor()
  }, [closeSourceAnchor])

  // 处理弹窗提交
  const handleModalSubmit = useCallback(
    (data: { title?: string; content?: string; url?: string; noteId?: string }) => {
      if (modalType === 'url') {
        handleUrlImport(data)
      } else if (modalType === 'text') {
        handleTextPaste(data)
      } else if (modalType === 'note') {
        handleNoteImport(data)
      }
    },
    [modalType, handleUrlImport, handleTextPaste, handleNoteImport]
  )

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      {openDocument ? (
        // 文档预览页面
        <DocumentViewerPanel
          key={openDocument.id}
          document={openDocument}
          anchor={readerAnchor}
          onBack={handleBack}
        />
      ) : (
        // 文档列表页面
        <>
          <PanelHeader
            draggable
            left={
              <span className="text-sm font-medium text-foreground truncate w-full select-none">
                {t('knowledgeBase')}
              </span>
            }
            right={
              <div
                className="relative"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <Button
                  onClick={() => setShowAddMenu(!showAddMenu)}
                  disabled={!hasEmbeddingModel}
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8"
                  title={!hasEmbeddingModel ? t('noEmbeddingModelConfigured') : t('addSource')}
                >
                  <Plus className="w-4 h-4" />
                </Button>

                {/* 添加菜单 */}
                {showAddMenu && (
                  <div className="absolute right-0 top-full mt-1 w-44 bg-surface-overlay border border-border rounded-lg shadow-elevation overflow-hidden p-1 z-10">
                    <Button
                      onClick={handleFileUpload}
                      variant="ghost"
                      className="w-full justify-start text-sm font-normal"
                    >
                      <FileUp className="w-4 h-4" />
                      {t('uploadFile')}
                    </Button>
                    <Button
                      onClick={() => {
                        setModalType('url')
                        setShowAddMenu(false)
                      }}
                      variant="ghost"
                      className="w-full justify-start text-sm font-normal"
                    >
                      <Globe className="w-4 h-4" />
                      {t('importUrl')}
                    </Button>
                    <Button
                      onClick={() => {
                        setModalType('text')
                        setShowAddMenu(false)
                      }}
                      variant="ghost"
                      className="w-full justify-start text-sm font-normal"
                    >
                      <FileText className="w-4 h-4" />
                      {t('pasteText')}
                    </Button>
                    <Button
                      onClick={() => {
                        setModalType('note')
                        setShowAddMenu(false)
                      }}
                      variant="ghost"
                      className="w-full justify-start text-sm font-normal"
                    >
                      <StickyNote className="w-4 h-4" />
                      {t('importNote')}
                    </Button>
                  </div>
                )}
              </div>
            }
          />

          {/* 索引进度 */}
          <IndexingProgress />

          {/* 文档列表 */}
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <DocumentList
                documents={documents}
                hasEmbeddingModel={!!hasEmbeddingModel}
                onDeleteDocument={handleDelete}
                onSelectDocument={handleSelectDocument}
                onOpenSettings={handleOpenSettings}
              />
            </ScrollArea>
          )}
        </>
      )}

      {/* 添加来源弹窗 - 使用 key 强制在 type 变化时重新挂载组件 */}
      {modalType && modalType !== 'file' && (
        <AddSourceModal
          key={modalType}
          type={modalType}
          isOpen={true}
          onClose={() => setModalType(null)}
          onSubmit={handleModalSubmit}
          isLoading={isIndexing}
          notes={notes
            .filter((n) => n.content.trim().length > 0)
            .map((n) => ({ id: n.id, title: n.title }))}
        />
      )}

      {/* 点击外部关闭菜单 */}
      {showAddMenu && <div className="fixed inset-0 z-0" onClick={() => setShowAddMenu(false)} />}
    </Card>
  )
}
