/**
 * 보안 저장소 유틸리티
 * Electron safeStorage API를 사용하여 민감 데이터 암호화
 */

import { safeStorage } from 'electron'
import Logger from '../../shared/utils/logger'

/**
 * 텍스트 데이터 암호화
 * @param plainText 평문
 * @returns Base64 인코딩된 암호화 데이터, 암호화 실패 시 null 반환
 */
export function encryptString(plainText: string): string | null {
  try {
    // 암호화 가능 여부 확인
    if (!safeStorage.isEncryptionAvailable()) {
      Logger.warn('SecureStorage', 'Encryption not available on this platform')
      return null
    }

    const encrypted = safeStorage.encryptString(plainText)
    return encrypted.toString('base64')
  } catch (error) {
    Logger.error('SecureStorage', 'Failed to encrypt string:', error)
    return null
  }
}

/**
 * 텍스트 데이터 복호화
 * @param encryptedBase64 Base64 인코딩된 암호화 데이터
 * @returns 복호화된 평문, 복호화 실패 시 null 반환
 */
export function decryptString(encryptedBase64: string): string | null {
  try {
    if (!encryptedBase64) {
      return null
    }

    const buffer = Buffer.from(encryptedBase64, 'base64')
    const decrypted = safeStorage.decryptString(buffer)
    return decrypted
  } catch (error) {
    Logger.error('SecureStorage', 'Failed to decrypt string:', error)
    return null
  }
}

/**
 * 암호화 가능 여부 확인
 */
export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

/**
 * 객체의 민감 필드 암호화
 * @param obj 민감 데이터를 포함하는 객체
 * @param sensitiveFields 암호화할 필드명 배열
 * @returns 암호화된 객체 (원본 객체가 수정됨)
 */
export function encryptObjectFields<T extends Record<string, any>>(
  obj: T,
  sensitiveFields: string[]
): T {
  const result: Record<string, any> = { ...obj }

  for (const field of sensitiveFields) {
    if (field in result && typeof result[field] === 'string') {
      const encrypted = encryptString(result[field])
      if (encrypted) {
        result[field] = encrypted
        // 해당 필드가 암호화되었음을 표시하는 마커 추가
        result[`__encrypted_${field}`] = true
      }
    }
  }

  return result as T
}

/**
 * 객체의 민감 필드 복호화
 * @param obj 암호화된 데이터를 포함하는 객체
 * @param sensitiveFields 복호화할 필드명 배열
 * @returns 복호화된 객체 (원본 객체가 수정됨)
 */
export function decryptObjectFields<T extends Record<string, any>>(
  obj: T,
  sensitiveFields: string[]
): T {
  const result: Record<string, any> = { ...obj }

  for (const field of sensitiveFields) {
    // 암호화 마커 확인
    const encryptedMarker = `__encrypted_${field}`
    if (result[encryptedMarker] && field in result && typeof result[field] === 'string') {
      const decrypted = decryptString(result[field])
      if (decrypted) {
        result[field] = decrypted
      }
      // 암호화 마커 제거
      delete result[encryptedMarker]
    }
  }

  return result as T
}

/**
 * Provider 설정의 민감 필드 목록
 */
export const PROVIDER_SENSITIVE_FIELDS = ['apiKey', 'apiSecret', 'accessToken']

/**
 * Provider 설정 암호화
 * @param config Provider 설정 객체
 * @returns 암호화된 설정
 */
export function encryptProviderConfig(config: Record<string, any>): Record<string, any> {
  return encryptObjectFields(config, PROVIDER_SENSITIVE_FIELDS)
}

/**
 * Provider 설정 복호화
 * @param config 암호화된 Provider 설정 객체
 * @returns 복호화된 설정
 */
export function decryptProviderConfig(config: Record<string, any>): Record<string, any> {
  return decryptObjectFields(config, PROVIDER_SENSITIVE_FIELDS)
}
