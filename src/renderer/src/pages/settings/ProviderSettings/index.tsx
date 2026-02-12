import { useState } from 'react'
import { useProviderStore } from '@/store/providerStore'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus, Database } from 'lucide-react'
import ProviderList from './ProviderList'
import ProviderForm from './ProviderForm'
import type { Provider } from '@shared/types'

export default function ProviderSettings() {
  const providers = useProviderStore((state) => state.providers)
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)

  const handleAddProvider = () => {
    setSelectedProvider(null)
    setIsFormOpen(true)
  }

  const handleEditProvider = (provider: Provider) => {
    setSelectedProvider(provider)
    setIsFormOpen(true)
  }

  const handleCloseForm = () => {
    setSelectedProvider(null)
    setIsFormOpen(false)
  }

  return (
    <div className="flex h-full gap-4">
      {/* 左侧：供应商列表 */}
      <div className="w-80 shrink-0 flex flex-col h-full">
        <Card className="flex-1 overflow-hidden flex flex-col min-h-0">
          <ProviderList
            providers={providers}
            selectedProvider={selectedProvider}
            onSelectProvider={handleEditProvider}
          />
        </Card>

        {/* 添加供应商按钮 - 固定在底部 */}
        <Button onClick={handleAddProvider} className="w-full mt-3 shrink-0">
          <Plus className="w-4 h-4 mr-2" />
          添加供应商
        </Button>
      </div>

      {/* 右侧：配置表单 */}
      <div className="flex-1 min-w-0">
        {isFormOpen ? (
          <ProviderForm provider={selectedProvider} onClose={handleCloseForm} />
        ) : (
          <Card className="h-full flex items-center justify-center">
            <CardContent className="text-center text-muted-foreground">
              <Database className="w-16 h-16 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-medium mb-2">选择一个供应商进行配置</p>
              <p className="text-sm">或点击"添加供应商"创建新的配置</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
