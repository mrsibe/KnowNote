import { Home, Plus, X, Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useNotebookStore } from '../../store/notebookStore'
import { useUIStore } from '../../store/uiStore'
import { ReactElement, useState } from 'react'
import { Button } from '../ui/button'
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs'
import { isMac, isLinux, isWindows } from '../../lib/platform'

interface TopNavigationBarProps {
  onCreateClick: () => void
  isHomePage?: boolean
}

export default function TopNavigationBar({
  onCreateClick,
  isHomePage = false
}: TopNavigationBarProps): ReactElement {
  const { t } = useTranslation('ui')
  const navigate = useNavigate()
  const { openSettings } = useUIStore()
  const { currentNotebook, openedNotebooks, removeOpenedNotebook, setCurrentNotebook } =
    useNotebookStore()

  // 확인정현재활성화의태그
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (isHomePage) return 'home'
    return currentNotebook?.id ?? 'home'
  })

  // 때 isHomePage 또는 currentNotebook 변경시，업데이트 activeTab
  if (isHomePage && activeTab !== 'home') {
    setActiveTab('home')
  } else if (!isHomePage && currentNotebook && activeTab !== currentNotebook.id) {
    setActiveTab(currentNotebook.id)
  }

  const handleTabChange = (value: string): void => {
    setActiveTab(value)
    if (value === 'home') {
      navigate('/')
    } else {
      setCurrentNotebook(value)
      navigate(`/notebook/${value}`)
    }
  }

  const handleCloseOpenedNotebook = (id: string, e: React.MouseEvent): void => {
    e.stopPropagation()

    // 만약닫기의예현재노트북，필요이동
    if (currentNotebook?.id === id && !isHomePage) {
      // 찾에현재노트북목록에서의인덱스
      const currentIndex = openedNotebooks.findIndex((nb) => nb.id === id)
      const otherNotebooks = openedNotebooks.filter((nb) => nb.id !== id)

      if (otherNotebooks.length > 0) {
        // 만약현재아닌예첫 번째개，이동에위하나개；아니오이동에아래하나개
        const targetNotebook =
          currentIndex > 0 ? openedNotebooks[currentIndex - 1] : openedNotebooks[1]
        setCurrentNotebook(targetNotebook.id)
        navigate(`/notebook/${targetNotebook.id}`)
      } else {
        // 없있는기타노트북，이동에홈페이지
        navigate('/')
      }
    }
    removeOpenedNotebook(id)
  }

  const handleSettingsClick = (): void => {
    openSettings()
  }

  return (
    <div
      className="h-12 shrink-0 flex items-center justify-between px-2 gap-0.5"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* macOS 왼쪽빈공백영역（남겨둠윈도우제어버튼） */}
      {isMac() && <div className="w-20"></div>}

      {/* Linux 왼쪽설정버튼영역 */}
      {isLinux() && (
        <div className="flex items-center gap-2">
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
        </div>
      )}

      {/* 내비게이션태그 */}
      <div className="flex items-center gap-2 flex-1">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1">
          <TabsList
            className="bg-transparent border-0 gap-2 h-auto p-0 justify-start"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {/* 홈페이지태그 */}
            <TabsTrigger
              value="home"
              className="h-7 gap-2 px-3 data-[state=active]:bg-muted/50 data-[state=active]:shadow-sm rounded-md border data-[state=active]:border-border/50 border-transparent hover:bg-accent/50 transition-all"
            >
              <Home className="w-4 h-4" />
              <span>{t('home')}</span>
            </TabsTrigger>

            {/* 열기의노트북태그 */}
            {openedNotebooks.map((notebook) => (
              <TabsTrigger
                key={notebook.id}
                value={notebook.id}
                className="h-7 gap-1 pr-2 pl-3 data-[state=active]:bg-muted/50 data-[state=active]:shadow-sm rounded-md border data-[state=active]:border-border/50 border-transparent hover:bg-accent/50 transition-all max-w-[200px]"
              >
                <span className="truncate">{notebook.title}</span>
                <span
                  onClick={(e) => handleCloseOpenedNotebook(notebook.id, e)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      handleCloseOpenedNotebook(notebook.id, e as unknown as React.MouseEvent)
                    }
                  }}
                  className="ml-1 inline-flex items-center justify-center h-4 w-4 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive transition-colors"
                  title={t('closeTab')}
                >
                  <X className="w-3 h-3" />
                </span>
              </TabsTrigger>
            ))}

            {/* 새로 만들기버튼 */}
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
      </div>

      {/* 비Linux플랫폼의설정버튼（Windows및macOS보유지오른쪽） */}
      {!isLinux() && (
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
      )}

      {/* Windows 오른쪽빈공백영역（남겨둠윈도우제어버튼） */}
      {isWindows() && <div className="w-32"></div>}
    </div>
  )
}
