import { useTranslation } from '../lib/i18n'
import { useI18nStore } from '../store/i18nStore'
import { Language } from '../store/i18nStore'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

const languages = [
  { code: 'zh-CN' as Language, name: '简体中文', nativeName: '简体中文' },
  { code: 'en-US' as Language, name: 'English', nativeName: 'English' }
]

export const LanguageSelector = ({ className = '' }: { className?: string }) => {
  const { t } = useTranslation('common')
  const { language, changeLanguage } = useI18nStore()

  const handleLanguageChange = async (newLanguage: Language) => {
    await changeLanguage(newLanguage)
  }

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <label htmlFor="language-select" className="text-sm font-medium text-foreground">
        {t('language', 'Language')}:
      </label>
      <Select value={language} onValueChange={(value) => handleLanguageChange(value as Language)}>
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {languages.map((lang) => (
            <SelectItem key={lang.code} value={lang.code}>
              {lang.nativeName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
