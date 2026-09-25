import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  requestAppendExcerpt,
  subscribeAppendExcerpt
} from '../src/renderer/src/components/notebook/note/appendExcerptCommand.ts'

/**
 * 追加命令是模块级单例状态，所以每个用例用**独立的 noteId**，避免上一条没人消费的请求
 * 漏进下一个用例。这里钉的是它存在的理由：命令只投给目标笔记，不能投给「当时恰好在场的
 * 那个编辑器」。
 */

const collected = (): { markdown: string[] } => ({ markdown: [] })

test('a request reaches the subscriber for the same note', () => {
  const seen = collected()
  const off = subscribeAppendExcerpt('note_a1', (markdown) => seen.markdown.push(markdown))

  requestAppendExcerpt('note_a1', '> excerpt')

  assert.deepEqual(seen.markdown, ['> excerpt'])
  off()
})

test('a request is held for its target when nothing is subscribed yet', () => {
  requestAppendExcerpt('note_a2', '> queued')

  const seen = collected()
  const off = subscribeAppendExcerpt('note_a2', (markdown) => seen.markdown.push(markdown))

  assert.deepEqual(seen.markdown, ['> queued'])
  off()
})

test('a request is delivered exactly once, not again for a later subscriber', () => {
  requestAppendExcerpt('note_a3', '> once')

  const first = collected()
  const offFirst = subscribeAppendExcerpt('note_a3', (m) => first.markdown.push(m))
  offFirst()

  const second = collected()
  const offSecond = subscribeAppendExcerpt('note_a3', (m) => second.markdown.push(m))
  offSecond()

  assert.deepEqual(first.markdown, ['> once'])
  assert.deepEqual(second.markdown, [])
})

/**
 * 这个用例就是带 `noteId` 的全部理由：A 的摘录绝不能被 B 的编辑器消费。
 * 没有目标匹配的话，这里会以「B 拿到了本该属于 A 的摘录」失败。
 */
test('a request for one note is never delivered to the editor of another', () => {
  const seenByB = collected()
  const offB = subscribeAppendExcerpt('note_b4', (markdown) => seenByB.markdown.push(markdown))

  requestAppendExcerpt('note_a4', '> belongs to A')

  assert.deepEqual(seenByB.markdown, [], 'B must not receive the excerpt that belongs to A')

  // 目标笔记的编辑器随后挂载，它才是应该拿到这条请求的人。
  const seenByA = collected()
  const offA = subscribeAppendExcerpt('note_a4', (markdown) => seenByA.markdown.push(markdown))

  assert.deepEqual(seenByA.markdown, ['> belongs to A'])
  offA()
  offB()
})

test('a request sent while another note is mounted waits for its own target', () => {
  const seenByB = collected()
  const offB = subscribeAppendExcerpt('note_b5', (markdown) => seenByB.markdown.push(markdown))

  // B 在场，但请求是发给 A 的。
  requestAppendExcerpt('note_a5', '> for A')
  assert.deepEqual(seenByB.markdown, [])

  // B 卸载，A 挂载。
  offB()
  const seenByA = collected()
  const offA = subscribeAppendExcerpt('note_a5', (markdown) => seenByA.markdown.push(markdown))

  assert.deepEqual(seenByA.markdown, ['> for A'])
  offA()
})

test('unsubscribing stops delivery to that subscriber', () => {
  const seen = collected()
  const off = subscribeAppendExcerpt('note_a6', (markdown) => seen.markdown.push(markdown))

  off()
  requestAppendExcerpt('note_a6', '> after unmount')

  assert.deepEqual(seen.markdown, [])
})

test('an unmounting editor does not clear the subscription that replaced it', () => {
  const first = collected()
  const offFirst = subscribeAppendExcerpt('note_a7', (m) => first.markdown.push(m))

  const second = collected()
  const offSecond = subscribeAppendExcerpt('note_a7', (m) => second.markdown.push(m))

  // 旧订阅者的清理函数晚于新订阅者执行时，不能把新订阅者一起注销掉。
  offFirst()
  requestAppendExcerpt('note_a7', '> still delivered')

  assert.deepEqual(second.markdown, ['> still delivered'])
  assert.deepEqual(first.markdown, [])
  offSecond()
})
