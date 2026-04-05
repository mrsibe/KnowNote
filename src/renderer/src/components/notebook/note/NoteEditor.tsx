import { ReactElement, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { Placeholder } from '@tiptap/extensions'
import { ScrollArea } from '../../ui/scroll-area'
import { Toaster } from '../../ui/sonner'
import './noteEditor.css'

interface NoteEditorProps {
  content: string
  onChange: (content: string) => void
  onSave?: () => void
}

export default function NoteEditor({ content, onChange, onSave }: NoteEditorProps): ReactElement {
  const { t } = useTranslation('notebook')

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown,
      Placeholder.configure({
        placeholder: t('startEditing', '입력노트내용...')
      })
    ],
    content,
    editorProps: {
      attributes: {
        class: 'tiptap-editor prose prose-sm max-w-none focus:outline-none'
      }
    },
    onUpdate: ({ editor }) => {
      const markdown = (editor.storage as any).markdown.getMarkdown()
      onChange(markdown)
    }
  })

  // 정리편집기인스턴스
  useEffect(() => {
    return () => {
      if (editor) {
        editor.destroy()
      }
    }
  }, [editor])

  // 때외부부분 content 변경시동기에편집기
  useEffect(() => {
    if (editor && content !== (editor.storage as any).markdown.getMarkdown()) {
      editor.commands.setContent(content)
    }
  }, [content, editor])

  // 단축키시리즈통합트리거저장（만편집기집중포커스시）
  useEffect(() => {
    if (!editor || !onSave) return

    const handleSaveShortcut = () => {
      if (editor.isFocused) {
        onSave()
      }
    }

    window.addEventListener('shortcut:save-note', handleSaveShortcut)
    return () => window.removeEventListener('shortcut:save-note', handleSaveShortcut)
  }, [editor, onSave])

  if (!editor) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        로딩 중...
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <Toaster />
      {/* 편집기내용 */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          <EditorContent editor={editor} />
        </div>
      </ScrollArea>
    </div>
  )
}
