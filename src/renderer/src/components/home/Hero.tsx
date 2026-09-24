import { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Separator } from '../ui/separator'

interface HeroProps {
  notebookCount: number
}

export default function Hero({ notebookCount }: HeroProps): ReactElement {
  const { t } = useTranslation('ui')

  return (
    <div className="px-6 pt-6 pb-4">
      <div className="max-w-7xl mx-auto space-y-4">
        <h1 className="text-xl font-medium text-foreground tracking-tight">{t('myNotebooks')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('totalNotebooks', { count: notebookCount })}
        </p>
        <Separator />
      </div>
    </div>
  )
}
