import { forwardRef, useEffect, useState, type ReactElement } from 'react'
import { Loader2 } from 'lucide-react'
import type { KnowledgeDocument } from '../../../../../../shared/types/knowledge'
import type {
  ReaderAnchor,
  ReaderHandle,
  ReaderSelection,
  SourceBlock
} from '../../../../../../shared/types/source'
import PdfSourceReader from './PdfSourceReader'
import TextSourceReader from './TextSourceReader'

interface SourceReaderProps {
  document: KnowledgeDocument
  anchor?: ReaderAnchor | null
  onSelectionChange?: (selection: ReaderSelection | null) => void
}

/** A stored PDF is the format with pages; everything else uses the text reader. */
function isPdf(document: KnowledgeDocument): boolean {
  if (document.mimeType === 'application/pdf') return true
  const path = document.localFilePath ?? document.sourceUri ?? ''
  return path.toLowerCase().endsWith('.pdf')
}

/**
 * 阅读器入口（#71）。选 PDF 还是文本实现是这里唯一的分支；两者对下游暴露同一个
 * `ReaderHandle`。结构块（页码 / bbox）在一次 IPC 里取回后传给实现。
 */
const SourceReader = forwardRef<ReaderHandle, SourceReaderProps>(function SourceReader(
  { document, anchor, onSelectionChange },
  ref
): ReactElement {
  const [blocks, setBlocks] = useState<SourceBlock[] | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.knowledge
      .getDocumentBlocks(document.id)
      .then((loaded) => {
        if (!cancelled) setBlocks(loaded)
      })
      .catch((error) => {
        console.error('Failed to load document blocks', error)
        if (!cancelled) setBlocks([])
      })
    return () => {
      cancelled = true
    }
  }, [document.id])

  if (blocks === null) {
    return (
      <div className="kn-reader__fallback">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // `key` remounts the reader when the document changes, so per-document state
  // (loaded bytes, zoom, highlight) never leaks across sources.
  return isPdf(document) ? (
    <PdfSourceReader
      key={document.id}
      ref={ref}
      documentId={document.id}
      blocks={blocks}
      anchor={anchor}
      onSelectionChange={onSelectionChange}
    />
  ) : (
    <TextSourceReader
      key={document.id}
      ref={ref}
      documentId={document.id}
      content={document.content ?? ''}
      blocks={blocks}
      anchor={anchor}
      onSelectionChange={onSelectionChange}
    />
  )
})

export default SourceReader
