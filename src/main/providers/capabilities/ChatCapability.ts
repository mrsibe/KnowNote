/**
 * ChatCapability 인터페이스
 * 정의대화기능
 */

import type { APIMessage, StreamChunk } from '../../../shared/types/chat'

/**
 * ChatCapability 대화기능 인터페이스
 * 현재이인터페이스의 Provider 지원대화공
 */
export interface ChatCapability {
  /**
   * 스트림형식메시지 전송
   * @param messages - 채팅메시지이력기록
   * @param onChunk - 수신에새 chunk 시의콜백
   * @param onError - 발생오류시의콜백
   * @param onComplete - 완료시의콜백
   * @returns Promise<AbortController> - 용도:에서판단요청의 AbortController
   */
  sendMessageStream(
    messages: APIMessage[],
    onChunk: (chunk: StreamChunk) => void,
    onError: (error: Error) => void,
    onComplete: () => void
  ): Promise<AbortController>

  /**
   * 조회기본대화모델
   * @returns 기본모델이름
   */
  getDefaultChatModel(): string
}
