import { PROVIDER_LOGO_MAP } from '@/config/providers'
import { CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { Provider } from '@shared/types'

interface ProviderListProps {
  providers: Provider[]
  selectedProvider: Provider | null
  onSelectProvider: (provider: Provider) => void
}

export default function ProviderList({
  providers,
  selectedProvider,
  onSelectProvider
}: ProviderListProps) {
  return (
    <CardContent className="p-0 h-full overflow-hidden">
      <ScrollArea className="h-full overflow-x-hidden">
        <div className="p-3 space-y-2 max-w-full overflow-x-hidden">
          {providers.map((provider) => {
            const isSelected = selectedProvider?.id === provider.id
            const logoUrl = PROVIDER_LOGO_MAP[provider.id]

            return (
              <div
                key={provider.id}
                onClick={() => onSelectProvider(provider)}
                className={cn(
                  'relative w-full rounded-lg border bg-card px-2.5 py-2 cursor-pointer transition-all hover:shadow-md overflow-hidden',
                  isSelected && 'border-primary bg-accent'
                )}
              >
                <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                  {/* Logo - 固定宽度 */}
                  {logoUrl && (
                    <div className="shrink-0 w-8 h-8">
                      <img
                        src={logoUrl}
                        alt={provider.name}
                        className="w-full h-full rounded-lg object-contain"
                      />
                    </div>
                  )}

                  <div className="min-w-0 overflow-hidden flex-1">
                    <h3
                      className="text-[13px] font-medium truncate min-w-0 leading-tight"
                      title={provider.name}
                    >
                      {provider.name}
                    </h3>
                  </div>

                  {provider.enabled && (
                    <Badge variant="default" className="text-[9px] px-1.5 py-0 leading-4 shrink-0">
                      已启用
                    </Badge>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </CardContent>
  )
}
