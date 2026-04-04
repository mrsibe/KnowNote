import { ReactElement, ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ScrollArea } from '../ui/scroll-area'
import { Separator } from '../ui/separator'
import { Button } from '../ui/button'

interface SettingsContentPanelProps {
  title: string
  description: string
  hasChanges: boolean
  onCancel: () => void
  onConfirm: () => void
  onClose: () => void
  children: ReactNode
}

export default function SettingsContentPanel({
  title,
  description,
  hasChanges,
  onCancel,
  onConfirm,
  onClose,
  children
}: SettingsContentPanelProps): ReactElement {
  const { t } = useTranslation('settings')

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background rounded-lg shadow-sm overflow-hidden">
      {/* 상단부분제목바 */}
      <div className="flex items-start justify-between gap-4 px-6 py-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <>
              <Button variant="outline" size="sm" onClick={onCancel}>
                {t('cancel')}
              </Button>
              <Button size="sm" onClick={onConfirm}>
                {t('confirm')}
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <Separator />

      {/* 내용영역 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-6">{children}</div>
        </ScrollArea>
      </div>
    </div>
  )
}
