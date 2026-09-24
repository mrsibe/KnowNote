import { ReactElement, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCircle2,
  Download,
  FolderInput,
  Loader2,
  RefreshCw,
  Trash2,
  XCircle
} from 'lucide-react'
import type {
  EmbeddingDownloadProgress,
  EmbeddingSourceInfo,
  LocalEmbeddingModelInfo,
  ModelConnection
} from '../../../../shared/types'
import { Button } from '../ui/button'
import { Progress } from '../ui/progress'
import ModelConnectionForm, { type ProtocolInfo } from './ModelConnectionForm'

interface EmbeddingSettingsProps {
  connection: ModelConnection | undefined
  protocols: ProtocolInfo[]
  onChange: (connection: ModelConnection) => void
  onClear: () => void
}

interface EmbeddingStatus {
  activeBackend: 'local' | 'remote'
  remoteConfigured: boolean
  downloading: boolean
  localModel: LocalEmbeddingModelInfo
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, exponent)
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}

/**
 * Embedding 后端选择：内置本地（默认）或自定义远程 provider。
 *
 * 默认本地让用户不必理解 protocol / base URL / API key / 维度就能索引第一个 PDF。
 */
export default function EmbeddingSettings({
  connection,
  protocols,
  onChange,
  onClear
}: EmbeddingSettingsProps): ReactElement {
  const { t } = useTranslation('settings')

  const [modeChoice, setModeChoice] = useState<'local' | 'custom' | null>(null)
  const [status, setStatus] = useState<EmbeddingStatus | null>(null)
  const [progress, setProgress] = useState<EmbeddingDownloadProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sources, setSources] = useState<EmbeddingSourceInfo[] | null>(null)

  // 已保存的 connection 决定初始模式；用户显式选择后以选择为准，避免连接异步加载
  // 回来后把界面重置成 "本地" 并误导用户删掉远程配置。
  const mode = modeChoice ?? (connection ? 'custom' : 'local')

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      setStatus(await window.api.embedding.getStatus())
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const next = await window.api.embedding.getStatus()
        if (!cancelled) setStatus(next)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    })()

    const cleanup = window.api.embedding.onDownloadProgress((next) => {
      setProgress(next)
      if (next.phase === 'done' || next.phase === 'error' || next.phase === 'cancelled') {
        void refreshStatus()
      }
    })
    return () => {
      cancelled = true
      cleanup()
    }
  }, [refreshStatus])

  const handleSelectLocal = (): void => {
    setModeChoice('local')
    // 内置本地时删除可能存在的远程 connection
    onClear()
  }

  const handleDownload = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const result = await window.api.embedding.download()
      if (!result.success) {
        setError(result.error || 'Download failed')
      }
    } finally {
      setBusy(false)
      await refreshStatus()
    }
  }

  const handleImport = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const result = await window.api.embedding.importLocal()
      if (!result.success && !result.canceled) {
        setError(
          result.missingFiles?.length
            ? `${t('localImportFailed')} ${result.missingFiles.join(', ')}`
            : result.error || 'Import failed'
        )
      }
    } finally {
      setBusy(false)
      await refreshStatus()
    }
  }

  const handleDelete = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.embedding.deleteLocal()
    } finally {
      setBusy(false)
      await refreshStatus()
    }
  }

  const handleProbe = async (): Promise<void> => {
    setBusy(true)
    try {
      setSources(await window.api.embedding.probeSources())
    } finally {
      setBusy(false)
    }
  }

  const installed = status?.localModel.state === 'installed'
  const downloading = busy || progress?.phase === 'downloading' || progress?.phase === 'probing'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium text-foreground">{t('embeddingModel')}</h2>
        <p className="text-muted-foreground text-sm">{t('embeddingModelDesc')}</p>
      </div>

      {/* 后端选择 */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={handleSelectLocal}
          className={`text-left rounded-lg border p-3 transition-colors ${
            mode === 'local'
              ? 'border-primary bg-surface-selected'
              : 'border-border hover:bg-surface-hover'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{t('builtInLocal')}</span>
            {mode === 'local' && <CheckCircle2 className="w-4 h-4 text-primary" />}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{t('builtInLocalDesc')}</p>
        </button>
        <button
          type="button"
          onClick={() => setModeChoice('custom')}
          className={`text-left rounded-lg border p-3 transition-colors ${
            mode === 'custom'
              ? 'border-primary bg-surface-selected'
              : 'border-border hover:bg-surface-hover'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{t('customProvider')}</span>
            {mode === 'custom' && <CheckCircle2 className="w-4 h-4 text-primary" />}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{t('embeddingModelDesc')}</p>
        </button>
      </div>

      {mode === 'custom' && (
        <ModelConnectionForm
          capability="embedding"
          connection={connection}
          protocols={protocols}
          onChange={onChange}
          onClear={onClear}
        />
      )}

      {mode === 'local' && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-foreground">
                {status?.localModel.label ?? 'multilingual-e5-small'}
              </span>
              <span className="text-xs text-muted-foreground">
                {status
                  ? `${formatBytes(installed && status.localModel.installedBytes ? status.localModel.installedBytes : status.localModel.totalBytes)} · ${
                      installed ? t('localInstalled') : t('localNotInstalled')
                    }`
                  : '...'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {installed ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleDelete}
                  disabled={busy}
                >
                  <Trash2 className="w-4 h-4 text-destructive" />
                  <span>{t('localDelete')}</span>
                </Button>
              ) : (
                <Button type="button" size="sm" onClick={handleDownload} disabled={downloading}>
                  {downloading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  <span>{downloading ? t('localDownloading') : t('localDownload')}</span>
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleImport}
                disabled={busy}
              >
                <FolderInput className="w-4 h-4" />
                <span>{t('localImport')}</span>
              </Button>
            </div>
          </div>

          {downloading && progress && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t('localDownloadingTitle')}</span>
                <span>{Math.round((progress.progress ?? 0) * 100)}%</span>
              </div>
              <Progress value={(progress.progress ?? 0) * 100} />
              <p className="text-xs text-muted-foreground">{t('localDownloadingDesc')}</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => void window.api.embedding.cancelDownload()}
              >
                {t('localCancel')}
              </Button>
            </div>
          )}

          {installed && status && (
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span>
                {t('localModelPath')}: {status.localModel.path}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={handleProbe} disabled={busy}>
              <RefreshCw className="w-4 h-4" />
              <span>{t('localProbe')}</span>
            </Button>
            {sources?.map((source) => (
              <span key={source.url} className="flex items-center gap-1 text-xs">
                {source.reachable ? (
                  <CheckCircle2 className="w-3 h-3 text-success" />
                ) : (
                  <XCircle className="w-3 h-3 text-destructive" />
                )}
                <span className="text-muted-foreground">{source.url}</span>
              </span>
            ))}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}
    </div>
  )
}
