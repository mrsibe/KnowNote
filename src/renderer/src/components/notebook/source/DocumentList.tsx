import { ReactElement, useRef, useEffect, useState } from 'react'
import { FileText, Globe, FileUp, StickyNote, Trash2, Loader2, Database } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KnowledgeDocument } from '../../../../../shared/types/knowledge'
import { Button } from '../../ui/button'
import ConfirmDialog from '../../common/ConfirmDialog'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent
} from '../../ui/empty'

interface DocumentListProps {
  documents: KnowledgeDocument[]
  hasEmbeddingModel: boolean
  onDeleteDocument: (documentId: string) => void
  onSelectDocument: (document: KnowledgeDocument) => void
  onOpenSettings: () => void
}

export default function DocumentList({
  documents,
  hasEmbeddingModel,
  onDeleteDocument,
  onSelectDocument,
  onOpenSettings
}: DocumentListProps): ReactElement {
  const { t } = useTranslation('ui')

  // 구성되지 않음임베딩모델의힌트（우선순위가장높은）
  if (!hasEmbeddingModel && documents.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Database className="w-12 h-12 text-muted-foreground" />
          </EmptyMedia>
          <EmptyTitle>{t('noEmbeddingModelConfigured')}</EmptyTitle>
          <EmptyDescription>{t('noEmbeddingModelConfiguredDesc')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onOpenSettings}>{t('goToSettings')}</Button>
        </EmptyContent>
      </Empty>
    )
  }

  // 임시없음문서의빈상태（사용Empty컴포넌트재구조）
  if (documents.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileText className="w-12 h-12 text-muted-foreground" />
          </EmptyMedia>
          <EmptyTitle>{t('noDocuments')}</EmptyTitle>
          <EmptyDescription>{t('noDocumentsDesc')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="p-2 space-y-1">
      {documents.map((doc) => (
        <DocumentItem
          key={doc.id}
          document={doc}
          onDelete={onDeleteDocument}
          onSelect={onSelectDocument}
        />
      ))}
    </div>
  )
}

// 문서항목컴포넌트
interface DocumentItemProps {
  document: KnowledgeDocument
  onDelete: (id: string) => void
  onSelect: (document: KnowledgeDocument) => void
}

function DocumentItem({ document, onDelete, onSelect }: DocumentItemProps): ReactElement {
  const { t } = useTranslation('ui')
  const hasShownErrorRef = useRef(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  const getTypeIcon = () => {
    const iconClass = 'w-4 h-4 mt-0.5 text-muted-foreground'
    switch (document.type) {
      case 'file':
        return <FileUp className={iconClass} />
      case 'url':
        return <Globe className={iconClass} />
      case 'note':
        return <StickyNote className={iconClass} />
      default:
        return <FileText className={iconClass} />
    }
  }

  // 표시실패힌트（만하나번）
  useEffect(() => {
    if (document.status === 'failed' && !hasShownErrorRef.current) {
      hasShownErrorRef.current = true
      alert(t('embeddingFailed', { title: document.title }))
    }
  }, [document.status, document.title, t])

  const handleConfirmDelete = () => {
    onDelete(document.id)
  }

  return (
    <div
      onClick={() => onSelect(document)}
      className="group grid grid-cols-[auto_1fr_auto] gap-2 items-start p-3 rounded-lg transition-colors cursor-pointer select-none hover:bg-muted"
    >
      {/* 도표컬럼 - 고정너비 */}
      {getTypeIcon()}

      {/* 내용컬럼 - 압축 */}
      <div className="min-w-0 flex flex-col gap-1">
        <h3 className="text-sm font-medium truncate">{document.title}</h3>
        <p className="text-xs text-muted-foreground">{document.chunkCount} chunks</p>
        {document.status === 'processing' && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            {t('indexing')}
          </p>
        )}
      </div>

      {/* 삭제버튼컬럼 - 고정너비 */}
      <Button
        onClick={(e) => {
          e.stopPropagation()
          setIsDeleteDialogOpen(true)
        }}
        variant="ghost"
        size="icon"
        className="opacity-0 group-hover:opacity-100 w-8 h-8 mt-0.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
        title={t('deleteDocument')}
      >
        <Trash2 className="w-4 h-4" />
      </Button>

      {/* 문서 삭제확인다이얼로그 */}
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleConfirmDelete}
        title={t('deleteDocument')}
        message={t('confirmDeleteDocument')}
      />
    </div>
  )
}
