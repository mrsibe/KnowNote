import { useState } from 'react'
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

  const handleComplete = async () => {
    setIsCompleting(true)
    await changeLanguage(selectedLanguage)
    await completeOnboarding()
    navigate('/')
  }

  const selectedLangName = languages.find((l) => l.code === selectedLanguage)?.name

  return (
    <div className="flex items-center justify-center min-h-screen bg-surface-base">
      <div className="w-full max-w-md px-6 text-center">
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

        {/* 语言选择 */}
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

        {/* 确认按钮 */}
        <Button size="lg" onClick={handleComplete} disabled={isCompleting} className="w-full">
          {isCompleting ? t('onboardingStarting') : t('onboardingGetStarted')}
        </Button>
      </div>
    </div>
  )
}
