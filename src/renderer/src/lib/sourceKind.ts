/**
 * What a source actually is, for display.
 *
 * `KnowledgeDocument.type` is deliberately coarse — `file | url | note | text` —
 * because that is all the ingestion path needs to know. A reader needs more: "PDF"
 * and "Word" are different facts about a source, and the library row is where that
 * is visible. This derives the finer kind once, from the fields the ingestion path
 * already stores, so the icon and the label cannot disagree with each other or
 * with the reader's own format check.
 *
 * Kept pure and free of React so it can be asserted directly (see
 * `test/sourceKind.test.ts`): `mimeType` is nullable, stored paths are Windows or
 * POSIX, and a `url` is whatever the user pasted.
 */
export type SourceKind =
  'pdf' | 'docx' | 'pptx' | 'markdown' | 'text' | 'file' | 'web' | 'youtube' | 'note'

/** The i18n key for a kind's short label ("PDF", "Word", "Web"). */
export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  pdf: 'sourceKindPdf',
  docx: 'sourceKindDocx',
  pptx: 'sourceKindPptx',
  markdown: 'sourceKindMarkdown',
  text: 'sourceKindText',
  file: 'sourceKindFile',
  web: 'sourceKindWeb',
  youtube: 'sourceKindYoutube',
  note: 'notes'
}

const MIME_KINDS: Record<string, SourceKind> = {
  'application/pdf': 'pdf',
  'application/msword': 'docx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-powerpoint': 'pptx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/markdown': 'markdown',
  'text/html': 'web'
}

/**
 * A `txt` file is the same fact as pasted text, so it resolves to `text` rather
 * than carrying a kind of its own. An extension that is not in here is `file`:
 * "we do not know" is a real answer, and guessing `text` would be a wrong one.
 */
const EXTENSION_KINDS: Record<string, SourceKind> = {
  pdf: 'pdf',
  doc: 'docx',
  docx: 'docx',
  ppt: 'pptx',
  pptx: 'pptx',
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  html: 'web',
  htm: 'web'
}

/** Lowercased extension of a stored path, without query or fragment. */
function extensionOf(path: string): string {
  const withoutQuery = path.split(/[?#]/)[0]
  const lastSegment = withoutQuery.split(/[\\/]/).pop() ?? ''
  const dot = lastSegment.lastIndexOf('.')
  return dot === -1 ? '' : lastSegment.slice(dot + 1).toLowerCase()
}

function isYoutubeHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host === 'youtu.be' ||
    host.endsWith('.youtu.be')
  )
}

/**
 * The fields `sourceKindOf` reads, and only those.
 *
 * Structural rather than `KnowledgeDocument`: the library row has a whole row, but
 * Home renders `WorkspaceOverviewDocument`, which deliberately carries only the
 * wire subset. Demanding the full row here meant the two call sites could not share
 * one derivation. `type` is `string`, not the enum, because the value comes out of
 * SQLite and an unknown value must fall through rather than be asserted away.
 */
export interface SourceKindInput {
  type: string
  mimeType?: string | null
  sourceUri?: string | null
  localFilePath?: string | null
}

export function sourceKindOf(document: SourceKindInput): SourceKind {
  if (document.type === 'note') return 'note'
  if (document.type === 'text') return 'text'

  if (document.type === 'url') {
    const raw = document.sourceUri ?? ''
    try {
      return isYoutubeHost(new URL(raw).hostname) ? 'youtube' : 'web'
    } catch {
      // A URL the browser cannot parse is still a web source; it is not a video.
      return 'web'
    }
  }

  const byMime = document.mimeType ? MIME_KINDS[document.mimeType] : undefined
  if (byMime) return byMime

  const path = document.localFilePath ?? document.sourceUri ?? ''
  return EXTENSION_KINDS[extensionOf(path)] ?? 'file'
}
