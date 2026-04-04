import { getDatabase } from '../db'
import { items, notes, mindMaps, quizzes, ankiCards, type Item, type NewItem } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'

/**
 * Item 타입 열거
 */
export type ItemType = 'note' | 'mindmap' | 'quiz' | 'anki' | 'ppt' | 'audio' | 'video'

/**
 * Item 상세 (연관된 리소스 데이터 포함)
 */
export interface ItemDetail extends Item {
  resource: any // type에 따라 해당하는 리소스 데이터 반환 (Note | MindMap | ...)
}

/**
 * Item 서비스
 * 노트북 내의 모든 콘텐츠 항목을 통합 관리
 */
export class ItemService {
  /**
   * 노트북의 모든 items 조회 (연관 리소스 포함)
   * order 오름차순 정렬
   */
  async getItemsByNotebook(notebookId: string): Promise<ItemDetail[]> {
    const db = getDatabase()
    const itemsList = await db
      .select()
      .from(items)
      .where(eq(items.notebookId, notebookId))
      .orderBy(items.order)

    // 각 item의 연관 리소스 로드
    const itemDetails: ItemDetail[] = []
    for (const item of itemsList) {
      let resource: any = null

      switch (item.type) {
        case 'note': {
          const noteResult = await db
            .select()
            .from(notes)
            .where(eq(notes.id, item.resourceId))
            .limit(1)
          resource = noteResult[0] || null
          break
        }

        case 'mindmap': {
          const mindMapResult = await db
            .select()
            .from(mindMaps)
            .where(eq(mindMaps.id, item.resourceId))
            .limit(1)
          resource = mindMapResult[0] || null
          break
        }

        case 'quiz': {
          const quizResult = await db
            .select()
            .from(quizzes)
            .where(eq(quizzes.id, item.resourceId))
            .limit(1)
          resource = quizResult[0] || null
          break
        }

        case 'anki': {
          const ankiCardResult = await db
            .select()
            .from(ankiCards)
            .where(eq(ankiCards.id, item.resourceId))
            .limit(1)
          resource = ankiCardResult[0] || null
          break
        }

        // 향후 더 많은 타입 추가 가능
        default:
          resource = null
      }

      if (resource) {
        itemDetails.push({
          ...item,
          resource
        })
      }
    }

    return itemDetails
  }

  /**
   * item 생성 (자동으로 목록 마지막에 추가)
   */
  async createItem(data: {
    notebookId: string
    type: ItemType
    resourceId: string
    order?: number
  }): Promise<Item> {
    const db = getDatabase()
    const now = new Date()

    // order가 지정되지 않은 경우 현재 노트북의 최대 order 값 조회
    let order = data.order
    if (order === undefined) {
      const existingItems = await db
        .select()
        .from(items)
        .where(eq(items.notebookId, data.notebookId))

      // 최대 order 값 찾기, 새 item의 order는 최대값 + 1
      const maxOrder = existingItems.reduce((max, item) => Math.max(max, item.order), -1)
      order = maxOrder + 1
    }

    const newItem: NewItem = {
      id: nanoid(),
      notebookId: data.notebookId,
      type: data.type,
      resourceId: data.resourceId,
      order,
      createdAt: now,
      updatedAt: now
    }

    await db.insert(items).values(newItem)
    return newItem as Item
  }

  /**
   * item 삭제 (연관 리소스는 삭제하지 않음)
   */
  async deleteItem(itemId: string): Promise<void> {
    const db = getDatabase()
    await db.delete(items).where(eq(items.id, itemId))
  }

  /**
   * item 순서 업데이트
   */
  async updateItemOrder(itemId: string, order: number): Promise<void> {
    const db = getDatabase()
    await db.update(items).set({ order, updatedAt: new Date() }).where(eq(items.id, itemId))
  }

  /**
   * items 순서 일괄 업데이트
   * @param updates - { itemId: order } 매핑
   */
  async batchUpdateOrder(updates: Record<string, number>): Promise<void> {
    const db = getDatabase()
    const now = new Date()
    for (const [itemId, order] of Object.entries(updates)) {
      await db.update(items).set({ order, updatedAt: now }).where(eq(items.id, itemId))
    }
  }

  /**
   * 리소스 ID 및 타입으로 item 찾기
   */
  async findItemByResource(resourceId: string, type: ItemType): Promise<Item | null> {
    const db = getDatabase()
    const result = await db
      .select()
      .from(items)
      .where(and(eq(items.resourceId, resourceId), eq(items.type, type)))
      .limit(1)

    return result[0] || null
  }

  /**
   * 연관 리소스와 item 함께 삭제
   */
  async deleteItemWithResource(itemId: string): Promise<void> {
    const db = getDatabase()
    const item = await db.select().from(items).where(eq(items.id, itemId)).limit(1)

    if (!item[0]) {
      throw new Error('Item not found')
    }

    const { type, resourceId } = item[0]

    // 연관 리소스 삭제
    switch (type) {
      case 'note':
        await db.delete(notes).where(eq(notes.id, resourceId))
        break
      case 'mindmap':
        await db.delete(mindMaps).where(eq(mindMaps.id, resourceId))
        break
      case 'quiz':
        await db.delete(quizzes).where(eq(quizzes.id, resourceId))
        break
      case 'anki':
        await db.delete(ankiCards).where(eq(ankiCards.id, resourceId))
        break
      // 향후 더 많은 타입 추가 가능
    }

    // item 삭제 (리소스에 캐스케이드 삭제가 있으면 이미 삭제되었을 수 있음)
    await db.delete(items).where(eq(items.id, itemId))
  }
}

export const itemService = new ItemService()
