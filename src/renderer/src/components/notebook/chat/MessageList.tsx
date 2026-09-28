import {
  forwardRef,
  ReactElement,
  ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react'
import { ArrowDown, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatMessage } from '../../../../../shared/types/chat'
import MessageItem from './MessageItem'
import { ScrollArea } from '../../ui/scroll-area'
import { Button } from '../../ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../ui/empty'
import { isAnswerLive } from '../../../../../shared/utils/answerState'
import { BACK_TO_BOTTOM_BOTTOM, COMPOSER_RESERVE, isPinnedToBottom } from './stickToBottom'
// messageList.css 已合并到 effects.css（通过 main.css 全局导入）

export interface MessageListHandle {
  /** Follow the transcript again and jump to the end, whatever the scroll was. */
  pinToBottom: () => void
}

interface MessageListProps {
  messages: ChatMessage[]
  /**
   * Rendered as the first block inside the scroll area, above the messages.
   *
   * A node rather than a set of props: the transcript does not know what a
   * notebook is, and the header has to scroll with the answer rather than sit
   * pinned above the scroll area, which would change the geometry the composer
   * reserve and the follow behaviour are measured against.
   */
  header?: ReactNode
}

/** A user who asked for reduced motion gets the jump without the animation. */
function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

const MessageList = forwardRef<MessageListHandle, MessageListProps>(function MessageList(
  { messages, header },
  ref
): ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  // True while an animated `pinToBottom` is still travelling. The scroll events
  // it emits are the animation, not the reader leaving, so they must not
  // unfollow the transcript halfway down.
  const programmaticRef = useRef(false)
  const [isPinned, setIsPinned] = useState(true)
  // Completion announcements. Kept as `{ text, id }` so the node is replaced and
  // the live region re-announces: setting the same string twice is a no-op for a
  // screen reader.
  const [announcement, setAnnouncement] = useState<{ text: string; id: number } | null>(null)
  const streamingRef = useRef(false)
  const { t } = useTranslation()

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : undefined
  // The record says whether the turn is still arriving (#142).
  const isStreaming = isAnswerLive(lastMessage?.status)
  const hasMessages = messages.length > 0

  useEffect(() => {
    // Announce the END of a turn, never its tokens. A live region on the
    // transcript would re-announce on every token, which is worse than silence —
    // the previous state of this surface was no announcement at all, and the
    // product's entire output arrived silently.
    if (streamingRef.current && !isStreaming) {
      setAnnouncement((previous) => ({
        text: t('ui:answerComplete'),
        id: (previous?.id ?? 0) + 1
      }))
    }
    streamingRef.current = isStreaming
  }, [isStreaming, t])

  // Land on the true bottom of the scroll viewport, not on an anchor near it. An
  // anchor's `scrollIntoView` stops short of the reserved composer space, which
  // is what left the last line behind the composer.
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto'): void => {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.scrollTo({ top: viewport.scrollHeight, behavior })
  }, [])

  const pinToBottom = useCallback((): void => {
    pinnedRef.current = true
    setIsPinned(true)
    const viewport = viewportRef.current
    if (!viewport) return
    // Smooth for a deliberate jump; instant while an answer streams, where the
    // content keeps growing underneath the animation and would cancel it. Already
    // at the bottom, there is nothing to animate and no scroll event will arrive
    // to clear the lock — so no lock is taken.
    const smooth = !isStreaming && !prefersReducedMotion() && !isPinnedToBottom(viewport)
    programmaticRef.current = smooth
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [isStreaming])

  useImperativeHandle(ref, () => ({ pinToBottom }), [pinToBottom])

  // Follow the transcript only while the reader is already near the bottom.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const handleScroll = (): void => {
      const pinned = isPinnedToBottom(viewport)
      if (programmaticRef.current) {
        // Still animating: only arrival clears the lock, so the follow re-arms
        // the instant the view lands instead of being cancelled part-way.
        if (!pinned) return
        programmaticRef.current = false
      }
      pinnedRef.current = pinned
      setIsPinned(pinned)
    }

    // A wheel, a touch drag or a key is the reader taking over; cancel a running
    // animation so the next scroll event is judged on its own.
    const cancelProgrammatic = (): void => {
      programmaticRef.current = false
    }

    viewport.addEventListener('scroll', handleScroll, { passive: true })
    viewport.addEventListener('wheel', cancelProgrammatic, { passive: true })
    viewport.addEventListener('touchmove', cancelProgrammatic, { passive: true })
    viewport.addEventListener('keydown', cancelProgrammatic)
    // No initial `handleScroll()`: a fresh viewport sits at the top, and the
    // follow effect below is about to move it to the bottom. Reading the
    // position here would unfollow before it ever ran.
    return () => {
      viewport.removeEventListener('scroll', handleScroll)
      viewport.removeEventListener('wheel', cancelProgrammatic)
      viewport.removeEventListener('touchmove', cancelProgrammatic)
      viewport.removeEventListener('keydown', cancelProgrammatic)
    }
  }, [])

  useEffect(() => {
    // Scrolling up to re-read a passage used to be impossible: every streamed
    // token forced the view back down, so the reader lost their place mid-sentence.
    if (!pinnedRef.current) return
    scrollToBottom()
  }, [messages, scrollToBottom])

  // Streaming changes the height of one message, not the number of messages: the
  // array above is replaced per token today, but Markdown reflow, a highlighted
  // code block, a decoded image or an opened source disclosure change the height
  // with no message event at all. Watch the content itself.
  useEffect(() => {
    if (!hasMessages) return
    const content = contentRef.current
    if (!content) return

    const observer = new ResizeObserver(() => {
      if (!pinnedRef.current) return
      scrollToBottom()
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [hasMessages, scrollToBottom])

  // The empty state and the message list must share ONE ScrollArea: the scroll
  // subscription above runs once, so a viewport that only appears after messages
  // arrive would never be observed and the follow would silently never work.
  return (
    <div className="relative h-full">
      {/* Completion only, and never the tokens in between. */}
      <div key={announcement?.id ?? 0} role="status" aria-live="polite" className="sr-only">
        {announcement?.text}
      </div>

      <ScrollArea className="h-full" viewportRef={viewportRef}>
        {header && (
          <div className="mx-auto w-full max-w-[var(--reading-measure)] px-4">{header}</div>
        )}

        {!hasMessages ? (
          // No `min-h-full`: with the header above it, a full-height box would
          // push the empty state down by a viewport and invent a scrollbar.
          <div className="mx-auto flex w-full max-w-[var(--reading-measure)] items-center justify-center px-4 py-16">
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
          // Observed for height so the follow survives reflow without a message
          // event. The reserved space keeps the last line above the composer.
          <div
            ref={contentRef}
            className="mx-auto w-full max-w-[var(--reading-measure)] px-4 py-6"
            style={{ paddingBottom: COMPOSER_RESERVE }}
          >
            <div className="space-y-4">
              {messages.map((message) => (
                <MessageItem key={message.id} message={message} />
              ))}
            </div>
          </div>
        )}
      </ScrollArea>

      {!isPinned && hasMessages && (
        // Icon-only, centred over the composer: the control means "the end of
        // this transcript", not a global action. The label carries the meaning a
        // text pill would have spent space on.
        <Button
          variant="outline"
          size="icon"
          onClick={pinToBottom}
          title={t('ui:jumpToLatest')}
          aria-label={t('ui:jumpToLatest')}
          className="absolute left-1/2 -translate-x-1/2 rounded-full bg-surface-overlay shadow-elevation"
          style={{ bottom: BACK_TO_BOTTOM_BOTTOM }}
        >
          <ArrowDown />
        </Button>
      )}
    </div>
  )
})

export default MessageList
