/**
 * 来源阅读器契约（#71）
 *
 * Reader 不是「PDF 组件」，而是「渲染来源自身结构」的界面。PDF 在 v1.4 是完整实现
 * （有页码、有版面），其余格式走文本回退。下游（#72 引用跳转、#73 摘录到笔记）只认
 * `openAt` / `getSelection`，不关心当前挂载的是哪一种实现。
 */

/** 一个来源里的可定位块（`document_blocks` 的读取投影）。 */
export interface SourceBlock {
  id: string
  kind: string
  /** 文档内阅读顺序。 */
  order: number
  /** 1 起始页码；非分页格式为 null。 */
  page: number | null
  /** 标题层级；非标题块为 null。 */
  level: number | null
  text: string
  /** 相对 `documents.content` 的字符偏移。 */
  startOffset: number
  endOffset: number
  /** 归一化页面坐标（分页格式），供高亮使用。 */
  bbox: { x: number; y: number; w: number; h: number } | null
}

/** 阅读器的定位目标：页 / 块 / 字符区间，三者都可选。 */
export interface ReaderAnchor {
  documentId: string
  page?: number | null
  blockId?: string | null
  startOffset?: number | null
  endOffset?: number | null
}

/**
 * 「打开哪个来源，并去哪」(#72)。
 *
 * `ReaderAnchor` 回答的是「在已经打开的 Reader 里去哪」；`SourceAnchor` 把来源身份和
 * 位置绑在一起，因此它是「打开某个来源并定位」这一动作的完整参数，也是 #72（引用跳转）
 * 与 #73（摘录到笔记）共享的定位单位。
 *
 * `location` 直接复用 `ReaderAnchor`，这样它可以原样交给 `ReaderHandle.openAt`；其中的
 * `documentId` 与外层字段是同一条来源身份。
 */
export interface SourceAnchor {
  documentId: string
  location: ReaderAnchor
}

/** 用户在阅读器里选中的一段文字。用于 #73 的摘录。 */
export interface ReaderSelection extends ReaderAnchor {
  text: string
}

/** 任意 Reader 实现都要满足的命令式接口。 */
export interface ReaderHandle {
  /** 滚动/高亮到 anchor。页码、块或字符区间任一可用即可。 */
  openAt(anchor: ReaderAnchor): void
  /** 当前选区，或 null。选区不在这个 reader 内时返回 null。 */
  getSelection(): ReaderSelection | null
}
