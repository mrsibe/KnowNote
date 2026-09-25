import type { Root } from 'mdast'

/**
 * 把回答正文里的 `[n]` 标记变成可点击的 citation 链接（#72）。
 *
 * 这是一个 remark 插件，只做一件事：把文本节点里的 `[n]` 拆成一个指向
 * `#citation-<n>` 的 link 节点。它**不**决定显示什么 —— 标题、页码、禁用态都由
 * `CitationChip` 渲染，编号到 `Citation` 的映射由 `MessageItem` 完成。这样正文解析和
 * 呈现互不依赖，也不会把显示字符串写死进 markdown。
 *
 * 为什么复用 link 节点而不是自定义元素：`react-markdown` 已经为 `a` 提供了组件覆盖点，
 * 不需要额外注册元素类型，也不需要注入 HTML。
 */

/** link 的 `href` 前缀，用来把 citation 跳转和普通链接区分开。 */
export const CITATION_HREF_PREFIX = '#citation-'

/** 只认 1-3 位数字，避免把 `[2024]` 这种正文误判成引用。 */
const MARKER_PATTERN = /\[(\d{1,3})\]/g

/** 从 link 的 `href` 里取回标记编号；不是 citation 链接时返回 null。 */
export function parseCitationHref(href: string | undefined): number | null {
  if (!href || !href.startsWith(CITATION_HREF_PREFIX)) return null
  const raw = href.slice(CITATION_HREF_PREFIX.length)
  if (!/^\d+$/.test(raw)) return null
  const index = Number(raw)
  return index > 0 ? index : null
}

/** 内部使用的结构化节点类型，避免把 mdast 的联合类型散落到遍历逻辑里。 */
interface MarkdownNode {
  type: string
  value?: string
  url?: string
  children?: MarkdownNode[]
}

/** 文本节点按标记切开，标记本身变成 link。 */
function splitText(value: string): MarkdownNode[] {
  const parts: MarkdownNode[] = []
  let lastIndex = 0
  MARKER_PATTERN.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = MARKER_PATTERN.exec(value)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: value.slice(lastIndex, match.index) })
    }
    const index = Number(match[1])
    if (index > 0) {
      parts.push({
        type: 'link',
        url: `${CITATION_HREF_PREFIX}${index}`,
        children: [{ type: 'text', value: match[0] }]
      })
    } else {
      parts.push({ type: 'text', value: match[0] })
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < value.length) {
    parts.push({ type: 'text', value: value.slice(lastIndex) })
  }
  return parts.length > 0 ? parts : [{ type: 'text', value }]
}

function transformChildren(children: MarkdownNode[]): MarkdownNode[] {
  const result: MarkdownNode[] = []

  for (const child of children) {
    // 代码块 / 行内代码没有 `children`，天然不受影响。
    if (child.type === 'text' && typeof child.value === 'string') {
      result.push(...splitText(child.value))
      continue
    }

    // 已经是链接的文本不再二次解析；`[text][1]` 这种引用式链接保持原样。
    if (child.type === 'link' || child.type === 'linkReference') {
      result.push(child)
      continue
    }

    if (child.children) {
      result.push({ ...child, children: transformChildren(child.children) })
      continue
    }

    result.push(child)
  }

  return result
}

/** remark 插件。 */
export default function remarkCitationMarkers() {
  return (tree: Root): void => {
    // SAFETY: mdast nodes are plain objects; `MarkdownNode` is the structural subset
    // this walker reads (`type` / `value` / `url` / `children`). The rewrite only
    // reuses the node's own fields, so the tree stays a valid mdast tree.
    const root = tree as unknown as MarkdownNode
    if (root.children) root.children = transformChildren(root.children)
  }
}
