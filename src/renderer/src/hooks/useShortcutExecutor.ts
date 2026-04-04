import { useEffect } from 'react'
import { ShortcutAction } from '../../../shared/types'

/**
 * 단축키실행행 Hook
 * 감시래자체메인프로세스의단축키트리거이벤트，그리고통해 CustomEvent 분발에각개컴포넌트
 */
export function useShortcutExecutor() {
  useEffect(() => {
    const handleShortcut = (_event: any, action: ShortcutAction) => {
      // 기반으로다른의 action 분발 CustomEvent 의컴포넌트처리
      switch (action) {
        // 노트북관리
        case ShortcutAction.CREATE_NOTEBOOK:
          window.dispatchEvent(new CustomEvent('shortcut:create-notebook'))
          break

        case ShortcutAction.CLOSE_NOTEBOOK:
          window.dispatchEvent(new CustomEvent('shortcut:close-notebook'))
          break

        // 패널전환
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

    // 감시래자체메인프로세스의단축키트리거이벤트
    window.electron.ipcRenderer.on('shortcut:triggered', handleShortcut)

    return () => {
      window.electron.ipcRenderer.removeAllListeners('shortcut:triggered')
    }
  }, [])
}
