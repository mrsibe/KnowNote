import { Globe, Database, HelpCircle, MessageSquare, Keyboard } from 'lucide-react'
import { useState, useEffect, useMemo, ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import GeneralSettings from './GeneralSettings'
import { useUIStore } from '../../store/uiStore'
import ModelsSettings from './ModelsSettings'
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
import type { AppSettings, ConnectionMap } from '../../../../shared/types'
import { MODEL_CAPABILITIES } from '../../../../shared/types'

export default function SettingsDialog(): ReactElement {
  const { t } = useTranslation('settings')
  const { isSettingsOpen, closeSettings } = useUIStore()
  const [activeSection, setActiveSection] = useState<string>('general')
  const [originalSettings, setOriginalSettings] = useState<AppSettings | null>(null)
  const [pendingSettings, setPendingSettings] = useState<AppSettings | null>(null)
  const [originalConnections, setOriginalConnections] = useState<ConnectionMap>({})
  const [pendingConnections, setPendingConnections] = useState<ConnectionMap>({})

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      closeSettings()
    }
  }

  // 加载初始设置
  useEffect(() => {
    const loadSettings = async () => {
      const settings = await window.api.settings.getAll()
      setOriginalSettings(settings)
      setPendingSettings(settings)

      const connections = await window.api.connections.getAll()
      setOriginalConnections(connections)
      setPendingConnections(connections)
    }
    loadSettings()
  }, [])

  // 使用 useMemo 计算是否有变化
  const hasChanges = useMemo(() => {
    if (!originalSettings || !pendingSettings) {
      return false
    }
    const settingsChanged = JSON.stringify(originalSettings) !== JSON.stringify(pendingSettings)
    const connectionsChanged =
      JSON.stringify(originalConnections) !== JSON.stringify(pendingConnections)
    return settingsChanged || connectionsChanged
  }, [originalSettings, pendingSettings, originalConnections, pendingConnections])

  const menuItems = [
    {
      id: 'general',
      icon: Globe,
      label: t('generalSettings'),
      title: t('generalSettings'),
      description: t('generalSettingsDesc')
    },
    {
      id: 'models',
      icon: Database,
      label: t('modelConnections'),
      title: t('modelConnections'),
      description: t('modelConnectionsDesc')
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

  // 更新临时设置
  const updatePendingSettings = (updates: Partial<AppSettings>) => {
    if (pendingSettings) {
      setPendingSettings({ ...pendingSettings, ...updates })
    }
  }

  // 确认保存
  const handleConfirm = async () => {
    if (pendingSettings) {
      await window.api.settings.update(pendingSettings)
      setOriginalSettings(pendingSettings)
    }

    // 保存或删除每个能力的连接
    for (const capability of MODEL_CAPABILITIES) {
      const connection = pendingConnections[capability]
      if (connection && connection.baseUrl && connection.modelId) {
        await window.api.connections.save(capability, connection)
      } else {
        const wasConfigured = Boolean(originalConnections[capability])
        if (wasConfigured) {
          await window.api.connections.remove(capability)
        }
      }
    }

    const saved = await window.api.connections.getAll()
    setOriginalConnections(saved)
    setPendingConnections(saved)
  }

  // 取消变更
  const handleCancel = () => {
    if (originalSettings) {
      setPendingSettings(originalSettings)
    }
    setPendingConnections(originalConnections)
  }

  return (
    <Dialog open={isSettingsOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-5xl h-[80vh] p-0 flex flex-col bg-surface-sunken"
        showCloseButton={false}
      >
        <SidebarProvider className="flex flex-1 min-h-0">
          <div className="flex flex-1 min-h-0 gap-3 p-3 w-full">
            {/* 使用 Shadcn Sidebar */}
            <Sidebar className="w-40 bg-transparent" collapsible="none">
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
                              ? 'bg-surface-selected! text-foreground! font-medium'
                              : 'hover:bg-surface-hover hover:text-foreground'
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

            {/* 获取当前活跃项的配置 */}
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
                    />
                  )}
                  {activeSection === 'models' && (
                    <ModelsSettings
                      connections={pendingConnections}
                      onConnectionsChange={setPendingConnections}
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
