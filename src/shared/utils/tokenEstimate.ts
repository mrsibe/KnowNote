/**
 * Rough token accounting for one piece of text.
 *
 * Moved here from `SessionAutoSwitchService` (#140): it is a pure function, and
 * living on a class that reaches for the database made the code that needs it
 * impossible to run outside an Electron process.
 *
 * The algorithm is unchanged — it distinguishes scripts so an estimate is not
 * wildly wrong for CJK text:
 *
 * - English/numbers/symbols: ~4 chars = 1 token
 * - Chinese/Japanese/Korean: ~1.5 chars = 1 token
 * - Code blocks: ~3.5 chars = 1 token
 */
export const estimateTokens = (text: string): number => {
  if (!text || text.length === 0) return 0

  let chineseChars = 0
  let englishChars = 0
  let codeChars = 0

  // Detect if in code block
  const codeBlockRegex = /```[\s\S]*?```|`[^`]+`/g
  const codeBlocks = text.match(codeBlockRegex) || []

  // Count code block characters
  codeBlocks.forEach((block) => {
    codeChars += block.length
  })

  // Count other characters after removing code blocks
  const textWithoutCode = text.replace(codeBlockRegex, '')

  for (const char of textWithoutCode) {
    const code = char.charCodeAt(0)

    // Chinese character ranges (CJK Unified Ideographs)
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Basic Ideographs
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
      (code >= 0x3040 && code <= 0x309f) || // Japanese Hiragana
      (code >= 0x30a0 && code <= 0x30ff) || // Japanese Katakana
      (code >= 0xac00 && code <= 0xd7af) // Korean Hangul
    ) {
      chineseChars++
    } else {
      englishChars++
    }
  }

  // Calculate token count for each part
  const chineseTokens = chineseChars / 1.5 // Chinese: 1.5 chars ≈ 1 token
  const englishTokens = englishChars / 4 // English: 4 chars ≈ 1 token
  const codeTokens = codeChars / 3.5 // Code: 3.5 chars ≈ 1 token

  return Math.ceil(chineseTokens + englishTokens + codeTokens)
}
