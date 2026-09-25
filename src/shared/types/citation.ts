/**
 * 结构化引用
 *
 * 一条 citation 是「回答里的一句断言」与「来源里支持它的一处文字」之间的连线。
 * 它刻意是一个**快照**：文字、页码、块 id 在回答生成时一并写入，而不是以后再去
 * 查库。来源文档可以在回答产生之后被重新索引甚至删除，citation 必须在这两件事
 * 之后依然存在 —— 它降级展示，而不是变成一个悬空的 id。
 *
 * `quote` 同样是快照：它是检索到的证据本身，不是指向 chunks 表的外键。重新分块
 * 或重新嵌入不能改变一条已经交付的回答里显示的原文。
 */
export interface Citation {
  /** 来源在 prompt 里的 1-based 位置，回答里的 `[n]` 据此解析。 */
  index: number
  documentId: string
  documentTitle: string
  documentType?: string
  /** 引用区间起始页；不分页的来源为 `undefined`。 */
  page?: number
  /** 引用跨页时的结束页。 */
  pageEnd?: number
  /** 跳转应落在的块（区间覆盖的第一个块）。 */
  blockId?: string
  chunkId: string
  /** 引用区间在 `documents.content` 里的字符偏移。 */
  startOffset?: number
  endOffset?: number
  /** 检索到的原文，逐字保留。 */
  quote: string
  score: number
}

/**
 * 一条 citation 连同它所覆盖的原文。
 *
 * 校验「引文确实落在引用区间内」需要区间文本，而文本只在检索侧（`locator`）
 * 存在，因此由调用方补齐。`spanText` 缺失时无法证伪引文 —— 解析结果保持为
 * resolved，而不是把一个证据不足的怀疑渲染成错误。
 */
export interface CitationContext {
  citation: Citation
  spanText?: string
}

/** 回答里一个 `[n]` 标记的归宿。 */
export type CitationMatchStatus = 'resolved' | 'unresolved' | 'misattributed'

export interface CitationMatch {
  /** 回答里的 `[n]` 编号。 */
  marker: number
  status: CitationMatchStatus
  /** 标记在回答文本里的字符位置。 */
  position: number
  /** 仅在 `resolved` / `misattributed` 时存在。 */
  citation?: Citation
}

/** `resolveCitations` 的结果。三组是互斥且穷尽的，因此可从中直接算出 precision。 */
export interface CitationResolution {
  matches: CitationMatch[]
  resolved: CitationMatch[]
  unresolved: CitationMatch[]
  misattributed: CitationMatch[]
  /** `resolved / total`；回答里没有任何标记时为 0。 */
  precision: number
}
