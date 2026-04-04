import { ReactElement, useState, useMemo } from 'react'
import { Search, Eye, EyeOff, ExternalLink, Download, Loader2, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { type Model, ModelType } from '../../../../shared/types'
import { categorizeModels } from '../../../../shared/utils/modelClassifier'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Switch } from '../ui/switch'
import { Checkbox } from '../ui/checkbox'

interface ProviderConfig {
  providerName: string
  config: Record<string, any>
  enabled: boolean
  updatedAt: number
}

interface ProviderConfigPanelProps {
  displayName: string
  description: string
  platformUrl: string
  provider: ProviderConfig
  models: Model[]
  isFetching: boolean
  onConfigChange: (config: Record<string, any>) => void
  onEnabledChange: (enabled: boolean) => void
  onFetchModels: () => void
  onDelete?: () => void // 선택：삭제제공자콜백（만자체정의제공자）
  defaultBaseUrl?: string // 선택：기본 Base URL（용도:복원기본）
}

export default function ProviderConfigPanel({
  displayName,
  description,
  platformUrl,
  provider,
  models,
  isFetching,
  onConfigChange,
  onEnabledChange,
  onFetchModels,
  onDelete,
  defaultBaseUrl
}: ProviderConfigPanelProps): ReactElement {
  const { t } = useTranslation('settings')
  const [showApiKey, setShowApiKey] = useState(false)
  const [modelSearchQuery, setModelSearchQuery] = useState('')
  const [showCategory, setShowCategory] = useState<'all' | 'chat' | 'embedding' | 'other'>('all')
  const [apiUrlError, setApiUrlError] = useState<string>('')

  const handleApiKeyChange = (apiKey: string) => {
    onConfigChange({ ...provider.config, apiKey })
  }

  const handleBaseUrlChange = (baseUrl: string) => {
    // 확인예아니오패키지포함비 ASCII 문자
    // eslint-disable-next-line no-control-regex
    if (baseUrl && /[^\x00-\x7F]/.test(baseUrl)) {
      setApiUrlError(t('apiUrlInvalid'))
    } else {
      setApiUrlError('')
    }
    onConfigChange({ ...provider.config, baseUrl })
  }

  const handleResetBaseUrl = () => {
    if (defaultBaseUrl) {
      handleBaseUrlChange(defaultBaseUrl)
    }
  }

  const handleModelToggle = (modelId: string, checked: boolean) => {
    const currentModels = provider.config.models || []
    const newModels = checked
      ? [...currentModels, modelId]
      : currentModels.filter((m: string) => m !== modelId)
    onConfigChange({ ...provider.config, models: newModels })
  }

  // 모델행분류
  const categorized = useMemo(() => categorizeModels(models || []), [models])

  // 기반으로선택에서의분류및검색바건필터링모델
  const filteredModels = useMemo(() => {
    let modelsToShow: Model[] = []

    if (showCategory === 'all') {
      modelsToShow = models || []
    } else if (showCategory === 'chat') {
      modelsToShow = categorized.chat
    } else if (showCategory === 'embedding') {
      modelsToShow = categorized.embedding
    } else if (showCategory === 'other') {
      modelsToShow = [...categorized.reranker, ...categorized.other]
    }

    // 앱검색필터링
    return modelsToShow.filter((model) =>
      model.id.toLowerCase().includes(modelSearchQuery.toLowerCase())
    )
  }, [models, categorized, showCategory, modelSearchQuery])

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* 상단부분제목및스위치 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-h1 text-foreground">{displayName}</h2>
          {provider.enabled && (
            <span className="px-2.5 py-0.5 bg-primary/20 text-primary text-xs font-medium rounded-full border border-primary/30">
              {t('active')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onDelete && (
            <Button onClick={onDelete} variant="ghost" size="icon" className="w-8 h-8">
              <Trash2 className="w-4 h-4 text-destructive" />
            </Button>
          )}
          <Switch checked={provider.enabled} onCheckedChange={onEnabledChange} />
        </div>
      </div>

      {/* 설명 */}
      <p className="text-muted-foreground text-sm -mt-1">{description}</p>

      {/* API Key */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-foreground">{t('apiKey')}</h3>
        <div className="relative">
          <Input
            type={showApiKey ? 'text' : 'password'}
            value={provider.config.apiKey || ''}
            onChange={(e) => handleApiKeyChange(e.target.value)}
            placeholder="sk-..."
            className="pr-12"
          />
          <Button
            onClick={() => setShowApiKey(!showApiKey)}
            variant="ghost"
            size="icon"
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8"
          >
            {showApiKey ? (
              <EyeOff className="w-4 h-4 text-muted-foreground" />
            ) : (
              <Eye className="w-4 h-4 text-muted-foreground" />
            )}
          </Button>
        </div>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <span>{t('getApiKeyFrom')}</span>
          <a
            href={platformUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:text-primary/80 inline-flex items-center gap-1"
          >
            {displayName} {t('platform')}
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* API URL - 모든제공자표시 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">{t('apiUrl')}</h3>
          {defaultBaseUrl && provider.config.baseUrl !== defaultBaseUrl && (
            <Button onClick={handleResetBaseUrl} variant="ghost" size="sm" className="h-7 text-xs">
              {t('resetToDefault')}
            </Button>
          )}
        </div>
        <Input
          value={provider.config.baseUrl || ''}
          onChange={(e) => handleBaseUrlChange(e.target.value)}
          placeholder="https://api.example.com/v1"
          className={apiUrlError ? 'border-destructive' : ''}
        />
        {apiUrlError ? (
          <p className="text-sm text-destructive">{apiUrlError}</p>
        ) : (
          <p className="text-xs text-muted-foreground">{t('apiUrlHint')}</p>
        )}
      </div>

      {/* Models */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">{t('models')}</h3>
          <Button onClick={onFetchModels} disabled={isFetching} variant="secondary" size="sm">
            {isFetching ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>{t('fetching')}</span>
              </>
            ) : (
              <>
                <Download className="w-3 h-3" />
                <span>{t('fetchModels')}</span>
              </>
            )}
          </Button>
        </div>

        {models && models.length > 0 && (
          <>
            {/* 분류태그 */}
            <div className="flex gap-2 flex-wrap">
              <Button
                onClick={() => setShowCategory('all')}
                variant={showCategory === 'all' ? 'default' : 'secondary'}
                size="sm"
                className="text-xs"
              >
                {t('allModels')} ({models.length})
              </Button>
              <Button
                onClick={() => setShowCategory('chat')}
                variant={showCategory === 'chat' ? 'default' : 'secondary'}
                size="sm"
                className="text-xs"
              >
                {t('chatModels')} ({categorized.chat.length})
              </Button>
              <Button
                onClick={() => setShowCategory('embedding')}
                variant={showCategory === 'embedding' ? 'default' : 'secondary'}
                size="sm"
                className="text-xs"
              >
                {t('embeddingModels')} ({categorized.embedding.length})
              </Button>
              {(categorized.reranker.length > 0 || categorized.other.length > 0) && (
                <Button
                  onClick={() => setShowCategory('other')}
                  variant={showCategory === 'other' ? 'default' : 'secondary'}
                  size="sm"
                  className="text-xs"
                >
                  {t('otherModels')} ({categorized.reranker.length + categorized.other.length})
                </Button>
              )}
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder={t('searchModels')}
                value={modelSearchQuery}
                onChange={(e) => setModelSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="max-h-60 overflow-y-auto themed-scrollbar space-y-2 border border-border rounded-lg p-2 shadow-sm">
              <p className="text-xs text-muted-foreground px-2 py-1">
                {showCategory === 'all'
                  ? t('totalModels', { count: models.length })
                  : t('showingModels', { count: filteredModels.length, total: models.length })}
              </p>
              {filteredModels.map((model) => (
                <label
                  key={model.id}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-muted rounded-lg cursor-pointer transition-colors"
                >
                  <Checkbox
                    checked={provider.config.models?.includes(model.id) || false}
                    onCheckedChange={(checked) => handleModelToggle(model.id, checked as boolean)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium text-foreground truncate">{model.id}</div>
                      {/* 표시모델타입태그 */}
                      {model.type && (
                        <span
                          className={`px-1.5 py-0.5 text-xs rounded ${
                            model.type === ModelType.CHAT
                              ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
                              : model.type === ModelType.EMBEDDING
                                ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                                : model.type === ModelType.RERANKER
                                  ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400'
                                  : 'bg-gray-500/20 text-gray-600 dark:text-gray-400'
                          }`}
                        >
                          {model.type}
                        </span>
                      )}
                    </div>
                    {model.owned_by && (
                      <div className="text-xs text-muted-foreground">by {model.owned_by}</div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
