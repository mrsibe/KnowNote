import { ReactElement, useEffect, useMemo } from 'react'
import { Sun, Moon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useI18nStore } from '../../store/i18nStore'
import type { AppSettings } from '../../../../shared/types'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet
} from '../ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Button } from '../ui/button'

interface ProviderConfig {
  providerName: string
  config: Record<string, any>
  enabled: boolean
  updatedAt: number
}

interface GeneralSettingsProps {
  settings: AppSettings
  onSettingsChange: (updates: Partial<AppSettings>) => void
  providers: ProviderConfig[]
}

const languages = [
  { value: 'ko-KR', label: 'Korean', native: '한국어' },
  { value: 'en-US', label: 'English', native: 'English' }
]

export default function GeneralSettings({
  settings,
  onSettingsChange,
  providers
}: GeneralSettingsProps): ReactElement {
  const { t } = useTranslation('settings')
  const { changeLanguage } = useI18nStore()

  // 분별도조회대화모델및임베딩모델
  const { availableChatModels, availableEmbeddingModels } = useMemo(() => {
    const chatModels: Array<{ id: string; provider: string; label: string }> = []
    const embeddingModels: Array<{ id: string; provider: string; label: string }> = []

    providers.forEach((provider) => {
      if (provider.enabled && provider.config.models && Array.isArray(provider.config.models)) {
        // 에서 modelDetails 조회완전한의모델정보（패키지포함 type 필드）
        const modelDetails = provider.config.modelDetails || []

        provider.config.models.forEach((modelId: string) => {
          const modelDetail = modelDetails.find((m: any) => m.id === modelId)
          const modelObj = {
            id: `${provider.providerName}:${modelId}`,
            provider: provider.providerName,
            label: modelId
          }

          // 기반으로타입분류
          if (modelDetail?.type === 'embedding') {
            embeddingModels.push(modelObj)
          } else if (modelDetail?.type === 'chat' || !modelDetail?.type) {
            chatModels.push(modelObj)
          }
        })
      }
    })

    return { availableChatModels: chatModels, availableEmbeddingModels: embeddingModels }
  }, [providers])

  // 확인기본모델예아니오여전히사용 가능，만약아닌사용 가능비우기
  useEffect(() => {
    if (providers.length === 0) {
      return
    }

    const isChatModelAvailable = settings.defaultChatModel
      ? availableChatModels.some((model) => model.id === settings.defaultChatModel)
      : true

    if (!isChatModelAvailable && settings.defaultChatModel) {
      onSettingsChange({ defaultChatModel: '' })
    }

    const isEmbeddingModelAvailable = settings.defaultEmbeddingModel
      ? availableEmbeddingModels.some((model) => model.id === settings.defaultEmbeddingModel)
      : true

    if (!isEmbeddingModelAvailable && settings.defaultEmbeddingModel) {
      onSettingsChange({ defaultEmbeddingModel: '' })
    }
  }, [
    providers,
    settings.defaultChatModel,
    settings.defaultEmbeddingModel,
    availableChatModels,
    availableEmbeddingModels,
    onSettingsChange
  ])

  // 때테마변경시，즉시업데이트 DOM 으로미리보기효과
  useEffect(() => {
    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [settings.theme])

  return (
    <FieldSet>
      <FieldGroup>
        {/* 테마 모드 설정 */}
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>{t('themeMode')}</FieldLabel>
            <FieldDescription>{t('selectTheme')}</FieldDescription>
          </FieldContent>
          <div className="inline-flex rounded-lg border bg-muted p-1">
            <Button
              onClick={() => onSettingsChange({ theme: 'light' })}
              variant={settings.theme === 'light' ? 'default' : 'ghost'}
              size="sm"
              className="gap-1.5 rounded-md"
            >
              <Sun className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">{t('light')}</span>
            </Button>
            <Button
              onClick={() => onSettingsChange({ theme: 'dark' })}
              variant={settings.theme === 'dark' ? 'default' : 'ghost'}
              size="sm"
              className="gap-1.5 rounded-md"
            >
              <Moon className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">{t('dark')}</span>
            </Button>
          </div>
        </Field>

        {/* 언어설정 */}
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="language-select">{t('language')}</FieldLabel>
            <FieldDescription>{t('languageDesc')}</FieldDescription>
          </FieldContent>
          <Select
            value={settings.language}
            onValueChange={(value) => {
              const newLang = value as AppSettings['language']
              onSettingsChange({ language: newLang })
              changeLanguage(newLang)
            }}
          >
            <SelectTrigger id="language-select" className="w-56">
              <SelectValue placeholder={t('pleaseSelect')}>
                {languages.find((lang) => lang.value === settings.language)?.native}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {languages.map((language) => (
                <SelectItem key={language.value} value={language.value}>
                  <span className="text-sm font-medium">{language.native}</span>
                  <span className="text-xs text-muted-foreground">{language.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {/* 기본대화모델설정 */}
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="chat-model-select">{t('defaultChatModel')}</FieldLabel>
            <FieldDescription>
              {availableChatModels.length > 0 ? t('defaultChatModelDesc') : t('noAvailableModel')}
            </FieldDescription>
          </FieldContent>
          {availableChatModels.length > 0 && (
            <Select
              value={settings.defaultChatModel || undefined}
              onValueChange={(value) => onSettingsChange({ defaultChatModel: value })}
            >
              <SelectTrigger id="chat-model-select" className="w-56">
                <SelectValue placeholder={t('pleaseSelectModel')}>
                  {availableChatModels.find((m) => m.id === settings.defaultChatModel)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {availableChatModels.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{model.label}</span>
                      {model.provider && (
                        <span className="text-xs text-muted-foreground">{model.provider}</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>

        {/* 기본임베딩모델설정 */}
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="embedding-model-select">{t('defaultEmbeddingModel')}</FieldLabel>
            <FieldDescription>
              {availableEmbeddingModels.length > 0
                ? t('defaultEmbeddingModelDesc')
                : t('noAvailableModel')}
            </FieldDescription>
          </FieldContent>
          {availableEmbeddingModels.length > 0 && (
            <Select
              value={settings.defaultEmbeddingModel || undefined}
              onValueChange={(value) => onSettingsChange({ defaultEmbeddingModel: value })}
            >
              <SelectTrigger id="embedding-model-select" className="w-56">
                <SelectValue placeholder={t('pleaseSelectModel')}>
                  {
                    availableEmbeddingModels.find((m) => m.id === settings.defaultEmbeddingModel)
                      ?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {availableEmbeddingModels.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{model.label}</span>
                      {model.provider && (
                        <span className="text-xs text-muted-foreground">{model.provider}</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      </FieldGroup>
    </FieldSet>
  )
}
