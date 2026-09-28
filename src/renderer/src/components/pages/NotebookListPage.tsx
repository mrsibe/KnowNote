import { useState, useEffect, useCallback, ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import TopNavigationBar from '../common/TopNavigationBar'
import RenameDialog from '../common/RenameDialog'
import DeleteConfirmDialog from '../common/DeleteConfirmDialog'
import Home from '../home/Home'
import { useNotebookStore } from '../../store/notebookStore'
import type { WorkspaceOverview } from '../../../../shared/types/workspace'
import type { SourceAnchor } from '../../../../shared/types/source'
import { withSourceAnchor } from '../../../../shared/utils/sourceAnchor'
import {
  readRecentlyOpened,
  recordNotebookOpened,
  writeRecentlyOpened,
  type RecentlyOpenedNotebook
} from '../../lib/recentlyOpened'

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
  const [overview, setOverview] = useState<WorkspaceOverview | null>(null)
  // Read once per mount. Home is unmounted while a notebook is open, so returning to
  // it re-reads — no subscription to storage is needed to stay current.
  const [recentlyOpened, setRecentlyOpened] = useState<RecentlyOpenedNotebook[]>(readRecentlyOpened)
  const [renameNotebookId, setRenameNotebookId] = useState<string | null>(null)
  const [renameNotebookTitle, setRenameNotebookTitle] = useState('')
  const [deleteNotebookId, setDeleteNotebookId] = useState<string | null>(null)
  const [deleteNotebookTitle, setDeleteNotebookTitle] = useState('')

  // One read for the whole page: notebook source counts, the newest sources across
  // every notebook, and the conversation last written to. See WorkspaceOverview.
  useEffect(() => {
    let cancelled = false
    window.api
      .getWorkspaceOverview()
      .then((loaded) => {
        if (!cancelled) setOverview(loaded)
      })
      .catch((error) => {
        // Home degrades to what the notebook store already has; it is not worth
        // failing the page over a count.
        console.error('[NotebookListPage] Failed to load workspace overview:', error)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const rememberOpen = useCallback((notebookId: string): void => {
    setRecentlyOpened((entries) => {
      const next = recordNotebookOpened(entries, notebookId, Date.now())
      writeRecentlyOpened(next)
      return next
    })
  }, [])

  const handleCreateNotebook = async (): Promise<void> => {
    const newId = await addNotebook({
      title: t('newNotebook', { index: notebooks.length + 1 }),
      description: t('notebookDescription')
    })

    addOpenedNotebook(newId)
    setCurrentNotebook(newId)
    rememberOpen(newId)
    navigate(`/notebook/${newId}`)
  }

  const handleNotebookClick = (id: string): void => {
    addOpenedNotebook(id)
    setCurrentNotebook(id)
    rememberOpen(id)
    navigate(`/notebook/${id}`)
  }

  /**
   * A source opened from Home goes to its notebook with the location in the query.
   *
   * The query is how it has to travel: `SourcePanel` hydrates the reading anchor from
   * the URL on mount, and treats a URL without an anchor as "nothing is open". Setting
   * the store and then navigating would be wiped by that same effect, so the anchor
   * goes into the route, exactly as a citation does.
   */
  const handleOpenSource = (notebookId: string, documentId: string): void => {
    const anchor: SourceAnchor = { documentId, location: { documentId } }
    const search = withSourceAnchor(new URLSearchParams(), anchor).toString()
    addOpenedNotebook(notebookId)
    setCurrentNotebook(notebookId)
    rememberOpen(notebookId)
    navigate(`/notebook/${notebookId}?${search}`)
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
    <div className="flex flex-col h-screen bg-surface-sunken text-foreground">
      <TopNavigationBar isHomePage={true} onCreateClick={handleCreateNotebook} />

      {/* 主内容区域 - 使用 Home 组件 */}
      <Home
        notebooks={notebooks}
        overview={overview}
        recentlyOpened={recentlyOpened}
        onNotebookClick={handleNotebookClick}
        onNotebookDelete={handleOpenDeleteDialog}
        onNotebookRename={handleOpenRenameDialog}
        onCreateNotebook={handleCreateNotebook}
        onOpenSource={handleOpenSource}
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
