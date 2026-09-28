import { desc, eq, sql } from 'drizzle-orm'
import { getDatabase } from '../db'
import { documents, notes, notebooks } from '../db/schema'
import type { KnowledgeService } from '../services/KnowledgeService'

/**
 * Knowledge query layer for MCP (#80).
 *
 * The tool handlers talk to this interface, never to `KnowledgeService`,
 * Electron or the database directly. That keeps the protocol surface testable
 * with a stub runtime and keeps the MCP server an *adapter* over the same
 * retrieval path the chat does — the ADR's "do not fork a query path".
 *
 * Everything here is read-only. There is no tool that writes, spends money or
 * calls a model, and no result carries a filesystem path.
 */

export interface NotebookSummary {
  id: string
  title: string
  description?: string
  sourceCount: number
  noteCount: number
}

/** One retrieved passage with the provenance a citation needs. */
export interface EvidenceView {
  documentId: string
  documentTitle: string
  page?: number
  blockId?: string
  startOffset?: number
  endOffset?: number
  quote: string
  score: number
}

export interface SearchResultView {
  strategy: string
  evidence: EvidenceView[]
  /** Set when the requested strategy could not run (e.g. no embedding backend). */
  degraded?: string
}

export interface SourceOutlineEntry {
  blockId: string
  kind: string
  page: number | null
  level: number | null
  text: string
}

export interface SourceView {
  documentId: string
  title: string
  type: string
  status: string
  mimeType?: string
  chunkCount: number
  outline: SourceOutlineEntry[]
}

export interface DocumentTextView {
  documentId: string
  title: string
  /** The page the text was scoped to, when `page` was given. */
  page?: number
  text: string
  /** True when the returned text is a bounded window rather than the whole source. */
  truncated: boolean
}

export interface NoteView {
  id: string
  title: string
  content: string
}

export interface McpRuntime {
  listNotebooks(): Promise<NotebookSummary[]>
  searchNotebook(notebookId: string, query: string, topK: number): Promise<SearchResultView>
  getSource(documentId: string): Promise<SourceView | null>
  readDocument(documentId: string, page?: number): Promise<DocumentTextView | null>
  searchNotes(notebookId: string, query: string): Promise<NoteView[]>
}

/** How much of a source `read_document` returns when no page is given. */
export const READ_DOCUMENT_WINDOW = 20_000

export function createKnowledgeRuntime(knowledgeService: KnowledgeService): McpRuntime {
  const db = getDatabase()

  return {
    async listNotebooks(): Promise<NotebookSummary[]> {
      const rows = await db.select().from(notebooks).orderBy(desc(notebooks.updatedAt)).all()

      const sourceCounts = new Map<string, number>(
        db
          .select({ notebookId: documents.notebookId, count: sql<number>`count(*)` })
          .from(documents)
          .groupBy(documents.notebookId)
          .all()
          .map((row) => [row.notebookId, Number(row.count)])
      )
      const noteCounts = new Map<string, number>(
        db
          .select({ notebookId: notes.notebookId, count: sql<number>`count(*)` })
          .from(notes)
          .groupBy(notes.notebookId)
          .all()
          .map((row) => [row.notebookId, Number(row.count)])
      )

      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        ...(row.description ? { description: row.description } : {}),
        sourceCount: sourceCounts.get(row.id) ?? 0,
        noteCount: noteCounts.get(row.id) ?? 0
      }))
    },

    async searchNotebook(notebookId, query, topK): Promise<SearchResultView> {
      // The same Retriever the chat and the search panel use. When no embedding
      // backend is configured the dense path throws; the literal index is still a
      // valid answer, so it is used and the result says so rather than failing the
      // whole tool call.
      try {
        const result = await knowledgeService.retrieve({ notebookId, query, topK })
        return {
          strategy: result.trace.strategy,
          evidence: result.evidence.map((item) => {
            const block = item.locator.blocks[0]
            return {
              documentId: item.documentId,
              documentTitle: item.source.title,
              ...(item.locator.pageStart !== null ? { page: item.locator.pageStart } : {}),
              ...(block
                ? {
                    blockId: block.blockId,
                    startOffset: block.startOffset + block.startInBlock,
                    endOffset: block.startOffset + block.endInBlock
                  }
                : {}),
              quote: item.content,
              score: item.score
            }
          })
        }
      } catch (error) {
        const literal = await knowledgeService.searchText(notebookId, query, { limit: topK })
        return {
          strategy: 'sparse',
          degraded: `Dense retrieval was unavailable (${(error as Error).message}); these are literal BM25 matches only.`,
          evidence: literal.map((item) => {
            const block = item.locator.blocks[0]
            return {
              documentId: item.documentId,
              documentTitle: item.documentTitle,
              ...(item.locator.pageStart !== null ? { page: item.locator.pageStart } : {}),
              ...(block
                ? {
                    blockId: block.blockId,
                    startOffset: block.startOffset + block.startInBlock,
                    endOffset: block.startOffset + block.endInBlock
                  }
                : {}),
              quote: item.content,
              score: item.score
            }
          })
        }
      }
    },

    async getSource(documentId): Promise<SourceView | null> {
      const document = knowledgeService.getDocument(documentId)
      if (!document) return null

      const outline = knowledgeService.getDocumentBlocks(documentId).map((block) => ({
        blockId: block.id,
        kind: block.kind,
        page: block.page,
        level: block.level,
        text: block.text
      }))

      return {
        documentId: document.id,
        title: document.title,
        type: document.type,
        status: document.status,
        ...(document.mimeType ? { mimeType: document.mimeType } : {}),
        chunkCount: document.chunkCount ?? 0,
        outline
      }
    },

    async readDocument(documentId, page): Promise<DocumentTextView | null> {
      const document = knowledgeService.getDocument(documentId)
      if (!document?.content) return null

      const content = document.content

      // Page-scoped read: the block table is what knows where a page starts and
      // ends, so the slice is derived from it rather than guessed from a page count.
      if (page !== undefined) {
        const pageBlocks = knowledgeService
          .getDocumentBlocks(documentId)
          .filter((block) => block.page === page)
          .sort((a, b) => a.order - b.order)

        if (pageBlocks.length === 0) {
          return { documentId, title: document.title, page, text: '', truncated: false }
        }
        const start = pageBlocks[0].startOffset
        const end = pageBlocks[pageBlocks.length - 1].endOffset
        return {
          documentId,
          title: document.title,
          page,
          text: content.slice(start, end),
          truncated: false
        }
      }

      return {
        documentId,
        title: document.title,
        text: content.slice(0, READ_DOCUMENT_WINDOW),
        truncated: content.length > READ_DOCUMENT_WINDOW
      }
    },

    async searchNotes(notebookId, query): Promise<NoteView[]> {
      const needle = query.trim().toLowerCase()
      if (needle.length === 0) return []

      return getDatabase()
        .select({ id: notes.id, title: notes.title, content: notes.content })
        .from(notes)
        .where(eq(notes.notebookId, notebookId))
        .all()
        .filter(
          (note) =>
            note.title.toLowerCase().includes(needle) || note.content.toLowerCase().includes(needle)
        )
    }
  }
}
