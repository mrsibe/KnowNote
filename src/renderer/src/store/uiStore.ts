import { create } from 'zustand'
import type { SourceAnchor } from '../../../shared/types/source'

interface UIStore {
  isSettingsOpen: boolean
  openSettings: () => void
  closeSettings: () => void

  /**
   * Whether the note editor holds text that has not been saved.
   *
   * It lives here because the surfaces that would destroy it are not its
   * children: the tab strip, the Home tab and the close-notebook shortcut all
   * unmount the workspace, and only the editor knows it is dirty. `NotePanel`
   * owns the state and publishes it; whoever navigates away reads it first.
   */
  hasUnsavedNoteChanges: boolean
  setHasUnsavedNoteChanges: (dirty: boolean) => void

  /**
   * The source the reader asked to see, set when a citation in the transcript is
   * clicked. The transcript (centre panel) and the library (left panel) are
   * siblings, so the request travels through the store rather than through props.
   *
   * It carries the whole `SourceAnchor` — not just the document id — because a
   * citation jump needs the target page/block. `SourcePanel` consumes it, and it is
   * rehydrated from the route query on reload so a deep link survives a restart.
   */
  focusedSource: SourceAnchor | null
  openSourceAnchor: (anchor: SourceAnchor | null) => void
}

export const useUIStore = create<UIStore>()((set) => ({
  isSettingsOpen: false,
  openSettings: () => set({ isSettingsOpen: true }),
  closeSettings: () => set({ isSettingsOpen: false }),

  hasUnsavedNoteChanges: false,
  setHasUnsavedNoteChanges: (dirty) => set({ hasUnsavedNoteChanges: dirty }),

  focusedSource: null,
  openSourceAnchor: (anchor) => set({ focusedSource: anchor })
}))
