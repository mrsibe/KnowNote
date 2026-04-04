import { useCallback } from 'react'
import { useI18nStore } from '../store/i18nStore'

// 언어타입정의
export type Language = 'ko-KR' | 'en-US'
export type Namespace = 'common' | 'chat' | 'settings' | 'notebook' | 'ui' | 'quiz'

// 동상태가져오기언어패키지
const loadLocale = async (lang: Language, namespace: Namespace) => {
  const module = await import(`../locales/${lang}/${namespace}.json`)
  return module.default
}

// 캐시로드의언어패키지
const localeCache = new Map<string, Record<string, any>>()

// 조회번역번역텍스트의핵심마음함수
export const getTranslation = async (
  lang: Language,
  namespace: Namespace,
  key: string
): Promise<string> => {
  const cacheKey = `${lang}-${namespace}`

  // 만약캐시에서있는，직접사용
  if (localeCache.has(cacheKey)) {
    const locale = localeCache.get(cacheKey)!
    return getNestedValue(locale, key) || key
  }

  // 아니오로드그리고캐시
  try {
    const locale = await loadLocale(lang, namespace)
    localeCache.set(cacheKey, locale)
    return getNestedValue(locale, key) || key
  } catch (error) {
    console.error(`Failed to load locale ${lang}/${namespace}:`, error)
    return key
  }
}

// 조회임베딩세트객체의값
const getNestedValue = (obj: any, key: string): string | undefined => {
  return key.split('.').reduce((prev, curr) => {
    return prev && prev[curr] !== undefined ? prev[curr] : undefined
  }, obj)
}

// 동기버전의번역번역함수（용도:미리로드의언어패키지）
export const t = (namespace: Namespace, key: string, fallback?: string) => {
  const language = useI18nStore.getState().language
  const cacheKey = `${language}-${namespace}`

  if (localeCache.has(cacheKey)) {
    const locale = localeCache.get(cacheKey)!
    const value = getNestedValue(locale, key)
    return value || fallback || key
  }

  return fallback || key
}

// 미리로드모든언어패키지
export const preloadLocales = async (lang: Language) => {
  const namespaces: Namespace[] = ['common', 'chat', 'settings', 'notebook', 'ui', 'quiz']
  const promises = namespaces.map(async (namespace) => {
    const cacheKey = `${lang}-${namespace}`
    if (!localeCache.has(cacheKey)) {
      try {
        const locale = await loadLocale(lang, namespace)
        localeCache.set(cacheKey, locale)
      } catch (error) {
        console.error(`Failed to preload locale ${lang}/${namespace}:`, error)
      }
    }
  })

  await Promise.all(promises)
}

// React Hook for translations
export const useTranslation = (namespace: Namespace) => {
  const language = useI18nStore((state) => state.language)

  const translate = useCallback(
    (key: string, fallback?: string): string => {
      const cacheKey = `${language}-${namespace}`

      if (localeCache.has(cacheKey)) {
        const locale = localeCache.get(cacheKey)!
        const value = getNestedValue(locale, key)
        return value || fallback || key
      }

      return fallback || key
    },
    [language, namespace]
  )

  return { t: translate, language }
}

// 포맷팅함수
export const formatMessage = (
  template: string,
  values: Record<string, string | number> = {}
): string => {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return values[key]?.toString() || match
  })
}

// 복수형형식처리（간단일현재）
export const pluralize = (count: number, singular: string, plural?: string): string => {
  if (count === 1) return singular
  return plural || singular + 's'
}
