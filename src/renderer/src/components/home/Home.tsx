import { ReactElement } from 'react'
import { ScrollArea } from '../ui/scroll-area'
import Hero from './Hero'
import NotebookGrid from '../notebook/NotebookGrid'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '../ui/empty'
import { BookOpen, Plus } from 'lucide-react'
import { Button } from '../ui/button'
import { useTranslation } from 'react-i18next'
import type { Notebook } from '../../types/notebook'

interface HomeProps {
  notebooks: Notebook[]
  onNotebookClick: (id: string) => void
  onNotebookDelete: (id: string) => void
  onNotebookRename: (id: string) => void
  onCreateNotebook: () => void
}

export default function Home({
  notebooks,
  onNotebookClick,
  onNotebookDelete,
  onNotebookRename,
  onCreateNotebook
}: HomeProps): ReactElement {
  const { t } = useTranslation('ui')

  // 空状态
  if (notebooks.length === 0) {
    return (
      <ScrollArea className="flex-1">
        <div className="flex items-center justify-center min-h-[calc(100vh-80px)] px-6">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BookOpen className="w-16 h-16 text-muted-foreground" />
              </EmptyMedia>
              <EmptyTitle>{t('noNotebooks')}</EmptyTitle>
              <EmptyDescription>{t('noNotebooksDesc')}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={onCreateNotebook} size="lg">
                <Plus className="w-4 h-4" />
                {t('createFirstNotebook')}
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      </ScrollArea>
    )
  }

  // 正常状态
  return (
    <ScrollArea className="flex-1">
      <div className="min-h-full">
        <Hero notebookCount={notebooks.length} />
        <NotebookGrid
          notebooks={notebooks}
          onNotebookClick={onNotebookClick}
          onNotebookDelete={onNotebookDelete}
          onNotebookRename={onNotebookRename}
        />
      </div>
    </ScrollArea>
  )
}
