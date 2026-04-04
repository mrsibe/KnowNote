import { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw } from 'lucide-react'
import SettingItem from './SettingItem'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import type { AppSettings } from '../../../../shared/types'

interface PromptsSettingsProps {
  settings: AppSettings
  onSettingsChange: (updates: Partial<AppSettings>) => void
}

export default function PromptsSettings({
  settings,
  onSettingsChange
}: PromptsSettingsProps): ReactElement {
  const { t } = useTranslation('settings')

  const currentLanguage = settings.language
  // 후엔드의 mergeSettings 이미보장모든필드있는기본값，프론트엔드직접사용
  const currentMindMapPrompt = settings.prompts?.mindMap?.[currentLanguage] || ''
  const currentQuizPrompt = settings.prompts?.quiz?.[currentLanguage] || ''
  const currentAnkiPrompt = settings.prompts?.anki?.[currentLanguage] || ''

  const handleMindMapPromptChange = (value: string) => {
    onSettingsChange({
      prompts: {
        ...settings.prompts,
        mindMap: {
          ...settings.prompts?.mindMap,
          [currentLanguage]: value
        }
      }
    })
  }

  const handleQuizPromptChange = (value: string) => {
    onSettingsChange({
      prompts: {
        ...settings.prompts,
        quiz: {
          ...settings.prompts?.quiz,
          [currentLanguage]: value
        }
      }
    })
  }

  const handleAnkiPromptChange = (value: string) => {
    onSettingsChange({
      prompts: {
        ...settings.prompts,
        anki: {
          ...settings.prompts?.anki,
          [currentLanguage]: value
        }
      }
    })
  }

  const handleResetToDefault = async () => {
    // 에서 defaults.ts 조회기본힌트
    const defaultPrompts = await window.api.settings.getDefaultPrompts()
    onSettingsChange({
      prompts: defaultPrompts
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingItem
        title={t('mindMapPrompt')}
        description=""
        layout="vertical"
        action={
          <Button variant="outline" size="sm" onClick={handleResetToDefault}>
            <RotateCcw className="w-4 h-4 mr-2" />
            {t('resetToDefault')}
          </Button>
        }
      >
        <div className="relative">
          <Textarea
            value={currentMindMapPrompt}
            onChange={(e) => handleMindMapPromptChange(e.target.value)}
            placeholder={t('promptPlaceholder')}
            className="w-full h-[400px] max-h-[400px] resize-none bg-input border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-ring font-mono text-sm leading-relaxed overflow-y-auto themed-scrollbar"
          />
        </div>
      </SettingItem>

      <SettingItem
        title={t('quizPrompt')}
        description=""
        layout="vertical"
        action={
          <Button variant="outline" size="sm" onClick={handleResetToDefault}>
            <RotateCcw className="w-4 h-4 mr-2" />
            {t('resetToDefault')}
          </Button>
        }
      >
        <div className="relative">
          <Textarea
            value={currentQuizPrompt}
            onChange={(e) => handleQuizPromptChange(e.target.value)}
            placeholder={t('promptPlaceholder')}
            className="w-full h-[400px] max-h-[400px] resize-none bg-input border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-ring font-mono text-sm leading-relaxed overflow-y-auto themed-scrollbar"
          />
        </div>
      </SettingItem>

      <SettingItem
        title={t('ankiPrompt')}
        description=""
        layout="vertical"
        action={
          <Button variant="outline" size="sm" onClick={handleResetToDefault}>
            <RotateCcw className="w-4 h-4 mr-2" />
            {t('resetToDefault')}
          </Button>
        }
      >
        <div className="relative">
          <Textarea
            value={currentAnkiPrompt}
            onChange={(e) => handleAnkiPromptChange(e.target.value)}
            placeholder={t('promptPlaceholder')}
            className="w-full h-[400px] max-h-[400px] resize-none bg-input border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-ring font-mono text-sm leading-relaxed overflow-y-auto themed-scrollbar"
          />
        </div>
      </SettingItem>
    </div>
  )
}
