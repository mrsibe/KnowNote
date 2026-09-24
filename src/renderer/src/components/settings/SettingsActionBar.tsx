import { ReactElement } from 'react'
import { Check, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'

interface SettingsActionBarProps {
  hasChanges: boolean
  onCancel: () => void
  onConfirm: () => void
}

export default function SettingsActionBar({
  hasChanges,
  onCancel,
  onConfirm
}: SettingsActionBarProps): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="bg-surface-raised p-6 shrink-0">
      <div className="flex items-center justify-end gap-3">
        <Button onClick={onCancel} disabled={!hasChanges} variant="outline">
          <X className="w-4 h-4 mr-2" />
          {t('cancel')}
        </Button>
        <Button onClick={onConfirm} disabled={!hasChanges} variant="default">
          <Check className="w-4 h-4 mr-2" />
          {t('save')}
        </Button>
      </div>
    </div>
  )
}
