import { ReactElement, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { Placeholder } from '@tiptap/extensions'
import { ScrollArea } from '../../ui/scroll-area'
import { Toaster } from '../../ui/sonner'
import { toast } from 'sonner'
import { sourceDocumentExists } from '../../../../../shared/utils/citations'
import {
  appendExcerptMarkdown,
  excerptAnchorFromHref,
  isExcerptSourceHref
} from '../../../../../shared/utils/excerpt'
import { useSourceAnchorNavigation } from '../../../hooks/useSourceAnchorNavigation'
import { useKnowledgeStore } from '../../../store/knowledgeStore'
import { subscribeAppendExcerpt } from './appendExcerptCommand'
import './noteEditor.css'

interface NoteEditorProps {
  /** 正在编辑的笔记 id。摘录追加命令按它匹配目标，不再靠「当前挂载的是谁」。 */
  noteId: string
  content: string
  onChange: (content: string) => void
}

/** 正文的当前 markdown。`onUpdate`、外部同步和摘录追加都走这一个序列化入口。 */
const markdownOf = (editor: Editor): string =>
  // SAFETY: `tiptap-markdown` 把 serializer 挂在 `editor.storage.markdown` 上，但它的
  // 类型增强没有覆盖到 @tiptap/core v3 的 storage 映射，所以 TS 看不到 `getMarkdown`。
  // 该扩展是下面 `useEditor` 的固定成员，挂载后这个字段必然存在（原本这里写的是 `as any`）。
  (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()

export default function NoteEditor({ noteId, content, onChange }: NoteEditorProps): ReactElement {
  const { t } = useTranslation('notebook')

  const documents = useKnowledgeStore((state) => state.documents)
  const documentsLoaded = useKnowledgeStore((state) => state.documentsLoaded)
  const { openSourceAnchor } = useSourceAnchorNavigation()

  const containerRef = useRef<HTMLDivElement>(null)

  // `useEditor` 只创建一次编辑器，`editorProps` 里的闭包不会随重渲染更新，所以点击派发
  // 需要的东西放在 ref 里读最新值，而不是捕获进创建时的闭包。
  const clickContext = useRef({ documents, documentsLoaded, openSourceAnchor })
  useEffect(() => {
    clickContext.current = { documents, documentsLoaded, openSourceAnchor }
  }, [documents, documentsLoaded, openSourceAnchor])

  const editor = useEditor({
    extensions: [
      // 摘录锚点是普通 markdown 链接（#73），交给下面自己的派发处理。Tiptap 的 Link 默认
      // `openOnClick: true`，会在可编辑状态下直接 `window.open(href)` —— 对笔记里的锚点
      // 是错的，对普通外链也绕过了应用的 openExternalUrl。
      StarterKit.configure({ link: { openOnClick: false } }),
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
      onChange(markdownOf(editor))
    }
  })

  // 编辑器实例由 useEditor 管理生命周期（@tiptap/react v3 会在卸载时销毁），
  // 这里不能手动 destroy：StrictMode 下 effect 会 mount → cleanup → mount，
  // 手动销毁会让第二次挂载拿到已销毁的实例，editor.storage.markdown 为 undefined。

  // 当外部 content 变化时同步到编辑器
  useEffect(() => {
    if (editor && content !== markdownOf(editor)) {
      editor.commands.setContent(content)
    }
  }, [content, editor])

  // 快捷键保存由 NoteEditorPanel 统一处理，因为它同时管理标题输入框。

  // 摘录追加（#73）：命令按 `noteId` 匹配，只被这篇笔记的编辑器消费；基线是它自己手上的
  // 正文，因此不存在「外部写入被编辑器用旧正文覆盖」的双写问题。
  // `setContent` 默认 emitUpdate，改动会沿既有 onUpdate → onChange → 保存路径流出去。
  useEffect(() => {
    if (!editor) return

    return subscribeAppendExcerpt(noteId, (excerptMarkdown) => {
      const current = markdownOf(editor)
      const next = appendExcerptMarkdown(current, excerptMarkdown)
      if (next === current) return
      editor.commands.setContent(next)
    })
  }, [editor, noteId])

  // 来源被删除时，正文里的锚点**原样保留**，只是不再可跳转 —— 「现在拿不到这份证据」和
  // 「这段笔记当初来自这里」是两件事。标记只写在 DOM 上，markdown 一个字节都不改。
  useEffect(() => {
    const root = containerRef.current
    if (!root) return

    for (const element of root.querySelectorAll('a[href]')) {
      const anchor = excerptAnchorFromHref(element.getAttribute('href'))
      const missing =
        anchor !== null && !sourceDocumentExists(documents, documentsLoaded, anchor.documentId)

      element.toggleAttribute('data-source-missing', missing)
      if (missing) element.setAttribute('aria-disabled', 'true')
      else element.removeAttribute('aria-disabled')
    }
  }, [documents, documentsLoaded, content, editor])

  /**
   * 笔记正文里的链接点击派发。
   *
   * 用 React 的 capture 而不是 `editorProps.handleClick`：这里的闭包每次渲染都是新的，
   * 不会读到过期的 documents；也不依赖 ProseMirror 插件与 view props 的处理顺序。
   *
   *   #know-note-source?...  → 应用内回到原文（复用 #72 的 openSourceAnchor）
   *   其它                   → 交给系统浏览器
   */
  const handleClickCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>): void => {
      const target = event.target
      if (!(target instanceof Element)) return

      const link = target.closest('a')
      if (!link) return

      const href = link.getAttribute('href')

      if (isExcerptSourceHref(href)) {
        event.preventDefault()
        const anchor = excerptAnchorFromHref(href)
        if (!anchor) return

        const context = clickContext.current
        // 来源已删除：不导航，也不把锚点从正文里删掉。但要说明为什么没反应，
        // 否则「已禁用」和「坏了」在用户看来是一样的。
        if (!sourceDocumentExists(context.documents, context.documentsLoaded, anchor.documentId)) {
          toast.error(t('excerptSourceMissing'))
          return
        }
        context.openSourceAnchor(anchor)
        return
      }

      // 交给系统浏览器。空 href 和纯 fragment 不是外部地址；协议白名单不在这里重造 ——
      // Link 的 renderHTML 已经把不被允许的协议写成 href=""。
      if (!href || href.startsWith('#')) return
      event.preventDefault()
      void window.api.openExternalUrl(href)
    },
    [t]
  )

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
        <div ref={containerRef} className="p-4" onClickCapture={handleClickCapture}>
          <EditorContent editor={editor} />
        </div>
      </ScrollArea>
    </div>
  )
}
