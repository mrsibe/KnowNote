import { useState, useEffect, ReactElement } from 'react'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ProviderConfigPanel from './ProviderConfigPanel'
import AddProviderDialog from './AddProviderDialog'
import DeleteProviderDialog from './DeleteProviderDialog'
import { ScrollArea } from '../ui/scroll-area'
import { Input } from '../ui/input'
import { Button } from '../ui/button'

interface ProviderConfig {
  providerName: string
  config: Record<string, any>
  enabled: boolean
  updatedAt: number
}

interface ProvidersSettingsProps {
  providers: ProviderConfig[]
  onProvidersChange: (updatedProviders: ProviderConfig[]) => void
  onRefresh: () => Promise<void>
}

interface Model {
  id: string
  object: string
  owned_by?: string
  created?: number
}

export default function ProvidersSettings({
  providers,
  onProvidersChange,
  onRefresh
}: ProvidersSettingsProps): ReactElement {
  const { t } = useTranslation('settings')
  const [activeProvider, setActiveProvider] = useState<string>('lmstudio')
  const [searchQuery, setSearchQuery] = useState('')
  const [models, setModels] = useState<Record<string, Model[]>>({})
  const [fetchingModels, setFetchingModels] = useState<Record<string, boolean>>({})
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [providerToDelete, setProviderToDelete] = useState<string>('')

  // 각 프로바이더의 기본 baseUrl 정의
  const defaultBaseUrls: Record<string, string> = {
    lmstudio: 'http://localhost:1234/v1',
    ollama: 'http://localhost:11434/api',
    openai: 'https://api.openai.com/v1',
    deepseek: 'https://api.deepseek.com'
  }

  // 캐시된 모델 목록 로드
  useEffect(() => {
    const loadCachedModels = async () => {
      const providerList = ['lmstudio', 'ollama', 'openai', 'deepseek']
      const loadedModels: Record<string, Model[]> = {}

      for (const providerName of providerList) {
        try {
          const cachedModels = await window.api.getProviderModels(providerName)
          loadedModels[providerName] = cachedModels

          // provider.config.modelDetails에 동기화하여 GeneralSettings에서 모델 타입을 읽을 수 있도록 함
          const provider = providers.find((p) => p.providerName === providerName)
          if (provider && cachedModels.length > 0) {
            // 이미 modelDetails가 있는 경우 중복 업데이트 방지
            if (!provider.config.modelDetails || provider.config.modelDetails.length === 0) {
              console.log(
                `[Sync] Syncing ${cachedModels.length} cached models to ${providerName}.config.modelDetails`
              )
              updateProviderConfig(providerName, {
                config: {
                  ...provider.config,
                  modelDetails: cachedModels
                }
              })
            }
          }
        } catch (error) {
          console.error(`Failed to load cached models for ${providerName}:`, error)
        }
      }

      setModels(loadedModels)
    }

    loadCachedModels()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 프로바이더 설정 조회
  const getProviderConfig = (providerName: string) => {
    const existingProvider = providers.find((p) => p.providerName === providerName)

    if (existingProvider) {
      // 프로바이더가 존재하지만 baseUrl이 설정되지 않은 경우 기본값 추가
      return {
        ...existingProvider,
        config: {
          ...existingProvider.config,
          baseUrl: existingProvider.config.baseUrl || defaultBaseUrls[providerName] || ''
        }
      }
    }

    // 프로바이더가 존재하지 않는 경우 기본 설정 객체 생성
    return {
      providerName,
      config: {
        baseUrl: defaultBaseUrls[providerName] || '',
        apiKey: '',
        models: [],
        displayName: providerName
      },
      enabled: false,
      updatedAt: 0
    }
  }

  // 프로바이더 설정 업데이트
  const updateProviderConfig = (
    providerName: string,
    updates: Partial<Pick<ProviderConfig, 'config' | 'enabled'>>
  ) => {
    const updatedProviders = [...providers]
    const index = updatedProviders.findIndex((p) => p.providerName === providerName)

    if (index !== -1) {
      updatedProviders[index] = {
        ...updatedProviders[index],
        ...updates,
        config: updates.config !== undefined ? updates.config : updatedProviders[index].config,
        updatedAt: Date.now()
      }
    } else {
      updatedProviders.push({
        providerName,
        config: updates.config || {},
        enabled: updates.enabled || false,
        updatedAt: Date.now()
      })
    }

    onProvidersChange(updatedProviders)
  }

  // 모델 목록 가져오기
  const fetchModels = async (providerName: string) => {
    const provider = getProviderConfig(providerName)
    const apiKey = provider.config.apiKey

    // 로컬 프로바이더는 API 키 없이도 모델 목록을 가져올 수 있음
    const isLocalProvider = providerName === 'lmstudio' || providerName === 'ollama'
    if (!apiKey && !isLocalProvider) {
      alert(t('enterApiKey'))
      return
    }

    setFetchingModels((prev) => ({ ...prev, [providerName]: true }))

    try {
      const result = await window.api.fetchModels(providerName, apiKey || '')

      // 타입 가드: 새 형식인지 확인 (models와 source 필드 포함)
      const isNewFormat = (
        res: any
      ): res is {
        models: Model[]
        source: 'merged' | 'builtin'
        builtinCount?: number
        remoteCount?: number
        error?: string
      } => {
        return res && typeof res === 'object' && 'models' in res && 'source' in res
      }

      if (isNewFormat(result)) {
        const modelList = result.models
        setModels((prev) => ({ ...prev, [providerName]: modelList }))

        // 전체 모델 정보를 config에 저장
        updateProviderConfig(providerName, {
          config: {
            ...provider.config,
            modelDetails: modelList
          }
        })

        if (result.source === 'merged') {
          console.log(
            `[Models Updated] ${providerName}: 내장 ${result.builtinCount}개 + 원격 ${result.remoteCount}개 병합 완료`
          )
        } else if (result.source === 'builtin') {
          console.warn(`[Models Fallback] ${providerName}: 네트워크 요청 실패, 내장 모델 사용`)
        }
      } else {
        const modelList = result
        setModels((prev) => ({ ...prev, [providerName]: modelList }))

        updateProviderConfig(providerName, {
          config: {
            ...provider.config,
            modelDetails: modelList
          }
        })
      }
    } catch (error) {
      console.error('Failed to fetch model list:', error)
      alert(`${t('fetchModelFailed')}${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setFetchingModels((prev) => ({ ...prev, [providerName]: false }))
    }
  }

  const lmstudioProvider = getProviderConfig('lmstudio')
  const ollamaProvider = getProviderConfig('ollama')
  const openaiProvider = getProviderConfig('openai')
  const deepseekProvider = getProviderConfig('deepseek')

  const providerList = [
    {
      id: 'lmstudio',
      name: 'LM Studio',
      description: t('lmstudioDesc', { defaultValue: 'Local LLM server (OpenAI compatible)' }),
      platformUrl: 'https://lmstudio.ai',
      enabled: lmstudioProvider.enabled
    },
    {
      id: 'ollama',
      name: 'Ollama',
      description: t('ollamaDesc', { defaultValue: 'Local LLM runner' }),
      platformUrl: 'https://ollama.com',
      enabled: ollamaProvider.enabled
    },
    {
      id: 'openai',
      name: t('openaiName'),
      description: t('openaiDesc'),
      platformUrl: 'https://platform.openai.com',
      enabled: openaiProvider.enabled
    },
    {
      id: 'deepseek',
      name: t('deepseekName'),
      description: t('deepseekDesc'),
      platformUrl: 'https://platform.deepseek.com',
      enabled: deepseekProvider.enabled
    }
  ]

  // 사용자 정의 프로바이더 목록 가져오기
  const getCustomProviders = () => {
    const builtInProviders = ['lmstudio', 'ollama', 'openai', 'deepseek']
    return providers
      .filter((p) => !builtInProviders.includes(p.providerName))
      .map((p) => ({
        id: p.providerName,
        name: p.config.displayName || p.providerName,
        enabled: p.enabled
      }))
  }

  const customProviders = getCustomProviders()

  // 프로바이더 추가 처리
  const handleAddProvider = async (data: {
    providerName: string
    apiKey: string
    baseUrl: string
  }) => {
    const newProvider: ProviderConfig = {
      providerName: data.providerName,
      config: {
        apiKey: data.apiKey,
        baseUrl: data.baseUrl,
        displayName: data.providerName,
        models: []
      },
      enabled: false,
      updatedAt: Date.now()
    }

    // 백엔드에 즉시 저장
    await window.api.saveProviderConfig(newProvider)

    // 상태 새로고침 (original과 pending 동기화)
    await onRefresh()

    // 새 프로바이더로 전환
    setActiveProvider(data.providerName)
  }

  // 삭제 확인 다이얼로그 열기
  const handleDeleteClick = (providerName: string) => {
    setProviderToDelete(providerName)
    setIsDeleteDialogOpen(true)
  }

  // 프로바이더 삭제 확인
  const handleDeleteConfirm = async () => {
    // 백엔드에서 즉시 삭제
    await window.api.deleteProviderConfig(providerToDelete)

    // 상태 새로고침
    await onRefresh()

    // 삭제된 프로바이더가 현재 선택된 경우 lmstudio로 전환
    if (activeProvider === providerToDelete) {
      setActiveProvider('lmstudio')
    }

    setProviderToDelete('')
  }

  // 사용자 정의 프로바이더 모델 가져오기 (CORS 문제 회피를 위해 백엔드 API 사용)
  const fetchCustomProviderModels = async (providerName: string) => {
    const provider = getProviderConfig(providerName)
    const apiKey = provider.config.apiKey
    const baseUrl = provider.config.baseUrl

    if (!apiKey) {
      alert(t('enterApiKey'))
      return
    }

    if (!baseUrl) {
      alert(t('enterApiKeyAndUrl'))
      return
    }

    // URL에 비 ASCII 문자가 포함되어 있는지 확인
    // eslint-disable-next-line no-control-regex
    if (/[^\x00-\x7F]/.test(baseUrl)) {
      alert(t('apiUrlInvalid'))
      return
    }

    setFetchingModels((prev) => ({ ...prev, [providerName]: true }))

    try {
      // 현재 설정을 백엔드에 저장하여 baseUrl을 읽을 수 있도록 함
      await window.api.saveProviderConfig({
        providerName,
        config: provider.config,
        enabled: provider.enabled,
        updatedAt: Date.now()
      })

      // 백엔드 API 사용
      const result = await window.api.fetchModels(providerName, apiKey)

      // 타입 가드: 새 형식인지 확인
      const isNewFormat = (
        res: any
      ): res is {
        models: Model[]
        source: 'merged' | 'builtin'
        builtinCount?: number
        remoteCount?: number
        error?: string
      } => {
        return res && typeof res === 'object' && 'models' in res && 'source' in res
      }

      const modelList = isNewFormat(result) ? result.models : result
      setModels((prev) => ({ ...prev, [providerName]: modelList }))

      // 전체 모델 정보를 config에 저장
      updateProviderConfig(providerName, {
        config: {
          ...provider.config,
          modelDetails: modelList
        }
      })
    } catch (error) {
      console.error('Failed to fetch model list:', error)
      alert(`${t('fetchModelFailed')}${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setFetchingModels((prev) => ({ ...prev, [providerName]: false }))
    }
  }

  const filteredProviders = providerList.filter((provider) =>
    provider.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="flex h-full gap-6 overflow-hidden">
      {/* 좌측 프로바이더 목록 */}
      <div className="w-48 shrink-0 flex flex-col gap-4">
        {/* 검색창 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
          <Input
            type="text"
            placeholder={t('searchProvider')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* 프로바이더 목록 */}
        <div className="flex flex-col gap-2">
          {/* 내장 프로바이더 */}
          {filteredProviders.map((provider) => (
            <Button
              key={provider.id}
              onClick={() => setActiveProvider(provider.id)}
              variant={activeProvider === provider.id ? 'secondary' : 'outline'}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl justify-start h-auto ${
                activeProvider === provider.id ? 'border-primary/50' : ''
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">{provider.name}</div>
              </div>
              <div
                className={`w-2 h-2 rounded-full ${provider.enabled ? 'bg-primary' : 'bg-muted'}`}
              ></div>
            </Button>
          ))}

          {/* 구분선 */}
          {customProviders.length > 0 && <div className="border-t border-border my-2" />}

          {/* 사용자 정의 프로바이더 */}
          {customProviders
            .filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
            .map((provider) => (
              <Button
                key={provider.id}
                onClick={() => setActiveProvider(provider.id)}
                variant={activeProvider === provider.id ? 'secondary' : 'outline'}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl justify-start h-auto ${
                  activeProvider === provider.id ? 'border-primary/50' : ''
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">{provider.name}</div>
                </div>
                <div
                  className={`w-2 h-2 rounded-full ${provider.enabled ? 'bg-primary' : 'bg-muted'}`}
                />
              </Button>
            ))}
        </div>

        {/* 사용자 정의 프로바이더 추가 버튼 */}
        <Button
          className="w-full py-3 rounded-xl text-sm font-medium h-auto"
          onClick={() => setIsAddDialogOpen(true)}
        >
          {t('addCustomProvider')}
        </Button>
      </div>

      {/* 우측 설정 영역 */}
      <ScrollArea className="flex-1 min-w-0">
        {activeProvider === 'lmstudio' && (
          <ProviderConfigPanel
            displayName="LM Studio"
            description={t('lmstudioDesc', { defaultValue: 'Local LLM server (OpenAI compatible)' })}
            platformUrl="https://lmstudio.ai"
            provider={lmstudioProvider}
            models={models.lmstudio || []}
            isFetching={fetchingModels.lmstudio || false}
            onConfigChange={(config) => updateProviderConfig('lmstudio', { config })}
            onEnabledChange={(enabled) => updateProviderConfig('lmstudio', { enabled })}
            onFetchModels={() => fetchModels('lmstudio')}
            defaultBaseUrl={defaultBaseUrls.lmstudio}
          />
        )}

        {activeProvider === 'ollama' && (
          <ProviderConfigPanel
            displayName="Ollama"
            description={t('ollamaDesc', { defaultValue: 'Local LLM runner' })}
            platformUrl="https://ollama.com"
            provider={ollamaProvider}
            models={models.ollama || []}
            isFetching={fetchingModels.ollama || false}
            onConfigChange={(config) => updateProviderConfig('ollama', { config })}
            onEnabledChange={(enabled) => updateProviderConfig('ollama', { enabled })}
            onFetchModels={() => fetchModels('ollama')}
            defaultBaseUrl={defaultBaseUrls.ollama}
          />
        )}

        {activeProvider === 'openai' && (
          <ProviderConfigPanel
            displayName={t('openaiName')}
            description={t('openaiDesc')}
            platformUrl="https://platform.openai.com"
            provider={openaiProvider}
            models={models.openai || []}
            isFetching={fetchingModels.openai || false}
            onConfigChange={(config) => updateProviderConfig('openai', { config })}
            onEnabledChange={(enabled) => updateProviderConfig('openai', { enabled })}
            onFetchModels={() => fetchModels('openai')}
            defaultBaseUrl={defaultBaseUrls.openai}
          />
        )}

        {activeProvider === 'deepseek' && (
          <ProviderConfigPanel
            displayName={t('deepseekName')}
            description={t('deepseekDesc')}
            platformUrl="https://platform.deepseek.com"
            provider={deepseekProvider}
            models={models.deepseek || []}
            isFetching={fetchingModels.deepseek || false}
            onConfigChange={(config) => updateProviderConfig('deepseek', { config })}
            onEnabledChange={(enabled) => updateProviderConfig('deepseek', { enabled })}
            onFetchModels={() => fetchModels('deepseek')}
            defaultBaseUrl={defaultBaseUrls.deepseek}
          />
        )}

        {/* 사용자 정의 프로바이더 설정 */}
        {!['lmstudio', 'ollama', 'openai', 'deepseek'].includes(activeProvider) &&
          (() => {
            const customProvider = getProviderConfig(activeProvider)
            return customProvider && customProvider.providerName ? (
              <ProviderConfigPanel
                displayName={customProvider.config.displayName || activeProvider}
                description={t('customProviderDesc')}
                platformUrl={customProvider.config.baseUrl || ''}
                provider={customProvider}
                models={models[activeProvider] || []}
                isFetching={fetchingModels[activeProvider] || false}
                onConfigChange={(config) => updateProviderConfig(activeProvider, { config })}
                onEnabledChange={(enabled) => updateProviderConfig(activeProvider, { enabled })}
                onFetchModels={() => fetchCustomProviderModels(activeProvider)}
                onDelete={() => handleDeleteClick(activeProvider)}
              />
            ) : null
          })()}
      </ScrollArea>

      {/* 프로바이더 추가 다이얼로그 */}
      <AddProviderDialog
        isOpen={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        onConfirm={handleAddProvider}
        existingProviders={[...providerList.map((p) => p.id), ...customProviders.map((p) => p.id)]}
      />

      {/* 프로바이더 삭제 다이얼로그 */}
      <DeleteProviderDialog
        isOpen={isDeleteDialogOpen}
        providerName={providerToDelete}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  )
}
