import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  safeIdentifier,
  createVectorTableSql,
  dropVectorTableSql,
  copyVectorsSql,
  upsertVectorsSql,
  deleteVectorsByChunkIdsSql,
  knnQuerySql,
  countVectorsSql
} from '../src/main/vectorstore/vectorTableSql.ts'

/**
 * vec0 的表名是 SQL 标识符,不能作为绑定参数,只能拼进语句。这个测试盯住两件事:
 * 白名单真的挡住了注入,以及拼出来的语句确实按 notebook 分表(不再有 notebook_id 过滤)。
 */

test('safeIdentifier 接受 vec0 表名', () => {
  assert.equal(
    safeIdentifier('vec_notebook_1767000000000_abc123'),
    'vec_notebook_1767000000000_abc123'
  )
  assert.equal(safeIdentifier('vec_embeddings'), 'vec_embeddings')
})

test('safeIdentifier 拒绝注入尝试', () => {
  const rejected = [
    'vec_x; DROP TABLE notebooks',
    'vec_x WHERE 1=1',
    'vec"x',
    "vec'x",
    'vec_x--',
    '1vec_x',
    '',
    'vec x',
    'vec_x)'
  ]

  for (const identifier of rejected) {
    assert.throws(
      () => safeIdentifier(identifier),
      /unsafe SQL identifier/,
      `expected ${JSON.stringify(identifier)} to be rejected`
    )
  }
})

test('createVectorTableSql 把宽度写进 vec0 声明', () => {
  const sql = createVectorTableSql('vec_nb1', 768)

  assert.match(sql, /^CREATE VIRTUAL TABLE vec_nb1 USING vec0\(/)
  assert.match(sql, /embedding FLOAT\[768\] distance_metric=cosine/)
})

test('createVectorTableSql 拒绝非法表名', () => {
  assert.throws(
    () => createVectorTableSql('vec_nb1; DROP TABLE vec_nb1', 768),
    /unsafe SQL identifier/
  )
})

test('dropVectorTableSql 幂等', () => {
  assert.equal(dropVectorTableSql('vec_nb1'), 'DROP TABLE IF EXISTS vec_nb1')
})

test('copyVectorsSql 只搬一个 notebook 的行', () => {
  const sql = copyVectorsSql('vec_nb1', 'vec_embeddings')

  assert.match(sql, /INSERT INTO vec_nb1 \(embedding_id, chunk_id, embedding\)/)
  assert.match(sql, /FROM vec_embeddings WHERE notebook_id = \?$/)
})

test('单表内的语句不再按 notebook_id 过滤', () => {
  for (const sql of [
    upsertVectorsSql('vec_nb1'),
    deleteVectorsByChunkIdsSql('vec_nb1', 2),
    knnQuerySql('vec_nb1'),
    countVectorsSql('vec_nb1')
  ]) {
    assert.doesNotMatch(sql, /notebook_id/)
    assert.match(sql, /vec_nb1/)
  }
})

test('按 chunk 删除时占位符数量与 id 数量一致', () => {
  assert.match(deleteVectorsByChunkIdsSql('vec_nb1', 3), /chunk_id IN \(\?,\?,\?\)/)
})

test('KNN 查询按距离排序', () => {
  const sql = knnQuerySql('vec_nb1')

  assert.match(sql, /WHERE embedding MATCH \? AND k = \?/)
  assert.match(sql, /ORDER BY distance ASC$/)
})
