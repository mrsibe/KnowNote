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
      // 초기화언어설정
      await initLanguage()

      // 현재 조회언어
      const currentLanguage = useI18nStore.getState().language

      // 미리로드모든언어패키지
      await preloadLocales(currentLanguage)

      setIsReady(true)
    }

    init()
  }, [initLanguage])

  // 감시언어변경그리고미리로드새의언어패키지
  useEffect(() => {
    if (isReady) {
      preloadLocales(language)
    }
  }, [language, isReady])

  // 만약아직로딩 중，표시로드화면
  if (!isReady || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background dark:bg-background-dark">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-foreground dark:text-foreground-dark">Loading...</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
