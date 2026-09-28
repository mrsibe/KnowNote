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
 * 一个候选取证区间（#160 定义，#155 使用）。
 *
 * 与 `Citation` 的关键区别是**时机**：candidate 在回答生成之前就存在 —— 检索到的
 * chunk 被切成句子/块之后，每个片段带一个编号。prompt 把 candidate 的编号交给模型，
 * 模型回答时引用编号，于是引用区间在回答产生前就已确定。
 *
 * 这样就不需要回答之后再问「哪句话支持了哪个 claim」：substring / token overlap 对
 * 改写无能为力，embedding 相似度是概率而非证明，真正的支持关系是语义蕴含（NLI），
 * 那不是一个确定性算法。先有 span、再由模型选择，才是确定性的。
 */
export interface CitationCandidate {
  /**
   * 本次回答内部的临时编号（1-based），也是模型在回答里写的 `[n]`。
   *
   * 它只在一次 prompt / 一次回答内有效，不是数据库级稳定 id —— 用户可见的 marker
   * 就是 `Citation.index`，真正的稳定定位是下面的
   * `documentId` / `chunkId` / `blockId` / `startOffset` / `endOffset` / `quote`。
   */
  index: number
  documentId: string
  chunkId: string
  /** 区间所在的块；来源没有块结构时为 `undefined`。 */
  blockId?: string
  page?: number
  /**
   * 相对 `documents.content` 的字符区间，`quote` 是它的逐字切片。
   *
   * 只有来源带块结构时才知道区间。没有块结构的 chunk（旧索引或未生成块的来源）
   * 仍然可以是一个 candidate，此时没有 span 可指 —— 宁可缺字段，也不要编一个
   * 假的 offset；`Citation` 的对应字段本来也是可选的。
   */
  startOffset?: number
  endOffset?: number
  quote: string
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
