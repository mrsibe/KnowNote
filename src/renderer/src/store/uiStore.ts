import { create } from 'zustand'

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
   * A document the reader asked to see, set when a source in the transcript is
   * clicked. The transcript (centre panel) and the library (left panel) are
   * siblings, so the request travels through the store rather than through props.
   *
   * `SourcePanel` consumes it once the document is in its list, so returning to
   * the library later does not re-open it.
   */
  focusedSourceDocumentId: string | null
  focusSourceDocument: (documentId: string | null) => void
}

export const useUIStore = create<UIStore>()((set) => ({
  isSettingsOpen: false,
  openSettings: () => set({ isSettingsOpen: true }),
  closeSettings: () => set({ isSettingsOpen: false }),

  hasUnsavedNoteChanges: false,
  setHasUnsavedNoteChanges: (dirty) => set({ hasUnsavedNoteChanges: dirty }),

  focusedSourceDocumentId: null,
  focusSourceDocument: (documentId) => set({ focusedSourceDocumentId: documentId })
}))
