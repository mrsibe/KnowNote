import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import type {
  ReaderAnchor,
  ReaderHandle,
  ReaderSelection,
  SourceBlock
} from '../../../../../../shared/types/source'
import { resolveAnchor, resolveSelection } from './anchor'
import './reader.css'

interface TextSourceReaderProps {
  documentId: string
  content: string
  blocks: SourceBlock[]
  anchor?: ReaderAnchor | null
  onSelectionChange?: (selection: ReaderSelection | null) => void
}

interface HighlightRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * 非 PDF 来源的文本阅读器（#71）。与 PDF reader 实现同一 `openAt` / `getSelection`
 * 契约：下游不需要知道挂载的是哪一种实现。按字符偏移滚动并用 `Range` 画高亮，
 * 不修改正文 DOM。
 */
const TextSourceReader = forwardRef<ReaderHandle, TextSourceReaderProps>(function TextSourceReader(
  { documentId, content, blocks, anchor, onSelectionChange },
  ref
): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const lastSelection = useRef<ReaderSelection | null>(null)
  const [highlightRects, setHighlightRects] = useState<HighlightRect[]>([])

  const applyAnchor = useCallback(
    (target: ReaderAnchor): void => {
      const { block } = resolveAnchor(blocks, target)
      const start = target.startOffset ?? block?.startOffset ?? null
      const end = target.endOffset ?? block?.endOffset ?? null

      const node = contentRef.current?.firstChild
      const container = scrollRef.current
      if (!node || start === null || !container) {
        // 定位不到就清掉上一次的高亮，不要让旧高亮留在屏幕上。
        setHighlightRects([])
        return
      }

      const limit = node.textContent?.length ?? 0
      const range = window.document.createRange()
      range.setStart(node, Math.max(0, Math.min(start, limit)))
      range.setEnd(node, Math.max(0, Math.min(end ?? start, limit)))

      const containerRect = container.getBoundingClientRect()
      const rects = Array.from(range.getClientRects()).map((rect) => ({
        left: rect.left - containerRect.left + container.scrollLeft,
        top: rect.top - containerRect.top + container.scrollTop,
        width: rect.width,
        height: rect.height
      }))
      setHighlightRects(rects)

      const first = rects[0]
      if (first) container.scrollTo({ top: Math.max(0, first.top - 80), behavior: 'auto' })
    },
    [blocks]
  )

  useImperativeHandle(
    ref,
    () => ({
      openAt(target: ReaderAnchor): void {
        applyAnchor(target)
      },
      getSelection(): ReaderSelection | null {
        return lastSelection.current
      }
    }),
    [applyAnchor]
  )

  useEffect(() => {
    if (!anchor) return
    const frame = requestAnimationFrame(() => applyAnchor(anchor))
    return () => cancelAnimationFrame(frame)
  }, [anchor, blocks, applyAnchor])

  const handleSelection = useCallback((): void => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      lastSelection.current = null
      onSelectionChange?.(null)
      return
    }
    const range = selection.getRangeAt(0)
    const node = contentRef.current?.firstChild
    if (!node || !contentRef.current?.contains(range.commonAncestorContainer)) {
      lastSelection.current = null
      onSelectionChange?.(null)
      return
    }

    // The body is a single text node, so a range offset is already an absolute
    // document offset — no approximation needed here.
    const offset = range.startContainer === node ? range.startOffset : null
    const resolved = resolveSelection(documentId, selection.toString(), blocks, null, offset)
    lastSelection.current = resolved
    onSelectionChange?.(resolved)
  }, [blocks, documentId, onSelectionChange])

  return (
    <div
      ref={scrollRef}
      className="kn-reader"
      onMouseUp={handleSelection}
      onKeyUp={handleSelection}
    >
      <div className="kn-reader__overlay">
        {highlightRects.map((rect, index) => (
          <div
            key={index}
            className="kn-reader__highlight"
            style={
              {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div ref={contentRef} className="kn-reader__text">
        {content}
      </div>
    </div>
  )
})

export default TextSourceReader
