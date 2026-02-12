import type { Model } from '@shared/types'

export interface ModelFilter {
  type: 'all' | 'chat' | 'embedding'
  searchQuery: string
}

export interface ModelManagementProps {
  providerId: string
  apiKey: string
  models: Model[]
}
