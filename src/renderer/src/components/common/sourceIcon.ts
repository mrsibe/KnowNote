import {
  AlignLeft,
  File,
  FileCode,
  FileText,
  FileType,
  Globe,
  Presentation,
  StickyNote,
  Youtube,
  type LucideIcon
} from 'lucide-react'
import type { SourceKind } from '../../lib/sourceKind'

/**
 * One drawn glyph per source kind, shared by every surface that lists a source.
 *
 * This lives outside `lib/sourceKind.ts` on purpose: that module is the pure
 * derivation (mime type, path, URL host) and is asserted in Node, where a UI icon
 * set has no business being loaded. The *vocabulary* is still single — a PDF must
 * not have one glyph in the library and another on Home — so the map is here, once,
 * and both call sites read it.
 *
 * All one stroke weight, all neutral. DESIGN.md bans colour icons in neutral
 * chrome, so a kind is carried by the glyph **and** its label, never by a tint.
 */
export const SOURCE_KIND_ICON: Record<SourceKind, LucideIcon> = {
  pdf: FileText,
  docx: FileType,
  pptx: Presentation,
  markdown: FileCode,
  text: AlignLeft,
  file: File,
  web: Globe,
  youtube: Youtube,
  note: StickyNote
}
