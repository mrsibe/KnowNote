import { useCallback } from 'react'
import { useI18nStore } from '../store/i18nStore'

// 언어 타입 정의
export type Language = 'ko-KR' | 'en-US'
export type Namespace = 'common' | 'chat' | 'settings' | 'notebook' | 'ui' | 'quiz'

// 언어 팩 동적 가져오기
const loadLocale = async (lang: Language, namespace: Namespace) => {
  const module = await import(`../locales/${lang}/${namespace}.json`)
  return module.default
}

// 로드된 언어 팩 캐시
const localeCache = new Map<string, Record<string, any>>()

// 번역 텍스트 조회 핵심 함수
export const getTranslation = async (
  lang: Language,
  namespace: Namespace,
  key: string
): Promise<string> => {
  const cacheKey = `${lang}-${namespace}`

  // 캐시에 있으면 직접 사용
  if (localeCache.has(cacheKey)) {
    const locale = localeCache.get(cacheKey)!
    return getNestedValue(locale, key) || key
  }

  // 로드 후 캐시
  try {
    const locale = await loadLocale(lang, namespace)
    localeCache.set(cacheKey, locale)
    return getNestedValue(locale, key) || key
  } catch (error) {
    console.error(`Failed to load locale ${lang}/${namespace}:`, error)
    return key
  }
}

// 중첩 객체에서 값 조회
const getNestedValue = (obj: any, key: string): string | undefined => {
  return key.split('.').reduce((prev, curr) => {
    return prev && prev[curr] !== undefined ? prev[curr] : undefined
  }, obj)
}

// 동기 버전 번역 함수 (미리 로드된 언어 팩용)
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

// 모든 언어 팩 미리 로드
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

// 포맷팅 함수
export const formatMessage = (
  template: string,
  values: Record<string, string | number> = {}
): string => {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return values[key]?.toString() || match
  })
}

// 복수형 처리 (현재 간단한 구현)
export const pluralize = (count: number, singular: string, plural?: string): string => {
  if (count === 1) return singular
  return plural || singular + 's'
}
