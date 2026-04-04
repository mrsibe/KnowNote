import { getDatabase } from '../db'
import { items, notes, mindMaps, quizzes, ankiCards, type Item, type NewItem } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'

/**
 * Item 타입열거형
 */
export type ItemType = 'note' | 'mindmap' | 'quiz' | 'anki' | 'ppt' | 'audio' | 'video'

/**
 * Item 상세（패키지포함연관된리소스데이터）
 */
export interface ItemDetail extends Item {
  resource: any // 기반으로 type 반환의리소스데이터（Note | MindMap | ...）
}

/**
 * Item 서비스
 * 통합관리노트북아래의모든내용항목
 */
export class ItemService {
  /**
   * 노트북 조회아래의모든 items（패키지포함닫기연리소스）
   * 에 따라참조 order 오름차순정렬
   */
  async getItemsByNotebook(notebookId: string): Promise<ItemDetail[]> {
    const db = getDatabase()
    const itemsList = await db
      .select()
      .from(items)
      .where(eq(items.notebookId, notebookId))
      .orderBy(items.order)

    // 로드매개 item 의닫기연리소스
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

        // 향후으로추가더 많은타입
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
   * 생성 item（자동추가에목록마지막）
   */
  async createItem(data: {
    notebookId: string
    type: ItemType
    resourceId: string
    order?: number
  }): Promise<Item> {
    const db = getDatabase()
    const now = new Date()

    // 만약없있는가리키는정 order，현재 조회노트북의최대 order 값
    let order = data.order
    if (order === undefined) {
      const existingItems = await db
        .select()
        .from(items)
        .where(eq(items.notebookId, data.notebookId))

      // 찾에최대의 order 값，새 item 의 order 최대값 + 1
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
   * 삭제 item（아닌삭제연관된리소스）
   */
  async deleteItem(itemId: string): Promise<void> {
    const db = getDatabase()
    await db.delete(items).where(eq(items.id, itemId))
  }

  /**
   * 업데이트 item 의순서순서
   */
  async updateItemOrder(itemId: string, order: number): Promise<void> {
    const db = getDatabase()
    await db.update(items).set({ order, updatedAt: new Date() }).where(eq(items.id, itemId))
  }

  /**
   * 일괄업데이트 items 의순서순서
   * @param updates - { itemId: order } 의매핑
   */
  async batchUpdateOrder(updates: Record<string, number>): Promise<void> {
    const db = getDatabase()
    const now = new Date()
    for (const [itemId, order] of Object.entries(updates)) {
      await db.update(items).set({ order, updatedAt: now }).where(eq(items.id, itemId))
    }
  }

  /**
   * 기반으로리소스 ID 및타입찾기 item
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
   * 삭제연관된리소스및 item
   */
  async deleteItemWithResource(itemId: string): Promise<void> {
    const db = getDatabase()
    const item = await db.select().from(items).where(eq(items.id, itemId)).limit(1)

    if (!item[0]) {
      throw new Error('Item not found')
    }

    const { type, resourceId } = item[0]

    // 삭제연관된리소스
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
      // 향후으로추가더 많은타입
    }

    // 삭제 item（만약리소스있는레벨연삭제，이미삭제）
    await db.delete(items).where(eq(items.id, itemId))
  }
}

export const itemService = new ItemService()
