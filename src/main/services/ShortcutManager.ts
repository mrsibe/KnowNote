import { Menu, BrowserWindow } from 'electron'
import type Store from 'electron-store'
import { ShortcutConfig, ShortcutAction } from '../../shared/types'
import { defaultShortcuts } from '../config/defaults'
import type { StoreSchema } from '../config/types'

/**
 * 단축키 관리자
 * 애플리케이션 단축키 등록, 해제 및 관리 담당
 */
export class ShortcutManager {
  private store: Store<StoreSchema>
  private mainWindow: BrowserWindow | null = null
  private shortcuts: ShortcutConfig[] = []
  private keyboardHandler: ((event: Event, input: Electron.Input) => void) | null = null

  constructor(store: Store<StoreSchema>) {
    this.store = store
  }

  /**
   * 메인 윈도우 참조 설정
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /**
   * webContents 리스너를 사용하여 단축키 등록
   */
  registerShortcuts(): void {
    const shortcuts: ShortcutConfig[] = (this.store.get('shortcuts') as ShortcutConfig[]) || []

    if (shortcuts.length === 0) {
      console.warn('[ShortcutManager] No shortcuts found in store, using defaults')
      this.store.set('shortcuts', defaultShortcuts)
      this.registerShortcuts()
      return
    }

    // 새로 추가된 기본 단축키 병합 (이전 버전 설정과의 하위 호환성)
    const mergedShortcuts = [...shortcuts]
    let hasNewShortcut = false
    for (const defaultShortcut of defaultShortcuts) {
      if (!mergedShortcuts.some((s) => s.action === defaultShortcut.action)) {
        mergedShortcuts.push({ ...defaultShortcut })
        hasNewShortcut = true
      }
    }
    if (hasNewShortcut) {
      this.store.set('shortcuts', mergedShortcuts)
    }

    this.shortcuts = mergedShortcuts.filter((s) => s.enabled)

    if (!this.mainWindow) {
      console.error('[ShortcutManager] Main window not set!')
      return
    }

    // 기존 리스너 제거
    if (this.keyboardHandler) {
      ;(this.mainWindow.webContents as any).removeListener(
        'before-input-event',
        this.keyboardHandler
      )
    }

    // 새 핸들러 생성
    this.keyboardHandler = (event: Event, input: Electron.Input) => {
      this.handleKeyboardEvent(event, input)
    }

    // webContents ready 후 등록 대기
    if (this.mainWindow.webContents.isLoading()) {
      this.mainWindow.webContents.once('did-finish-load', () => {
        ;(this.mainWindow!.webContents as any).on('before-input-event', this.keyboardHandler!)
      })
    } else {
      ;(this.mainWindow.webContents as any).on('before-input-event', this.keyboardHandler)
    }
  }

  /**
   * 키보드 이벤트 처리
   */
  private handleKeyboardEvent(event: Event, input: Electron.Input): void {
    // keyDown 이벤트만 처리
    if (input.type !== 'keyDown') return

    // 현재 키 조합 구성
    const modifiers: string[] = []
    if (input.control || input.meta) modifiers.push('CommandOrControl')
    if (input.shift) modifiers.push('Shift')
    if (input.alt) modifiers.push('Alt')

    // 키 가져오기
    let key = input.key
    // 특수 키 매핑 및 대문자 변환
    if (key === 'Enter') {
      key = 'Enter'
    } else if (key.length === 1) {
      // 문자만 대문자로 변환, 기호는 원래대로 유지
      if (key >= 'a' && key <= 'z') {
        key = key.toUpperCase()
      }
    }

    const accelerator = modifiers.length > 0 ? [...modifiers, key].join('+') : key

    // 일치하는 단축키 찾기
    const matchedShortcut = this.shortcuts.find((s) => s.accelerator === accelerator)

    if (matchedShortcut) {
      // 기본 동작 방지, 시스템 단축키 충돌 회피
      event.preventDefault()
      this.handleShortcut(matchedShortcut.action)
    }
  }

  /**
   * 모든 단축키 해제
   */
  unregisterShortcuts(): void {
    // 메뉴 초기화 (모든 단축키 제거)
    Menu.setApplicationMenu(null)
  }

  /**
   * 단일 단축키 업데이트
   */
  updateShortcut(action: ShortcutAction, newAccelerator: string): void {
    const shortcuts: ShortcutConfig[] = (this.store.get('shortcuts') as ShortcutConfig[]) || []
    const index = shortcuts.findIndex((s) => s.action === action)

    if (index !== -1) {
      shortcuts[index].accelerator = newAccelerator
      this.store.set('shortcuts', shortcuts)
      this.registerShortcuts() // 재등록
    }
  }

  /**
   * 단축키 활성화/비활성화 토글
   */
  toggleShortcut(action: ShortcutAction, enabled: boolean): void {
    const shortcuts: ShortcutConfig[] = (this.store.get('shortcuts') as ShortcutConfig[]) || []
    const index = shortcuts.findIndex((s) => s.action === action)

    if (index !== -1) {
      shortcuts[index].enabled = enabled
      this.store.set('shortcuts', shortcuts)
      this.registerShortcuts() // 재등록
    }
  }

  /**
   * 단일 단축키를 기본값으로 재설정
   */
  resetSingle(action: ShortcutAction): void {
    const shortcuts: ShortcutConfig[] = (this.store.get('shortcuts') as ShortcutConfig[]) || []
    const index = shortcuts.findIndex((s) => s.action === action)
    const defaultShortcut = defaultShortcuts.find((s) => s.action === action)

    if (index !== -1 && defaultShortcut) {
      shortcuts[index] = { ...defaultShortcut }
      this.store.set('shortcuts', shortcuts)
      this.registerShortcuts()
    }
  }

  /**
   * 기본 설정으로 재설정
   */
  resetToDefaults(): void {
    this.store.set('shortcuts', defaultShortcuts)
    this.registerShortcuts()
  }

  /**
   * 단축키 트리거 이벤트 처리
   * 렌더러 프로세스에 IPC 이벤트 전송
   */
  private handleShortcut(action: ShortcutAction): void {
    if (!this.mainWindow) {
      return
    }

    // Renderer Process에 IPC 이벤트 전송
    this.mainWindow.webContents.send('shortcut:triggered', action)
  }
}
