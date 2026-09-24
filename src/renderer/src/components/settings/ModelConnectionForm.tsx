import { ReactElement, useState } from 'react'
import { Eye, EyeOff, Download, Loader2, Trash2, CheckCircle2, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { APIProtocol, ModelCapability, ModelConnection } from '../../../../shared/types'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

export interface ProtocolInfo {
  protocol: string
  supportsModelListing: boolean
  supportsEmbedding: boolean
}

interface ModelConnectionFormProps {
  capability: ModelCapability
  connection: ModelConnection | undefined
  protocols: ProtocolInfo[]
  onChange: (connection: ModelConnection) => void
  onClear: () => void
}

interface QuickSetup {
  id: string
  labelKey: string
  protocol: APIProtocol
  baseUrl: string
  apiKey?: string
}

/**
 * Quick setup 只是自动填表，不是 Provider 实现。
 */
const QUICK_SETUPS: QuickSetup[] = [
  {
    id: 'openai',
    labelKey: 'presetOpenAI',
    protocol: 'openai-completions',
    baseUrl: 'https://api.openai.com/v1'
  },
  {
    id: 'ollama',
    labelKey: 'presetOllama',
    protocol: 'openai-completions',
    baseUrl: 'http://localhost:11434/v1',
    apiKey: 'ollama'
  },
  {
    id: 'openrouter',
    labelKey: 'presetOpenRouter',
    protocol: 'openai-completions',
    baseUrl: 'https://openrouter.ai/api/v1'
  }
]

const EMPTY_CONNECTION: ModelConnection = {
  protocol: 'openai-completions',
  baseUrl: '',
  apiKey: '',
  modelId: ''
}

export default function ModelConnectionForm({
  capability,
  connection,
  protocols,
  onChange,
  onClear
}: ModelConnectionFormProps): ReactElement {
  const { t } = useTranslation('settings')
  const [showApiKey, setShowApiKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [modelOptions, setModelOptions] = useState<string[]>([])

  const value = connection ?? EMPTY_CONNECTION
  const availableProtocols =
    capability === 'embedding' ? protocols.filter((p) => p.supportsEmbedding) : protocols
  const protocolInfo = protocols.find((p) => p.protocol === value.protocol)
  const canListModels = protocolInfo?.supportsModelListing ?? false

  const update = (patch: Partial<ModelConnection>): void => {
    setTestResult(null)
    onChange({ ...value, ...patch })
  }

  const applyQuickSetup = (presetId: string): void => {
    const preset = QUICK_SETUPS.find((p) => p.id === presetId)
    if (!preset) return
    if (
      capability === 'embedding' &&
      !protocols.find((p) => p.protocol === preset.protocol)?.supportsEmbedding
    ) {
      return
    }
    update({
      protocol: preset.protocol,
      baseUrl: preset.baseUrl,
      apiKey: preset.apiKey ?? value.apiKey
    })
  }

  const handleTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.api.connections.test(value)
      setTestResult(result)
    } catch (error) {
      setTestResult({ ok: false, error: (error as Error).message })
    } finally {
      setTesting(false)
    }
  }

  const handleFetchModels = async (): Promise<void> => {
    setFetching(true)
    setFetchError('')
    try {
      const models = await window.api.connections.fetchModels(value)
      setModelOptions(models)
      if (models.length === 0) {
        setFetchError(t('fetchModelsEmpty'))
      }
    } catch (error) {
      setFetchError((error as Error).message)
    } finally {
      setFetching(false)
    }
  }

  const listId = `model-options-${capability}`

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-medium text-foreground">
            {capability === 'chat' ? t('chatModel') : t('embeddingModel')}
          </h2>
          <p className="text-muted-foreground text-sm">
            {capability === 'chat' ? t('chatModelDesc') : t('embeddingModelDesc')}
          </p>
        </div>
        {connection && (
          <Button onClick={onClear} variant="ghost" size="icon" className="shrink-0">
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
        )}
      </div>

      {/* Quick setup */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground">{t('quickSetup')}</label>
        <div className="flex gap-2 flex-wrap">
          {QUICK_SETUPS.filter(
            (preset) =>
              capability === 'chat' ||
              protocols.find((p) => p.protocol === preset.protocol)?.supportsEmbedding
          ).map((preset) => (
            <Button
              key={preset.id}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyQuickSetup(preset.id)}
            >
              {t(preset.labelKey)}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange({
                ...value,
                baseUrl: '',
                apiKey: '',
                modelId: ''
              })
            }
          >
            {t('presetCustom')}
          </Button>
        </div>
      </div>

      {/* Protocol */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground">{t('apiProtocol')}</label>
        <Select
          value={value.protocol}
          onValueChange={(next) => update({ protocol: next as APIProtocol })}
        >
          <SelectTrigger className="w-full">
            <SelectValue>{value.protocol}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {availableProtocols.map((info) => (
              <SelectItem key={info.protocol} value={info.protocol}>
                {info.protocol}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Base URL */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground">{t('baseUrl')}</label>
        <Input
          value={value.baseUrl}
          onChange={(e) => update({ baseUrl: e.target.value })}
          placeholder="https://api.example.com/v1"
        />
      </div>

      {/* API Key */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground">{t('apiKey')}</label>
        <div className="relative">
          <Input
            type={showApiKey ? 'text' : 'password'}
            value={value.apiKey}
            onChange={(e) => update({ apiKey: e.target.value })}
            placeholder="sk-..."
            className="pr-12"
          />
          <Button
            type="button"
            onClick={() => setShowApiKey(!showApiKey)}
            variant="ghost"
            size="icon"
            className="absolute right-2 top-1/2 -translate-y-1/2"
          >
            {showApiKey ? (
              <EyeOff className="w-4 h-4 text-muted-foreground" />
            ) : (
              <Eye className="w-4 h-4 text-muted-foreground" />
            )}
          </Button>
        </div>
      </div>

      {/* Model ID */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-foreground">{t('modelId')}</label>
          <Button
            type="button"
            onClick={handleFetchModels}
            disabled={fetching || !canListModels}
            variant="secondary"
            size="sm"
          >
            {fetching ? (
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
        <Input
          list={listId}
          value={value.modelId}
          onChange={(e) => update({ modelId: e.target.value })}
          placeholder={t('modelIdPlaceholder')}
        />
        <datalist id={listId}>
          {modelOptions.map((modelId) => (
            <option key={modelId} value={modelId} />
          ))}
        </datalist>
        {!canListModels && (
          <p className="text-xs text-muted-foreground">{t('fetchModelsUnsupported')}</p>
        )}
        {fetchError && <p className="text-sm text-destructive">{fetchError}</p>}
      </div>

      {/* Test connection */}
      <div className="flex items-center gap-3">
        <Button type="button" onClick={handleTest} disabled={testing} variant="outline" size="sm">
          {testing ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>{t('testing')}</span>
            </>
          ) : (
            t('testConnection')
          )}
        </Button>
        {testResult?.ok && (
          <span className="flex items-center gap-1 text-sm text-success">
            <CheckCircle2 className="w-4 h-4" />
            {t('connectionSuccessful')}
          </span>
        )}
        {testResult && !testResult.ok && (
          <span className="flex items-center gap-1 text-sm text-destructive">
            <XCircle className="w-4 h-4" />
            {testResult.error || t('connectionFailed')}
          </span>
        )}
      </div>
    </div>
  )
}
