import { useEffect, useState, ReactNode } from 'react'
import { useI18nStore } from '../store/i18nStore'
import { preloadLocales } from '../lib/i18n'

interface I18nProviderProps {
  children: ReactNode
}

export const I18nProvider = ({ children }: I18nProviderProps) => {
  const { language, isLoading, initLanguage } = useI18nStore()
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    const init = async () => {
      // 初始化语言设置
      await initLanguage()

      // 获取当前语言
      const currentLanguage = useI18nStore.getState().language

      // 预加载所有语言包
      await preloadLocales(currentLanguage)

      setIsReady(true)
    }

    init()
  }, [initLanguage])

  // 监听语言变化并预加载新的语言包
  useEffect(() => {
    if (isReady) {
      preloadLocales(language)
    }
  }, [language, isReady])

  // 如果还在加载中，显示加载界面
  if (!isReady || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-surface-base">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-muted-foreground"></div>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
