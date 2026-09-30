import { memo, useState, useEffect, useRef, ReactElement } from 'react'
import {
  Send,
  StopCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chatStore'
import { useNotebookStore } from '../../store/notebookStore'
import { useKnowledgeStore } from '../../store/knowledgeStore'
import { useUIStore } from '../../store/uiStore'
import { parseRetrievalScope } from '../../../../shared/types/scope'
import { FOCUS_CHAT_EVENT } from '../../lib/workspaceEvents'
import MessageList, { type MessageListHandle } from './chat/MessageList'
import NotebookHeader from './chat/NotebookHeader'
import ScopeSelector from './chat/ScopeSelector'
import SessionSwitcher from './chat/SessionSwitcher'
import SessionContinuationNotice from './chat/SessionContinuationNotice'
import { COMPOSER_GAP, COMPOSER_RESERVE, COMPOSER_RESERVE_VAR } from './chat/stickToBottom'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { Card } from '../ui/card'
import { PanelHeader } from '../ui/panel-header'

interface ProcessPanelProps {
  onToggleLeft?: () => void
  onToggleRight?: () => void
  isLeftCollapsed?: boolean
  isRightCollapsed?: boolean
}

function ProcessPanel({
  onToggleLeft,
  onToggleRight,
  isLeftCollapsed = false,
  isRightCollapsed = false
}: ProcessPanelProps = {}): ReactElement {
  const { t } = useTranslation('ui')
  const [input, setInput] = useState('')
  const [hasChatModel, setHasChatModel] = useState(false)
  const {
    currentSession,
    messages,
    isNotebookStreaming,
    sendMessage,
    abortMessage,
    setSessionScope
  } = useChatStore()
  const { currentNotebook, updateNotebook } = useNotebookStore()
  const documents = useKnowledgeStore((state) => state.documents)
  const focusedSource = useUIStore((state) => state.focusedSource)

  // 这次提问的来源范围（#94）。scope 是 session 的属性；没有 session 时就是默认的
  // 整个 notebook。
  const scope = parseRetrievalScope(currentSession?.retrievalScope)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messageListRef = useRef<MessageListHandle>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)

  const currentNotebookId = currentSession?.notebookId
  const isCurrentNotebookStreaming = currentNotebookId
    ? isNotebookStreaming(currentNotebookId)
    : false
  const canSend = currentSession && !isCurrentNotebookStreaming && input.trim() && hasChatModel
  const canStop = currentSession && isCurrentNotebookStreaming

  // Check whether a chat model connection is configured
  const checkChatModel = async (): Promise<void> => {
    try {
      const connections = await window.api.connections.getAll()
      setHasChatModel(Boolean(connections.chat))
    } catch (error) {
      console.error('Failed to check model connection:', error)
      setHasChatModel(false)
    }
  }

  // Add useEffect listeners
  useEffect(() => {
    // 1. Check on page load
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkChatModel()

    // 2. Listen for connection configuration change events
    const cleanup = window.api.connections.onChanged(() => {
      void checkChatModel()
    })

    return cleanup
  }, [])

  const handleSend = (): void => {
    if (!canSend) return

    sendMessage(currentSession.id, input.trim())
    setInput('')
    // The reader may have scrolled up meanwhile: their own message must always
    // land in view, regardless of the follow state.
    messageListRef.current?.pinToBottom()
  }

  const handleStop = async (): Promise<void> => {
    if (!canStop || !currentNotebookId) return
    await abortMessage(currentNotebookId)
  }

  // 使用 ref 存储 handleSend 函数的引用，避免事件监听器频繁重注册
  const handleSendRef = useRef<() => void>(() => {})

  // 保持 ref 指向最新的 handleSend 函数
  useEffect(() => {
    handleSendRef.current = handleSend
  })

  // 监听发送消息快捷键（只注册一次）
  useEffect(() => {
    const handleSendShortcut = () => {
      handleSendRef.current()
    }

    window.addEventListener('shortcut:send-message', handleSendShortcut)

    return () => {
      window.removeEventListener('shortcut:send-message', handleSendShortcut)
    }
  }, [])

  /**
   * Focus-return fallback (#65).
   *
   * Closing the reader normally returns focus to whatever opened it (a citation
   * chip, a note excerpt link). When there is no such origin — a deep link, a
   * restored session — `SourcePanel` asks the composer to take focus instead of
   * letting it fall to `<body>`. A custom event rather than a store field: it is
   * a one-shot instruction to the mounted composer, not UI state.
   */
  useEffect(() => {
    const focusComposer = (): void => {
      textareaRef.current?.focus()
    }
    window.addEventListener(FOCUS_CHAT_EVENT, focusComposer)
    return () => window.removeEventListener(FOCUS_CHAT_EVENT, focusComposer)
  }, [])

  // 面板切换快捷键（`shortcut:toggle-*`）现在由 `ResizableLayout` 处理：它拥有侧栏
  // 的折叠状态与 zone focus target，并且快捷键的语义已从「显示/隐藏面板」变成
  // 「进入该工作区」（#65）。顶部按钮仍然走 `onToggleLeft` / `onToggleRight`。

  // The composer floats over the transcript, so the transcript reserves its
  // height plus a gap. Measured rather than fixed: the reserve used to be a
  // hardcoded `pb-32` while the composer grew with the scope row and the
  // auto-resizing textarea, so a long question left the last answer line behind
  // the input. Published as a CSS variable on the card because `MessageList`
  // (the reserve) and the fade below both read it.
  useEffect(() => {
    const composer = composerRef.current
    const card = cardRef.current
    if (!composer || !card) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      const height = entry.borderBoxSize?.[0]?.blockSize ?? composer.getBoundingClientRect().height
      card.style.setProperty(COMPOSER_RESERVE_VAR, `${height + COMPOSER_GAP}px`)
    })
    observer.observe(composer)
    return () => observer.disconnect()
  }, [])

  // Auto-resize textarea based on content
  const adjustTextareaHeight = (): void => {
    const textarea = textareaRef.current
    if (!textarea) return

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto'

    // Calculate new height with min and max constraints
    const minHeight = 84 // ~3 rows
    const maxHeight = 280 // ~10 rows
    const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)

    textarea.style.height = `${newHeight}px`
  }

  // Handle input change with auto-resize
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setInput(e.target.value)
    adjustTextareaHeight()
  }

  // Adjust height when input changes externally (e.g., after sending)
  useEffect(() => {
    adjustTextareaHeight()
  }, [input])

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // Send only. Enter used to abort the running generation, which made the key
      // you press to send the key that cancels; the Stop button is the abort, and
      // it is the only one. While a turn streams `canSend` is false, so Enter is
      // simply inert and the composer stays usable for composing the next one.
      if (canSend) handleSend()
    }
  }

  return (
    <Card ref={cardRef} className="relative flex h-full flex-col overflow-hidden">
      <PanelHeader
        draggable
        left={
          onToggleLeft && (
            <Button
              onClick={onToggleLeft}
              variant="ghost"
              size="icon"
              className="w-8 h-8 shrink-0"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              title={isLeftCollapsed ? t('expandLibrary') : t('collapseLibrary')}
            >
              {isLeftCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </Button>
          )
        }
        center={
          /*
           * The notebook's name lives in the document header below; the centre of
           * the chat panel is the session switcher (#97), because the session is
           * what the panel is showing. Leaving it empty kept the drag surface, but
           * there is no longer a reason to.
           */
          <SessionSwitcher />
        }
        right={
          onToggleRight && (
            <Button
              onClick={onToggleRight}
              variant="ghost"
              size="icon"
              className="w-8 h-8 shrink-0"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              title={isRightCollapsed ? t('expandNotes') : t('collapseNotes')}
            >
              {isRightCollapsed ? (
                <PanelRightOpen className="w-4 h-4" />
              ) : (
                <PanelRightClose className="w-4 h-4" />
              )}
            </Button>
          )
        }
      />

      {/* 对话消息区域 - 使用 absolute 定位占满剩余空间。`top-11` 就是 PanelHeader 的高度：
          以前是 `top-14`，中间多出的 12px 是一条什么都不放的死带。 */}
      <div className="absolute top-11 bottom-0 left-0 right-0 overflow-hidden">
        {/* Remount per session: every conversation opens at its own end, not at
            the position the previous one happened to be left at. */}
        <MessageList
          key={currentSession?.id ?? 'no-session'}
          ref={messageListRef}
          messages={messages}
          header={
            <div className="flex flex-col gap-2">
              {currentNotebook && (
                <NotebookHeader
                  notebook={currentNotebook}
                  sourceCount={documents.length}
                  onRename={(title) => updateNotebook(currentNotebook.id, { title })}
                />
              )}
              {/* The rollover boundary, above the transcript it continues (#97). */}
              <SessionContinuationNotice />
            </div>
          }
        />
      </div>

      {/* 底部渐变遮罩 - 独立于消息区域，避免堆叠上下文问题。
          `right-2` 让出右侧 8px：Radix 的滚动条正好占这条轨道（`w-2`），
          全宽的遮罩会把它的下半段盖住。内容本身有 `px-4` 内边距，这 8px 里没有
          正文，所以让开它不会让任何一行失去淡出。 */}
      <div
        // Height tracks the measured composer reserve (the CSS variable written
        // above), so the fade covers exactly the space the composer floats over
        // and never dims the last line of an answer.
        className="absolute bottom-0 left-0 right-2 pointer-events-none rounded-b-lg z-10"
        style={{
          height: COMPOSER_RESERVE,
          // A scroll fade, not decoration: it keeps the transcript readable as it
          // passes under the floating composer. Uses the surface token rather than
          // the legacy --card alias, and never a raw hsl().
          background:
            'linear-gradient(to bottom, transparent 0%, var(--surface-raised) 40%, var(--surface-raised) 100%)'
        }}
      />

      {/* 底部输入区域 - 绝对定位浮动在底部 */}
      <div
        ref={composerRef}
        className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none shrink-0 z-20"
      >
        {/*
         * A floating layer, not glass. It is opaque (`bg-surface-overlay`) with a
         * hairline and the elevation token, and it deliberately carries no
         * `backdrop-blur`: nothing reads through it (the fade covers the
         * transcript, not this surface), so the blur was cost without an effect
         * and one of the two glass surfaces DESIGN.md bans.
         *
         * The empty composer is one line tall (56px) so it reads as an input
         * rather than as an empty text box; it grows to `max-h-[280px]` with the
         * content while the transcript keeps its place, because the fade and the
         * transcript reserve are both measured from this element.
         */}
        {/* Centred on the same canvas as the transcript: the input and the answers
            it produces line up, so a wide panel adds margin to both instead of
            stretching the composer past the text it is answering. */}
        <div className="mx-auto w-full max-w-5xl">
          <div className="relative bg-surface-overlay rounded-lg border border-border focus-within:ring-2 focus-within:ring-ring shadow-elevation pointer-events-auto select-none">
            {/* 范围选择（#94）：这次问题用哪些来源回答。放在输入框上方，跟在要提问的地方。 */}
            {currentSession && (
              <ScopeSelector
                scope={scope}
                documents={documents}
                currentDocumentId={focusedSource?.documentId ?? null}
                onChange={(next) => void setSessionScope(currentSession.id, next)}
              />
            )}

            {/* 多行输入框 */}
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={!hasChatModel ? t('noProviderConfigured') : t('inputMessage')}
              disabled={!hasChatModel}
              rows={1}
              className="w-full bg-transparent border-0 pl-4 pr-14 py-3 text-sm text-foreground placeholder-muted-foreground resize-none focus-visible:ring-0 focus-visible:ring-offset-0 overflow-y-auto min-h-[56px] max-h-[280px] themed-scrollbar select-text"
            />

            {/* 发送/停止按钮 - 动态切换 */}
            {isCurrentNotebookStreaming ? (
              // 停止按钮
              <Button
                onClick={handleStop}
                disabled={!canStop}
                title={t('stopGenerating', { ns: 'chat' })}
                variant="destructive"
                size="icon"
                className="absolute right-2 bottom-3 w-8 h-8 rounded-full"
              >
                <StopCircle className="w-4 h-4" />
              </Button>
            ) : (
              // 发送按钮
              <Button
                onClick={handleSend}
                disabled={!canSend}
                title={
                  !hasChatModel
                    ? t('noProviderConfigured')
                    : !currentSession
                      ? t('selectSession')
                      : ''
                }
                size="icon"
                className="absolute right-2 bottom-3 w-8 h-8 rounded-full"
              >
                <Send className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

/**
 * Memoised because `ResizableLayout` re-renders on every drag frame and clones
 * this element with a fresh props object each time. The props are stable between
 * frames, so memo keeps the transcript out of the resize path entirely — without
 * it the whole message list re-rendered at pointer-event frequency.
 */
export default memo(ProcessPanel)
