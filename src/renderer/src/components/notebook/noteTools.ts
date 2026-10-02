import { FileText, Network, ClipboardCheck, Layers } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * The Notes panel's four creation tools, in the order they render (a 2 x 2 grid).
 *
 * They are action buttons, not a mode switch: pressing one runs and returns — a
 * blank note opens the editor, the other three generate an artifact — so there is
 * no persistent selected state to express, and none is invented. `surfaceClassName`
 * is the card's background token from DESIGN.md, "Tool fills"; those four tokens
 * exist for these cards only.
 */
export type NoteToolId = 'note' | 'mindmap' | 'quiz' | 'anki'

export interface NoteTool {
  id: NoteToolId
  /** i18n key in the `notebook` namespace. */
  labelKey: string
  Icon: LucideIcon
  /** The sanctioned tool-card background utility (DESIGN.md, "Tool fills"). */
  surfaceClassName: string
}

export const NOTE_TOOLS: readonly NoteTool[] = [
  {
    id: 'note',
    labelKey: 'createNote',
    Icon: FileText,
    surfaceClassName: 'bg-tool-note hover:bg-tool-note'
  },
  {
    id: 'mindmap',
    labelKey: 'generateMindMap',
    Icon: Network,
    surfaceClassName: 'bg-tool-mindmap hover:bg-tool-mindmap'
  },
  {
    id: 'quiz',
    labelKey: 'generateQuiz',
    Icon: ClipboardCheck,
    surfaceClassName: 'bg-tool-quiz hover:bg-tool-quiz'
  },
  {
    id: 'anki',
    labelKey: 'generateAnki',
    Icon: Layers,
    surfaceClassName: 'bg-tool-anki hover:bg-tool-anki'
  }
]
