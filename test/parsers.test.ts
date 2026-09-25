import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FileParserService } from '../src/main/services/FileParserService.ts'
import { PdfLoader } from '../src/main/services/loaders/PdfLoader.ts'
import { DocxLoader } from '../src/main/services/loaders/DocxLoader.ts'
import { MarkdownLoader } from '../src/main/services/loaders/MarkdownLoader.ts'
import { WebLoader } from '../src/main/services/loaders/WebLoader.ts'
import type { DocumentLoadResult, SectionInfo } from '../src/main/services/loaders/types.ts'

/**
 * Golden-file tests for the document loaders.
 *
 * `DocumentLoadResult.structure` is about to become load-bearing for provenance
 * (#66/#67) and nothing under `test/` exercised a loader before this file. These
 * tests parse the committed fixtures in `test/fixtures/` and assert the *shape*
 * of the result — page count, page boundaries, heading outlines, offset
 * arithmetic — rather than the extracted prose. A slightly different extraction
 * still passes; a loader that stops emitting `structure`, miscounts a page
 * boundary, or loses a heading level fails.
 *
 * Fixtures:
 *   multipage.pdf  three pages, one text run each (generated for this issue)
 *   sample.pdf     the existing single-page smoke fixture
 *   headings.docx  minimal OOXML with Heading1/Heading2 styles (generated)
 *   sample.docx    the existing fixture, deliberately heading-less
 *   sample.md      ATX headings: one h1 and two h2
 *   sample.html    the existing Readability smoke fixture
 */

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const fixture = (name: string): string => join(FIXTURES, name)

/** The committed outline each fixture is expected to produce. */
const DOCX_OUTLINE = [
  { level: 1, title: 'Overview' },
  { level: 2, title: 'Details' },
  { level: 1, title: 'Summary' }
]
const MARKDOWN_OUTLINE = [
  { level: 1, title: 'Sample Markdown' },
  { level: 2, title: 'Section One' },
  { level: 2, title: 'Section Two' }
]

/** `structure` is optional on the result, so every structural test has to ask for it. */
function requirePages(result: DocumentLoadResult) {
  assert.ok(result.structure, 'the loader must populate `structure`')
  assert.equal(result.structure.type, 'pages')
  assert.ok(result.structure.pages, 'a `pages` structure must carry `pages`')
  return result.structure.pages
}

function requireSections(result: DocumentLoadResult) {
  assert.ok(result.structure, 'the loader must populate `structure`')
  assert.equal(result.structure.type, 'sections')
  assert.ok(result.structure.sections, 'a `sections` structure must carry `sections`')
  return result.structure.sections
}

function flattenSections(sections: SectionInfo[]): SectionInfo[] {
  const flat: SectionInfo[] = []
  const walk = (nodes: SectionInfo[]): void => {
    for (const node of nodes) {
      flat.push(node)
      if (node.children?.length) walk(node.children)
    }
  }
  walk(sections)
  return flat
}

function outline(sections: SectionInfo[]): { level: number; title: string }[] {
  return flattenSections(sections).map(({ level, title }) => ({ level, title }))
}

/**
 * Siblings must not overlap, children must stay inside their parent, and no
 * range may be inverted. This is the invariant #66/#67 are most likely to break
 * while they rework how offsets are computed.
 */
function assertSectionOffsets(nodes: SectionInfo[], label: string, parent?: SectionInfo): void {
  nodes.forEach((node, index) => {
    assert.ok(node.endOffset >= node.startOffset, `${label}: ${node.title} has an inverted range`)
    if (parent) {
      assert.ok(
        node.startOffset >= parent.startOffset && node.endOffset <= parent.endOffset,
        `${label}: ${node.title} escapes its parent ${parent.title}`
      )
    }
    if (index > 0) {
      assert.ok(
        node.startOffset >= nodes[index - 1].endOffset,
        `${label}: ${node.title} overlaps ${nodes[index - 1].title}`
      )
    }
    if (node.children?.length) assertSectionOffsets(node.children, label, node)
  })
}

// --- PDF ---------------------------------------------------------------------

test('PDF: pages are numbered in order and their offsets slice back to the page text', async () => {
  const result = await new PdfLoader().loadFromPath(fixture('multipage.pdf'))
  assert.equal(result.mimeType, 'application/pdf')
  assert.equal(result.metadata?.pageCount, 3)

  const pages = requirePages(result)
  assert.equal(pages.length, 3)
  assert.deepEqual(
    pages.map((page) => page.pageNumber),
    [1, 2, 3]
  )

  for (const page of pages) {
    assert.equal(
      result.content.slice(page.startOffset, page.endOffset),
      page.content,
      `page ${page.pageNumber} offsets do not slice back to its text`
    )
  }

  for (let i = 1; i < pages.length; i++) {
    assert.ok(pages[i].startOffset >= pages[i - 1].endOffset, 'page boundaries overlap')
    assert.ok(pages[i].startOffset >= pages[i - 1].startOffset, 'page offsets are not monotonic')
  }
  assert.ok(
    pages[pages.length - 1].endOffset <= result.content.length,
    'the last page boundary runs past the document'
  )
})

test('PDF: the existing single-page fixture keeps its text and page box', async () => {
  const result = await new PdfLoader().loadFromPath(fixture('sample.pdf'))
  assert.equal(result.metadata?.pageCount, 1)

  const pages = requirePages(result)
  assert.equal(pages.length, 1)
  assert.match(pages[0].content, /KnowNote Import Test/)
  assert.equal(result.content.slice(pages[0].startOffset, pages[0].endOffset), pages[0].content)
  assert.equal(pages[0].metadata?.width, 612)
  assert.equal(pages[0].metadata?.height, 792)
})

// --- DOCX --------------------------------------------------------------------

test('DOCX: heading levels and their nesting survive the round trip', async () => {
  const result = await new DocxLoader().loadFromPath(fixture('headings.docx'))
  assert.equal(result.title, 'Overview')
  assert.equal(
    result.mimeType,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )

  const sections = requireSections(result)
  assert.deepEqual(outline(sections), DOCX_OUTLINE)
  assert.equal(sections.length, 2, 'Overview and Summary are the roots')
  assert.equal(sections[0].children?.length, 1, 'Details nests under Overview')
  assertSectionOffsets(sections, 'DOCX')

  for (const section of flattenSections(sections)) {
    assert.ok(
      result.content.slice(section.startOffset).startsWith(section.title),
      `DOCX: ${section.title} startOffset does not point at its title`
    )
  }
})

test('DOCX: a heading-less document still reports an (empty) section structure', async () => {
  const result = await new DocxLoader().loadFromPath(fixture('sample.docx'))
  assert.match(result.content, /KnowNote Import Test/)
  assert.deepEqual(requireSections(result), [])
})

// --- Markdown ----------------------------------------------------------------

test('Markdown: ATX headings become a nested outline with consistent offsets', async () => {
  const result = await new MarkdownLoader().loadFromPath(fixture('sample.md'))
  assert.equal(result.title, 'Sample Markdown')
  assert.equal(result.mimeType, 'text/markdown')

  const sections = requireSections(result)
  assert.deepEqual(outline(sections), MARKDOWN_OUTLINE)
  assertSectionOffsets(sections, 'Markdown')

  // Heading offsets are positions in the raw fixture text while `content` is
  // trimmed, so the root section can end a newline past `result.content`; the
  // assertions stay relative to the headings themselves.
  for (const section of flattenSections(sections)) {
    const marker = `${'#'.repeat(section.level)} ${section.title}`
    assert.ok(
      result.content.slice(section.startOffset).startsWith(marker),
      `Markdown: ${section.title} startOffset does not point at its ATX marker`
    )
  }
})

// --- HTML --------------------------------------------------------------------

test('HTML: Readability extracts the title and body and still carries a structure', async () => {
  const html = await readFile(fixture('sample.html'))
  const result = await new WebLoader().loadFromBuffer(html)
  assert.equal(result.title, 'Sample Document')
  assert.equal(result.mimeType, 'text/html')
  assert.equal(result.metadata?.excerpt, 'Fixture for the packaged-app smoke test')
  assert.match(result.content, /KnowNote Import Test/)
  assert.match(result.content, /Hello World/)

  // Readability hoists the document's lone <h1> into `title` and drops it from
  // the body, so this fixture has no heading left to become a section. The test
  // still guards the presence of the structure object itself.
  assert.deepEqual(requireSections(result), [])
})

// --- structure opt-out -------------------------------------------------------

test('preserveStructure: false drops the structure without dropping the text', async () => {
  const buffer = await readFile(fixture('multipage.pdf'))
  const result = await new PdfLoader().loadFromBuffer(buffer, { preserveStructure: false })
  assert.equal(result.structure, undefined)
  assert.match(result.content, /Page One Text/)
})

// --- dispatch ----------------------------------------------------------------

test('FileParserService routes each extension and MIME type to the matching loader', async () => {
  const parser = new FileParserService()

  const pdf = await parser.parseFile(fixture('sample.pdf'))
  assert.equal(pdf.mimeType, 'application/pdf')
  assert.equal(pdf.structure?.type, 'pages')

  const docx = await parser.parseFile(fixture('sample.docx'))
  assert.equal(
    docx.mimeType,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
  assert.equal(docx.structure?.type, 'sections')

  const markdown = await parser.parseBuffer(await readFile(fixture('sample.md')), 'md')
  assert.equal(markdown.mimeType, 'text/markdown')
  assert.equal(markdown.structure?.type, 'sections')

  for (const supported of ['pdf', 'docx', 'md', 'html', 'htm', 'pptx']) {
    assert.ok(parser.isSupported(supported), `${supported} should be routable`)
  }
  assert.equal(parser.isSupported('exe'), false)

  assert.equal(parser.getFileTypeFromMime('application/pdf'), 'pdf')
  assert.equal(parser.getFileTypeFromMime('text/markdown'), 'md')
  assert.equal(parser.getMimeType('md'), 'text/markdown')
  assert.equal(
    parser.getMimeType('docx'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
})
