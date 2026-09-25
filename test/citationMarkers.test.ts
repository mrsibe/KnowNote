import { test } from 'node:test'
import assert from 'node:assert/strict'
import remarkCitationMarkers, {
  parseCitationHref
} from '../src/renderer/src/components/notebook/chat/citationMarkers.ts'

/**
 * 回答正文里的 `[n]` 由 remark 插件变成 `#citation-n` 链接，再由 `CitationChip` 渲染。
 * 这里只钉解析：哪些文本会被转换、哪些绝不碰 —— 正文解析不能吃掉代码块，也不能把
 * 引用式链接 `[text][1]` 拆坏。
 */

interface TestNode {
  type: string
  value?: string
  url?: string
  children?: TestNode[]
}

const run = (children: TestNode[]): TestNode[] => {
  const tree: TestNode = { type: 'root', children }
  remarkCitationMarkers()(tree as never)
  return tree.children ?? []
}

const paragraph = (...children: TestNode[]): TestNode => ({
  type: 'paragraph',
  children
})

test('parseCitationHref only accepts citation hrefs', () => {
  assert.equal(parseCitationHref('#citation-1'), 1)
  assert.equal(parseCitationHref('#citation-42'), 42)
  assert.equal(parseCitationHref('#citation-0'), null)
  assert.equal(parseCitationHref('#citation-x'), null)
  assert.equal(parseCitationHref('#citation-'), null)
  assert.equal(parseCitationHref('https://example.com'), null)
  assert.equal(parseCitationHref(undefined), null)
})

test('a marker becomes a citation link and the rest stays text', () => {
  const [node] = run([paragraph({ type: 'text', value: 'See [1] here.' })])

  assert.deepEqual(node.children, [
    { type: 'text', value: 'See ' },
    { type: 'link', url: '#citation-1', children: [{ type: 'text', value: '[1]' }] },
    { type: 'text', value: ' here.' }
  ])
})

test('several markers in one paragraph all become links', () => {
  const [node] = run([paragraph({ type: 'text', value: '[1] and [2]' })])
  const links = (node.children ?? []).filter((child) => child.type === 'link')
  assert.deepEqual(
    links.map((link) => link.url),
    ['#citation-1', '#citation-2']
  )
})

test('inline code is never parsed for markers', () => {
  const [node] = run([
    paragraph({
      type: 'inlineCode',
      value: 'arr[1]'
    })
  ])

  assert.deepEqual(node.children, [{ type: 'inlineCode', value: 'arr[1]' }])
})

test('fenced code blocks are never parsed for markers', () => {
  const children = run([{ type: 'code', value: 'x = a[1]' }])
  assert.deepEqual(children, [{ type: 'code', value: 'x = a[1]' }])
})

test('an existing reference link is left alone', () => {
  const reference = {
    type: 'linkReference',
    url: undefined,
    children: [{ type: 'text', value: '[1]' }]
  }
  const [node] = run([paragraph(reference)])
  assert.deepEqual(node.children, [reference])
})

test('nested emphasis is walked, so a marker inside it is linked', () => {
  const [node] = run([
    paragraph({ type: 'emphasis', children: [{ type: 'text', value: 'really [3]' }] })
  ])

  assert.deepEqual(node.children, [
    {
      type: 'emphasis',
      children: [
        { type: 'text', value: 'really ' },
        { type: 'link', url: '#citation-3', children: [{ type: 'text', value: '[3]' }] }
      ]
    }
  ])
})

test('a parenthesised number that is not a marker stays text', () => {
  const [node] = run([paragraph({ type: 'text', value: 'see (1) and [12345]' })])
  assert.deepEqual(node.children, [{ type: 'text', value: 'see (1) and [12345]' }])
})
