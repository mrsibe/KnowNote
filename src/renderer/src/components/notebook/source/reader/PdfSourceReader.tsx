import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useTranslation } from 'react-i18next'
import { Minus, Plus, Loader2 } from 'lucide-react'
import { documentUrl } from '../../../../../../shared/utils/documentUrl'
import type {
  ReaderAnchor,
  ReaderHandle,
  ReaderSelection,
  SourceBlock
} from '../../../../../../shared/types/source'
import { Button } from '../../../ui/button'
import {
  blockById,
  blockRect,
  resolveAnchor,
  resolveSelection,
  type NormalizedPoint
} from './anchor'
import './reader.css'

// The worker is emitted as its own asset by Vite; pointing pdfjs at it keeps the
// whole thing offline and same-origin, which the renderer CSP allows.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const MIN_SCALE = 0.5
const MAX_SCALE = 3

interface PdfSourceReaderProps {
  documentId: string
  blocks: SourceBlock[]
  anchor?: ReaderAnchor | null
  onSelectionChange?: (selection: ReaderSelection | null) => void
}

interface PdfPageProps {
  pdf: PDFDocumentProxy
  pageNumber: number
  scale: number
  blocks: SourceBlock[]
  highlightBlockId: string | null
  registerPage: (pageNumber: number, element: HTMLDivElement | null) => void
}

function PdfPage({
  pdf,
  pageNumber,
  scale,
  blocks,
  highlightBlockId,
  registerPage
}: PdfPageProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })

  useEffect(() => {
    let cancelled = false
    let task: RenderTask | null = null

    const render = async (): Promise<void> => {
      const page = await pdf.getPage(pageNumber)
      if (cancelled) return

      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      if (!canvas) return

      const outputScale = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      setSize({ width: viewport.width, height: viewport.height })

      task = page.render({
        canvas,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0]
      })
      await task.promise
      if (cancelled) return

      const textLayerDiv = textLayerRef.current
      if (textLayerDiv) {
        textLayerDiv.replaceChildren()
        const textLayer = new pdfjs.TextLayer({
          textContentSource: await page.getTextContent(),
          container: textLayerDiv,
          viewport
        })
        await textLayer.render()
      }
    }

    render().catch((error) => {
      if (!cancelled) console.error('Failed to render PDF page', pageNumber, error)
    })

    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [pdf, pageNumber, scale])

  const highlight = blockById(blocks, highlightBlockId)
  const rect =
    highlight && (highlight.page === null || highlight.page === pageNumber) && size.width > 0
      ? blockRect(highlight, size.width, size.height)
      : null

  return (
    <div
      ref={(element) => {
        registerPage(pageNumber, element)
        return undefined
      }}
      data-page-number={pageNumber}
      className="kn-reader__page"
      style={{ width: size.width || undefined, height: size.height || undefined } as CSSProperties}
    >
      <canvas ref={canvasRef} className="kn-reader__canvas" />
      <div
        ref={textLayerRef}
        className="textLayer"
        style={{ '--total-scale-factor': scale } as CSSProperties}
      />
      <div className="kn-reader__overlay">
        {rect && (
          <div
            className="kn-reader__highlight"
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height
            }}
          />
        )}
      </div>
    </div>
  )
}

/**
 * PDF reader（#71）：连续分页 + 文本层（可选中）+ 高亮层。
 *
 * 字节通过 `knownote-doc://` 协议取，渲染进程不接触文件路径。文本层由 pdfjs 的
 * `TextLayer` 生成，高亮层按 `document_blocks.bbox` 归一化坐标绘制。
 */
const PdfSourceReader = forwardRef<ReaderHandle, PdfSourceReaderProps>(function PdfSourceReader(
  { documentId, blocks, anchor, onSelectionChange },
  ref
): ReactElement {
  const { t } = useTranslation('ui')
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageElements = useRef(new Map<number, HTMLDivElement>())
  const lastSelection = useRef<ReaderSelection | null>(null)

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [scale, setScale] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [highlightBlockId, setHighlightBlockId] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const registerPage = useCallback((pageNumber: number, element: HTMLDivElement | null) => {
    if (element) pageElements.current.set(pageNumber, element)
    else pageElements.current.delete(pageNumber)
  }, [])

  const applyAnchor = useCallback(
    (target: ReaderAnchor): void => {
      const { page, block } = resolveAnchor(blocks, target)

      // 每次都重设高亮：新的 anchor 没有块时清掉上一次的，避免旧高亮冒充这次的落点。
      setHighlightBlockId(block?.id ?? null)

      if (page !== null) {
        setCurrentPage(page)
        pageElements.current.get(page)?.scrollIntoView({ block: 'start', behavior: 'auto' })
        return
      }

      // 页码和块都定位不到（例如只有 documentId 的链接）：回到文档顶部。
      scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    },
    [blocks]
  )

  useEffect(() => {
    let cancelled = false
    // pdfjs-dist 6.x moved `destroy()` off `PDFDocumentProxy` and onto the loading task,
    // so the task is what has to be held on to for teardown (the document keeps only
    // `cleanup()`).
    let loaded: PDFDocumentLoadingTask | null = null

    const load = async (): Promise<void> => {
      const response = await fetch(documentUrl(documentId))
      if (!response.ok) throw new Error(`Document request failed: ${response.status}`)
      const data = new Uint8Array(await response.arrayBuffer())
      // 这个 reader 只做 `page.render()`（canvas）和 `TextLayer`，刻意不构造 AnnotationLayer、
      // 也不导入 `pdfjs-dist/web/*` —— 而 `enableScripting` 只存在于 AnnotationLayer / viewer
      // 上，不在 `getDocument` 参数里，所以这里没有可以传的开关（#121 /
      // GHSA-hq66-cqwq-w95j）。也就是说**在当前检查过的调用点下漏洞路径不可达**，
      // 前提由 `test/pdfjsScriptingBoundary.test.ts` 守住。
      const task = pdfjs.getDocument({ data })
      loaded = task
      const doc = await task.promise
      if (cancelled) {
        // 置空再销毁，让卸载路径不再重复销毁同一个 task。
        loaded = null
        await task.destroy()
        return
      }
      setPdf(doc)
      setNumPages(doc.numPages)
      setStatus('ready')
    }

    load().catch((error) => {
      if (!cancelled) {
        console.error('Failed to open PDF', error)
        setStatus('error')
      }
    })

    return () => {
      cancelled = true
      void loaded?.destroy()
    }
  }, [documentId])

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

  // An anchor can arrive before the pages have rendered (a citation click that
  // mounts the reader). rAF defers the scroll until layout exists, instead of
  // setting state synchronously inside the effect body.
  useEffect(() => {
    if (!anchor || status !== 'ready') return
    const frame = requestAnimationFrame(() => applyAnchor(anchor))
    return () => cancelAnimationFrame(frame)
  }, [anchor, status, numPages, applyAnchor])

  const handleSelection = useCallback((): void => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      lastSelection.current = null
      onSelectionChange?.(null)
      return
    }
    const range = selection.getRangeAt(0)
    if (!scrollRef.current?.contains(range.commonAncestorContainer)) {
      lastSelection.current = null
      onSelectionChange?.(null)
      return
    }

    const startNode =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement
    const pageElement = startNode?.closest('[data-page-number]') as HTMLElement | null
    const pageNumber = pageElement ? Number(pageElement.dataset.pageNumber) : null

    let point: { page: number | null; normalized: NormalizedPoint } | null = null
    const pageRect = pageElement?.getBoundingClientRect()
    const selectionRect = range.getBoundingClientRect()
    if (pageRect && pageRect.width > 0 && pageRect.height > 0) {
      point = {
        page: pageNumber,
        normalized: {
          x: (selectionRect.left - pageRect.left) / pageRect.width,
          y: (selectionRect.top - pageRect.top) / pageRect.height
        }
      }
    }

    const resolved = resolveSelection(documentId, selection.toString(), blocks, point, null)
    lastSelection.current = resolved
    onSelectionChange?.(resolved)
  }, [blocks, documentId, onSelectionChange])

  const handleScroll = useCallback((): void => {
    const container = scrollRef.current
    if (!container) return
    const top = container.getBoundingClientRect().top
    let nearest = 1
    let nearestDistance = Number.POSITIVE_INFINITY
    for (const [pageNumber, element] of pageElements.current) {
      const distance = Math.abs(element.getBoundingClientRect().top - top)
      if (distance < nearestDistance) {
        nearest = pageNumber
        nearestDistance = distance
      }
    }
    setCurrentPage(nearest)
  }, [])

  const zoom = useCallback((factor: number) => {
    setScale((value) =>
      Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number((value * factor).toFixed(2))))
    )
  }, [])

  const pages = useMemo(() => Array.from({ length: numPages }, (_, index) => index + 1), [numPages])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        <span>{t('readerPage', { current: currentPage, total: numPages })}</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => zoom(1 / 1.2)}
            title={t('readerZoomOut')}
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="w-10 text-center tabular-nums">{Math.round(scale * 100)}%</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => zoom(1.2)}
            title={t('readerZoomIn')}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {status === 'error' ? (
        <div className="kn-reader__fallback text-sm text-muted-foreground">
          {t('readerPdfUnavailable')}
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="kn-reader"
          onScroll={handleScroll}
          onMouseUp={handleSelection}
        >
          {status === 'loading' && (
            <div className="kn-reader__fallback">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          <div className="kn-reader__pages">
            {pdf &&
              pages.map((pageNumber) => (
                <PdfPage
                  key={pageNumber}
                  pdf={pdf}
                  pageNumber={pageNumber}
                  scale={scale}
                  blocks={blocks}
                  highlightBlockId={highlightBlockId}
                  registerPage={registerPage}
                />
              ))}
          </div>
        </div>
      )}
    </div>
  )
})

export default PdfSourceReader
