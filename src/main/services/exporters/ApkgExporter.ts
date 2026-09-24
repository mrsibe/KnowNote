/**
 * ApkgExporter
 * 将Anki卡片导出为.apkg格式
 */

import AnkiExportModule from 'anki-apkg-export'
import type { AnkiCardItem } from '../../../shared/types/anki'

// anki-apkg-export is Babel-compiled CJS: the factory lives on `exports.default`
// and `module.exports` itself is just `{ default, Exporter }`. Because the package
// is external (see the `//dependencies` note in package.json), rollup emits a
// bare `require('anki-apkg-export')` and does not unwrap it, so `new AnkiExport()`
// threw `TypeError: AnkiExport is not a constructor`. Unwrap it explicitly instead
// of relying on bundler interop.
const AnkiExport = AnkiExportModule.default ?? AnkiExportModule

/**
 * APKG导出器类
 */
export class ApkgExporter {
  /**
   * 将卡片数组导出为APKG格式的Buffer
   * @param cards - 卡片数组
   * @param deckName - 卡组名称
   * @returns Promise<Buffer> - APKG文件的Buffer
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

    // 遍历所有卡片并添加到APKG
    for (const card of cards) {
      // 只处理basic类型卡片
      if (card.type === 'basic') {
        // 基础卡片:正面问题,背面答案
        apkg.addCard(card.front, card.back, {
          tags: card.tags || []
        })
        exportedCount++
      } else {
        skippedCount++
        skippedTypes[card.type] = (skippedTypes[card.type] || 0) + 1
      }
    }

    // 生成ZIP格式的APKG文件
    const zip = await apkg.save()
    const buffer = Buffer.from(zip)
    // 附带 summary 供调用方参考
    return { buffer, summary: { exportedCount, skippedCount, skippedTypes } }
  }
}
