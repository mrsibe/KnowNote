import { ScrollArea } from '@/components/ui/scroll-area'
import ModelListItem from './ModelListItem'
import type { Model } from '@shared/types'

interface ModelListProps {
  models: Model[]
  onToggleEnabled?: (modelId: string, enabled: boolean) => void
  onEdit?: (model: Model) => void
}

export default function ModelList({ models, onToggleEnabled, onEdit }: ModelListProps) {
  if (models.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <p className="text-muted-foreground">暂无模型</p>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-2">
        {models.map((model) => (
          <ModelListItem
            key={model.id}
            model={model}
            onToggleEnabled={onToggleEnabled}
            onEdit={onEdit}
          />
        ))}
      </div>
    </ScrollArea>
  )
}
