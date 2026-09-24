import { ReactElement } from 'react'
import NotebookCard from '../common/NotebookCard'
import type { Notebook } from '../../types/notebook'

interface NotebookGridProps {
  notebooks: Notebook[]
  onNotebookClick: (id: string) => void
  onNotebookDelete: (id: string) => void
  onNotebookRename: (id: string) => void
}

export default function NotebookGrid({
  notebooks,
  onNotebookClick,
  onNotebookDelete,
  onNotebookRename
}: NotebookGridProps): ReactElement {
  return (
    <div className="px-6 pb-12">
      <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
        {notebooks.map((notebook) => (
          <NotebookCard
            key={notebook.id}
            notebook={notebook}
            onClick={() => onNotebookClick(notebook.id)}
            onDelete={() => onNotebookDelete(notebook.id)}
            onRename={() => onNotebookRename(notebook.id)}
          />
        ))}
      </div>
    </div>
  )
}
