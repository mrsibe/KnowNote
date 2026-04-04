/**
 * 플랫폼감지유틸리티
 * 사용메인프로세스의 process.platform 대체대폐기폐기의 navigator.platform
 */

// 캐시플랫폼정보，회피면재복 IPC 호출
let cachedPlatform: string | null = null

/**
 * 비동기조회플랫폼정보（추추천）
 * 에서메인프로세스조회준비확인의플랫폼정보그리고캐시
 */
export async function getPlatform(): Promise<string> {
  if (cachedPlatform) return cachedPlatform
  cachedPlatform = await window.api.getPlatform()
  return cachedPlatform
}

/**
 * 동기조회플랫폼정보
 * 사용 userAgentData（현재대표준비）또는캐시값
 * 만약아닌사용 가능，회뒤로에 navigator.platform
 */
export function getPlatformSync(): 'darwin' | 'win32' | 'linux' | 'unknown' {
  // 우선사용캐시
  if (cachedPlatform) {
    return cachedPlatform as 'darwin' | 'win32' | 'linux' | 'unknown'
  }

  // 사용 userAgentData（현재대표준비，chromium 90+）
  const ua = (navigator as any).userAgentData
  if (ua?.platform) {
    const platform = ua.platform.toLowerCase()
    if (platform.includes('mac')) return 'darwin'
    if (platform.includes('win')) return 'win32'
    if (platform.includes('linux')) return 'linux'
  }

  // 마지막비선택：이전버전 navigator.platform（겸용성고려고려）
  const p = navigator.platform.toUpperCase()
  if (p.includes('MAC')) return 'darwin'
  if (p.includes('WIN')) return 'win32'
  if (p.includes('LINUX')) return 'linux'

  return 'unknown'
}

/**
 * 판단예아니오 macOS
 */
export const isMac = (): boolean => getPlatformSync() === 'darwin'

/**
 * 판단예아니오 Windows
 */
export const isWindows = (): boolean => getPlatformSync() === 'win32'

/**
 * 판단예아니오 Linux
 */
export const isLinux = (): boolean => getPlatformSync() === 'linux'

/**
 * 초기화플랫폼감지
 * 앱시작동시호출，미리로드플랫폼정보에캐시
 */
export async function initPlatform(): Promise<void> {
  await getPlatform()
}
