import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

/**
 * 库来源复用里「不调用 embedding」「只解除挂载」「不 unlink」这些约束。
 *
 * 这些行为落在 Electron 的 KnowledgeService / db/queries 上，node test 里没法实例化
 * 它们（会 import electron），所以按仓库里 architectureBoundary.test.ts 的既有做法，
 * 扫描真实源码把方向固定下来。真正能跑的行为在 librarySourceReuse.test.ts 里。
 */

const KNOWLEDGE = 'src/main/services/KnowledgeService.ts'
const LIBRARY_MODULE = 'src/main/services/librarySources.ts'
const QUERIES = 'src/main/db/queries.ts'

/** Parse the actual method body, not an object-shaped return type. */
function methodBody(source: string, signature: string): string {
  const name = signature.match(/(\w+)\($/)?.[1]
  assert.ok(name, `invalid signature: ${signature}`)
  const file = ts.createSourceFile('guard.ts', source, ts.ScriptTarget.Latest, true)
  let body: string | undefined
  const visit = (node: ts.Node): void => {
    if (
      (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) &&
      node.name?.getText(file) === name &&
      node.body
    ) {
      body = node.body.getText(file)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(body, `method body not found: ${signature}`)
  return body
}

test('the embedding guard inspects code after an object-shaped Promise return type', () => {
  const body = methodBody(
    'class Service { async attachLibrarySource(): Promise<{ indexed: boolean }> { await this.embedBatch(); } }',
    'async attachLibrarySource('
  )
  assert.match(body, /this\.embedBatch\(\)/)
  assert.doesNotMatch(body, /indexed: boolean/)
})

test('attaching a library source never reaches for the embedding provider', () => {
  const knowledge = readFileSync(KNOWLEDGE, 'utf8')
  const attach = methodBody(knowledge, 'async attachLibrarySource(')
  for (const forbidden of ['embedBatch', 'embedDocumentChunks', 'indexDocument']) {
    assert.equal(
      attach.includes(forbidden),
      false,
      `attachLibrarySource must not call ${forbidden}; reuse copies vectors, it never embeds`
    )
  }

  const module = readFileSync(LIBRARY_MODULE, 'utf8')
  assert.equal(module.includes('embedBatch'), false)
  assert.equal(module.includes('embedDocumentChunks'), false)
  assert.equal(
    module.includes('EmbeddingService'),
    false,
    'the reuse boundary must not import an embedding provider at all'
  )
})

test('deleting a document is detach-only: it never unlinks the library file', () => {
  const knowledge = readFileSync(KNOWLEDGE, 'utf8')
  const detach = methodBody(knowledge, 'async deleteDocument(')
  assert.equal(detach.includes('deleteLocalFile('), false, 'deleteDocument unlinked a library file')
  assert.equal(detach.includes('unlink('), false)
  assert.match(detach, /db\.delete\(documents\)/)
})

test('deleting a notebook never unlinks files owned by a library source', () => {
  const queries = readFileSync(QUERIES, 'utf8')
  const deleteNotebook = methodBody(queries, 'export async function deleteNotebook(')
  assert.equal(deleteNotebook.includes('unlink('), false)
  assert.equal(deleteNotebook.includes('localFilePath'), false)
})

test('only an explicit, confirmed library deletion unlinks the file', () => {
  const knowledge = readFileSync(KNOWLEDGE, 'utf8')
  const deleteSource = methodBody(knowledge, 'async deleteLibrarySource(')
  assert.match(deleteSource, /this\.deleteLocalFile\(/)
  assert.match(deleteSource, /deleteLibrarySourceRecord\(/)
})

test('file refresh is copy-on-write: new snapshot id and an owner-named file', () => {
  const knowledge = readFileSync(KNOWLEDGE, 'utf8')

  const refresh = methodBody(knowledge, 'async refreshDocumentFromFile(')
  assert.match(refresh, /refresh: true/)

  const ingest = methodBody(knowledge, 'private async ingestFile(')
  assert.match(ingest, /isNewSnapshot/, 'ingestFile must allocate a fresh snapshot on refresh')
  assert.match(
    ingest,
    /planSnapshotWrite\(/,
    'the snapshot write plan must come from the shared rule, so a shared/parsed snapshot is never mutated'
  )
  assert.match(ingest, /countMemberships\(/)
  // 解析完成之后（parseFile）、索引之前（indexDocument）落 snapshot。
  const insertAt = ingest.indexOf('insertLibrarySnapshot(')
  const indexAt = ingest.lastIndexOf('await this.indexDocument(')
  assert.ok(insertAt > ingest.indexOf('parseFile('), 'the snapshot must be created after parsing')
  assert.ok(insertAt < indexAt, 'the snapshot must exist before a successful index can be reused')

  const copy = methodBody(knowledge, 'private async copyFileToKnowledgeDir(')
  assert.match(
    copy,
    /\$\{ownerId\}\.\$\{extension\}/,
    'the local file is named by the snapshot id, so a refresh cannot overwrite a shared file'
  )
})
