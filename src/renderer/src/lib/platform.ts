/**
 * 플랫폼 감지 유틸리티
 * 메인 프로세스의 process.platform을 사용하여 폐기된 navigator.platform을 대체
 */

// 플랫폼 정보 캐시, 반복 IPC 호출 방지
let cachedPlatform: string | null = null

/**
 * 비동기 플랫폼 정보 조회 (권장)
 * 메인 프로세스에서 확인된 플랫폼 정보를 조회하고 캐시
 */
export async function getPlatform(): Promise<string> {
  if (cachedPlatform) return cachedPlatform
  cachedPlatform = await window.api.getPlatform()
  return cachedPlatform
}

/**
 * 동기 플랫폼 정보 조회
 * userAgentData (현재 표준) 또는 캐시 값 사용
 * 사용 불가능한 경우 navigator.platform으로 폴백
 */
export function getPlatformSync(): 'darwin' | 'win32' | 'linux' | 'unknown' {
  // 캐시 우선 사용
  if (cachedPlatform) {
    return cachedPlatform as 'darwin' | 'win32' | 'linux' | 'unknown'
  }

  // userAgentData 사용 (현재 표준, chromium 90+)
  const ua = (navigator as any).userAgentData
  if (ua?.platform) {
    const platform = ua.platform.toLowerCase()
    if (platform.includes('mac')) return 'darwin'
    if (platform.includes('win')) return 'win32'
    if (platform.includes('linux')) return 'linux'
  }

  // 최후 수단: 이전 버전 navigator.platform (호환성 고려)
  const p = navigator.platform.toUpperCase()
  if (p.includes('MAC')) return 'darwin'
  if (p.includes('WIN')) return 'win32'
  if (p.includes('LINUX')) return 'linux'

  return 'unknown'
}

/**
 * macOS 여부 판별
 */
export const isMac = (): boolean => getPlatformSync() === 'darwin'

/**
 * Windows 여부 판별
 */
export const isWindows = (): boolean => getPlatformSync() === 'win32'

/**
 * Linux 여부 판별
 */
export const isLinux = (): boolean => getPlatformSync() === 'linux'

/**
 * 플랫폼 감지 초기화
 * 앱 시작 시 호출, 플랫폼 정보를 캐시에 미리 로드
 */
export async function initPlatform(): Promise<void> {
  await getPlatform()
}
