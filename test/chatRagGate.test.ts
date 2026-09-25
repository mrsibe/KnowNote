import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * chat 的 RAG 开关，以及「没有远程 connection」这条日志的语义。
 *
 * `ConnectionManager.getEmbeddingClient()` 只认远程 embedding connection；内置本地模型
 * 是默认配置，它返回 null。以前 chat 用这个 null 当作「没有 embedding」的判据，于是默认
 * 配置下整条 RAG 被静默关掉 —— 回答无依据、无引用，而索引其实完全正常。
 */

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8')

test('the built-in local fallback is not logged as a warning', () => {
  const source = read('src/main/models/ConnectionManager.ts')

  assert.ok(
    !source.includes("'No embedding model configured'"),
    'the local-fallback path must not keep the old warning text'
  )
  assert.ok(
    source.includes('built-in local model'),
    'the log should say the built-in local model is being used'
  )
  assert.match(source, /Logger\.debug\(/)
})

test('chat RAG is gated on embedding availability, not on a remote connection', () => {
  const chat = read('src/main/ipc/chatHandlers.ts')

  // Match the call, not the bare name: the explanatory comment mentions it.
  assert.ok(
    !/connectionManager\.getEmbeddingClient\(/.test(chat),
    'getEmbeddingClient() is remote-only; using it as the gate disables RAG for local embeddings'
  )
  assert.ok(chat.includes('isEmbeddingAvailable'))

  const knowledge = read('src/main/services/KnowledgeService.ts')
  assert.ok(knowledge.includes('isEmbeddingAvailable'))
  assert.ok(
    knowledge.includes('embeddingService.isAvailable()'),
    'isEmbeddingAvailable() must delegate to the backend availability check'
  )
})
