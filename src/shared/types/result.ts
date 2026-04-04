/**
 * 통합 오류 처리 타입
 * throw Error와 오류 객체 반환 패턴의 혼용을 대체하기 위함
 */

/**
 * Result 타입 - 작업의 성공 또는 실패를 나타냄
 * @template T - 성공 시 데이터 타입
 * @template E - 실패 시 오류 타입, 기본값은 Error
 */
export type Result<T, E = Error> = { success: true; data: T } | { success: false; error: E }

/**
 * 성공 Result 생성
 * @param data - 성공 데이터
 * @returns 성공 Result 객체
 * @example
 * const result = Ok({ id: '123', name: 'test' })
 * // result = { success: true, data: { id: '123', name: 'test' } }
 */
export function Ok<T>(data: T): Result<T, never> {
  return { success: true, data }
}

/**
 * 실패 Result 생성
 * @param error - 오류 객체 또는 오류 메시지
 * @returns 실패 Result 객체
 * @example
 * const result = Err(new Error('Something went wrong'))
 * // result = { success: false, error: Error('Something went wrong') }
 *
 * const result2 = Err('Invalid input')
 * // result2 = { success: false, error: Error('Invalid input') }
 */
export function Err<E = Error>(error: E | string): Result<never, E> {
  const errorObj = typeof error === 'string' ? (new Error(error) as E) : error
  return { success: false, error: errorObj }
}

/**
 * Result가 성공인지 확인
 * @param result - Result 객체
 * @returns 성공이면 true 반환
 */
export function isOk<T, E>(result: Result<T, E>): result is { success: true; data: T } {
  return result.success === true
}

/**
 * Result가 실패인지 확인
 * @param result - Result 객체
 * @returns 실패이면 true 반환
 */
export function isErr<T, E>(result: Result<T, E>): result is { success: false; error: E } {
  return result.success === false
}

/**
 * Result에서 데이터를 추출하고, 실패 시 오류를 던짐
 * @param result - Result 객체
 * @returns 성공 데이터
 * @throws Result가 실패 상태인 경우
 * @example
 * const result = Ok(42)
 * const value = unwrap(result) // value = 42
 *
 * const failResult = Err('Failed')
 * const value2 = unwrap(failResult) // throws Error('Failed')
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.success) {
    return result.data
  }
  throw result.error
}

/**
 * Result에서 데이터를 추출하고, 실패 시 기본값을 반환
 * @param result - Result 객체
 * @param defaultValue - 실패 시 기본값
 * @returns 성공 데이터 또는 기본값
 * @example
 * const result = Ok(42)
 * const value = unwrapOr(result, 0) // value = 42
 *
 * const failResult = Err('Failed')
 * const value2 = unwrapOr(failResult, 0) // value2 = 0
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (result.success) {
    return result.data
  }
  return defaultValue
}

/**
 * 비동기 함수를 Result를 반환하는 함수로 래핑
 * @param fn - 비동기 함수
 * @returns Result를 반환하는 비동기 함수
 * @example
 * const safeFetch = wrapAsync(async (url: string) => {
 *   const response = await fetch(url)
 *   return response.json()
 * })
 *
 * const result = await safeFetch('https://api.example.com/data')
 * if (result.success) {
 *   console.log(result.data)
 * } else {
 *   console.error(result.error)
 * }
 */
export function wrapAsync<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>
): (...args: T) => Promise<Result<R>> {
  return async (...args: T) => {
    try {
      const data = await fn(...args)
      return Ok(data)
    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)))
    }
  }
}

/**
 * 동기 함수를 Result를 반환하는 함수로 래핑
 * @param fn - 동기 함수
 * @returns Result를 반환하는 함수
 * @example
 * const safeParseInt = wrapSync((str: string) => {
 *   const num = parseInt(str, 10)
 *   if (isNaN(num)) throw new Error('Invalid number')
 *   return num
 * })
 *
 * const result = safeParseInt('42')  // { success: true, data: 42 }
 * const result2 = safeParseInt('abc') // { success: false, error: Error('Invalid number') }
 */
export function wrapSync<T extends unknown[], R>(fn: (...args: T) => R): (...args: T) => Result<R> {
  return (...args: T) => {
    try {
      const data = fn(...args)
      return Ok(data)
    } catch (error) {
      return Err(error instanceof Error ? error : new Error(String(error)))
    }
  }
}
