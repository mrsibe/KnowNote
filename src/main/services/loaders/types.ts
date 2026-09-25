/**
 * DocumentLoader 抽象接口和类型定义
 * 统一文档加载和结构提取
 */

/**
 * 归一化矩形框（0..1，相对页面）。页面坐标系原点在左上角，便于渲染层直接使用。
 */
export interface NormalizedBox {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 页面信息（用于 PDF、PPT 等分页文档）
 */
export interface PageInfo {
  pageNumber: number // 页码（从 1 开始）
  content: string // 页面文本
  startOffset: number // 在完整文本中的起始位置
  endOffset: number // 在完整文本中的结束位置
  bbox?: NormalizedBox // 页面文本的归一化包围盒（可选）
  metadata?: {
    width?: number
    height?: number
    hasImages?: boolean
    imageCount?: number
    [key: string]: unknown
  }
}

/**
 * 章节信息（用于 Markdown、Word 等有层级结构的文档）
 */
export interface SectionInfo {
  level: number // 章节层级（1-6）
  title: string // 章节标题
  content: string // 章节内容（不含子章节）
  startOffset: number // 起始位置
  endOffset: number // 结束位置
  children?: SectionInfo[] // 子章节
}

/**
 * 文档结构信息
 */
export interface DocumentStructure {
  type: 'flat' | 'pages' | 'sections' // 结构类型
  pages?: PageInfo[] // 分页文档（PDF、PPT）
  sections?: SectionInfo[] // 章节文档（Markdown、Word）
}

/**
 * 文档加载结果（统一返回格式）
 */
export interface DocumentLoadResult {
  content: string // 完整文本内容
  title?: string // 文档标题
  mimeType: string // MIME 类型
  structure?: DocumentStructure // 结构信息（新增）
  metadata?: Record<string, unknown> // 其他元数据
}

/**
 * 加载选项
 */
export interface LoadOptions {
  preserveStructure?: boolean // 是否保留结构信息（默认 true）
  extractImages?: boolean // 是否提取图片信息（默认 false，预留）
  ocrEnabled?: boolean // 是否启用 OCR（默认 false，预留）
  password?: string // PDF 密码（预留）
}

/**
 * DocumentLoader 抽象接口
 * 所有文档加载器必须实现此接口
 */
export interface IDocumentLoader {
  /**
   * 支持的 MIME 类型列表
   */
  readonly supportedMimeTypes: string[]

  /**
   * 支持的文件扩展名列表
   */
  readonly supportedExtensions: string[]

  /**
   * 从文件路径加载
   */
  loadFromPath(filePath: string, options?: LoadOptions): Promise<DocumentLoadResult>

  /**
   * 从 Buffer 加载
   */
  loadFromBuffer(buffer: Buffer, options?: LoadOptions): Promise<DocumentLoadResult>

  /**
   * 检查是否支持该文件
   */
  canLoad(filePathOrMimeType: string): boolean
}
