import { useEffect, useCallback, ReactElement } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import TopNavigationBar from '../common/TopNavigationBar'
import ResizableLayout from '../layouts/ResizableLayout'
import SourcePanel from './SourcePanel'
import ProcessPanel from './ProcessPanel'
import NotePanel from './NotePanel'
import { useNotebookStore } from '../../store/notebookStore'
import { useChatStore } from '../../store/chatStore'
import { setupQuizListeners } from '../../store/quizStore'

export default function NotebookLayout(): ReactElement {
  const { t } = useTranslation('ui')
  const navigate = useNavigate()
  const { id } = useParams()
  const { notebooks, addNotebook, addOpenedNotebook, setCurrentNotebook, removeOpenedNotebook } =
    useNotebookStore()
  const { loadActiveSession } = useChatStore()

  // 当进入笔记本时，设置openedNotebook和currentNotebook，并加载栈顶session
  useEffect(() => {
    if (id) {
      addOpenedNotebook(id)
      setCurrentNotebook(id)
      // 关键改动：自动加载该Notebook的栈顶session
      loadActiveSession(id).catch((err) => {
        console.error('[NotebookLayout] Failed to load session for notebook:', id, err)
      })
    }
  }, [id, addOpenedNotebook, setCurrentNotebook, loadActiveSession])

  const handleCreateNotebook = useCallback(async (): Promise<void> => {
    const newId = await addNotebook({
      title: t('newNotebook', { index: notebooks.length + 1 }),
      description: t('notebookDescription')
    })

    navigate(`/notebook/${newId}`)
  }, [addNotebook, t, notebooks.length, navigate])

  // 监听笔记本管理快捷键
  useEffect(() => {
    const handleCreateShortcut = () => {
      void handleCreateNotebook()
    }

    const handleCloseShortcut = () => {
      // 关闭当前笔记本标签页，并返回笔记本列表
      if (id) {
        removeOpenedNotebook(id)
      }
      navigate('/')
    }

    window.addEventListener('shortcut:create-notebook', handleCreateShortcut)
    window.addEventListener('shortcut:close-notebook', handleCloseShortcut)

    return () => {
      window.removeEventListener('shortcut:create-notebook', handleCreateShortcut)
      window.removeEventListener('shortcut:close-notebook', handleCloseShortcut)
    }
  }, [navigate, handleCreateNotebook, id, removeOpenedNotebook])

  // 设置答题进度监听器
  useEffect(() => {
    const cleanup = setupQuizListeners()
    return cleanup
  }, [])

  return (
    <div className="flex flex-col h-screen bg-surface-base text-foreground">
      <TopNavigationBar onCreateClick={handleCreateNotebook} />

      <ResizableLayout
        leftPanel={<SourcePanel />}
        centerPanel={<ProcessPanel />}
        rightPanel={<NotePanel />}
      />
    </div>
  )
}
