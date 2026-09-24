import { ReactElement, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatMessage } from '../../../../../shared/types/chat'
import MessageItem from './MessageItem'
import { ScrollArea } from '../../ui/scroll-area'
import { Button } from '../../ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../ui/empty'
// messageList.css 已合并到 effects.css（通过 main.css 全局导入）

interface MessageListProps {
  messages: ChatMessage[]
}

/** How close to the bottom still counts as "following the answer". */
const PINNED_THRESHOLD = 48

export default function MessageList({ messages }: MessageListProps): ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const [isPinned, setIsPinned] = useState(true)
  const { t } = useTranslation()

  const scrollToBottom = useCallback((): void => {
    // Deliberately instant, not smooth: while an answer streams this effect runs
    // per token, and an animated scroll queued that often never settles — it
    // fights the reader and burns frames instead of following the text.
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [])

  // Follow the transcript only while the reader is already at the bottom.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const handleScroll = (): void => {
      const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      const pinned = distance <= PINNED_THRESHOLD
      pinnedRef.current = pinned
      setIsPinned(pinned)
    }

    viewport.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => viewport.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    // Scrolling up to re-read a passage used to be impossible: every streamed
    // token forced the view back down, so the reader lost their place mid-sentence.
    if (!pinnedRef.current) return
    scrollToBottom()
  }, [messages, scrollToBottom])

  // 空状态与消息列表共用同一个 ScrollArea：视口必须在首次渲染就存在，
  // 否则下面那个 `[]` 依赖的 scroll 订阅会在 viewportRef 为空时直接返回，
  // 之后再也不会重试 —— pinnedRef 会永远是 true，跟随/回到最新全部失效。
  return (
    <div className="relative h-full">
      <ScrollArea className="h-full" viewportRef={viewportRef}>
        {messages.length === 0 ? (
          <div className="flex min-h-full items-center justify-center p-8">
            <Empty className="border-none">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageSquare className="w-6 h-6" />
                </EmptyMedia>
                <EmptyTitle>{t('ui:newChat')}</EmptyTitle>
                <EmptyDescription>{t('ui:noMessages')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          <div className="px-4 py-6 pb-32">
            <div className="space-y-4">
              {messages.map((message) => (
                <MessageItem key={message.id} message={message} />
              ))}
              {/* 滚动锚点 */}
              <div ref={bottomRef} />
            </div>
          </div>
        )}
      </ScrollArea>

      {!isPinned && messages.length > 0 && (
        // `bottom-32` matches the `pb-32` reserve above, so the pill lands in the
        // gap between the last message and the floating composer.
        <Button
          variant="outline"
          size="sm"
          onClick={scrollToBottom}
          className="absolute bottom-32 left-1/2 -translate-x-1/2 bg-surface-overlay shadow-elevation"
        >
          <ArrowDown className="w-3 h-3" />
          {t('ui:jumpToLatest')}
        </Button>
      )}
    </div>
  )
}
