import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { McpRuntime } from './runtime'

/**
 * The MCP tool surface (#80).
 *
 * Read-only, and that is the point: this surface is granted to an agent that is
 * itself acting on untrusted document text, so no tool writes, spends money,
 * calls a model, or reports a filesystem path.
 *
 * `server/discover` is not here on purpose — it is a protocol RPC owned by the
 * SDK's `serveStdio` entry, not a tool, and must not appear in `tools/list`.
 */

/** The tools this server registers, in a stable order. */
export const MCP_TOOL_NAMES = [
  'list_notebooks',
  'search_notebook',
  'get_source',
  'read_document',
  'search_notes'
] as const

const textResult = (value: unknown): { content: Array<{ type: 'text'; text: string }> } => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }]
})

/**
 * Build one server instance.
 *
 * `serveStdio` may call the factory twice for a single connection (an optimistic
 * modern probe, then a legacy instance when the probe falls back), so this must
 * stay cheap and side-effect-free. It closes over an already-constructed
 * runtime and opens nothing.
 */
export function buildMcpServer(runtime: McpRuntime, version: string): McpServer {
  const server = new McpServer({ name: 'knownote', version })

  server.registerTool(
    'list_notebooks',
    {
      description:
        'List the notebooks in this KnowNote library, with source and note counts. Call this first to get a notebook_id.',
      annotations: { readOnlyHint: true },
      inputSchema: z.object({})
    },
    async () => textResult(await runtime.listNotebooks())
  )

  server.registerTool(
    'search_notebook',
    {
      description:
        'Search one notebook and return matching passages WITH provenance (document id, page, character offsets). Prefer this over guessing: the provenance is what lets a claim be checked.',
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        notebook_id: z.string().min(1),
        query: z.string().min(1).max(1000),
        top_k: z.number().int().min(1).max(50).default(5)
      })
    },
    async ({ notebook_id, query, top_k }) =>
      textResult(await runtime.searchNotebook(notebook_id, query, top_k))
  )

  server.registerTool(
    'get_source',
    {
      description:
        'Get one source (document) by id: its metadata and a structure outline of blocks (page, heading level, text).',
      annotations: { readOnlyHint: true },
      inputSchema: z.object({ document_id: z.string().min(1) })
    },
    async ({ document_id }) => textResult(await runtime.getSource(document_id))
  )

  server.registerTool(
    'read_document',
    {
      description:
        'Read a source as canonical text. Pass page to read one page; otherwise a bounded window of the document is returned and `truncated` says so.',
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        document_id: z.string().min(1),
        page: z.number().int().min(1).optional()
      })
    },
    async ({ document_id, page }) => textResult(await runtime.readDocument(document_id, page))
  )

  server.registerTool(
    'search_notes',
    {
      description: 'Search the notes of one notebook by substring (case-insensitive).',
      annotations: { readOnlyHint: true },
      inputSchema: z.object({
        notebook_id: z.string().min(1),
        query: z.string().min(1).max(1000)
      })
    },
    async ({ notebook_id, query }) => textResult(await runtime.searchNotes(notebook_id, query))
  )

  return server
}
