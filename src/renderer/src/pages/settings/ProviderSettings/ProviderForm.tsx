import { useState, useEffect } from 'react'
import { useProviderStore } from '@/store/providerStore'
import { PROVIDER_LOGO_MAP, SYSTEM_PROVIDERS_CONFIG } from '@/config/providers'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldContent, FieldLabel, FieldDescription } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Eye, EyeOff, RotateCcw, Zap, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import ModelManagement from './ModelManagement'
import type { Provider } from '@shared/types'

interface ProviderFormProps {
  provider: Provider | null
  onClose: () => void
}

export default function ProviderForm({ provider, onClose }: ProviderFormProps) {
  const updateProvider = useProviderStore((state) => state.updateProvider)
  const removeProvider = useProviderStore((state) => state.removeProvider)

  const [formData, setFormData] = useState({
    name: '',
    apiKey: '',
    apiHost: '',
    enabled: true
  })
  const [isSaving, setIsSaving] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [isTestingConnection, setIsTestingConnection] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle')

  // 获取默认 Base URL
  const defaultBaseUrl = provider ? SYSTEM_PROVIDERS_CONFIG[provider.id]?.apiHost : undefined

  useEffect(() => {
    if (provider) {
      setFormData({
        name: provider.name,
        apiKey: provider.apiKey || '',
        apiHost: provider.apiHost || '',
        enabled: provider.enabled ?? true
      })
    }
  }, [provider])

  const handleTestConnection = async () => {
    if (!formData.apiKey) {
      toast.error('请先输入 API Key')
      return
    }

    if (!provider) return

    setIsTestingConnection(true)
    setConnectionStatus('idle')

    try {
      // 调用 IPC 方法验证配置
      const isValid = await window.api.validateProviderConfig(provider.id, {
        apiKey: formData.apiKey,
        baseUrl: formData.apiHost || provider.apiHost
      })

      if (isValid) {
        setConnectionStatus('success')
        toast.success('连接测试成功', {
          description: '供应商配置有效，可以正常使用',
          duration: 3000
        })
      } else {
        setConnectionStatus('error')
        toast.error('连接测试失败', {
          description: '请检查 API Key 和网络连接',
          duration: 5000
        })
      }
    } catch (error) {
      setConnectionStatus('error')
      const errorMessage = error instanceof Error ? error.message : '未知错误'
      toast.error('连接测试失败', {
        description: errorMessage,
        duration: 5000
      })
    } finally {
      setIsTestingConnection(false)
    }
  }

  const handleResetBaseUrl = () => {
    if (defaultBaseUrl) {
      setFormData({ ...formData, apiHost: defaultBaseUrl })
      toast.success('已重置为默认地址')
    }
  }

  const handleToggleEnabled = async (checked: boolean) => {
    if (!provider) return

    // 立即更新本地状态
    setFormData({ ...formData, enabled: checked })

    // 自动保存到 store
    try {
      await updateProvider(provider.id, { enabled: checked })
      toast.success(checked ? '已启用供应商' : '已禁用供应商')
    } catch (error) {
      console.error('更新供应商状态失败:', error)
      toast.error('更新失败', {
        description: error instanceof Error ? error.message : '请重试'
      })
      // 恢复原状态
      setFormData({ ...formData, enabled: !checked })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)

    try {
      if (provider) {
        // 更新现有供应商
        await updateProvider(provider.id, {
          apiKey: formData.apiKey,
          apiHost: formData.apiHost,
          enabled: formData.enabled
        })
        toast.success('保存成功', {
          description: '供应商配置已更新'
        })
      } else {
        // 添加新供应商（暂不支持）
        toast.error('添加自定义供应商功能即将推出')
      }
      onClose()
    } catch (error) {
      console.error('保存供应商配置失败:', error)
      toast.error('保存失败', {
        description: error instanceof Error ? error.message : '请重试'
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!provider) return

    if (confirm(`确定要删除供应商 "${provider.name}" 吗？`)) {
      try {
        await removeProvider(provider.id)
        toast.success('删除成功')
        onClose()
      } catch (error) {
        console.error('删除供应商失败:', error)
        toast.error('删除失败', {
          description: error instanceof Error ? error.message : '请重试'
        })
      }
    }
  }

  const logoUrl = provider ? PROVIDER_LOGO_MAP[provider.id] : null

  return (
    <Card className="h-full overflow-hidden flex flex-col">
      {/* 头部 */}
      <CardHeader className="border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {logoUrl && (
              <img src={logoUrl} alt={formData.name} className="w-12 h-12 rounded-lg object-contain" />
            )}
            <div>
              <CardTitle className="text-xl">{formData.name}</CardTitle>
              {provider?.isSystem && (
                <Badge variant="outline" className="mt-1">系统供应商</Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={formData.enabled}
              onCheckedChange={handleToggleEnabled}
            />
          </div>
        </div>
      </CardHeader>

      {/* 表单内容 */}
      <CardContent className="flex-1 overflow-hidden p-0">
        <Tabs defaultValue="basic" className="h-full flex flex-col">
          <TabsList className="shrink-0 px-6 pt-4">
            <TabsTrigger value="basic">基础配置</TabsTrigger>
            <TabsTrigger value="models">模型管理</TabsTrigger>
          </TabsList>

          {/* 基础配置标签 */}
          <TabsContent value="basic" className="flex-1 overflow-hidden mt-0">
            <ScrollArea className="h-full">
              <div className="p-6 space-y-6">
                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* API Key 字段 */}
                  <Field orientation="vertical">
                    <FieldLabel>
                      API Key <span className="text-destructive">*</span>
                    </FieldLabel>
                    <FieldDescription>您的 API 密钥将被加密存储在本地</FieldDescription>
                    <FieldContent>
                      <div className="relative">
                        <Input
                          type={showApiKey ? 'text' : 'password'}
                          value={formData.apiKey}
                          onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                          placeholder="请输入 API Key"
                          className="pr-10"
                          required
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full"
                          onClick={() => setShowApiKey(!showApiKey)}
                        >
                          {showApiKey ? (
                            <EyeOff className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <Eye className="w-4 h-4 text-muted-foreground" />
                          )}
                        </Button>
                      </div>
                    </FieldContent>
                  </Field>

                  {/* API Host 字段 */}
                  <Field orientation="vertical">
                    <FieldLabel>API 地址</FieldLabel>
                    <FieldDescription>自定义 API 端点地址（留空使用默认地址）</FieldDescription>
                    <FieldContent>
                      <div className="flex gap-2">
                        <Input
                          type="url"
                          value={formData.apiHost}
                          onChange={(e) => setFormData({ ...formData, apiHost: e.target.value })}
                          placeholder="https://api.example.com"
                          className="flex-1"
                        />
                        {defaultBaseUrl && formData.apiHost !== defaultBaseUrl && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleResetBaseUrl}
                            title="重置为默认地址"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </FieldContent>
                  </Field>

                  <Separator />

                  {/* 健康检查按钮 */}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleTestConnection}
                      disabled={isTestingConnection || !formData.apiKey}
                      className="flex-1"
                    >
                      {isTestingConnection ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          测试中...
                        </>
                      ) : connectionStatus === 'success' ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 mr-2 text-green-600" />
                          连接成功
                        </>
                      ) : connectionStatus === 'error' ? (
                        <>
                          <XCircle className="w-4 h-4 mr-2 text-destructive" />
                          连接失败
                        </>
                      ) : (
                        <>
                          <Zap className="w-4 h-4 mr-2" />
                          测试连接
                        </>
                      )}
                    </Button>
                  </div>

                  {/* 底部按钮 */}
                  <div className="flex items-center justify-between pt-4 border-t">
                    <div>
                      {provider && !provider.isSystem && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={handleDelete}
                          className="text-destructive hover:text-destructive"
                        >
                          删除供应商
                        </Button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" onClick={onClose}>
                        取消
                      </Button>
                      <Button type="submit" disabled={isSaving}>
                        {isSaving ? '保存中...' : '保存'}
                      </Button>
                    </div>
                  </div>
                </form>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* 模型管理标签 */}
          <TabsContent value="models" className="flex-1 overflow-hidden mt-0">
            {provider ? (
              <ModelManagement
                providerId={provider.id}
                apiKey={formData.apiKey}
                models={provider.models || []}
              />
            ) : (
              <div className="p-6">
                <p className="text-muted-foreground">请先选择一个供应商</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
