import { create } from 'zustand'

type Theme = 'light' | 'dark'

interface ThemeStore {
  theme: Theme
  isLoading: boolean
  setTheme: (theme: Theme) => Promise<void>
  toggleTheme: () => Promise<void>
  initTheme: () => Promise<void>
}

export const useThemeStore = create<ThemeStore>((set, get) => {
  // 리스너 설정 (한 번만 설정)
  if (typeof window !== 'undefined' && window.api) {
    window.api.settings.onSettingsChange((newSettings) => {
      const newTheme = newSettings.theme
      set({ theme: newTheme })
      // HTML 요소의 class 업데이트
      if (newTheme === 'dark') {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
      console.log('[ThemeStore] Theme changed to:', newTheme)
    })
  }

  return {
    theme: 'light',
    isLoading: true,

    initTheme: async () => {
      try {
        const theme = await window.api.settings.get('theme')
        set({ theme, isLoading: false })
        // HTML 요소의 class 업데이트
        if (theme === 'dark') {
          document.documentElement.classList.add('dark')
        } else {
          document.documentElement.classList.remove('dark')
        }
      } catch (error) {
        console.error('Failed to load theme:', error)
        set({ isLoading: false })
      }
    },

    setTheme: async (theme) => {
      try {
        // 먼저 UI 업데이트
        set({ theme })
        if (theme === 'dark') {
          document.documentElement.classList.add('dark')
        } else {
          document.documentElement.classList.remove('dark')
        }
        // 그런 다음 electron-store에 저장
        await window.api.settings.set('theme', theme)
      } catch (error) {
        console.error('Failed to save theme:', error)
      }
    },

    toggleTheme: async () => {
      const currentTheme = get().theme
      const newTheme = currentTheme === 'light' ? 'dark' : 'light'
      await get().setTheme(newTheme)
    }
  }
})
