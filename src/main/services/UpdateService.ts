import { BrowserWindow } from 'electron'
import Logger from '../../shared/utils/logger'
import { UpdateStatus, UpdateState } from '../../shared/types/update'

/**
 * 자동 업데이트 서비스 (온프레미스 배포용 비활성화됨)
 */
export class UpdateService {
  constructor() {
    // 온프레미스 배포: 자동 업데이트 비활성화
    Logger.info('UpdateService', 'Auto-update service disabled for on-premise deployment')
  }

  /**
   * 메인 윈도우 참조 설정 (업데이트 알림 전송용)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setMainWindow(_window: BrowserWindow): void {
    return
  }

  /**
   * 업데이트 확인
   */
  async checkForUpdates(): Promise<UpdateState> {
    return { status: UpdateStatus.IDLE }
  }

  /**
   * 업데이트 다운로드
   */
  async downloadUpdate(): Promise<void> {
    return
  }

  /**
   * 종료 후 업데이트 설치
   */
  quitAndInstall(): void {
    return
  }

  /**
   * 현재 업데이트 상태 조회
   */
  getState(): UpdateState {
    return { status: UpdateStatus.IDLE }
  }

  /**
   * 앱 시작 시 자동 업데이트 확인 (선택사항)
   */
  async checkForUpdatesOnStartup(): Promise<void> {
    return
  }
}
