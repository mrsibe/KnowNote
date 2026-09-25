import { useCallback } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import type { SourceAnchor } from '../../../shared/types/source'
import { withSourceAnchor } from '../../../shared/utils/sourceAnchor'
import { useUIStore } from '../store/uiStore'

/**
 * 打开 / 关闭一个来源定位（#72）。
 *
 * 这是引用跳转的唯一入口，也刻意是 #73 将来复用的入口：调用方拿到一个
 * `SourceAnchor` 就调它，不需要知道 URL 或左栏阅读器如何协作。
 *
 * 两件事同时发生：
 *
 *   store  —— 立即驱动左栏阅读器（兄弟面板之间的通信）；
 *   query  —— 写进 `/notebook/:id` 的 search，reload 后据此恢复。
 *
 * 关闭时只删掉来源定位那几个 key，保留 route 上其它 query。
 */
export function useSourceAnchorNavigation(): {
  openSourceAnchor: (anchor: SourceAnchor) => void
  closeSourceAnchor: () => void
} {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const setFocusedSource = useUIStore((state) => state.openSourceAnchor)

  const navigateTo = useCallback(
    (anchor: SourceAnchor | null): void => {
      const search = withSourceAnchor(searchParams, anchor).toString()
      navigate(`${location.pathname}${search ? `?${search}` : ''}`, { replace: true })
    },
    [navigate, location.pathname, searchParams]
  )

  const openSourceAnchor = useCallback(
    (anchor: SourceAnchor): void => {
      setFocusedSource(anchor)
      navigateTo(anchor)
    },
    [navigateTo, setFocusedSource]
  )

  const closeSourceAnchor = useCallback((): void => {
    setFocusedSource(null)
    navigateTo(null)
  }, [navigateTo, setFocusedSource])

  return { openSourceAnchor, closeSourceAnchor }
}
