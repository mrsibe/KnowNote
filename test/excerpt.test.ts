import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  appendExcerptMarkdown,
  buildExcerptMarkdown,
  escapeExcerptMarkdown,
  excerptAnchorFromHref,
  excerptSourceHref,
  isExcerptSourceHref,
  quoteMarkdown
} from '../src/shared/utils/excerpt.ts'
import { selectionToSourceAnchor } from '../src/shared/utils/sourceAnchor.ts'
import type { ReaderSelection, SourceAnchor } from '../src/shared/types/source.ts'

/**
 * #73 的摘录必须活在笔记正文（markdown）里，而不是 Tiptap 节点属性里 —— `NoteEditor`
 * 每次改动都会把文档序列化成 markdown 落库。这里钉住的就是那条往返：写进笔记的字符串
 * 能不能把定位一字不差地读回来，以及读不回来的时候是不是安静地退化成普通文本。
 */

const anchor = (location: SourceAnchor['location']): SourceAnchor => ({
  documentId: location.documentId,
  location
})

const selection = (over: Partial<ReaderSelection> = {}): ReaderSelection => ({
  documentId: 'doc_1',
  page: 5,
  blockId: 'block_7',
  startOffset: 1832,
  endOffset: 1947,
  text: 'the retrieved passage',
  ...over
})

/** 从生成的摘录里取回被写进 markdown 的那个 href —— 也就是读者点击时手上真正有的东西。 */
const hrefOf = (markdown: string): string => {
  const match = /\]\(([^)]*)\)\s*$/.exec(markdown)
  assert.ok(match, `no link destination at the end of: ${markdown}`)
  return match[1]
}

test('an excerpt round-trips its anchor through the markdown it writes', () => {
  const original = selectionToSourceAnchor(selection({ page: 5 }))
  const markdown = buildExcerptMarkdown({
    text: 'the retrieved passage',
    anchor: original,
    label: 'Attention Is All You Need · p.5'
  })

  assert.ok(markdown)
  assert.deepEqual(excerptAnchorFromHref(hrefOf(markdown)), original)
})

test('a document-only anchor round-trips, page and offsets omitted', () => {
  const original = anchor({ documentId: 'doc_1' })
  const markdown = buildExcerptMarkdown({ text: 'quoted', anchor: original, label: 'A source' })

  assert.ok(markdown)
  assert.deepEqual(excerptAnchorFromHref(hrefOf(markdown)), original)
})

test('an excerpt with no body is refused rather than written as an empty quote', () => {
  const anchorIn = anchor({ documentId: 'doc_1', page: 2 })

  assert.equal(buildExcerptMarkdown({ text: '', anchor: anchorIn, label: 'x' }), null)
  assert.equal(buildExcerptMarkdown({ text: '   \n\t\n ', anchor: anchorIn, label: 'x' }), null)
})

test('the quote keeps blank lines inside one blockquote, not two', () => {
  const quoted = quoteMarkdown('first paragraph\n\nsecond paragraph')
  const lines = quoted.split('\n')

  assert.deepEqual(lines, ['> first paragraph', '>', '> second paragraph'])
  // 每一行都带 `>`：任何一行漏掉都会把引用块提前结束。
  for (const line of lines) assert.ok(line.startsWith('>'), line)
})

test('trailing whitespace is dropped so quoted text never gains a markdown hard break', () => {
  assert.equal(
    quoteMarkdown('a line with trailing spaces   \nnext'),
    '> a line with trailing spaces\n> next'
  )
})

test('windows line endings are normalised before quoting', () => {
  assert.equal(quoteMarkdown('one\r\ntwo\rthree'), '> one\n> two\n> three')
})

test('brackets in the label are escaped so the link cannot be broken by a title', () => {
  const markdown = buildExcerptMarkdown({
    text: 'quoted',
    anchor: anchor({ documentId: 'doc_1', page: 1 }),
    label: 'A [draft] \\ study'
  })

  assert.ok(markdown)
  assert.ok(markdown.includes('[A \\[draft\\] \\\\ study]('), markdown)
})

test('an href survives identifiers that would otherwise break a markdown link', () => {
  const nasty = anchor({
    documentId: 'doc (1) [x] a b',
    blockId: 'block/a(b) c',
    page: 3
  })
  const href = excerptSourceHref(nasty)

  // markdown 链接目标在 `(` `)` 处结束，空白也会截断它。
  assert.equal(/[()\s<>]/.test(href), false, href)
  assert.deepEqual(excerptAnchorFromHref(href), nasty)
})

test('the fragment survives being resolved against a document base', () => {
  const original = anchor({ documentId: 'doc_1', page: 5, startOffset: 10, endOffset: 20 })
  const resolved = `file:///app/index.html${excerptSourceHref(original)}`

  assert.deepEqual(excerptAnchorFromHref(resolved), original)
})

test('a href that is not an excerpt anchor is not mistaken for one', () => {
  const cases = [
    null,
    undefined,
    '',
    '#',
    'https://example.com/#know-note-source',
    '#know-note-source',
    '#know-note-source?',
    '#other?doc=doc_1&page=5',
    'doc=doc_1&page=5'
  ]

  for (const href of cases) {
    assert.equal(excerptAnchorFromHref(href), null, String(href))
  }
})

test('a malformed position inside an excerpt link degrades field by field', () => {
  const href = '#know-note-source?doc=doc_1&page=abc&start=100&end=200'

  assert.deepEqual(
    excerptAnchorFromHref(href),
    anchor({ documentId: 'doc_1', startOffset: 100, endOffset: 200 })
  )
})

/**
 * 点击派发靠这个谓词把三种情况分开：摘录链接、外部链接、其它。它不能等同于
 * 「`excerptAnchorFromHref` 有结果」—— 一条 `#know-note-source?` 后面没有 `doc` 的链接仍然是
 * 摘录链接（应该就地拒绝跳转），而不是一条可以被交给浏览器打开的外部链接。
 */

test('an excerpt link is recognised even when its position does not parse', () => {
  // 有标记、但没有可用的定位。
  assert.equal(isExcerptSourceHref('#know-note-source?page=5'), true)
  assert.equal(excerptAnchorFromHref('#know-note-source?page=5'), null)
})

test('a link that is not an excerpt link is never mistaken for one', () => {
  const cases = [
    null,
    undefined,
    '',
    '#',
    '#know-note-source',
    '#other?doc=doc_1',
    'https://example.com/',
    'https://example.com/#know-note-source',
    'https://example.com/?doc=doc_1&page=5'
  ]

  for (const href of cases) assert.equal(isExcerptSourceHref(href), false, String(href))
})

test('whenever an anchor parses, its href is also recognised as an excerpt link', () => {
  const hrefs = [
    excerptSourceHref(anchor({ documentId: 'doc_1' })),
    excerptSourceHref(anchor({ documentId: 'doc_1', page: 5, blockId: 'b1' })),
    excerptSourceHref(anchor({ documentId: 'doc (1)', blockId: 'b/a b' })),
    '#know-note-source?doc=doc_1',
    '#know-note-source?doc=doc_1&page=abc'
  ]

  for (const href of hrefs) {
    if (excerptAnchorFromHref(href) !== null) {
      assert.equal(isExcerptSourceHref(href), true, href)
    }
  }
})

/**
 * #73：摘录接进正文末尾。接缝必须正好是一个空行，且两个退化情况不能制造多余的空白。
 * 组件里不该出现手拼的 `'\n\n'`。
 */

test('an excerpt is appended after a blank line', () => {
  const current = '原来的笔记内容。'
  const excerpt = buildExcerptMarkdown({
    text: 'Attention mechanisms allow the model to weigh tokens.',
    anchor: anchor({ documentId: 'doc_1', page: 5, startOffset: 10, endOffset: 58 }),
    label: 'Attention Is All You Need · p.5'
  })
  assert.ok(excerpt)

  assert.equal(
    appendExcerptMarkdown(current, excerpt),
    '原来的笔记内容。\n\n' +
      '> Attention mechanisms allow the model to weigh tokens.\n\n' +
      '[Attention Is All You Need · p.5](#know-note-source?doc=doc_1&page=5&start=10&end=58)'
  )
})

test('appending uses exactly one blank line, whatever whitespace the note ended with', () => {
  for (const current of ['body', 'body\n', 'body\n\n', 'body\n\n\n', 'body  \n']) {
    assert.equal(appendExcerptMarkdown(current, '> q'), 'body\n\n> q', JSON.stringify(current))
  }
})

test('an empty note receives the excerpt without a leading blank line', () => {
  for (const current of ['', '   ', '\n', '\n\n']) {
    assert.equal(appendExcerptMarkdown(current, '> q'), '> q', JSON.stringify(current))
  }
})

test('an empty excerpt leaves the note byte-for-byte unchanged', () => {
  for (const excerpt of ['', '   ', '\n']) {
    assert.equal(appendExcerptMarkdown('body\n', excerpt), 'body\n', JSON.stringify(excerpt))
  }
})

test('appending is idempotent in structure: two appends give two separated blocks', () => {
  const once = appendExcerptMarkdown('body', '> q1')
  const twice = appendExcerptMarkdown(once, '> q2')

  assert.equal(twice, 'body\n\n> q1\n\n> q2')
})

/**
 * 摘录的原文是**用户选中的字**，不是用户写的 Markdown。一段从 PDF 或网页上选下来的文字
 * 完全可能长得像 Markdown（`# 标题`、`- 列表`、`[foo](bar)`、`<b>`），它必须原样显示。
 *
 * 这些用例有一个共同点：不断言「序列化形式好看」，只断言**它不会被重新解释**。真实的
 * Tiptap 往返（含多行组合、表格、缩进、原始 HTML）已在提交前单独用一次性 harness 验过
 * 42 条，全部保持可见文本与结构；这里钉住的是那条规则本身，让它不会在以后被改坏。
 */

test('line-start markers are escaped so quoted text cannot become structure', () => {
  assert.equal(escapeExcerptMarkdown('# not a heading'), '\\# not a heading')
  assert.equal(escapeExcerptMarkdown('> not a quote'), '\\> not a quote')
  assert.equal(escapeExcerptMarkdown('- not a list'), '\\- not a list')
  assert.equal(escapeExcerptMarkdown('+ not a list'), '\\+ not a list')
  assert.equal(escapeExcerptMarkdown('* not a list'), '\\* not a list')
  assert.equal(escapeExcerptMarkdown('1. not ordered'), '1\\. not ordered')
  assert.equal(escapeExcerptMarkdown('1) not ordered'), '1\\) not ordered')
  assert.equal(escapeExcerptMarkdown('---'), '\\---')
  assert.equal(escapeExcerptMarkdown('==='), '\\===')
})

test('an escaped line-start marker keeps its leading indentation', () => {
  assert.equal(escapeExcerptMarkdown('  # deeper'), '  \\# deeper')
})

/** 去掉转义用的反斜杠，得到「渲染出来看到的字」。转义必须是可逆的。 */
const visibleTextOf = (escaped: string): string => escaped.replace(/\\([\s\S])/g, '$1')

/** 把转义对连字符一起丢掉：剩下的就是会被 Markdown 当成语法的地方。 */
const bareSyntaxOf = (escaped: string): string => escaped.replace(/\\[\s\S]/g, '')

test('inline markdown syntax is escaped so it cannot become a mark', () => {
  const source = '*b* __c__ ~~d~~ `e` [f](g) ![h](i) <b>j</b> &k; |'
  const escaped = escapeExcerptMarkdown(source)

  // 转义结果里不该剩下任何「裸的」有含义字符 —— 剩下的每一个都会变成结构或实体。
  const bare = bareSyntaxOf(escaped)
  for (const char of ['*', '_', '~', '`', '[', ']', '<', '&', '|']) {
    assert.equal(bare.includes(char), false, `${char} left unescaped in ${bare}`)
  }

  // 反过来的那一半同样重要：转义不能改变可见文本。
  assert.equal(visibleTextOf(escaped), source)
})

test('a backslash in the source survives as a visible backslash', () => {
  const source = 'a \\* b'

  assert.equal(visibleTextOf(escapeExcerptMarkdown(source)), source)
})

test('escaping never changes the visible text it is given', () => {
  const sources = [
    '# Attention',
    '- bullet',
    'plain sentence',
    '[ref]: https://example.com',
    'a | b',
    '_underscores_ and ~tildes~',
    '1. numbered',
    'trailing # hash',
    '100% *sure*'
  ]

  for (const source of sources) {
    assert.equal(visibleTextOf(escapeExcerptMarkdown(source)), source, source)
  }
})

test('leading indentation is clamped so a line cannot become an indented code block', () => {
  // 四个空格（或一个制表符）在 Markdown 里是代码块，而它是唯一一种反斜杠解决不了的情况。
  assert.equal(escapeExcerptMarkdown('    four spaces'), '   four spaces')
  assert.equal(escapeExcerptMarkdown('        eight spaces'), '   eight spaces')
  assert.equal(escapeExcerptMarkdown('\tone tab'), '   one tab')
  assert.equal(escapeExcerptMarkdown(' \tmixed'), '   mixed')
})

test('indentation up to three spaces is left alone', () => {
  assert.equal(escapeExcerptMarkdown('   three spaces'), '   three spaces')
  assert.equal(escapeExcerptMarkdown('  two spaces'), '  two spaces')
})

test('escaping is applied per line, not to the whole block', () => {
  assert.equal(escapeExcerptMarkdown('# one\n- two\nplain three'), '\\# one\n\\- two\nplain three')
})

test('quoteMarkdown escapes before prefixing, so its own marker is never escaped', () => {
  assert.equal(quoteMarkdown('> nested'), '> \\> nested')
  assert.equal(quoteMarkdown('# Attention'), '> \\# Attention')
  // 每一行都带 `>`，包括被转义的那一行 —— 引用块不会被转义内容拆开。
  for (const line of quoteMarkdown('# one\n\n- two').split('\n')) {
    assert.ok(line.startsWith('>'), line)
  }
})

test('a markdown-looking selection is not rewritten into structure in the excerpt', () => {
  const markdown = buildExcerptMarkdown({
    text: '# Attention\n*not emphasis*\n[not a link](https://example.com)',
    anchor: anchor({ documentId: 'doc_1', page: 2 }),
    label: 'Src · p.2'
  })

  assert.ok(markdown)
  assert.ok(markdown.includes('> \\# Attention'), markdown)
  assert.ok(markdown.includes('> \\*not emphasis\\*'), markdown)
  assert.ok(markdown.includes('> \\[not a link\\](https://example.com)'), markdown)
})

test('a plain-text selection is left untouched by escaping', () => {
  const body = 'Just a normal sentence.\nAnd a second line.'

  assert.equal(escapeExcerptMarkdown(body), body)
  assert.equal(quoteMarkdown(body), '> Just a normal sentence.\n> And a second line.')
})
