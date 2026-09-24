import { ReactElement } from 'react'
import { Pencil, Trash2, Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Notebook } from '../../types/notebook'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../ui/card'
import { Button } from '../ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '../ui/context-menu'

interface NotebookCardProps {
  notebook: Notebook
  onClick: () => void
  onDelete: () => void
  onRename: () => void
}

// 笔记本卡片。DESIGN.md 明确禁止在图表/图谱之外使用 --chart-* 颜色，
// 所以卡片不再用彩色侧边条区分，颜色只用于正文层级和交互状态。

export default function NotebookCard({
  notebook,
  onClick,
  onDelete,
  onRename
}: NotebookCardProps): ReactElement {
  const { t, i18n } = useTranslation('ui')

  const formatDate = (date: Date): string => {
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (days === 0) return t('today')
    if (days === 1) return t('yesterday')
    if (days < 7) return t('daysAgo', { days })

    const locale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US'
    return date.toLocaleDateString(locale)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Card onClick={onClick} className="group relative cursor-pointer overflow-hidden">
          {/*
            Hover fill as an overlay, not as `hover:bg-surface-hover` on the card
            itself: the card is opaque `surface-raised`, so replacing its
            background with the translucent token would make it almost the same
            lightness as `surface-base` in dark mode — an invisible hover.
            Compositing keeps it visible in both themes.
          */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-surface-hover opacity-0 transition-opacity group-hover:opacity-100"
          />

          <CardHeader>
            <CardTitle>{notebook.title}</CardTitle>
            {notebook.description && <CardDescription>{notebook.description}</CardDescription>}
          </CardHeader>

          <CardContent>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              <span>{formatDate(notebook.updatedAt)}</span>
            </div>
          </CardContent>

          <CardFooter className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onRename()
              }}
            >
              <Pencil className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </CardFooter>
        </Card>
      </ContextMenuTrigger>

      {/* 右键菜单 */}
      <ContextMenuContent>
        <ContextMenuItem
          onClick={(e) => {
            e.stopPropagation()
            onRename()
          }}
        >
          <Pencil className="w-4 h-4 mr-2" />
          {t('renameNotebook')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="w-4 h-4 mr-2" />
          {t('deleteNotebook')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
