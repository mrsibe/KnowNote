/**
 * DocumentLoader 추상 인터페이스 및 타입 정의
 * 통합 문서 로드 및 구조 추출
 */

/**
 * 페이지 정보 (용도: PDF, PPT 등 페이지 기반 문서)
 */
export interface PageInfo {
  pageNumber: number // 페이지 번호 (1부터 시작)
  content: string // 페이지 텍스트
  startOffset: number // 전체 텍스트에서의 시작 위치
  endOffset: number // 전체 텍스트에서의 종료 위치
  metadata?: {
    width?: number
    height?: number
    hasImages?: boolean
    imageCount?: number
    [key: string]: unknown
  }
}

/**
 * 섹션 정보 (용도: Markdown, Word 등 계층 구조가 있는 문서)
 */
export interface SectionInfo {
  level: number // 섹션 계층 (1-6)
  title: string // 섹션 제목
  content: string // 섹션 내용 (하위 섹션 미포함)
  startOffset: number // 시작 위치
  endOffset: number // 종료 위치
  children?: SectionInfo[] // 하위 섹션
}

/**
 * 문서 구조 정보
 */
export interface DocumentStructure {
  type: 'flat' | 'pages' | 'sections' // 구조 타입
  pages?: PageInfo[] // 페이지 기반 문서 (PDF, PPT)
  sections?: SectionInfo[] // 섹션 기반 문서 (Markdown, Word)
}

/**
 * 문서 로드 결과 (통합 반환 형식)
 */
export interface DocumentLoadResult {
  content: string // 전체 텍스트 내용
  title?: string // 문서 제목
  mimeType: string // MIME 타입
  structure?: DocumentStructure // 구조 정보 (신규 추가)
  metadata?: Record<string, unknown> // 기타 메타데이터
}

/**
 * 로드 옵션
 */
export interface LoadOptions {
  preserveStructure?: boolean // 구조 정보 유지 여부 (기본값 true)
  extractImages?: boolean // 이미지 정보 추출 여부 (기본값 false, 예약)
  ocrEnabled?: boolean // OCR 활성화 여부 (기본값 false, 예약)
  password?: string // PDF 비밀번호 (예약)
}

/**
 * DocumentLoader 추상 인터페이스
 * 모든 문서 로더는 이 인터페이스를 구현해야 합니다
 */
export interface IDocumentLoader {
  /**
   * 지원하는 MIME 타입 목록
   */
  readonly supportedMimeTypes: string[]

  /**
   * 지원하는 파일 확장자 목록
   */
  readonly supportedExtensions: string[]

  /**
   * 파일 경로에서 로드
   */
  loadFromPath(filePath: string, options?: LoadOptions): Promise<DocumentLoadResult>

  /**
   * Buffer에서 로드
   */
  loadFromBuffer(buffer: Buffer, options?: LoadOptions): Promise<DocumentLoadResult>

  /**
   * 파일 지원 여부 확인
   */
  canLoad(filePathOrMimeType: string): boolean
}
