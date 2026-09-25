import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { Citation } from '../../../../../shared/types/citation'

interface CitationChipProps {
  /** 回答正文里的 `[n]` 编号。 */
  index: number
  /** 该编号解析到的 citation；未解析的标记没有 citation。 */
  citation?: Citation
  /** 来源文档是否还在。已经删除的来源只禁用跳转，不隐藏这条引用。 */
  documentExists: boolean
  /**
   * The reader is currently showing this citation's anchor. Derived from
   * `uiStore.focusedSource` by the caller (#65) — there is no separate selection
   * store to keep in sync.
   */
  selected?: boolean
  onOpen: (citation: Citation, origin: HTMLElement) => void
}

/**
 * 回答里的一个 `[n]`（#72）。
 *
 * 数据和呈现是分开的：解析阶段只负责把编号映射回 `Citation`，标题与页码由这里决定。
 * 因此将来改文案、换布局都不需要动正文解析，`Citation` 也不必携带显示字符串。
 *
 * 三种形态：
 *
 * - 没有对应 citation —— 渲染成普通文本 `[n]`，与未被解析的标记保持一致；
 * - 来源已删除 —— 芯片存在但禁用，让「这里曾经有一条引用」这件事仍然可见；
 * - 正常 —— 点击跳到原文的对应页 / 段落。
 *
 * `selected` 是第四种状态但不是第四种形态：它表示阅读器此刻正停在同一个定位上，
 * 由 `citationToSourceAnchor` 与 `focusedSource` 比较得出（#65）。
 */
export default function CitationChip({
  index,
  citation,
  documentExists,
  selected = false,
  onOpen
}: CitationChipProps): ReactElement {
  const { t } = useTranslation('chat')

  if (!citation) {
    return <span className="citation-chip citation-chip--plain">[{index}]</span>
  }

  const label = `[${index}]`
  const page = typeof citation.page === 'number' ? t('citationPage', { page: citation.page }) : null
  const disabled = !documentExists

  return (
    <button
      type="button"
      className={`citation-chip${selected ? ' citation-chip--selected' : ''}`}
      disabled={disabled}
      aria-current={selected ? 'true' : undefined}
      title={disabled ? t('citationUnavailable') : citation.documentTitle}
      aria-label={
        disabled
          ? t('citationUnavailable')
          : page
            ? t('citationOpenAtPage', { title: citation.documentTitle, page: citation.page })
            : t('citationOpen', { title: citation.documentTitle })
      }
      onClick={(event) => onOpen(citation, event.currentTarget)}
    >
      <span className="citation-chip__marker">{label}</span>
      <span className="citation-chip__title">{citation.documentTitle}</span>
      {page && <span className="citation-chip__page">· {page}</span>}
    </button>
  )
}
