import { create } from 'zustand'
import type { Provider, Model } from '@shared/types'

interface ProviderStore {
  // 状态
  providers: Provider[]
  selectedProviderId: string | null
  modelFilters: {
    [providerId: string]: {
      type: 'all' | 'chat' | 'embedding'
      searchQuery: string
    }
  }

  // Actions
  setProviders: (providers: Provider[]) => void
  updateProvider: (id: string, updates: Partial<Provider>) => Promise<void>
  addProvider: (provider: Provider) => Promise<void>
  removeProvider: (id: string) => Promise<void>
  addModel: (providerId: string, model: Model) => Promise<void>
  removeModel: (providerId: string, modelId: string) => Promise<void>
  updateModel: (providerId: string, modelId: string, updates: Partial<Model>) => Promise<void>
  toggleModelEnabled: (providerId: string, modelId: string, enabled: boolean) => Promise<void>
  setModelFilter: (providerId: string, filter: Partial<{ type: 'all' | 'chat' | 'embedding'; searchQuery: string }>) => void
  setSelectedProvider: (id: string) => void

  // 初始化
  initialize: () => Promise<void>
}

export const useProviderStore = create<ProviderStore>((set, get) => ({
  providers: [],
  selectedProviderId: null,
  modelFilters: {},

  setProviders: (providers) => set({ providers }),

  updateProvider: async (id, updates) => {
    // 1. 更新本地状态
    set((state) => ({
      providers: state.providers.map((p) => (p.id === id ? { ...p, ...updates } : p))
    }))

    // 2. 同步到 Electron Store
    const provider = get().providers.find((p) => p.id === id)
    if (provider) {
      await window.api.saveProviderConfig({
        providerName: id,
        config: {
          apiKey: provider.apiKey,
          baseUrl: provider.apiHost,
          ...updates
        },
        enabled: provider.enabled || false,
        updatedAt: Date.now()
      })
    }
  },

  addProvider: async (provider) => {
    set((state) => ({
      providers: [provider, ...state.providers]
    }))
    await window.api.saveProviderConfig({
      providerName: provider.id,
      config: {
        apiKey: provider.apiKey,
        baseUrl: provider.apiHost
      },
      enabled: provider.enabled || false,
      updatedAt: Date.now()
    })
  },

  removeProvider: async (id) => {
    set((state) => ({
      providers: state.providers.filter((p) => p.id !== id)
    }))
    await window.api.deleteProviderConfig(id)
  },

  addModel: async (providerId, model) => {
    // 只更新内存中的状态，不持久化模型列表
    set((state) => ({
      providers: state.providers.map((p) =>
        p.id === providerId ? { ...p, models: [...p.models, model] } : p
      )
    }))
  },

  removeModel: async (providerId, modelId) => {
    // 只更新内存中的状态，不持久化模型列表
    set((state) => ({
      providers: state.providers.map((p) =>
        p.id === providerId ? { ...p, models: p.models.filter((m) => m.id !== modelId) } : p
      )
    }))
  },

  updateModel: async (providerId, modelId, updates) => {
    // 只更新内存中的状态，不持久化模型列表
    set((state) => ({
      providers: state.providers.map((p) =>
        p.id === providerId
          ? {
              ...p,
              models: p.models.map((m) => (m.id === modelId ? { ...m, ...updates } : m))
            }
          : p
      )
    }))
  },

  toggleModelEnabled: async (providerId, modelId, enabled) => {
    // 只更新内存中的状态，不持久化模型列表
    set((state) => ({
      providers: state.providers.map((p) =>
        p.id === providerId
          ? {
              ...p,
              models: p.models.map((m) =>
                m.id === modelId ? { ...m, enabled: enabled } : m
              )
            }
          : p
      )
    }))
  },

  setModelFilter: (providerId, filter) => {
    set((state) => ({
      modelFilters: {
        ...state.modelFilters,
        [providerId]: {
          ...(state.modelFilters[providerId] || { type: 'all', searchQuery: '' }),
          ...filter
        }
      }
    }))
  },

  setSelectedProvider: (id) => set({ selectedProviderId: id }),

  initialize: async () => {
    try {
      // 1. 动态导入 SYSTEM_PROVIDERS_CONFIG（避免循环依赖）
      const { SYSTEM_PROVIDERS_CONFIG } = await import('@renderer/config/providers')
      const systemProviders = Object.values(SYSTEM_PROVIDERS_CONFIG)

      // 2. 从 Electron Store 加载用户配置
      const savedConfigs = await window.api.getAllProviderConfigs()

      // 3. 合并配置
      const providers = systemProviders.map((sp: any) => {
        const saved = savedConfigs.find((sc: any) => sc.providerName === sp.id)
        if (saved) {
          return {
            ...sp,
            apiKey: saved.config.apiKey || sp.apiKey || '',
            apiHost: saved.config.baseUrl || sp.apiHost,
            enabled: saved.enabled
          }
        }
        return {
          ...sp,
          enabled: false
        }
      })

      set({ providers })
    } catch (error) {
      console.error('Failed to initialize provider store:', error)
      set({ providers: [] })
    }
  }
}))
