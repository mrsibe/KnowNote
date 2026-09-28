import { ReactElement, useState } from 'react'
import {
  Database,
  FileText,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Trash2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KnowledgeDocument } from '../../../../../shared/types/knowledge'
import { SOURCE_KIND_LABEL, sourceKindOf } from '../../../lib/sourceKind'
import { SOURCE_KIND_ICON } from '../../common/sourceIcon'
import { Button } from '../../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../../ui/dropdown-menu'
import ConfirmDialog from '../../common/ConfirmDialog'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent
} from '../../ui/empty'

/**
 * The order the library is grouped in, and the label each group carries.
 *
 * A library is read by scanning, so the sections are stable rather than sorted
 * by size: what a user uploaded sits above what they pasted, every time. The
 * section headings are only rendered when more than one group exists — a
 * heading over the only group is noise, not structure.
 *
 * This is the coarse `document.type`, not the display kind from
 * `lib/sourceKind.ts`: a group of "PDF" with one item in it is a worse table of
 * contents than a group of "Documents".
 */
const SOURCE_GROUPS = ['file', 'url', 'note', 'text'] as const
type SourceGroup = (typeof SOURCE_GROUPS)[number]

const GROUP_LABEL: Record<SourceGroup, string> = {
  file: 'files',
  url: 'webPages',
  note: 'notes',
  text: 'sourceKindText'
}

/**
 * One drawn glyph per kind, shared with the Home page (`components/common/sourceIcon.ts`).
 *
 * The library used to show four generic icons (an upload arrow for every file),
 * which said nothing about what the source *is*.
 */
/** The column is a closed enum in the schema but open at runtime, so an unknown
 * kind falls into the Documents group instead of disappearing from the list. */
function groupOf(document: KnowledgeDocument): SourceGroup {
  const type = document.type
  return SOURCE_GROUPS.includes(type as SourceGroup) ? (type as SourceGroup) : 'file'
}

interface DocumentListProps {
  documents: KnowledgeDocument[]
  hasEmbeddingModel: boolean
  onDeleteDocument: (documentId: string) => void
  onSelectDocument: (document: KnowledgeDocument) => void
  /** 重试一份失败的来源（#95）。 */
  onRetryDocument: (documentId: string) => void
  /** 重建一份来源的派生索引（#95）。 */
  onReindexDocument: (documentId: string) => void
  onOpenSettings: () => void
}

export default function DocumentList({
  documents,
  hasEmbeddingModel,
  onDeleteDocument,
  onSelectDocument,
  onRetryDocument,
  onReindexDocument,
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

  const groups = SOURCE_GROUPS.map((group) => ({
    group,
    documents: documents.filter((document) => groupOf(document) === group)
  })).filter((section) => section.documents.length > 0)

  // A single group needs no heading: the panel header already says "Library".
  const showHeadings = groups.length > 1

  return (
    <div className="p-2 space-y-3">
      {groups.map((section) => (
        <section key={section.group} className="space-y-1">
          {showHeadings && (
            <h2 className="select-none px-2 py-0.5 text-xs font-medium text-subtle-foreground">
              {t(GROUP_LABEL[section.group])}
            </h2>
          )}
          {section.documents.map((doc) => (
            <DocumentItem
              key={doc.id}
              document={doc}
              onDelete={onDeleteDocument}
              onSelect={onSelectDocument}
              onRetry={onRetryDocument}
              onReindex={onReindexDocument}
            />
          ))}
        </section>
      ))}
    </div>
  )
}

// 文档项组件
interface DocumentItemProps {
  document: KnowledgeDocument
  onDelete: (id: string) => void
  onSelect: (document: KnowledgeDocument) => void
  onRetry: (id: string) => void
  onReindex: (id: string) => void
}

function DocumentItem({
  document,
  onDelete,
  onSelect,
  onRetry,
  onReindex
}: DocumentItemProps): ReactElement {
  const { t } = useTranslation('ui')
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  const kind = sourceKindOf(document)
  const KindIcon = SOURCE_KIND_ICON[kind]

  const handleConfirmDelete = () => {
    onDelete(document.id)
  }

  return (
    <DropdownMenu>
      {/* The row reads as a line of text, not as a toolbar: one control lives on
          it, and that control only appears on hover or focus. Retry and re-index
          moved into the menu with delete, which is what stopped every row from
          carrying a permanent column of buttons.

          The row is a real button and the menu trigger is its **sibling**, never
          its child — a button nested in a button is the defect the tab strip
          already fixed (#65, and the same rule the note list follows). The 32px
          trigger is always laid out, so revealing it does not reflow the title. */}
      <div className="group flex items-start gap-0.5 rounded-md transition-colors hover:bg-surface-hover focus-within:bg-surface-hover">
        <button
          type="button"
          onClick={() => onSelect(document)}
          className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="mt-0.5 shrink-0">
            <KindIcon className="w-4 h-4 text-muted-foreground" />
          </span>

          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm text-foreground">{document.title}</span>
            {/* The kind leads the meta line: "202 chunks" alone was the only fact a
                row carried, and it is machine vocabulary. "PDF · 202 chunks" says
                what the source is first. */}
            <span className="truncate text-xs text-subtle-foreground">
              {t(SOURCE_KIND_LABEL[kind])}
              <span aria-hidden="true"> · </span>
              {t('chunks', { count: document.chunkCount ?? 0 })}
            </span>
            {document.status === 'processing' && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                {t('indexing')}
              </span>
            )}
            {/* 失败原因就地显示（#95）：以前是一个 alert，既丢掉了原因也无法重试。 */}
            {document.status === 'failed' && document.errorMessage && (
              <span className="truncate text-xs text-destructive" title={document.errorMessage}>
                {document.errorMessage}
              </span>
            )}
            {/* 来源文件不在了（#158）：citation / 摘录仍然有效，只是文件暂时取不到。 */}
            {document.sourceState === 'missing' && (
              <span className="text-xs text-subtle-foreground">{t('sourceMissing')}</span>
            )}
          </span>
        </button>

        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('moreActions')}
            title={t('moreActions')}
            className="mt-0.5 mr-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:bg-surface-selected hover:text-foreground data-[state=open]:opacity-100 data-[state=open]:bg-surface-selected"
          >
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
      </div>

      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => onSelect(document)}>
          <FileText className="w-4 h-4 text-muted-foreground" />
          {t('openSource')}
        </DropdownMenuItem>
        {document.status === 'failed' && (
          <DropdownMenuItem onSelect={() => onRetry(document.id)}>
            <RotateCcw className="w-4 h-4 text-muted-foreground" />
            {t('retryDocument')}
          </DropdownMenuItem>
        )}
        {document.status === 'indexed' && (
          <DropdownMenuItem onSelect={() => onReindex(document.id)}>
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
            {t('reindexDocument')}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => setIsDeleteDialogOpen(true)}
        >
          <Trash2 className="w-4 h-4" />
          {t('deleteDocument')}
        </DropdownMenuItem>
      </DropdownMenuContent>

      {/* 删除文档确认对话框 */}
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleConfirmDelete}
        title={t('deleteDocument')}
        message={t('confirmDeleteDocument')}
      />
    </DropdownMenu>
  )
}
