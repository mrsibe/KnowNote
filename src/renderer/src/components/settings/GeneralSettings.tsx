import { ReactElement, useEffect } from 'react'
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

interface GeneralSettingsProps {
  settings: AppSettings
  onSettingsChange: (updates: Partial<AppSettings>) => void
}

const languages = [
  { value: 'zh-CN', label: 'Chinese', native: '简体中文' },
  { value: 'en-US', label: 'English', native: 'English' }
]

export default function GeneralSettings({
  settings,
  onSettingsChange
}: GeneralSettingsProps): ReactElement {
  const { t } = useTranslation('settings')
  const { changeLanguage } = useI18nStore()

  // 当主题变化时，立即更新 DOM 以预览效果
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
        {/* 主题模式设置 */}
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>{t('themeMode')}</FieldLabel>
            <FieldDescription>{t('selectTheme')}</FieldDescription>
          </FieldContent>
          <div className="inline-flex rounded-md border border-border bg-surface-sunken p-0.5">
            <Button
              onClick={() => onSettingsChange({ theme: 'light' })}
              variant="ghost"
              size="sm"
              className={`gap-1.5 ${
                settings.theme === 'light'
                  ? 'bg-surface-raised text-foreground hover:bg-surface-raised'
                  : ''
              }`}
            >
              <Sun className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">{t('light')}</span>
            </Button>
            <Button
              onClick={() => onSettingsChange({ theme: 'dark' })}
              variant="ghost"
              size="sm"
              className={`gap-1.5 ${
                settings.theme === 'dark'
                  ? 'bg-surface-raised text-foreground hover:bg-surface-raised'
                  : ''
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">{t('dark')}</span>
            </Button>
          </div>
        </Field>

        {/* 语言设置 */}
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
      </FieldGroup>
    </FieldSet>
  )
}
