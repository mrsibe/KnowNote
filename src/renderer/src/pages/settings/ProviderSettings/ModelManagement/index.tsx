import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { RefreshCw, Database } from 'lucide-react'
import { toast } from 'sonner'
import { useProviderStore } from '@/store/providerStore'
import ModelList from './ModelList'
import type { ModelManagementProps } from './types'
import type { Model } from '@shared/types'

export default function ModelManagement({
  providerId,
  apiKey,
  models: initialModels
}: ModelManagementProps) {
  const updateProvider = useProviderStore((state) => state.updateProvider)
  const toggleModelEnabled = useProviderStore((state) => state.toggleModelEnabled)

  const [models, setModels] = useState<Model[]>(initialModels || [])
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleToggleEnabled = async (modelId: string, enabled: boolean) => {
    try {
      await toggleModelEnabled(providerId, modelId, enabled)
      // 更新本地状态
      setModels((prev) =>
        prev.map((m) => (m.id === modelId ? { ...m, enabled } : m))
      )
      toast.success(enabled ? '已启用模型' : '已禁用模型')
    } catch (error) {
      console.error('切换模型状态失败:', error)
      toast.error('操作失败')
    }
  }

  const handleRefreshModels = async () => {
    if (!apiKey) {
      toast.error('请先配置 API Key')
      return
    }

    setIsRefreshing(true)
    try {
      // 调用 IPC 方法获取模型列表
      const result = await window.api.fetchModels(providerId, apiKey)

      // 处理返回结果
      let modelsList: Model[] = []
      if (Array.isArray(result)) {
        modelsList = result as Model[]
      } else if (result && 'models' in result) {
        modelsList = result.models as Model[]
      }

      if (modelsList.length > 0) {
        setModels(modelsList)

        // 更新 store 中的模型列表
        await updateProvider(providerId, {
          models: modelsList
        })

        toast.success(`已刷新 ${modelsList.length} 个模型`)
      } else {
        toast.warning('未获取到模型列表')
      }
    } catch (error) {
      console.error('刷新模型列表失败:', error)
      toast.error('刷新失败', {
        description: error instanceof Error ? error.message : '请检查网络连接和 API Key'
      })
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* 顶部操作栏 */}
      <div className="shrink-0 px-6 py-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">模型列表</h3>
            <p className="text-xs text-muted-foreground mt-1">
              {models.length > 0 ? `共 ${models.length} 个模型` : '暂无模型'}
            </p>
          </div>
          <Button
            onClick={handleRefreshModels}
            disabled={isRefreshing}
            size="sm"
            variant="outline"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? '刷新中...' : '刷新模型列表'}
          </Button>
        </div>
      </div>

      {/* 模型列表区域 */}
      <div className="flex-1 overflow-hidden">
        {models.length === 0 ? (
          // 空状态
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <Database className="w-16 h-16 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-medium mb-2">暂无模型</p>
              <p className="text-sm mb-4">点击"刷新模型列表"获取可用模型</p>
              <Button
                onClick={handleRefreshModels}
                disabled={isRefreshing}
                size="sm"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                刷新模型列表
              </Button>
            </div>
          </div>
        ) : (
          // 模型列表
          <ModelList
            models={models}
            onToggleEnabled={handleToggleEnabled}
          />
        )}
      </div>
    </div>
  )
}
