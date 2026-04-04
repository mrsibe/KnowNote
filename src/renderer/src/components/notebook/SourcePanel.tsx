import { useState, useEffect, useCallback, ReactElement } from 'react'
import { useParams } from 'react-router-dom'
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
import type { KnowledgeDocument } from '../../../../shared/types/knowledge'

// 추가출처타입
type AddSourceType = 'file' | 'url' | 'text' | 'note'

// 추가출처팝업컴포넌트
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
  // 상태컴포넌트재새마운트시자동재（통해부모컴포넌트의 key 속성）
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

  // 판단예아니오으로제출
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

// 인덱스진행컴포넌트
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

// 문서미리보기패널컴포넌트
interface DocumentViewerPanelProps {
  document: KnowledgeDocument
  onBack: () => void
}

function DocumentViewerPanel({ document, onBack }: DocumentViewerPanelProps) {
  const { t } = useTranslation('ui')
  const [content, setContent] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)

  // 로드문서내용
  useEffect(() => {
    const loadContent = async () => {
      setIsLoading(true)
      try {
        const chunks = await window.api.knowledge.getDocumentChunks(document.id)
        // 병합모든 chunk 의내용
        const fullContent = chunks.map((chunk) => chunk.content).join('\n\n')
        setContent(fullContent)
      } catch (error) {
        console.error('Error loading document content:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadContent()
  }, [document.id])

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

      {/* 문서내용 */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="p-6">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{content}</pre>
            </div>
          </div>
        )}
      </ScrollArea>
    </>
  )
}

export default function SourcePanel(): ReactElement {
  const { t } = useTranslation('ui')
  const { id: notebookId } = useParams()
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [modalType, setModalType] = useState<AddSourceType | null>(null)
  const [defaultEmbeddingModel, setDefaultEmbeddingModel] = useState<string | undefined>(undefined)
  const [selectedDocument, setSelectedDocument] = useState<KnowledgeDocument | null>(null)

  const {
    documents,
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

  // 로드기본임베딩모델설정
  useEffect(() => {
    const loadEmbeddingModel = async () => {
      const model = await window.api.settings.get('defaultEmbeddingModel')
      setDefaultEmbeddingModel(model)
    }
    loadEmbeddingModel()

    // 감시설정변경
    const unsubscribe = window.api.settings.onSettingsChange((newSettings) => {
      setDefaultEmbeddingModel(newSettings.defaultEmbeddingModel)
    })

    return unsubscribe
  }, [])

  // 설정감시
  useEffect(() => {
    const cleanup = setupKnowledgeListeners()
    return cleanup
  }, [])

  // 로드문서및노트
  useEffect(() => {
    if (notebookId) {
      loadDocuments(notebookId)
      loadStats(notebookId)
      loadNotes(notebookId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId])

  // 때 notebook 전환시비우기선택에서의문서
  useEffect(() => {
    setSelectedDocument(null)
  }, [notebookId])

  // 처리파일업로드
  const handleFileUpload = useCallback(async () => {
    if (!notebookId) return

    // 확인예아니오설정기본임베딩모델
    if (!defaultEmbeddingModel) {
      alert(t('noEmbeddingModelConfigured'))
      return
    }

    const files = await selectFiles()
    for (const filePath of files) {
      await addDocumentFromFile(notebookId, filePath)
    }
    setShowAddMenu(false)
  }, [notebookId, defaultEmbeddingModel, selectFiles, addDocumentFromFile, t])

  // 처리 URL 가져오기
  const handleUrlImport = useCallback(
    async (data: { url?: string }) => {
      if (!notebookId || !data.url) return

      // 확인예아니오설정기본임베딩모델
      if (!defaultEmbeddingModel) {
        alert(t('noEmbeddingModelConfigured'))
        setModalType(null)
        return
      }

      await addDocumentFromUrl(notebookId, data.url)
      setModalType(null)
    },
    [notebookId, defaultEmbeddingModel, addDocumentFromUrl, t]
  )

  // 처리텍스트붙여넣기
  const handleTextPaste = useCallback(
    async (data: { title?: string; content?: string }) => {
      if (!notebookId || !data.title || !data.content) return

      // 확인예아니오설정기본임베딩모델
      if (!defaultEmbeddingModel) {
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
    [notebookId, defaultEmbeddingModel, addDocument, t]
  )

  // 처리노트가져오기
  const handleNoteImport = useCallback(
    async (data: { noteId?: string }) => {
      if (!notebookId || !data.noteId) return

      // 확인예아니오설정기본임베딩모델
      if (!defaultEmbeddingModel) {
        alert(t('noEmbeddingModelConfigured'))
        setModalType(null)
        return
      }

      try {
        await addNoteToKnowledge(notebookId, data.noteId)
        setModalType(null)
      } catch (error) {
        // 확인예아니오예빈노트오류
        const errorMessage = (error as Error).message || ''
        if (errorMessage.toLowerCase().includes('empty')) {
          alert(t('emptyNoteCannotImport'))
        } else {
          alert(errorMessage || t('embeddingFailed', { title: '' }))
        }
        setModalType(null)
      }
    },
    [notebookId, defaultEmbeddingModel, addNoteToKnowledge, t]
  )

  // 처리문서 삭제
  const handleDelete = useCallback(
    async (documentId: string) => {
      if (!notebookId) return
      await deleteDocument(notebookId, documentId)
    },
    [notebookId, deleteDocument]
  )

  // 처리열기설정
  const handleOpenSettings = useCallback(() => {
    openSettings()
  }, [openSettings])

  // 처리열기소스파일
  const handleOpenSource = useCallback(async (documentId: string) => {
    try {
      await window.api.knowledge.openSource(documentId)
    } catch (error) {
      console.error('Error opening source:', error)
    }
  }, [])

  // 처리문서점클릭
  const handleSelectDocument = useCallback(
    (document: KnowledgeDocument) => {
      // 텍스트및노트타입으로미리보기，직접표시미리보기페이지
      if (document.type === 'text' || document.type === 'note') {
        setSelectedDocument(document)
      } else {
        // 기타타입（파일、URL）직접열기
        handleOpenSource(document.id)
      }
    },
    [handleOpenSource]
  )

  // 반환목록
  const handleBack = useCallback(() => {
    setSelectedDocument(null)
  }, [])

  // 처리팝업제출
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
    <Card className="flex flex-col rounded-xl border-0 overflow-hidden h-full shadow-md">
      {selectedDocument ? (
        // 문서미리보기페이지
        <DocumentViewerPanel
          key={selectedDocument.id}
          document={selectedDocument}
          onBack={handleBack}
        />
      ) : (
        // 문서목록페이지
        <>
          <PanelHeader
            draggable
            left={
              <span className="text-sm text-foreground truncate w-full select-none">
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
                  disabled={!defaultEmbeddingModel}
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8"
                  title={!defaultEmbeddingModel ? t('noEmbeddingModelConfigured') : t('addSource')}
                >
                  <Plus className="w-4 h-4" />
                </Button>

                {/* 추가메뉴 */}
                {showAddMenu && (
                  <div className="absolute right-0 top-full mt-1 w-40 bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-10">
                    <Button
                      onClick={handleFileUpload}
                      variant="ghost"
                      className="w-full justify-start text-sm font-normal rounded-none"
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
                      className="w-full justify-start text-sm font-normal rounded-none"
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
                      className="w-full justify-start text-sm font-normal rounded-none"
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
                      className="w-full justify-start text-sm font-normal rounded-none"
                    >
                      <StickyNote className="w-4 h-4" />
                      {t('importNote')}
                    </Button>
                  </div>
                )}
              </div>
            }
          />

          {/* 인덱스진행 */}
          <IndexingProgress />

          {/* 문서목록 */}
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <DocumentList
                documents={documents}
                hasEmbeddingModel={!!defaultEmbeddingModel}
                onDeleteDocument={handleDelete}
                onSelectDocument={handleSelectDocument}
                onOpenSettings={handleOpenSettings}
              />
            </ScrollArea>
          )}
        </>
      )}

      {/* 추가출처팝업 - 사용 key 강제 type 변경시재새마운트컴포넌트 */}
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

      {/* 점클릭외부부분닫기메뉴 */}
      {showAddMenu && <div className="fixed inset-0 z-0" onClick={() => setShowAddMenu(false)} />}
    </Card>
  )
}
