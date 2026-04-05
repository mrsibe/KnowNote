/**
 * Scalar Quantization 유틸리티
 * Float32 벡터를 INT8 (-128~127) 범위로 변환하여 4배 저장 용량 절감
 */

/**
 * Float32 벡터를 INT8로 양자화
 * 각 벡터를 min-max 스케일링하여 [-128, 127] 범위로 매핑
 */
export function float32ToInt8(vector: Float32Array): Int8Array {
  const result = new Int8Array(vector.length)

  // Find min and max values
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < vector.length; i++) {
    if (vector[i] < min) min = vector[i]
    if (vector[i] > max) max = vector[i]
  }

  const range = max - min
  if (range === 0) {
    // All values are the same
    return result // all zeros
  }

  // Scale to [-128, 127]
  for (let i = 0; i < vector.length; i++) {
    const normalized = (vector[i] - min) / range // 0 to 1
    result[i] = Math.round(normalized * 255 - 128) // -128 to 127
  }

  return result
}

/**
 * INT8 벡터를 Float32로 복원 (근사값)
 * 리스코어링이 아닌 참조용으로만 사용
 */
export function int8ToFloat32(vector: Int8Array): Float32Array {
  const result = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i++) {
    result[i] = (vector[i] + 128) / 255 // Normalize to 0-1 range
  }
  return result
}
