import { ReactElement, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import { BookPlus, RotateCcw, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatMessage } from '../../../types/notebook'
import ReasoningContent from './ReasoningContent'
import AnswerSources from './AnswerSources'
import AnswerCoverage from './AnswerCoverage'
import CitationChip from './CitationChip'
import remarkCitationMarkers, { parseCitationHref } from './citationMarkers'
import { useItemStore } from '../../../store/itemStore'
import { useKnowledgeStore } from '../../../store/knowledgeStore'
import { useNotebookStore } from '../../../store/notebookStore'
import { useSourceAnchorNavigation } from '../../../hooks/useSourceAnchorNavigation'
import { useUIStore } from '../../../store/uiStore'
import {
  parseRetrievalStatus,
  parseRetrievalSnapshot,
  sourcesForDisplay
} from '../../../../../shared/utils/answerSources'
import { parseCitations, sourceDocumentExists } from '../../../../../shared/utils/citations'
import { classifyClaimSupport } from '../../../../../shared/utils/claimSupport'
import {
  citationToSourceAnchor,
  sourceAnchorsEqual
} from '../../../../../shared/utils/sourceAnchor'
import { answerNoticeKey, canRecover, isAnswerLive } from '../../../../../shared/utils/answerState'
import { useChatStore } from '../../../store/chatStore'
import { Button } from '../../ui/button'
import { ScrollArea, ScrollBar } from '../../ui/scroll-area'
import 'highlight.js/styles/github-dark.css'
import 'katex/dist/katex.min.css'
import './markdown.css'

interface MessageItemProps {
  message: ChatMessage
}

export default function MessageItem({ message }: MessageItemProps): ReactElement {
  const { t } = useTranslation(['common', 'chat'])
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const [copied, setCopied] = useState(false)
  const [addedToNote, setAddedToNote] = useState(false)

  // Everything about the turn's state comes from the record (#142): the transcript
  // renders from `status`, so the same message reads the same whether it is
  // arriving or was reloaded from the database.
  const isLive = isAnswerLive(message.status)
  const noticeKey = answerNoticeKey(message)

  const { createNote } = useItemStore()
  const { currentNotebook } = useNotebookStore()
  const { openSourceAnchor } = useSourceAnchorNavigation()
  const focusedSource = useUIStore((state) => state.focusedSource)
  const documents = useKnowledgeStore((state) => state.documents)
  const documentsLoaded = useKnowledgeStore((state) => state.documentsLoaded)
  // Whether the model is still thinking. The one live detail that is not on the
  // message: it comes from the assembled answer, and only exists while one does.
  const reasoningLive = useChatStore((state) => state.turns[message.id]?.reasoningLive ?? false)
  const retryMessage = useChatStore((state) => state.retryMessage)
  const continueMessage = useChatStore((state) => state.continueMessage)

  // What this answer was built from. Read defensively: the metadata comes from the
  // database and may predate the shape (see shared/utils/answerSources.ts).
  const answerSources = sourcesForDisplay(message.metadata)
  const retrieval = parseRetrievalStatus(message.metadata)
  // How this turn retrieved (#157): strategy, effective scope, topK, latency.
  const retrievalSnapshot = parseRetrievalSnapshot(message.metadata)

  // Structured citations (#69) mapped back to the `[n]` markers in the answer.
  const citations = parseCitations(message.metadata)
  const citationByIndex = new Map(citations.map((citation) => [citation.index, citation]))

  // Citation coverage (#156): which sentences carry a resolvable citation. Computed
  // from the answer and the persisted citations with the same pure function the
  // tests exercise, so "grounded" means one thing in the UI and in a test.
  const coverage = message.content ? classifyClaimSupport(message.content, citations) : null

  // A chip is disabled only once the library has been read and the document is
  // provably absent. Before that (or after a failed load) the list is "unknown",
  // not "deleted", so the chip stays clickable and the reader falls back.
  const documentExists = (documentId: string): boolean =>
    sourceDocumentExists(documents, documentsLoaded, documentId)

  const handleOpenCitation = (citation: (typeof citations)[number], origin: HTMLElement): void => {
    openSourceAnchor(citationToSourceAnchor(citation), origin)
  }

  // Copy message content
  // The two ways out of an answer that stopped (#151): carry on from what arrived, or
  // ask the same question again beside it. Both need the notebook the turn belongs to.
  const recoveryNotebookId = message.notebookId ?? currentNotebook?.id
  const handleContinue = (): void => {
    if (recoveryNotebookId) void continueMessage(recoveryNotebookId, message.id)
  }
  const handleRetry = (): void => {
    if (recoveryNotebookId) void retryMessage(recoveryNotebookId, message.id)
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  // Add to note
  const handleAddToNote = async () => {
    if (!currentNotebook) return

    try {
      await createNote(currentNotebook.id, message.content)
      setAddedToNote(true)
      setTimeout(() => setAddedToNote(false), 2000)
    } catch (error) {
      console.error('Failed to add to note:', error)
    }
  }

  // System message: centered notification box
  if (isSystem) {
    return (
      <div className="flex justify-center">
        <div className="max-w-[85%] min-w-0 bg-muted text-muted-foreground rounded-lg px-4 py-3 w-fit">
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p(props) {
                  const { children, ...rest } = props
                  return (
                    <p className="text-sm whitespace-pre-wrap wrap-break-word m-0" {...rest}>
                      {children}
                    </p>
                  )
                },
                // Table: wrap in scrollable container
                table: ({ children, ...props }) => (
                  <ScrollArea className="w-full">
                    <table {...props}>{children}</table>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
                )
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    )
  }

  if (isUser) {
    // User message: blue background, right-aligned
    return (
      <div className="flex justify-end group">
        <div className="flex flex-col gap-1 max-w-[85%] min-w-0 items-end">
          <div className="bg-muted text-foreground rounded-lg px-4 py-3 w-fit">
            <p className="text-sm whitespace-pre-wrap wrap-break-word message-content-selectable">
              {message.content}
            </p>
          </div>
          {/* Copy button */}
          <Button
            onClick={handleCopy}
            variant="ghost"
            className="self-end px-2 py-1 text-xs h-auto text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            title={copied ? t('common:copied') : t('common:copy')}
          >
            {copied ? (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span>{t('common:copied')}</span>
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                <span>{t('common:copy')}</span>
              </>
            )}
          </Button>
        </div>
      </div>
    )
  }

  // AI message: no background, left-aligned, Markdown rendered
  return (
    <div className="flex justify-start group">
      <div className="flex flex-col gap-3 max-w-[85%] min-w-0">
        {/* Reasoning process display - only shown when reasoning content exists */}
        {message.reasoningContent && (
          <ReasoningContent content={message.reasoningContent} isStreaming={reasoningLive} />
        )}

        {message.content ? (
          <div className="markdown-content text-foreground px-2">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath, remarkCitationMarkers]}
              rehypePlugins={[rehypeHighlight, rehypeKatex]}
              components={{
                // Citation markers become chips (#72); every other link keeps the
                // "open externally" behaviour.
                a: ({ href, children, ...props }) => {
                  const marker = parseCitationHref(href)
                  if (marker !== null) {
                    const citation = citationByIndex.get(marker)
                    return (
                      <CitationChip
                        index={marker}
                        citation={citation}
                        documentExists={!citation || documentExists(citation.documentId)}
                        selected={
                          citation !== undefined &&
                          sourceAnchorsEqual(citationToSourceAnchor(citation), focusedSource)
                        }
                        onOpen={handleOpenCitation}
                      />
                    )
                  }
                  return (
                    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                      {children}
                    </a>
                  )
                },
                // Table: wrap in scrollable container
                table: ({ children, ...props }) => (
                  <ScrollArea className="w-full">
                    <table {...props}>{children}</table>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
                )
              }}
            >
              {message.content}
            </ReactMarkdown>
            {/* Streaming message cursor */}
            {isLive && (
              <span className="inline-block w-2 h-4 ml-1 bg-muted-foreground animate-pulse" />
            )}
          </div>
        ) : (
          // Show cursor when message is empty and still streaming
          isLive && (
            <div className="flex items-center gap-2 px-2">
              <span className="text-sm text-muted-foreground">{t('chat:thinking')}</span>
              <span className="inline-block w-2 h-4 bg-muted-foreground animate-pulse" />
            </div>
          )
        )}
        {/* What the answer was built from. Only after the turn ends: during
            streaming there is nothing to show yet, and an empty evidence list
            mid-answer would read as "nothing was used". */}
        {message.content && !isLive && (
          <AnswerSources
            sources={answerSources}
            retrieval={retrieval}
            citations={citations}
            snapshot={retrievalSnapshot}
            onShowDocument={(documentId, origin) =>
              openSourceAnchor({ documentId, location: { documentId } }, origin)
            }
          />
        )}
        {/* Citation coverage (#156). Stated only when something is not backed by a
            source; a normal answer does not need an "all good" line. */}
        {coverage && !isLive && <AnswerCoverage coverage={coverage} />}
        {/* Why the answer stops where it does, when the model did not decide to stop
            there itself. Beside the answer, never instead of it: the part that
            arrived is what the reader was left with. */}
        {!isLive && noticeKey && (
          <p className="px-2 text-xs text-subtle-foreground">
            {t(`chat:${noticeKey}`, { error: message.error?.message ?? '' })}
          </p>
        )}
        {/* Action buttons - only shown when reply is complete and has content */}
        {message.content && !isLive && (
          <div className="flex items-center gap-2 self-start ml-2">
            {/* Recovery, when the answer stopped early and asking again may help */}
            {canRecover(message.status) && (
              <>
                <Button
                  onClick={handleContinue}
                  variant="ghost"
                  className="px-2 py-1 text-xs h-auto text-muted-foreground hover:text-foreground"
                  title={t('chat:continueAnswer')}
                >
                  <Play className="w-3 h-3" />
                  <span>{t('chat:continueAnswer')}</span>
                </Button>
                <Button
                  onClick={handleRetry}
                  variant="ghost"
                  className="px-2 py-1 text-xs h-auto text-muted-foreground hover:text-foreground"
                  title={t('chat:retryAnswer')}
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{t('chat:retryAnswer')}</span>
                </Button>
              </>
            )}
            {/* Copy button */}
            <Button
              onClick={handleCopy}
              variant="ghost"
              className="px-2 py-1 text-xs h-auto text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              title={copied ? t('common:copied') : t('common:copy')}
            >
              {copied ? (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span>{t('common:copied')}</span>
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                  <span>{t('common:copy')}</span>
                </>
              )}
            </Button>

            {/* Add to note button */}
            <Button
              onClick={handleAddToNote}
              variant="ghost"
              className="px-2 py-1 text-xs h-auto text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              title={addedToNote ? t('chat:addedToNote') : t('chat:addToNote')}
            >
              {addedToNote ? (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span>{t('chat:added')}</span>
                </>
              ) : (
                <>
                  <BookPlus className="w-3 h-3" />
                  <span>{t('chat:addToNote')}</span>
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
