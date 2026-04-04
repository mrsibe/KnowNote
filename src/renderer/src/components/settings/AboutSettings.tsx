import { ChevronRight, Download, RefreshCw, CheckCircle } from 'lucide-react'
import { ReactElement, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import logoImg from '../../assets/logo.png'
import { UpdateStatus } from '@/../../shared/types/update'
import type { UpdateState } from '@/../../preload/index.d'

export default function AboutSettings(): ReactElement {
  const { t } = useTranslation('settings')
  const [updateState, setUpdateState] = useState<UpdateState>({
    status: UpdateStatus.IDLE
  })
  const [checking, setChecking] = useState(false)
  const [appVersion, setAppVersion] = useState<string>('')

  // 감시업데이트상태변경
  useEffect(() => {
    const unsubscribe = window.api.update.onStateChanged((state: UpdateState) => {
      setUpdateState(state)
      setChecking(false)
    })

    // 조회초기시작상태
    window.api.update.getState().then((result) => {
      if (result.success && result.state) {
        setUpdateState(result.state)
      }
    })

    // 앱 버전 조회번호
    window.api.getAppVersion().then((version) => {
      setAppVersion(version)
    })

    return unsubscribe
  }, [])

  const handleOpenWebsite = async () => {
    await window.api.openExternalUrl('https://github.com/MrSibe/KnowNote')
  }

  const handleFeedback = async () => {
    await window.api.openExternalUrl('https://github.com/MrSibe/KnowNote/issues')
  }

  const handleCheckUpdates = async () => {
    setChecking(true)
    try {
      await window.api.update.check()
    } catch (error) {
      console.error('Failed to check for updates:', error)
      setChecking(false)
    }
  }

  // 조회업데이트버튼텍스트및상태
  const getUpdateButtonContent = () => {
    switch (updateState.status) {
      case UpdateStatus.CHECKING:
        return {
          text: t('checking'),
          icon: <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />,
          disabled: true,
          onClick: undefined
        }
      case UpdateStatus.AVAILABLE:
        return {
          text: t('downloadAndInstall', { version: updateState.info?.version }),
          icon: <Download className="w-4 h-4 text-muted-foreground" />,
          disabled: false,
          onClick: async () => {
            try {
              await window.api.update.download()
            } catch (error) {
              console.error('Failed to download update:', error)
            }
          }
        }
      case UpdateStatus.DOWNLOADING:
        return {
          text: t('downloading', {
            percent: updateState.progress?.percent.toFixed(0) || 0
          }),
          icon: <Download className="w-4 h-4 animate-pulse text-muted-foreground" />,
          disabled: true,
          onClick: undefined
        }
      case UpdateStatus.DOWNLOADED:
        return {
          text: t('installing'),
          icon: <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />,
          disabled: true,
          onClick: undefined
        }
      case UpdateStatus.NOT_AVAILABLE:
        return {
          text: t('latestVersion'),
          icon: <CheckCircle className="w-4 h-4 text-green-500" />,
          disabled: true,
          onClick: undefined
        }
      case UpdateStatus.ERROR:
        return {
          text: t('checkUpdateError'),
          icon: <RefreshCw className="w-4 h-4 text-muted-foreground" />,
          disabled: false,
          onClick: handleCheckUpdates
        }
      default:
        return {
          text: t('checkUpdates'),
          icon: <RefreshCw className="w-4 h-4 text-muted-foreground" />,
          disabled: checking,
          onClick: handleCheckUpdates
        }
    }
  }

  const updateButton = getUpdateButtonContent()

  return (
    <div className="space-y-6">
      <div className="text-center py-8 flex flex-col items-center gap-4">
        <img src={logoImg} alt="Logo" className="w-16 h-16 rounded-xl" />
        <div className="flex flex-col gap-2">
          <h2 className="text-h1 text-foreground">KnowNote</h2>
          <p className="text-sm text-muted-foreground">
            {t('version')} {appVersion}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <button
          onClick={handleOpenWebsite}
          className="flex justify-between p-3 bg-card rounded-lg hover:bg-accent transition-colors cursor-pointer"
        >
          <span className="text-sm text-muted-foreground">{t('officialWebsite')}</span>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>

        <button
          onClick={handleFeedback}
          className="flex justify-between p-3 bg-card rounded-lg hover:bg-accent transition-colors cursor-pointer"
        >
          <span className="text-sm text-muted-foreground">{t('feedback')}</span>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>

        <button
          onClick={updateButton.onClick}
          disabled={updateButton.disabled}
          className={`flex justify-between items-center p-3 bg-card rounded-lg transition-colors ${
            updateButton.disabled
              ? 'cursor-not-allowed opacity-60'
              : 'hover:bg-accent cursor-pointer'
          }`}
        >
          <span className="text-sm text-muted-foreground">{updateButton.text}</span>
          {updateButton.icon}
        </button>

        {updateState.status === UpdateStatus.ERROR && updateState.error && (
          <div className="p-3 bg-destructive/10 rounded-lg">
            <p className="text-xs text-destructive">{updateState.error}</p>
          </div>
        )}
      </div>
    </div>
  )
}
