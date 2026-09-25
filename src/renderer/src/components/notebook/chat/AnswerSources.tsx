import { ReactElement, useState } from 'react'
import { ChevronDown, ChevronRight, FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AnswerSource, RetrievalStatus } from '../../../../../shared/types/chat'
import { Button } from '../../ui/button'

interface AnswerSourcesProps {
  sources: AnswerSource[]
  /** `null` for a message written before this was recorded — claim nothing. */
  retrieval: RetrievalStatus | null
  onShowDocument: (documentId: string, origin: HTMLElement) => void
}

/**
 * What an answer was built from.
 *
 * The retrieval step always knew this and used to throw it away: the prompt kept
 * a title and some text, and `chunkId` / `documentId` were dropped on the floor.
 * So the answer arrived looking identical whether it came from the reader's own
 * documents or from nowhere, which is the one thing this product cannot afford.
 *
 * Three states, and they are not the same statement:
 *
 * - `used`   — these passages, quotable, with a way back to the document.
 * - `none`   — nothing in the notebook matched; the answer is the model's own.
 * - `failed` — the search itself broke, so the answer was never grounded.
 *
 * A message with no recorded status renders nothing at all: an older message is
 * "unknown", not "ungrounded".
 */
export default function AnswerSources({
  sources,
  retrieval,
  onShowDocument
}: AnswerSourcesProps): ReactElement | null {
  const { t } = useTranslation('chat')
  const [isOpen, setIsOpen] = useState(false)

  if (retrieval === null) return null

  if (retrieval === 'failed') {
    return <p className="px-2 text-xs text-subtle-foreground">{t('answerRetrievalFailed')}</p>
  }

  if (sources.length === 0) {
    return <p className="px-2 text-xs text-subtle-foreground">{t('answerNotGrounded')}</p>
  }

  return (
    <div className="px-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="h-auto gap-1 px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground"
      >
        {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {isOpen ? t('hideSources') : t('sourcesUsed', { count: sources.length })}
      </Button>

      {isOpen && (
        <ul className="mt-2 space-y-2">
          {sources.map((source) => (
            <li key={`${source.documentId}:${source.chunkId}`} className="rounded-md bg-muted p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
                  <FileText className="w-3 h-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{source.documentTitle}</span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(event) => onShowDocument(source.documentId, event.currentTarget)}
                  className="h-auto shrink-0 px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  {t('showDocument')}
                </Button>
              </div>
              {/* The passage as it was retrieved, quoted rather than summarised:
                  this is the evidence, so it is shown verbatim. */}
              <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                {source.content}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
