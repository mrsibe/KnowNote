import { Globe, Database, HelpCircle, MessageSquare, Keyboard } from 'lucide-react'
import { useState, useEffect, useMemo, ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import GeneralSettings from './GeneralSettings'
import { useUIStore } from '../../store/uiStore'
import ProvidersSettings from './ProvidersSettings'
import PromptsSettings from './PromptsSettings'
import ShortcutSettings from './ShortcutSettings'
import AboutSettings from './AboutSettings'
import SettingsContentPanel from './SettingsContentPanel'
import { Dialog, DialogContent } from '../ui/dialog'
import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarProvider
} from '../ui/sidebar'
import type { AppSettings } from '../../../../shared/types'

interface ProviderConfig {
  providerName: string
  config: Record<string, any>
  enabled: boolean
  updatedAt: number
}

export default function SettingsDialog(): ReactElement {
  const { t } = useTranslation('settings')
  const { isSettingsOpen, closeSettings } = useUIStore()
  const [activeSection, setActiveSection] = useState<string>('general')
  const [originalSettings, setOriginalSettings] = useState<AppSettings | null>(null)
  const [pendingSettings, setPendingSettings] = useState<AppSettings | null>(null)
  const [originalProviders, setOriginalProviders] = useState<ProviderConfig[]>([])
  const [pendingProviders, setPendingProviders] = useState<ProviderConfig[]>([])

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      closeSettings()
    }
  }

  // 로드초기시작설정
  useEffect(() => {
    const loadSettings = async () => {
      const settings = await window.api.settings.getAll()
      setOriginalSettings(settings)
      setPendingSettings(settings)

      const providers = await window.api.getAllProviderConfigs()
      setOriginalProviders(providers)
      setPendingProviders(providers)
    }
    loadSettings()
  }, [])

  // 사용 useMemo 계산예아니오있는변경
  const hasChanges = useMemo(() => {
    if (originalSettings && pendingSettings && originalProviders && pendingProviders) {
      const settingsChanged = JSON.stringify(originalSettings) !== JSON.stringify(pendingSettings)
      const providersChanged =
        JSON.stringify(originalProviders) !== JSON.stringify(pendingProviders)
      return settingsChanged || providersChanged
    }
    return false
  }, [originalSettings, pendingSettings, originalProviders, pendingProviders])

  const menuItems = [
    {
      id: 'general',
      icon: Globe,
      label: t('generalSettings'),
      title: t('generalSettings'),
      description: t('generalSettingsDesc')
    },
    {
      id: 'provider',
      icon: Database,
      label: t('aiProviders'),
      title: t('aiProviders'),
      description: t('aiProvidersDesc')
    },
    {
      id: 'prompts',
      icon: MessageSquare,
      label: t('promptSettings'),
      title: t('promptSettings'),
      description: t('mindMapPromptDesc')
    },
    {
      id: 'shortcuts',
      icon: Keyboard,
      label: t('shortcuts'),
      title: t('shortcuts'),
      description: t('shortcutsDesc')
    },
    {
      id: 'about',
      icon: HelpCircle,
      label: t('about'),
      title: t('about'),
      description: t('aboutDesc')
    }
  ]

  // 업데이트임시시설정
  const updatePendingSettings = (updates: Partial<AppSettings>) => {
    if (pendingSettings) {
      setPendingSettings({ ...pendingSettings, ...updates })
    }
  }

  // 업데이트임시시제공자설정
  const updatePendingProviders = (updatedProviders: ProviderConfig[]) => {
    setPendingProviders(updatedProviders)
  }

  // 제공자 새로고침설정（용도:새로 추가된/삭제후동기상태）
  const refreshProviders = async () => {
    const providers = await window.api.getAllProviderConfigs()
    setOriginalProviders(providers)
    setPendingProviders(providers)
  }

  // 확인저장
  const handleConfirm = async () => {
    // 저장통용설정
    if (pendingSettings) {
      await window.api.settings.update(pendingSettings)
      setOriginalSettings(pendingSettings)
    }

    // 제공자 설정 저장（새로 추가된/삭제이미즉시저장，내부저장수정수정）
    for (const provider of pendingProviders) {
      await window.api.saveProviderConfig(provider)
    }
    setOriginalProviders(pendingProviders)
  }

  // 취소변더
  const handleCancel = () => {
    if (originalSettings) {
      setPendingSettings(originalSettings)
    }
    if (originalProviders) {
      setPendingProviders(originalProviders)
    }
  }

  return (
    <Dialog open={isSettingsOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-5xl h-[80vh] p-0 flex flex-col bg-sidebar"
        showCloseButton={false}
      >
        <SidebarProvider className="flex flex-1 min-h-0">
          <div className="flex flex-1 min-h-0 gap-3 p-3 w-full">
            {/* 사용 Shadcn Sidebar */}
            <Sidebar className="w-40" collapsible="none">
              <SidebarContent>
                <SidebarMenu>
                  {menuItems.map((item) => {
                    const Icon = item.icon
                    const isActive = activeSection === item.id
                    return (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          onClick={() => setActiveSection(item.id)}
                          isActive={isActive}
                          className={
                            isActive
                              ? 'bg-sidebar-primary! text-sidebar-primary-foreground!'
                              : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                          }
                        >
                          <Icon className="w-4 h-4" />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarContent>
            </Sidebar>

            {/* 현재 조회활점프항목의설정 */}
            {(() => {
              const currentItem = menuItems.find((item) => item.id === activeSection)
              if (!currentItem) return null

              return (
                <SettingsContentPanel
                  title={currentItem.title}
                  description={currentItem.description}
                  hasChanges={hasChanges}
                  onCancel={handleCancel}
                  onConfirm={handleConfirm}
                  onClose={() => closeSettings()}
                >
                  {pendingSettings && activeSection === 'general' && (
                    <GeneralSettings
                      settings={pendingSettings}
                      onSettingsChange={updatePendingSettings}
                      providers={pendingProviders}
                    />
                  )}
                  {activeSection === 'provider' && (
                    <ProvidersSettings
                      providers={pendingProviders}
                      onProvidersChange={updatePendingProviders}
                      onRefresh={refreshProviders}
                    />
                  )}
                  {pendingSettings && activeSection === 'prompts' && (
                    <PromptsSettings
                      settings={pendingSettings}
                      onSettingsChange={updatePendingSettings}
                    />
                  )}
                  {activeSection === 'shortcuts' && <ShortcutSettings />}
                  {activeSection === 'about' && <AboutSettings />}
                </SettingsContentPanel>
              )
            })()}
          </div>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}
