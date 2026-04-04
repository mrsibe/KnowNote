import { create } from 'zustand'

export type Language = 'ko-KR' | 'en-US'

interface I18nStore {
  language: Language
  isLoading: boolean
  changeLanguage: (language: Language) => Promise<void>
  initLanguage: () => Promise<void>
}

export const useI18nStore = create<I18nStore>((set) => {
  // 설정 리스너 (한 번만 설정)
  if (typeof window !== 'undefined' && window.api) {
    window.api.settings.onSettingsChange((newSettings) => {
      const newLanguage = newSettings.language
      set({ language: newLanguage })
      console.log('[I18nStore] Language changed to:', newLanguage)
    })
  }

  return {
    language: 'en-US',
    isLoading: true,

    initLanguage: async () => {
      try {
        const language = await window.api.settings.get('language')
        set({ language: language || 'en-US', isLoading: false })
      } catch (error) {
        console.error('Failed to load language:', error)
        set({ isLoading: false })
      }
    },

    changeLanguage: async (language) => {
      try {
        // 먼저 UI 업데이트
        set({ language })
        // 그 후 electron-store에 저장
        await window.api.settings.set('language', language)
      } catch (error) {
        console.error('Failed to save language:', error)
      }
    }
  }
})
