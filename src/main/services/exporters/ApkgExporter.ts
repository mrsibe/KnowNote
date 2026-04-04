/**
 * ApkgExporter
 * Anki 카드를 .apkg 형식으로 내보내기
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AnkiExport = require('anki-apkg-export').default
import type { AnkiCardItem } from '../../../shared/types/anki'

/**
 * APKG 내보내기 클래스
 */
export class ApkgExporter {
  /**
   * 카드 배열을 APKG 형식의 Buffer로 내보내기
   * @param cards - 카드 배열
   * @param deckName - 카드 덱 이름
   * @returns Promise<Buffer> - APKG 파일의 Buffer
   */
  async export(
    cards: AnkiCardItem[],
    deckName: string
  ): Promise<{
    buffer: Buffer
    summary: { exportedCount: number; skippedCount: number; skippedTypes: Record<string, number> }
  }> {
    const apkg = new AnkiExport(deckName)

    let exportedCount = 0
    let skippedCount = 0
    const skippedTypes: Record<string, number> = {}

    // 모든 카드를 순회하여 APKG에 추가
    for (const card of cards) {
      // basic 타입 카드 처리
      if (card.type === 'basic') {
        // 기본 카드: 앞면 질문, 뒷면 답변
        apkg.addCard(card.front, card.back, {
          tags: card.tags || []
        })
        exportedCount++
      } else {
        skippedCount++
        skippedTypes[card.type] = (skippedTypes[card.type] || 0) + 1
      }
    }

    // ZIP 형식의 APKG 파일 생성
    const zip = await apkg.save()
    const buffer = Buffer.from(zip)
    // 호출자 참고용 summary 첨부
    return { buffer, summary: { exportedCount, skippedCount, skippedTypes } }
  }
}
