/**
 * 업데이트 상태 열거
 */
export enum UpdateStatus {
  IDLE = 'idle',
  CHECKING = 'checking',
  AVAILABLE = 'available',
  NOT_AVAILABLE = 'not-available',
  DOWNLOADING = 'downloading',
  DOWNLOADED = 'downloaded',
  ERROR = 'error'
}

/**
 * 업데이트 진행률
 */
export interface UpdateProgress {
  percent: number
  transferred: number
  total: number
}

/**
 * 업데이트 상태
 * info 필드는 electron-updater의 UpdateInfo와 호환하기 위해 any 타입 사용
 */
export interface UpdateState {
  status: UpdateStatus
  info?: any
  progress?: UpdateProgress
  error?: string
}

/**
 * 업데이트 확인 결과
 */
export interface UpdateCheckResult {
  success: boolean
  state?: UpdateState
  error?: string
}

/**
 * 업데이트 작업 결과
 */
export interface UpdateOperationResult {
  success: boolean
  error?: string
}
