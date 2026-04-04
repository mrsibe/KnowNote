import { useEffect } from 'react'
import { ShortcutAction } from '../../../shared/types'

/**
 * 단축키 실행 Hook
 * 메인 프로세스에서 오는 단축키 트리거 이벤트를 수신하여 CustomEvent로 각 컴포넌트에 전달
 */
export function useShortcutExecutor() {
  useEffect(() => {
    const handleShortcut = (_event: any, action: ShortcutAction) => {
      // action에 따라 해당 컴포넌트에서 처리할 CustomEvent 발행
      switch (action) {
        // 노트북 관리
        case ShortcutAction.CREATE_NOTEBOOK:
          window.dispatchEvent(new CustomEvent('shortcut:create-notebook'))
          break

        case ShortcutAction.CLOSE_NOTEBOOK:
          window.dispatchEvent(new CustomEvent('shortcut:close-notebook'))
          break

        // 패널 전환
        case ShortcutAction.TOGGLE_KNOWLEDGE_BASE:
          window.dispatchEvent(new CustomEvent('shortcut:toggle-knowledge-base'))
          break

        case ShortcutAction.TOGGLE_CREATIVE_SPACE:
          window.dispatchEvent(new CustomEvent('shortcut:toggle-creative-space'))
          break

        // 편집기
        case ShortcutAction.SAVE_NOTE:
          window.dispatchEvent(new CustomEvent('shortcut:save-note'))
          break

        default:
          console.warn('[ShortcutExecutor] Unknown shortcut action:', action)
      }
    }

    // 메인 프로세스의 단축키 트리거 이벤트 수신
    window.electron.ipcRenderer.on('shortcut:triggered', handleShortcut)

    return () => {
      window.electron.ipcRenderer.removeAllListeners('shortcut:triggered')
    }
  }, [])
}
