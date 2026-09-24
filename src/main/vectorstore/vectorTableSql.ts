/**
 * 向量表的 SQL 语句拼装。
 *
 * vec0 的语句里表名是 SQL 标识符,而 sqlite 只支持参数化值 —— 标识符只能拼进语句
 * 文本。拼装因此全部收敛在这里,并统一过 safeIdentifier() 白名单;调用方传进来的是
 * vec_metadata 里记录的、或由 notebook id 生成的名字。
 *
 * 向量表按 notebook 拆分,宽度在创建时固定,所以这里的语句里没有 notebook_id 过滤。
 */

const SAFE_SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/** 校验 SQL 标识符,不让任意文本拼进语句。 */
export function safeIdentifier(identifier: string): string {
  if (!SAFE_SQL_IDENTIFIER.test(identifier)) {
    throw new Error(
      `[VectorTableSql] Refusing to interpolate an unsafe SQL identifier: ${identifier}`
    )
  }
  return identifier
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',')
}

export function createVectorTableSql(tableName: string, dimensions: number): string {
  return (
    'CREATE VIRTUAL TABLE ' +
    safeIdentifier(tableName) +
    ' USING vec0(embedding_id TEXT PRIMARY KEY, chunk_id TEXT, embedding FLOAT[' +
    dimensions +
    '] distance_metric=cosine)'
  )
}

export function dropVectorTableSql(tableName: string): string {
  return 'DROP TABLE IF EXISTS ' + safeIdentifier(tableName)
}

/** 把一个 notebook 的向量从一个表搬到另一个表(用于迁移旧版全局表)。 */
export function copyVectorsSql(targetTable: string, sourceTable: string): string {
  return (
    'INSERT INTO ' +
    safeIdentifier(targetTable) +
    ' (embedding_id, chunk_id, embedding) SELECT embedding_id, chunk_id, embedding FROM ' +
    safeIdentifier(sourceTable) +
    ' WHERE notebook_id = ?'
  )
}

export function upsertVectorsSql(tableName: string): string {
  return (
    'INSERT OR REPLACE INTO ' +
    safeIdentifier(tableName) +
    ' (embedding_id, chunk_id, embedding) VALUES (?, ?, ?)'
  )
}

export function deleteVectorsByEmbeddingIdsSql(tableName: string, count: number): string {
  return (
    'DELETE FROM ' +
    safeIdentifier(tableName) +
    ' WHERE embedding_id IN (' +
    placeholders(count) +
    ')'
  )
}

export function deleteVectorsByChunkIdsSql(tableName: string, count: number): string {
  return (
    'DELETE FROM ' + safeIdentifier(tableName) + ' WHERE chunk_id IN (' + placeholders(count) + ')'
  )
}

export function knnQuerySql(tableName: string): string {
  return (
    'SELECT embedding_id, chunk_id, distance FROM ' +
    safeIdentifier(tableName) +
    ' WHERE embedding MATCH ? AND k = ? ORDER BY distance ASC'
  )
}

export function clearVectorsSql(tableName: string): string {
  return 'DELETE FROM ' + safeIdentifier(tableName)
}

export function countVectorsSql(tableName: string): string {
  return 'SELECT COUNT(*) as count FROM ' + safeIdentifier(tableName)
}
