import type { SourceAnchor } from '../types/source'
import { sourceAnchorFromSearchParams, sourceAnchorToSearchParams } from './sourceAnchor'

/**
 * 摘录到笔记的序列化（#73）。
 *
 * 一段摘录就是「引文 + 指回原文的定位」。两者都必须活在**笔记正文本身**里，理由是这个
 * 仓库的笔记正文不是 Tiptap JSON：`NoteEditor` 每次改动都用 `tiptap-markdown` 把文档
 * 序列化成 markdown 落库，读回时再交回 markdown 解析。任何只存在于 Tiptap 节点属性里的
 * 定位，都会在下一次往返时无声消失。
 *
 * 所以定位写成一条普通的 markdown 链接，指向一个自定义 fragment：
 *
 *   > 引文
 *   >
 *   > 第二行
 *
 *   [Attention Is All You Need · p.5](#know-note-source?doc=doc_1&page=5&start=1832&end=1947)
 *
 * 这样做的三个后果都是想要的：
 *
 * - **往返安全** —— 引用块和链接是核心 markdown，任何解析器都能原样读回；不需要自定义
 *   节点、不需要在 `addStorage().markdown` 里补序列化，也就不存在「序列化漏了一半」的
 *   那种 bug；
 * - **不会坏** —— 删掉这段代码、换一个编辑器、或者定位字段坏掉，它退化成一段引文加一条
 *   链接，而不是笔记打不开；
 * - **可测** —— 输入输出都是字符串，纯函数，不需要 DOM。
 *
 * fragment 里的定位直接复用 `SourceAnchor` 的 query 编码（`sourceAnchor.ts`），因此笔记里
 * 的这条链接和聊天里点击引用走的是同一套解析与同一套优先级。
 */

/** 摘录链接的 fragment 标记。`#` 开头保证它不会和外部链接混淆。 */
const EXCERPT_FRAGMENT = '#know-note-source?'

/** 摘录链接的 href：`SourceAnchor` 的 query 编码，只加一个 fragment 标记。 */
export function excerptSourceHref(anchor: SourceAnchor): string {
  return EXCERPT_FRAGMENT + sourceAnchorToSearchParams(anchor).toString()
}

/**
 * 这个 href 是不是一条摘录链接。
 *
 * 和 `excerptAnchorFromHref(...) !== null` 不是一回事：定位字段坏掉的摘录链接仍然是摘录
 * 链接（`#know-note-source?` 后面没有 `doc`）。调用方需要能区分三种情况 —— 摘录链接、外部
 * 链接、以及什么都不是 —— 否则一条解析不出来的摘录链接会被当成外部链接交给浏览器打开。
 */
export function isExcerptSourceHref(href: string | null | undefined): boolean {
  return typeof href === 'string' && href.includes(EXCERPT_FRAGMENT)
}

/**
 * href → 定位。不是摘录链接时返回 null。
 *
 * 用 `indexOf` 而不是 `startsWith`：同一个 href 可能是 markdown 里的原样值，也可能是
 * 浏览器解析过 base 之后的绝对 URL（`file:///…` / `http://localhost:…/#know-note-source?…`）。
 * `URLSearchParams` 会把 `#` 编码成 `%23`，所以这个标记不会出现在定位字段自己身上。
 *
 * 防御式解析沿用 `sourceAnchorFromSearchParams`：单个坏字段只丢弃它自己。解析不出
 * `doc` 就等于「这条链接没有定位」，调用方据此禁用跳转而不是跳到别处。
 */
export function excerptAnchorFromHref(href: string | null | undefined): SourceAnchor | null {
  if (typeof href !== 'string') return null

  const marker = href.indexOf(EXCERPT_FRAGMENT)
  if (marker < 0) return null

  return sourceAnchorFromSearchParams(
    new URLSearchParams(href.slice(marker + EXCERPT_FRAGMENT.length))
  )
}

/**
 * 把原文转成「看起来一模一样、但不会被 Markdown 重新解释」的文本。
 *
 * 摘录的原文是**用户选中的字**，不是用户写的 Markdown。一段从 PDF 或网页上选下来的文字
 * 完全可能包含 `# 标题`、`- 列表`、`[foo](bar)`、`` `code` ``，甚至 `<b>` —— 它们必须原样显示，
 * 而不是变成真标题、真列表、真链接、真粗体。
 *
 * 转义表参考 prosemirror-markdown 的 `esc()`（它已经被用在无数编辑器上），并额外补了
 * 两类它不需要、而我们需要的情况：
 *
 * - `<` 与 `&` —— tiptap-markdown 默认 `html: true`，所以原本的 HTML 与实体是活的：
 *   `<b>x</b>` 会真的加粗，`&amp;` 会显示成 `&`；
 * - `|` —— 两行凑在一起会变成表格。
 *
 * 反斜杠必须先处理，它自己就是转义符。行首额外的标记（标题、引用、列表、分隔线、setext
 * 下划线、有序列表）在行内转义之后再补，否则 `***` 会被转义两次。
 *
 * 行首缩进单独钳一下（见 `clampIndent`）：那是唯一一种反斜杠解决不了的情况。
 */
export function escapeExcerptMarkdown(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      clampIndent(line)
        .replace(INLINE_ESCAPE, '\\$&')
        .replace(LINE_START_ORDERED, '$1$2\\$3$4')
        .replace(LINE_START_MARKER, '$1\\$2')
    )
    .join('\n')
}

/**
 * 把行首缩进钳到至多 3 个空格。
 *
 * 行首四个空格（或一个制表符）在 Markdown 里是代码块：一段从 PDF 里选下来、恰好带着
 * 首行缩进的文字，会静默变成一个代码块。这一种用反斜杠解决不了 —— 触发它的是空白
 * 本身，而反斜杠只能转义标点字符。
 *
 * 也不用 HTML 实体（`&#32;`）绕：那在一次「解析 → 重新序列化」之后会退回普通空格，
 * 于是下次加载又变成代码块 —— 会骰掉的修复比不修更糟。
 *
 * 钳到 3 个空格没有可观的代价：HTML 本来就会折叠行首空白，渲染出来一模一样；
 * 保留前三个空格只是让 Markdown 源码里仍然看得出「原本有缩进」。
 */
function clampIndent(line: string): string {
  return line.replace(/^[ \t]+/, (run) => (run.length >= 4 || run.includes('\t') ? '   ' : run))
}

/** 在一行里任何位置都有含义的字符。 */
const INLINE_ESCAPE = /[\\`*_[\]~<&|]/g

/** 只在行首才有含义的标记：标题、引用、列表、分隔线、setext 下划线。 */
const LINE_START_MARKER = /^(\s*)([#>=\-+*])/

/** 有序列表的 `1.` / `1)`。 */
const LINE_START_ORDERED = /^(\s*)(\d+)([.)])(\s|$)/

/**
 * 一行 markdown 引用。空行也写成 `>`，否则引文里的空行会把引用块拆成两段。
 *
 * 先转义再引用：顺序反了会把引用块自己的 `>` 也转义掉。
 *
 * 同时去掉每行末尾的空白：markdown 里「行尾两个空格」是硬换行，摘录的换行方式不应该
 * 由原文的尾随空格决定。
 */
export function quoteMarkdown(text: string): string {
  return escapeExcerptMarkdown(text.replace(/\r\n?/g, '\n'))
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .map((line) => (line.length === 0 ? '>' : `> ${line}`))
    .join('\n')
}

export interface Excerpt {
  /** 选中的原文。 */
  text: string
  /** 指回原文的定位。 */
  anchor: SourceAnchor
  /** 链接的可见文字，例如「Attention Is All You Need · p.5」。由调用方决定文案与语言。 */
  label: string
}

/**
 * 一段摘录 → 可以追加进笔记正文的 markdown。
 *
 * 返回 null 表示这段摘录没有内容（全空白）——由调用方决定怎么提示，而不是往笔记里塞一段
 * 空的引用块。
 */
export function buildExcerptMarkdown({ text, anchor, label }: Excerpt): string | null {
  const body = text.replace(/\r\n?/g, '\n').trim()
  if (body.length === 0) return null

  return `${quoteMarkdown(body)}\n\n[${escapeLinkText(label)}](${excerptSourceHref(anchor)})`
}

/**
 * 把一段摘录接到笔记正文末尾。
 *
 * 只在纯文本层面做一件事：保证接缝处正好是一个空行。笔记正文可能是空的（新建笔记）、
 * 可能没有以换行结尾、也可能已经带好几个尾随空白 —— 这些都不该由组件去手拼 `'\n\n'`。
 *
 * 两个退化情况都原样返回、不做多余的编辑：摘录是空的就不动正文（不留下一个孤立的空行），
 * 正文是空的就只留摘录（不在开头塞一个空行）。
 */
export function appendExcerptMarkdown(currentMarkdown: string, excerptMarkdown: string): string {
  const excerpt = excerptMarkdown.trim()
  if (excerpt.length === 0) return currentMarkdown

  const current = currentMarkdown.replace(/\s+$/, '')
  if (current.length === 0) return excerpt

  return `${current}\n\n${excerpt}`
}

/**
 * 链接文字里的 `[` `]` `\` 必须转义，否则一个带方括号的来源标题会把整条链接解析坏，
 * 连带让它后面的正文一起变形。
 */
function escapeLinkText(text: string): string {
  return text.replace(/([\\[\]])/g, '\\$1')
}
