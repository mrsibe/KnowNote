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
        placeholder: t('startEditing', '输入笔记内容...')
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

  // 清理编辑器实例
  useEffect(() => {
    return () => {
      if (editor) {
        editor.destroy()
      }
    }
  }, [editor])

  // 当外部 content 变化时同步到编辑器
  useEffect(() => {
    if (editor && content !== (editor.storage as any).markdown.getMarkdown()) {
      editor.commands.setContent(content)
    }
  }, [content, editor])

  // 快捷键系统触发保存（仅编辑器聚焦时）
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
        {t('loading', { ns: 'common' })}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <Toaster />
      {/* 编辑器内容 */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          <EditorContent editor={editor} />
        </div>
      </ScrollArea>
    </div>
  )
}
