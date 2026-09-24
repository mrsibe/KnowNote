import { useState, ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import TopNavigationBar from '../common/TopNavigationBar'
import RenameDialog from '../common/RenameDialog'
import DeleteConfirmDialog from '../common/DeleteConfirmDialog'
import Home from '../home/Home'
import { useNotebookStore } from '../../store/notebookStore'

export default function NotebookListPage(): ReactElement {
  const { t } = useTranslation('ui')
  const navigate = useNavigate()
  const {
    notebooks,
    addNotebook,
    setCurrentNotebook,
    deleteNotebook,
    updateNotebook,
    addOpenedNotebook,
    removeOpenedNotebook
  } = useNotebookStore()
  const [renameNotebookId, setRenameNotebookId] = useState<string | null>(null)
  const [renameNotebookTitle, setRenameNotebookTitle] = useState('')
  const [deleteNotebookId, setDeleteNotebookId] = useState<string | null>(null)
  const [deleteNotebookTitle, setDeleteNotebookTitle] = useState('')

  const handleCreateNotebook = async (): Promise<void> => {
    const newId = await addNotebook({
      title: t('newNotebook', { index: notebooks.length + 1 }),
      description: t('notebookDescription')
    })

    addOpenedNotebook(newId)
    setCurrentNotebook(newId)
    navigate(`/notebook/${newId}`)
  }

  const handleNotebookClick = (id: string): void => {
    addOpenedNotebook(id)
    setCurrentNotebook(id)
    navigate(`/notebook/${id}`)
  }

  const handleOpenDeleteDialog = (id: string): void => {
    const notebook = notebooks.find((nb) => nb.id === id)
    if (notebook) {
      setDeleteNotebookId(id)
      setDeleteNotebookTitle(notebook.title)
    }
  }

  const handleDeleteConfirm = async (): Promise<void> => {
    if (deleteNotebookId) {
      await deleteNotebook(deleteNotebookId)
      removeOpenedNotebook(deleteNotebookId)
    }
  }

  const handleDeleteClose = (): void => {
    setDeleteNotebookId(null)
  }

  const handleOpenRenameDialog = (id: string): void => {
    const notebook = notebooks.find((nb) => nb.id === id)
    if (notebook) {
      setRenameNotebookId(id)
      setRenameNotebookTitle(notebook.title)
    }
  }

  const handleRenameConfirm = (newTitle: string): void => {
    if (renameNotebookId) {
      updateNotebook(renameNotebookId, { title: newTitle })
      setRenameNotebookId(null)
    }
  }

  const handleRenameClose = (): void => {
    setRenameNotebookId(null)
  }

  return (
    <div className="flex flex-col h-screen bg-surface-base text-foreground">
      <TopNavigationBar isHomePage={true} onCreateClick={handleCreateNotebook} />

      {/* 主内容区域 - 使用 Home 组件 */}
      <Home
        notebooks={notebooks}
        onNotebookClick={handleNotebookClick}
        onNotebookDelete={handleOpenDeleteDialog}
        onNotebookRename={handleOpenRenameDialog}
        onCreateNotebook={handleCreateNotebook}
      />

      {/* 重命名对话框 */}
      <RenameDialog
        isOpen={renameNotebookId !== null}
        currentTitle={renameNotebookTitle}
        onClose={handleRenameClose}
        onConfirm={handleRenameConfirm}
      />

      {/* 删除确认对话框 */}
      <DeleteConfirmDialog
        isOpen={deleteNotebookId !== null}
        notebookTitle={deleteNotebookTitle}
        onClose={handleDeleteClose}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  )
}
