import { ShortcutAction, type ShortcutConfig } from '../types'

/** Replace retired defaults while preserving enabled state and custom bindings. */
export function migrateShortcuts(
  stored: ShortcutConfig[],
  defaults: ShortcutConfig[]
): ShortcutConfig[] {
  const retired: Partial<Record<ShortcutAction, string[]>> = {
    [ShortcutAction.CLOSE_NOTEBOOK]: ['Escape', 'CommandOrControl+W']
  }
  const result = stored.map((shortcut) => ({ ...shortcut }))
  for (const fallback of defaults) {
    const index = result.findIndex((shortcut) => shortcut.action === fallback.action)
    if (index === -1) result.push({ ...fallback })
    else if (retired[fallback.action]?.includes(result[index].accelerator)) {
      result[index].accelerator = fallback.accelerator
    }
  }
  return result
}
