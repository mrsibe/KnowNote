import { ReactElement, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import { ScrollArea, ScrollBar } from '../../ui/scroll-area'
import { Button } from '../../ui/button'

interface ReasoningContentProps {
  content: string
  isStreaming: boolean
}

export default function ReasoningContent({
  content,
  isStreaming
}: ReasoningContentProps): ReactElement {
  const { t } = useTranslation('chat')
  const [isExpanded, setIsExpanded] = useState(false)

  // 감시사고고려상태변경，자동제어확장열기/접기
  // 사고고려시작 → 자동확장열기
  // 사고고려종료 → 자동접기
  /* eslint-disable */
  useEffect(() => {
    if (isStreaming) {
      setIsExpanded(true)
    } else {
      setIsExpanded(false)
    }
  }, [isStreaming])
  /* eslint-enable */

  // 만약없있는내용또한아닌스트림형식전달입출력，아닌표시
  if (!content && !isStreaming) {
    return <></>
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-muted/30 shadow-sm">
      {/* 헤더부분：확장열기/접기버튼 */}
      <Button
        onClick={() => setIsExpanded(!isExpanded)}
        variant="ghost"
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs h-auto hover:bg-muted/50"
      >
        <div className="flex items-center gap-1.5">
          {/* 사고고려도표 */}
          <svg
            className="w-3.5 h-3.5 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>

          {/* 제목 */}
          <span className="font-medium text-foreground">
            {isStreaming ? t('thinkingInProgress') : t('thinkingProcess')}
          </span>

          {/* 스트림형식전달입출력동그리기 */}
          {isStreaming && (
            <span className="inline-block w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
          )}
        </div>

        {/* 확장열기/접기도표 */}
        <svg
          className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${
            isExpanded ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </Button>

      {/* 내용영역：확장열기시표시 */}
      {isExpanded && (
        <div className="border-t border-border">
          <ScrollArea>
            <div className="px-3 py-2">
              {content ? (
                <div className="markdown-content text-xs text-muted-foreground">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeHighlight, rehypeKatex]}
                    components={{
                      a: ({ children, ...props }) => (
                        <a target="_blank" rel="noopener noreferrer" {...props}>
                          {children}
                        </a>
                      ),
                      // Table: wrap in scrollable container
                      table: ({ children, ...props }) => (
                        <ScrollArea className="w-full">
                          <table {...props}>{children}</table>
                          <ScrollBar orientation="horizontal" />
                        </ScrollArea>
                      )
                    }}
                  >
                    {content}
                  </ReactMarkdown>
                  {/* 스트림형식전달입출력빛표 */}
                  {isStreaming && (
                    <span className="inline-block w-2 h-3 ml-1 bg-muted-foreground/50 animate-pulse" />
                  )}
                </div>
              ) : (
                // 빈내용시표시플레이스홀더
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{t('thinkingShort')}</span>
                  <span className="inline-block w-2 h-3 bg-muted-foreground/50 animate-pulse" />
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}
