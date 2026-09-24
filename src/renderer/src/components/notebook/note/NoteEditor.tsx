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
}

export default function NoteEditor({ content, onChange }: NoteEditorProps): ReactElement {
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

  // 编辑器实例由 useEditor 管理生命周期（@tiptap/react v3 会在卸载时销毁），
  // 这里不能手动 destroy：StrictMode 下 effect 会 mount → cleanup → mount，
  // 手动销毁会让第二次挂载拿到已销毁的实例，editor.storage.markdown 为 undefined。

  // 当外部 content 变化时同步到编辑器
  useEffect(() => {
    if (editor && content !== (editor.storage as any).markdown.getMarkdown()) {
      editor.commands.setContent(content)
    }
  }, [content, editor])

  // 快捷键保存由 NoteEditorPanel 统一处理，因为它同时管理标题输入框。

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
