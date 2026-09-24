import { Home, Plus, X, Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useNotebookStore } from '../../store/notebookStore'
import { useUIStore } from '../../store/uiStore'
import { ReactElement, useState } from 'react'
import { Button } from '../ui/button'
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs'
import { isLinux } from '../../lib/platform'
import WindowTitleBar from './WindowTitleBar'

interface TopNavigationBarProps {
  onCreateClick: () => void
  isHomePage?: boolean
  /**
   * Run a navigation that unmounts the workspace, after confirming when the note
   * editor holds unsaved text. Supplied by `NotebookLayout`, which owns the one
   * prompt so every path — tab close, tab switch, Home — asks the same question.
   */
  onConfirmDiscard?: (action: () => void) => void
}

export default function TopNavigationBar({
  onCreateClick,
  isHomePage = false,
  onConfirmDiscard
}: TopNavigationBarProps): ReactElement {
  const { t } = useTranslation('ui')
  const navigate = useNavigate()
  const { openSettings } = useUIStore()
  const { currentNotebook, openedNotebooks, removeOpenedNotebook, setCurrentNotebook } =
    useNotebookStore()

  // 确定当前激活的标签
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (isHomePage) return 'home'
    return currentNotebook?.id ?? 'home'
  })

  // 当 isHomePage 或 currentNotebook 改变时，更新 activeTab
  if (isHomePage && activeTab !== 'home') {
    setActiveTab('home')
  } else if (!isHomePage && currentNotebook && activeTab !== currentNotebook.id) {
    setActiveTab(currentNotebook.id)
  }

  const handleTabChange = (value: string): void => {
    if (value === activeTab) return
    // Switching tabs unmounts the whole workspace, so it discards the editor the
    // same way closing does. The tab highlight only moves once the action runs, so
    // cancelling the prompt leaves the strip where it was.
    const go = (): void => {
      setActiveTab(value)
      if (value === 'home') {
        navigate('/')
      } else {
        setCurrentNotebook(value)
        navigate(`/notebook/${value}`)
      }
    }
    if (onConfirmDiscard) onConfirmDiscard(go)
    else go()
  }

  const handleCloseOpenedNotebook = (id: string, e: React.SyntheticEvent): void => {
    e.stopPropagation()
    if (onConfirmDiscard) onConfirmDiscard(() => closeOpenedNotebook(id))
    else closeOpenedNotebook(id)
  }

  const closeOpenedNotebook = (id: string): void => {
    // 如果关闭的是当前笔记本，需要跳转
    if (currentNotebook?.id === id && !isHomePage) {
      // 找到当前笔记本在列表中的索引
      const currentIndex = openedNotebooks.findIndex((nb) => nb.id === id)
      const otherNotebooks = openedNotebooks.filter((nb) => nb.id !== id)

      if (otherNotebooks.length > 0) {
        // 如果当前不是第一个，跳转到上一个；否则跳转到下一个
        const targetNotebook =
          currentIndex > 0 ? openedNotebooks[currentIndex - 1] : openedNotebooks[1]
        setCurrentNotebook(targetNotebook.id)
        navigate(`/notebook/${targetNotebook.id}`)
      } else {
        // 没有其他笔记本，跳转到首页
        navigate('/')
      }
    }
    removeOpenedNotebook(id)
  }

  const handleSettingsClick = (): void => {
    openSettings()
  }

  const settingsButton = (
    <Button
      onClick={handleSettingsClick}
      variant="ghost"
      size="icon"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      className="w-7 h-7"
      title={t('settings')}
    >
      <Settings className="w-4 h-4" />
    </Button>
  )

  return (
    <WindowTitleBar
      className="gap-0.5"
      // Linux desktops put their window buttons in different places, so the
      // settings entry point stays on the left there instead of next to
      // minimize/maximize/close.
      left={isLinux() ? settingsButton : undefined}
      center={
        <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1">
          <TabsList
            className="bg-transparent border-0 gap-2 h-auto p-0 justify-start"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {/* 首页标签 */}
            <TabsTrigger
              value="home"
              className="h-7 gap-2 px-3 rounded-md border border-transparent text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground data-[state=active]:border-border data-[state=active]:bg-surface-selected data-[state=active]:text-foreground data-[state=active]:font-medium"
            >
              <Home className="w-4 h-4" />
              <span>{t('home')}</span>
            </TabsTrigger>

            {/* 打开的笔记本标签。
                关闭控件是 trigger 的**兄弟**节点而不是子节点：原先它是一个
                `role="button" tabIndex={0}` 的 span 嵌在 `role="tab"`（本身
                是 <button>）里 —— 交互角色套交互角色，而且 tablist 用 roving
                tabindex，内层恒为 0 的 tabIndex 会给每个打开的笔记本多造一个
                焦点停留点。现在它是一个真的 <button>，有自己的可访问名称。 */}
            {openedNotebooks.map((notebook) => (
              <div key={notebook.id} className="relative flex items-center">
                <TabsTrigger
                  value={notebook.id}
                  className="h-7 pr-7 pl-3 rounded-md border border-transparent text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground data-[state=active]:border-border data-[state=active]:bg-surface-selected data-[state=active]:text-foreground data-[state=active]:font-medium max-w-[200px]"
                >
                  <span className="truncate">{notebook.title}</span>
                </TabsTrigger>
                <button
                  type="button"
                  onClick={(e) => handleCloseOpenedNotebook(notebook.id, e)}
                  className="absolute right-1 inline-flex h-4 w-4 items-center justify-center rounded-md transition-colors hover:bg-destructive/20 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  title={t('closeTab')}
                  aria-label={t('closeTab')}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}

            {/* 新建按钮 */}
            <Button
              onClick={onCreateClick}
              variant="ghost"
              size="icon"
              className="w-7 h-7"
              title={t('create', { ns: 'common' })}
            >
              <Plus className="w-4 h-4" />
            </Button>
          </TabsList>
        </Tabs>
      }
      right={!isLinux() ? settingsButton : undefined}
    />
  )
}
