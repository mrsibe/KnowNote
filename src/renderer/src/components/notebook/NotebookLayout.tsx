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

  // 때입력노트북시，설정openedNotebook및currentNotebook，그리고로드스택상단session
  useEffect(() => {
    if (id) {
      addOpenedNotebook(id)
      setCurrentNotebook(id)
      // 닫기키수정동：자동로드Notebook의스택상단session
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

  // 감시노트북관리단축키
  useEffect(() => {
    const handleCreateShortcut = () => {
      void handleCreateNotebook()
    }

    const handleCloseShortcut = () => {
      // 닫기현재노트북탭，그리고반환노트북목록
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

  // 설정퀴즈진행감시
  useEffect(() => {
    const cleanup = setupQuizListeners()
    return cleanup
  }, [])

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <TopNavigationBar onCreateClick={handleCreateNotebook} />

      <ResizableLayout
        leftPanel={<SourcePanel />}
        centerPanel={<ProcessPanel />}
        rightPanel={<NotePanel />}
      />
    </div>
  )
}
