import { type ReactElement } from 'react'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import type { Model } from '@shared/types'

interface ModelListItemProps {
  model: Model
  onToggleEnabled?: (modelId: string, enabled: boolean) => void
  onEdit?: (model: Model) => void
}

export default function ModelListItem({ model, onToggleEnabled, onEdit }: ModelListItemProps) {
  const handleToggle = (checked: boolean) => {
    if (onToggleEnabled) {
      onToggleEnabled(model.id, checked)
    }
  }

  const handleEdit = () => {
    if (onEdit) {
      onEdit(model)
    }
  }

  // 渲染能力标签
  const renderCapabilityBadges = () => {
    const capabilities = model.capabilities
    if (!capabilities) return null

    const badges: ReactElement[] = []

    // 处理对象格式的 capabilities
    if (typeof capabilities === 'object' && !Array.isArray(capabilities)) {
      if (capabilities.vision) {
        badges.push(
          <Badge key="vision" variant="secondary" className="text-xs">
            vision
          </Badge>
        )
      }
      if (capabilities.toolUse) {
        badges.push(
          <Badge key="tools" variant="secondary" className="text-xs">
            tools
          </Badge>
        )
      }
      if (capabilities.reasoning) {
        badges.push(
          <Badge key="reasoning" variant="secondary" className="text-xs">
            reasoning
          </Badge>
        )
      }
      if (capabilities.embedding) {
        badges.push(
          <Badge key="embedding" variant="secondary" className="text-xs">
            embedding
          </Badge>
        )
      }
    }
    // 处理数组格式的 capabilities
    else if (Array.isArray(capabilities)) {
      capabilities.forEach((cap) => {
        if (typeof cap === 'object' && cap.type) {
          badges.push(
            <Badge key={cap.type} variant="secondary" className="text-xs">
              {cap.type}
            </Badge>
          )
        }
      })
    }

    return badges.length > 0 ? <div className="flex gap-1 flex-wrap">{badges}</div> : null
  }

  return (
    <div className="p-3 border rounded-lg bg-card hover:bg-accent/50 transition-colors">
      <div className="flex items-start gap-3">
        {/* 左侧：启用开关 */}
        <div className="shrink-0 pt-1">
          <Switch
            checked={model.enabled ?? true}
            onCheckedChange={handleToggle}
            disabled={!onToggleEnabled}
          />
        </div>

        {/* 中间：模型信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h4 className="text-sm font-medium truncate">{model.name || model.id}</h4>
          </div>
          <p className="text-xs text-muted-foreground truncate mb-2">{model.id}</p>
          {renderCapabilityBadges()}
        </div>

        {/* 右侧：编辑按钮 */}
        {onEdit && (
          <div className="shrink-0">
            <Button variant="ghost" size="icon" onClick={handleEdit} className="h-8 w-8">
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
