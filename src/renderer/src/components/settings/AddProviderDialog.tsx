import { useState, useEffect, useRef, ReactElement } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

interface AddProviderDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (data: { providerName: string; apiKey: string; baseUrl: string }) => void
  existingProviders: string[]
}

export default function AddProviderDialog({
  isOpen,
  onClose,
  onConfirm,
  existingProviders
}: AddProviderDialogProps): ReactElement {
  const { t } = useTranslation('settings')
  const [providerName, setProviderName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [errors, setErrors] = useState({
    providerName: '',
    apiKey: '',
    baseUrl: ''
  })
  const inputRef = useRef<HTMLInputElement>(null)

  // 자동집중포커스에첫 번째개입력창
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus()
      }, 50)
    }
  }, [isOpen])

  // URL 검증함수
  const isValidUrl = (url: string): boolean => {
    try {
      const urlObj = new URL(url)
      // 확인프로토콜
      if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        return false
      }
      // 확인예아니오패키지포함비 ASCII 문자
      // eslint-disable-next-line no-control-regex
      if (/[^\x00-\x7F]/.test(url)) {
        return false
      }
      return true
    } catch {
      return false
    }
  }

  // 테이블단일검증
  const validateForm = (): boolean => {
    const newErrors = {
      providerName: '',
      apiKey: '',
      baseUrl: ''
    }

    // 제공자이름검증
    const trimmedName = providerName.trim()
    if (!trimmedName) {
      newErrors.providerName = t('providerNameRequired')
    } else if (existingProviders.includes(trimmedName.toLowerCase())) {
      newErrors.providerName = t('providerNameExists')
    }

    // API Key 검증
    if (!apiKey.trim()) {
      newErrors.apiKey = t('apiKeyRequired')
    }

    // Base URL 검증
    const trimmedUrl = baseUrl.trim()
    if (!trimmedUrl) {
      newErrors.baseUrl = t('apiUrlRequired')
    } else if (!isValidUrl(trimmedUrl)) {
      newErrors.baseUrl = t('apiUrlInvalid')
    }

    setErrors(newErrors)
    return !Object.values(newErrors).some((error) => error !== '')
  }

  // 제출처리
  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (validateForm()) {
      onConfirm({
        providerName: providerName.trim().toLowerCase(),
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim()
      })
      handleClose()
    }
  }

  // 닫기시재테이블단일
  const handleClose = (): void => {
    setProviderName('')
    setApiKey('')
    setBaseUrl('')
    setShowApiKey(false)
    setErrors({
      providerName: '',
      apiKey: '',
      baseUrl: ''
    })
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('addCustomProvider')}</DialogTitle>
          <DialogDescription>{t('addProviderDesc')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* 제공자이름 */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">{t('providerName')}</label>
            <Input
              ref={inputRef}
              value={providerName}
              onChange={(e) => setProviderName(e.target.value)}
              placeholder={t('providerNamePlaceholder')}
            />
            {errors.providerName && (
              <p className="text-sm text-destructive">{errors.providerName}</p>
            )}
          </div>

          {/* API Key */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">{t('apiKey')}</label>
            <div className="relative">
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="pr-12"
              />
              <Button
                type="button"
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
            {errors.apiKey && <p className="text-sm text-destructive">{errors.apiKey}</p>}
          </div>

          {/* API 주소 */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">{t('apiUrl')}</label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
            />
            {errors.baseUrl && <p className="text-sm text-destructive">{errors.baseUrl}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              {t('cancel', { ns: 'common' })}
            </Button>
            <Button type="submit">{t('confirm', { ns: 'common' })}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
