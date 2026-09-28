import { join } from 'path'
import { app } from 'electron'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { closeDatabase, initDatabase, initVectorStore, runMigrations } from '../db'
import { ConnectionManager } from '../models/ConnectionManager'
import { EmbeddingService } from '../services/EmbeddingService'
import { KnowledgeService } from '../services/KnowledgeService'
import { createKnowledgeRuntime } from './runtime'
import { buildMcpServer } from './server'

export const MCP_FLAG = '--mcp'

export function isMcpRequested(argv: readonly string[] = process.argv): boolean {
  return argv.includes(MCP_FLAG)
}

/**
 * Serve the knowledge base over MCP on stdio (#80).
 *
 * The stdio transport **is** the protocol: the JSON-RPC frames and the process's
 * standard output are the same bytes. Anything the app logs to stdout would be
 * read by the client as a frame, and the database logs on init — so every console
 * method is redirected to stderr *before* anything else runs. This patches the
 * console methods, not `process.stdout`: the SDK writes to that stream directly.
 *
 * The runtime is built once here, outside the factory. `serveStdio` may call the
 * factory more than once for a single connection (an optimistic modern probe,
 * then a legacy instance when the probe falls back), so opening the database or
 * the index inside the factory would do it twice.
 *
 * Resolves when the client closes stdin, which is how a stdio server is supposed
 * to end.
 */
export async function runMcpServer(): Promise<void> {
  console.log = console.error
  console.info = console.error
  console.debug = console.error

  initDatabase()
  runMigrations()
  initVectorStore()

  const connectionManager = new ConnectionManager()
  const embeddingService = new EmbeddingService(connectionManager, {
    cacheDir: join(app.getPath('userData'), 'models')
  })
  const knowledgeService = new KnowledgeService(embeddingService)
  const runtime = createKnowledgeRuntime(knowledgeService)

  // Dual-era by default: `legacy` is left as the SDK's 'serve', so a 2025-era
  // `initialize` and a 2026-07-28 per-request envelope are both served by the same
  // factory — one tool surface, no second implementation.
  serveStdio(() => buildMcpServer(runtime, app.getVersion()))

  await new Promise<void>((resolve) => {
    process.stdin.once('end', resolve)
    process.stdin.once('close', resolve)
  })

  closeDatabase()
}
