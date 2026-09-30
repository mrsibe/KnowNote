import { useEffect } from 'react'
import { ShortcutAction } from '../../../shared/types'

/**
 * 快捷键执行器 Hook
 * 监听来自主进程的快捷键触发事件，并通过 CustomEvent 分发到各个组件
 */
export function useShortcutExecutor() {
  useEffect(() => {
    const handleShortcut = (_event: any, action: ShortcutAction) => {
      // 根据不同的 action 分发 CustomEvent 给对应的组件处理
      switch (action) {
        // 笔记本管理
        case ShortcutAction.CREATE_NOTEBOOK:
          window.dispatchEvent(new CustomEvent('shortcut:create-notebook'))
          break

        case ShortcutAction.CLOSE_NOTEBOOK:
          window.dispatchEvent(new CustomEvent('shortcut:close-notebook'))
          break

        // 面板切换
        case ShortcutAction.TOGGLE_KNOWLEDGE_BASE:
          window.dispatchEvent(new CustomEvent('shortcut:toggle-knowledge-base'))
          break

        case ShortcutAction.TOGGLE_CREATIVE_SPACE:
          window.dispatchEvent(new CustomEvent('shortcut:toggle-creative-space'))
          break

        // 编辑器
        case ShortcutAction.SAVE_NOTE:
          window.dispatchEvent(new CustomEvent('shortcut:save-note'))
          break

        default:
          console.warn('[ShortcutExecutor] Unknown shortcut action:', action)
      }
    }

    // 监听来自主进程的快捷键触发事件
    return window.electron.ipcRenderer.on('shortcut:triggered', handleShortcut)
  }, [])
}
