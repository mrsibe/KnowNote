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
  const [hasChatModel, setHasChatModel] = useState(false)
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

  // 监听面板切换快捷键（与顶部按钮共用逻辑）
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
              title={isLeftCollapsed ? '展开知识库' : '折叠知识库'}
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
              title={isRightCollapsed ? '展开笔记' : '折叠笔记'}
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

      {/* 对话消息区域 - 使用 absolute 定位占满剩余空间 */}
      <div className="absolute top-14 bottom-0 left-0 right-0 overflow-hidden">
        <MessageList messages={messages} />
      </div>

      {/* 底部渐变遮罩 - 独立于消息区域，避免堆叠上下文问题 */}
      <div
        className="absolute bottom-0 left-0 right-0 h-48 pointer-events-none rounded-b-xl z-10"
        style={{
          background:
            'linear-gradient(to bottom, transparent 0%, hsl(var(--card)) 40%, hsl(var(--card)) 100%)'
        }}
      />

      {/* 底部输入区域 - 绝对定位浮动在底部 */}
      <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none shrink-0 z-20">
        <div className="relative bg-muted/95 backdrop-blur-md rounded-lg border border-border focus-within:ring-2 focus-within:ring-ring shadow-lg pointer-events-auto select-none">
          {/* 多行输入框 */}
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              !currentSession
                ? t('selectSession')
                : !hasChatModel
                  ? t('noProviderConfigured')
                  : t('inputMessage')
            }
            disabled={!currentSession || isCurrentNotebookStreaming || !hasChatModel}
            rows={1}
            className="w-full bg-transparent border-0 pl-4 pr-14 py-3 text-sm text-foreground placeholder-muted-foreground resize-none focus-visible:ring-0 focus-visible:ring-offset-0 overflow-y-auto min-h-[84px] max-h-[280px] themed-scrollbar select-text"
          />

          {/* 发送/停止按钮 - 动态切换 */}
          {isCurrentNotebookStreaming ? (
            // 停止按钮
            <Button
              onClick={handleStop}
              disabled={!canStop}
              title="停止生成"
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
    </Card>
  )
}
