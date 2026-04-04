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

// 테마차트색상매핑 - 용도:쪽테두리장식
const chartColors = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5']

const getChartColor = (id: string): string => {
  const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return chartColors[hash % 5]
}

export default function NotebookCard({
  notebook,
  onClick,
  onDelete,
  onRename
}: NotebookCardProps): ReactElement {
  const { t, i18n } = useTranslation('ui')
  const chartColor = getChartColor(notebook.id)

  const formatDate = (date: Date): string => {
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (days === 0) return t('today')
    if (days === 1) return t('yesterday')
    if (days < 7) return t('daysAgo', { days })

    const locale = i18n.language === 'ko-KR' ? 'ko-KR' : 'en-US'
    return date.toLocaleDateString(locale)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Card onClick={onClick} className="relative overflow-hidden">
          {/* 왼쪽다채로운장식바 */}
          <div className={`absolute left-0 top-0 bottom-0 w-1 ${chartColor}`} />

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

      {/* 우클릭메뉴 */}
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
