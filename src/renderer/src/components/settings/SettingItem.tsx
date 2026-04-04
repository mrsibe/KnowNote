import { ReactElement, ReactNode } from 'react'

interface SettingItemProps {
  title: string
  description: string
  children: ReactNode
  layout?: 'horizontal' | 'vertical' // 기본 horizontal（왼오른레이아웃）
  action?: ReactNode // 선택의작업버튼
}

export default function SettingItem({
  title,
  description,
  children,
  layout = 'horizontal',
  action
}: SettingItemProps): ReactElement {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      {layout === 'horizontal' ? (
        <div className="flex items-center justify-between gap-6">
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <h3 className="text-sm font-medium text-foreground">{title}</h3>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          <div className="flex items-center gap-3">
            {action}
            <div className="shrink-0">{children}</div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <h3 className="text-sm font-medium text-foreground">{title}</h3>
              {description && <p className="text-xs text-muted-foreground">{description}</p>}
            </div>
            {action && <div className="shrink-0">{action}</div>}
          </div>
          <div>{children}</div>
        </div>
      )}
    </div>
  )
}
