import { ReactElement, useEffect, useRef } from 'react'
import { MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatMessage } from '../../../../../shared/types/chat'
import MessageItem from './MessageItem'
import { ScrollArea } from '../../ui/scroll-area'
// messageList.css 已合并到 effects.css（通过 main.css 全局导入）

interface MessageListProps {
  messages: ChatMessage[]
}

export default function MessageList({ messages }: MessageListProps): ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  // 自动滚动到底部
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // 空状态
  if (messages.length === 0) {
    return (
      <ScrollArea className="h-full">
        <div className="flex min-h-full select-none flex-col items-center justify-center p-8">
          <div className="flex flex-col items-center gap-4 text-muted-foreground">
            <MessageSquare className="w-16 h-16 opacity-20" />
            <div className="text-center flex flex-col gap-1">
              <p className="text-lg font-medium">{t('ui:newChat')}</p>
              <p className="text-sm">{t('ui:noMessages')}</p>
            </div>
          </div>
        </div>
      </ScrollArea>
    )
  }

  // 消息列表
  return (
    <ScrollArea className="h-full">
      <div className="px-4 py-6 pb-32">
        <div className="space-y-4">
          {messages.map((message) => (
            <MessageItem key={message.id} message={message} />
          ))}
          {/* 滚动锚点 */}
          <div ref={bottomRef} />
        </div>
      </div>
    </ScrollArea>
  )
}
