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

  // 未配置嵌入模型的提示（优先级最高）
  if (!hasEmbeddingModel && documents.length === 0) {
    return (
      <Empty className="border-none">
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

  // 暂无文档的空状态（使用Empty组件重构）
  if (documents.length === 0) {
    return (
      <Empty className="border-none">
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

// 文档项组件
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

  // 显示失败提示（仅一次）
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
    <div className="group grid grid-cols-[1fr_auto] items-start gap-1 rounded-md transition-colors hover:bg-surface-hover">
      {/* The row is a real button, not a click handler on a div: it is the primary
          way into a source, so it must be reachable and activatable by keyboard
          (#65). The delete control is its sibling rather than a child — a button
          nested in a button is the same defect the tab strip already fixed. */}
      <button
        type="button"
        onClick={() => onSelect(document)}
        className="grid min-w-0 cursor-pointer grid-cols-[auto_1fr] select-none items-start gap-2 rounded-md px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {/* 图标列 - 固定宽度 */}
        {getTypeIcon()}

        {/* 内容列 - 可被压缩 */}
        <div className="min-w-0 flex flex-col gap-1">
          <h3 className="text-sm font-medium truncate">{document.title}</h3>
          <p className="text-xs text-subtle-foreground">{document.chunkCount} chunks</p>
          {document.status === 'processing' && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              {t('indexing')}
            </p>
          )}
        </div>
      </button>

      {/* 删除按钮列 - 固定宽度 */}
      <Button
        onClick={() => setIsDeleteDialogOpen(true)}
        variant="ghost"
        size="icon"
        className="mt-2 mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-destructive hover:bg-destructive/10 hover:text-destructive"
        title={t('deleteDocument')}
      >
        <Trash2 className="w-4 h-4" />
      </Button>

      {/* 删除文档确认对话框 */}
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
