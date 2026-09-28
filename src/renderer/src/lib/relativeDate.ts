import type { TFunction } from 'i18next'

/**
 * "Today" / "Yesterday" / "N days ago" / a local date.
 *
 * Lifted out of `NotebookCard` when the notebook header needed the same string on
 * the same field: two call sites that must not drift into two phrasings, and a
 * bucket boundary (today / yesterday / this week / absolute) that is easier to
 * assert than to eyeball.
 *
 * `language` arrives separately rather than being read from `i18next` so the
 * function stays pure and testable.
 */
export function formatRelativeDate(date: Date, t: TFunction, language: string): string {
  const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24))

  if (days <= 0) return t('today')
  if (days === 1) return t('yesterday')
  if (days < 7) return t('daysAgo', { days })

  return date.toLocaleDateString(language === 'zh-CN' ? 'zh-CN' : 'en-US')
}
