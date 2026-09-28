import { ReactElement, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KnowledgeDocument } from '../../../../../shared/types/knowledge'
import type { RetrievalScope } from '../../../../../shared/types/scope'
import { Button } from '../../ui/button'
import { Checkbox } from '../../ui/checkbox'

interface ScopeSelectorProps {
  scope: RetrievalScope
  documents: KnowledgeDocument[]
  /** 阅读器当前打开的来源；没有时「当前来源」不可选。 */
  currentDocumentId: string | null
  disabled?: boolean
  onChange: (scope: RetrievalScope) => void
}

/**
 * 这次问题用哪些来源回答（#94）。
 *
 * 三种 scope：
 *
 *   All sources      整个 notebook —— 默认，与引入 scope 之前完全一致。
 *   Current source   阅读器里正打开的那一份。
 *   Selected sources 从来源列表里勾选的一组。
 *
 * 选中状态就是 scope 本身，没有第二份「选择」状态要同步；切换 session 时 scope 跟着
 * session 走（#97 会复用这一点）。非默认 scope 时旁边有一个一键清除的 X。
 *
 * 控件放在 composer 里而不是左栏：scope 是「这次提问」的属性，只有在要提问的地方
 * 才需要被看见。
 */
export default function ScopeSelector({
  scope,
  documents,
  currentDocumentId,
  disabled = false,
  onChange
}: ScopeSelectorProps): ReactElement {
  const { t } = useTranslation('ui')
  const [open, setOpen] = useState(false)

  const currentDocument = documents.find((document) => document.id === currentDocumentId) ?? null
  const selected =
    scope.type === 'selected-sources' ? new Set(scope.documentIds) : new Set<string>()

  const label =
    scope.type === 'current-source'
      ? t('scopeCurrentSource')
      : scope.type === 'selected-sources'
        ? t('scopeSelectedCount', { count: scope.documentIds.length })
        : t('scopeNotebook')

  const choose = (next: RetrievalScope): void => {
    onChange(next)
    setOpen(false)
  }

  const toggleDocument = (documentId: string): void => {
    const next = new Set(selected)
    if (next.has(documentId)) next.delete(documentId)
    else next.add(documentId)
    // 取消最后一个勾选会回到 notebook，而不是「限制到空集」—— 空 scope 应被明确清除，
    // 不应该伪装成「没有结果」。
    onChange(
      next.size === 0 ? { type: 'notebook' } : { type: 'selected-sources', documentIds: [...next] }
    )
  }

  return (
    <div className="relative flex items-center gap-1 px-3 pt-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="h-auto gap-1 px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <span>
          {t('scopeLabel')}: {label}
        </span>
        <ChevronDown className="h-3 w-3" />
      </Button>

      {scope.type !== 'notebook' && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          title={t('scopeClear')}
          aria-label={t('scopeClear')}
          onClick={() => onChange({ type: 'notebook' })}
          className="h-auto px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </Button>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-0" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-3 z-10 mb-1 max-h-72 w-72 overflow-y-auto rounded-md border border-border bg-surface-overlay p-1 shadow-elevation">
            <Button
              type="button"
              variant="ghost"
              onClick={() => choose({ type: 'notebook' })}
              className={`h-auto w-full justify-start px-2 py-1.5 text-xs font-normal ${
                scope.type === 'notebook' ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              {t('scopeNotebook')}
            </Button>

            <Button
              type="button"
              variant="ghost"
              disabled={!currentDocumentId}
              onClick={() => {
                if (currentDocumentId)
                  choose({ type: 'current-source', documentId: currentDocumentId })
              }}
              className={`h-auto w-full justify-start gap-2 px-2 py-1.5 text-xs font-normal ${
                scope.type === 'current-source' ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              <span>{t('scopeCurrentSource')}</span>
              {currentDocument && (
                <span className="truncate opacity-70">{currentDocument.title}</span>
              )}
            </Button>

            <div className="mt-1 border-t border-border pt-1">
              <div className="px-2 py-1 text-xs text-muted-foreground">
                {t('scopeSelectedSources')}
              </div>
              {documents.length === 0 ? (
                <div className="px-2 py-1 text-xs text-muted-foreground">
                  {t('scopeNoDocuments')}
                </div>
              ) : (
                documents.map((document) => (
                  <Button
                    key={document.id}
                    type="button"
                    variant="ghost"
                    aria-pressed={selected.has(document.id)}
                    onClick={() => toggleDocument(document.id)}
                    className={`h-auto w-full justify-start gap-2 px-2 py-1 text-xs font-normal ${
                      selected.has(document.id) ? 'text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    {/* The row is the control; the checkbox is its indicator, so it must
                        not take the click or the tab stop. */}
                    <Checkbox
                      checked={selected.has(document.id)}
                      aria-hidden
                      tabIndex={-1}
                      className="pointer-events-none"
                    />
                    <span className="truncate">{document.title}</span>
                  </Button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
