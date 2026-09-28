import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { buildMcpServer, MCP_TOOL_NAMES } from '../src/main/mcp/server.ts'
import type { McpRuntime } from '../src/main/mcp/runtime.ts'

/**
 * The MCP surface (#80).
 *
 * These drive the real server over the SDK's in-memory transport, so what is
 * verified is the protocol dispatch and the registered tool surface — not a
 * mocked handler call. The runtime is a stub, which is the point of the
 * `McpRuntime` seam.
 */

const runtime: McpRuntime = {
  listNotebooks: async () => [{ id: 'nb_1', title: 'Papers', sourceCount: 2, noteCount: 1 }],
  searchNotebook: async () => ({
    strategy: 'dense',
    evidence: [
      {
        documentId: 'doc_1',
        documentTitle: 'Attention Is All You Need',
        page: 7,
        blockId: 'blk_1',
        startOffset: 100,
        endOffset: 120,
        quote: 'self-attention connects all positions',
        score: 0.9
      }
    ]
  }),
  getSource: async (documentId) =>
    documentId === 'doc_1'
      ? {
          documentId: 'doc_1',
          title: 'Attention Is All You Need',
          type: 'file',
          status: 'indexed',
          chunkCount: 3,
          outline: [{ blockId: 'blk_1', kind: 'paragraph', page: 7, level: null, text: '…' }]
        }
      : null,
  readDocument: async (documentId, page) => ({
    documentId,
    title: 'Attention Is All You Need',
    ...(page !== undefined ? { page } : {}),
    text: 'the canonical text',
    truncated: false
  }),
  searchNotes: async () => [{ id: 'note_1', title: 'Note', content: 'hello world' }]
}

async function connected(): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = buildMcpServer(runtime, '0.0.0-test')
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'knownote-test', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return {
    client,
    close: async () => {
      await client.close()
      await server.close()
    }
  }
}

const textOf = (result: unknown): unknown => {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content
  const first = content[0]
  return JSON.parse(first.text ?? '')
}

test('the tool list is exactly the read-only surface, and nothing else', async () => {
  const { client, close } = await connected()

  const listed = await client.listTools()
  const names: string[] = listed.tools.map((tool) => tool.name).sort()

  // Exactly the five application tools. A write tool, or `server/discover`
  // registered as a tool, would fail here — and the ADR requires both to be absent.
  // The `includes` check runs first: `assert.deepEqual` is an assertion signature, so
  // it narrows `names` to the expected tuple's element union.
  assert.equal(names.includes('server/discover'), false)
  assert.deepEqual(names, [...MCP_TOOL_NAMES].sort())

  // Every tool declares itself read-only.
  for (const tool of listed.tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} is not marked read-only`)
  }

  await close()
})

test('list_notebooks returns the runtime payload', async () => {
  const { client, close } = await connected()
  const result = await client.callTool({ name: 'list_notebooks', arguments: {} })
  assert.deepEqual(textOf(result), [{ id: 'nb_1', title: 'Papers', sourceCount: 2, noteCount: 1 }])
  await close()
})

test('search_notebook returns evidence with provenance, not bare text', async () => {
  const { client, close } = await connected()
  const result = await client.callTool({
    name: 'search_notebook',
    arguments: { notebook_id: 'nb_1', query: 'attention', top_k: 3 }
  })

  const parsed = textOf(result) as {
    strategy: string
    evidence: Array<{ documentId: string; page?: number; blockId?: string; quote: string }>
  }

  assert.equal(parsed.strategy, 'dense')
  assert.equal(parsed.evidence[0].documentId, 'doc_1')
  assert.equal(parsed.evidence[0].page, 7)
  assert.equal(parsed.evidence[0].blockId, 'blk_1')
  assert.match(parsed.evidence[0].quote, /self-attention/)

  await close()
})

test('read_document passes an optional page through', async () => {
  const { client, close } = await connected()

  const whole = textOf(
    await client.callTool({ name: 'read_document', arguments: { document_id: 'doc_1' } })
  ) as {
    page?: number
  }
  assert.equal(whole.page, undefined)

  const scoped = textOf(
    await client.callTool({ name: 'read_document', arguments: { document_id: 'doc_1', page: 7 } })
  ) as { page?: number }
  assert.equal(scoped.page, 7)

  await close()
})

test('a missing source is returned as null, not as an error', async () => {
  const { client, close } = await connected()
  const result = await client.callTool({
    name: 'get_source',
    arguments: { document_id: 'doc_missing' }
  })
  assert.equal(textOf(result), null)
  await close()
})

test('search_notebook rejects top_k above 50 at the schema boundary', async () => {
  const { client, close } = await connected()
  const result = await client.callTool({
    name: 'search_notebook',
    arguments: { notebook_id: 'nb_1', query: 'x', top_k: 500 }
  })
  assert.equal((result as { isError?: boolean }).isError, true)
  await close()
})
