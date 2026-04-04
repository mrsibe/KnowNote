import { useState, useEffect, useRef, ReactElement } from 'react'
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
import MessageList from './chat/MessageList'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Card } from '../ui/card'
import { PanelHeader } from '../ui/panel-header'

interface ProcessPanelProps {
  onToggleLeft?: () => void
  onToggleRight?: () => void
  isLeftCollapsed?: boolean
  isRightCollapsed?: boolean
}

export default function ProcessPanel({
  onToggleLeft,
  onToggleRight,
  isLeftCollapsed = false,
  isRightCollapsed = false
}: ProcessPanelProps = {}): ReactElement {
  const { t } = useTranslation('ui')
  const [input, setInput] = useState('')
  const [hasProvider, setHasProvider] = useState(true)
  const [defaultChatModel, setDefaultChatModel] = useState<string | null>(null)
  const { currentSession, messages, isNotebookStreaming, sendMessage, abortMessage } =
    useChatStore()
  const { currentNotebook, updateNotebook } = useNotebookStore()

  const [editingTitle, setEditingTitle] = useState('')
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const currentNotebookId = currentSession?.notebookId
  const isCurrentNotebookStreaming = currentNotebookId
    ? isNotebookStreaming(currentNotebookId)
    : false
  const canSend =
    currentSession && !isCurrentNotebookStreaming && input.trim() && hasProvider && defaultChatModel
  const canStop = currentSession && isCurrentNotebookStreaming

  // Check if there are available providers and get default model
  const checkProvider = async (): Promise<void> => {
    try {
      const providers = await window.api.getAllProviderConfigs()
      const hasEnabledProvider = providers.some((p) => p.enabled)
      setHasProvider(hasEnabledProvider)

      // Get default chat model
      const defaultModel = await window.api.settings.get('defaultChatModel')
      setDefaultChatModel(defaultModel || null)
    } catch (error) {
      console.error('Failed to check Provider configuration:', error)
      setHasProvider(false)
      setDefaultChatModel(null)
    }
  }

  // Add useEffect listeners
  useEffect(() => {
    // 1. Check on page load
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkProvider()

    // 2. Listen for Provider configuration change events
    const cleanup = window.api.onProviderConfigChanged(() => {
      void checkProvider()
    })

    // 3. Listen for settings change events
    const cleanupSettings = window.api.settings.onSettingsChange((newSettings) => {
      setDefaultChatModel(newSettings.defaultChatModel || null)
    })

    return () => {
      cleanup()
      cleanupSettings()
    }
  }, [])

  const handleSend = (): void => {
    if (!canSend) return

    sendMessage(currentSession.id, input.trim())
    setInput('')
  }

  const handleStop = async (): Promise<void> => {
    if (!canStop || !currentNotebookId) return
    await abortMessage(currentNotebookId)
  }

  // 사용 ref 저장 handleSend 함수의참조，회피면이벤트감시빈도복잡재등록
  const handleSendRef = useRef<() => void>(() => {})

  // 보유지 ref 가리키는방향최신의 handleSend 함수
  useEffect(() => {
    handleSendRef.current = handleSend
  })

  // 감시메시지 전송단축키（등록하나번）
  useEffect(() => {
    const handleSendShortcut = () => {
      handleSendRef.current()
    }

    window.addEventListener('shortcut:send-message', handleSendShortcut)

    return () => {
      window.removeEventListener('shortcut:send-message', handleSendShortcut)
    }
  }, [])

  // 감시패널전환단축키（와상단부분버튼공용논리편집）
  useEffect(() => {
    if (!onToggleLeft && !onToggleRight) return

    const handleToggleKnowledgeBase = () => {
      onToggleLeft?.()
    }

    const handleToggleCreativeSpace = () => {
      onToggleRight?.()
    }

    window.addEventListener('shortcut:toggle-knowledge-base', handleToggleKnowledgeBase)
    window.addEventListener('shortcut:toggle-creative-space', handleToggleCreativeSpace)

    return () => {
      window.removeEventListener('shortcut:toggle-knowledge-base', handleToggleKnowledgeBase)
      window.removeEventListener('shortcut:toggle-creative-space', handleToggleCreativeSpace)
    }
  }, [onToggleLeft, onToggleRight])

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
      if (isCurrentNotebookStreaming) {
        void handleStop()
      } else {
        handleSend()
      }
    }
  }

  // Start editing title
  const handleStartEditTitle = (): void => {
    if (currentNotebook) {
      setEditingTitle(currentNotebook.title)
      setIsEditingTitle(true)
    }
  }

  // Save title
  const handleSaveTitle = async (): Promise<void> => {
    if (!currentNotebook || !editingTitle.trim()) {
      setIsEditingTitle(false)
      return
    }

    if (editingTitle.trim() !== currentNotebook.title) {
      try {
        await updateNotebook(currentNotebook.id, { title: editingTitle.trim() })
      } catch (error) {
        console.error('Failed to update Notebook title:', error)
      }
    }

    setIsEditingTitle(false)
  }

  // Cancel editing
  const handleCancelEditTitle = (): void => {
    setIsEditingTitle(false)
    setEditingTitle('')
  }

  // Title input box key handler
  const handleTitleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleSaveTitle()
    } else if (e.key === 'Escape') {
      handleCancelEditTitle()
    }
  }

  return (
    <Card className="relative flex flex-col rounded-xl border-0 overflow-hidden h-full mx-0 shadow-md">
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
              title={isLeftCollapsed ? '확장열기지식 베이스' : '접기지식 베이스'}
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
          currentNotebook ? (
            isEditingTitle ? (
              <Input
                type="text"
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={handleSaveTitle}
                onKeyDown={handleTitleKeyDown}
                autoFocus
                className="text-sm font-medium bg-transparent border-0 text-center min-w-0 max-w-full p-0 h-auto focus-visible:ring-0 focus-visible:ring-offset-0"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              />
            ) : (
              <Button
                onClick={handleStartEditTitle}
                variant="ghost"
                className="text-sm font-medium h-auto p-0 truncate w-full select-none"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                title={t('clickToEditTitle')}
              >
                {currentNotebook.title}
              </Button>
            )
          ) : (
            <span className="text-sm text-muted-foreground select-none">
              {t('selectOrCreateNotebook')}
            </span>
          )
        }
        right={
          onToggleRight && (
            <Button
              onClick={onToggleRight}
              variant="ghost"
              size="icon"
              className="w-8 h-8 shrink-0"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              title={isRightCollapsed ? '확장열기노트' : '접기노트'}
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

      {/* 대화메시지영역 - 사용 absolute 정위치점유가득남은나머지빈간격 */}
      <div className="absolute top-14 bottom-0 left-0 right-0 overflow-hidden">
        <MessageList messages={messages} />
      </div>

      {/* 바닥부분점차변가림오버레이 - 독립즉시메시지영역，회피면힙접기위아래문문제 */}
      <div
        className="absolute bottom-0 left-0 right-0 h-48 pointer-events-none rounded-b-xl z-10"
        style={{
          background:
            'linear-gradient(to bottom, transparent 0%, hsl(var(--card)) 40%, hsl(var(--card)) 100%)'
        }}
      />

      {/* 바닥부분입력영역 - 절대정위치떠다니는동바닥부분 */}
      <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none shrink-0 z-20">
        <div className="relative bg-muted/95 backdrop-blur-md rounded-lg border border-border focus-within:ring-2 focus-within:ring-ring shadow-lg pointer-events-auto select-none">
          {/* 많은행입력창 */}
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              !currentSession
                ? t('selectSession')
                : !hasProvider
                  ? t('noProviderConfigured')
                  : !defaultChatModel
                    ? t('noDefaultModel')
                    : t('inputMessage')
            }
            disabled={
              !currentSession || isCurrentNotebookStreaming || !hasProvider || !defaultChatModel
            }
            rows={1}
            className="w-full bg-transparent border-0 pl-4 pr-14 py-3 text-sm text-foreground placeholder-muted-foreground resize-none focus-visible:ring-0 focus-visible:ring-offset-0 overflow-y-auto min-h-[84px] max-h-[280px] themed-scrollbar select-text"
          />

          {/* 전송/중지버튼 - 동상태전환 */}
          {isCurrentNotebookStreaming ? (
            // 중지버튼
            <Button
              onClick={handleStop}
              disabled={!canStop}
              title="중지생성"
              variant="destructive"
              size="icon"
              className="absolute right-2 bottom-3 w-8 h-8 rounded-full"
            >
              <StopCircle className="w-4 h-4" />
            </Button>
          ) : (
            // 전송버튼
            <Button
              onClick={handleSend}
              disabled={!canSend}
              title={
                !hasProvider ? t('noProviderConfigured') : !currentSession ? t('selectSession') : ''
              }
              size="icon"
              className="absolute right-2 bottom-3 w-8 h-8 rounded-full"
            >
              <Send className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}
