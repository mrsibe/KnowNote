import { useEffect, useState } from 'react'
import type { ConnectionMap } from '../../../../shared/types'
import ModelsSettings from '../settings/ModelsSettings'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useOnboardingStore } from '../../store/onboardingStore'
import { useI18nStore } from '../../store/i18nStore'
import type { Language } from '../../store/i18nStore'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import logo from '../../assets/logo.png'

const languages = [
  { code: 'zh-CN' as Language, name: '简体中文' },
  { code: 'en-US' as Language, name: 'English' }
]

export default function OnboardingPage() {
  const navigate = useNavigate()
  const { t } = useTranslation('ui')
  const { completeOnboarding } = useOnboardingStore()
  const { language, changeLanguage } = useI18nStore()
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(language)
  const [isCompleting, setIsCompleting] = useState(false)
  const [step, setStep] = useState(0)
  const [connections, setConnections] = useState<ConnectionMap | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    window.api.connections
      .getAll()
      .then(setConnections)
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
      })
  }, [])

  const handleNext = async (skip = false) => {
    setIsCompleting(true)
    setError('')
    try {
      if (step === 0) {
        await changeLanguage(selectedLanguage)
      } else if (!skip && connections) {
        const capability = step === 1 ? 'embedding' : 'chat'
        const connection = connections[capability]
        if (connection) {
          if (!connection.baseUrl.trim() || !connection.modelId.trim()) {
            setError(t('onboardingIncompleteConnection'))
            return
          }
          await window.api.connections.save(capability, connection)
        } else {
          await window.api.connections.remove(capability)
        }
      }
      if (step < 2) {
        // Reload persisted connections so skipped edits do not leak into later steps.
        setConnections(await window.api.connections.getAll())
        setStep(step + 1)
      } else {
        await completeOnboarding()
        navigate('/')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsCompleting(false)
    }
  }

  const selectedLangName = languages.find((l) => l.code === selectedLanguage)?.name

  return (
    <div className="flex items-center justify-center min-h-screen bg-surface-sunken">
      <div className="w-full max-w-xl px-6 py-8 text-center">
        {/* Logo */}
        <div className="mb-8">
          <img src={logo} alt="KnowNote" className="w-24 h-24 mx-auto mb-4" />
          <h1 className="text-xl font-medium text-foreground mb-2">KnowNote</h1>
          {/* The product's own sub-line from the README. It replaced a comparative
              slogan ("more convenient, more lightweight, and understands you better")
              that had no basis and was hardcoded in English for zh-CN users — the
              product record forbids claims ahead of the evidence. */}
          <p className="text-sm text-muted-foreground">{t('onboardingTagline')}</p>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          {t('onboardingStep', { step: step + 1, total: 3 })}
        </p>
        {step === 0 ? (
          <div className="mb-6">
            <Select
              value={selectedLanguage}
              onValueChange={(value) => setSelectedLanguage(value as Language)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('selectLanguage')}>{selectedLangName}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {languages.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {lang.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="mb-6 text-left">
            <p className="text-sm text-muted-foreground mb-4">
              {t(step === 1 ? 'onboardingEmbeddingHint' : 'onboardingChatHint')}
            </p>
            {connections && (
              <ModelsSettings
                key={step}
                capability={step === 1 ? 'embedding' : 'chat'}
                connections={connections}
                onConnectionsChange={setConnections}
              />
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive mb-4">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          {step > 0 && (
            <Button
              variant="outline"
              onClick={() => void handleNext(true)}
              disabled={isCompleting || !connections}
            >
              {t('onboardingSkip')}
            </Button>
          )}
          <Button
            size="lg"
            onClick={() => void handleNext()}
            disabled={isCompleting || !connections}
            className="flex-1"
          >
            {isCompleting
              ? t('onboardingStarting')
              : t(step === 2 ? 'onboardingGetStarted' : 'onboardingNext')}
          </Button>
        </div>
      </div>
    </div>
  )
}
