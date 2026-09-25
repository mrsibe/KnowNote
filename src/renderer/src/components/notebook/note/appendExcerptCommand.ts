/**
 * 「把一段摘录追加进当前笔记」的命令通道（#73）。
 *
 * 摘录来自左栏的阅读器，但**笔记正文只有笔记编辑器拥有**：`NoteEditorPanel` 把正文存在
 * 自己的局部 state 里，`NoteEditor` 持有真正的那份 ProseMirror 文档。如果阅读器直接去改
 * `itemStore.updateNote()`，就会出现两个写入源，编辑器下一次 `onUpdate` 会拿它手上的旧
 * 正文把刚追加的摘录覆盖掉。
 *
 * 所以这里只传一个请求，不传状态：阅读器说「请把这段摘录追加进这篇笔记」，谁来追加、基于
 * 什么基线追加，由当前挂载的那个编辑器自己决定。真正拥有编辑状态的人负责修改编辑状态。
 *
 * 命令必须带目标 `noteId`。只靠「当前挂载的编辑器」来匹配是错的：编辑器 A 正在卸载、用户
 * 已经切到笔记 B 的时候，这条请求会被 B 的编辑器消费，摘录就落到错误的笔记里。这在这里
 * 不会发生（`NotePanel` 一次只挂载一个编辑器），但不该由「通常只有一个」来承担，匹配目标
 * 是这一层的正确性前提，而不是可以依赖的巧合。
 *
 * 之所以是一条命令而不是 store 里的一个字段：命令只投递给**当时在场的**订阅者，不会被
 * 重放。放进 store 当状态的话，React 严格模式下 effect 的 mount → cleanup → mount 会让
 * 同一个值被消费两次，摘录就重复了。
 */

interface AppendExcerptCommand {
  /** 这段摘录属于哪篇笔记。 */
  noteId: string
  markdown: string
}

type AppendExcerptHandler = (excerptMarkdown: string) => void

/**
 * 还没有匹配的订阅者时留住最后一条请求。
 *
 * 「先发命令、目标编辑器还没挂上」这个窗口期真的存在（新建笔记后编辑器才挂载），静默丢掉
 * 一条用户刚点的摘录是不能接受的。只留一条就够了：目标笔记的编辑器挂载时会把它取走。
 */
let pending: AppendExcerptCommand | null = null

/** 同时只应该有一个消费者：`NotePanel` 一次只渲染一个编辑器，一篇文章只有一个写入者。 */
let listener: { noteId: string; handler: AppendExcerptHandler } | null = null

/** 请求把一段摘录追加进 `noteId` 这篇笔记。 */
export function requestAppendExcerpt(noteId: string, excerptMarkdown: string): void {
  if (listener && listener.noteId === noteId) {
    listener.handler(excerptMarkdown)
    return
  }

  pending = { noteId, markdown: excerptMarkdown }
}

/**
 * 以 `noteId` 这篇笔记的身份订阅追加请求，返回取消订阅的函数。
 *
 * 有一条不属于自己的待处理请求时**不消费**，把它留给真正的目标 —— 这正是带 `noteId` 的
 * 意义所在。属于自己且还没人消费的那条会在订阅瞬间补发一次并清掉，因此补发只可能发生
 * 一次（不会有第二次 mount 又把它消费一遍）。
 */
export function subscribeAppendExcerpt(noteId: string, handler: AppendExcerptHandler): () => void {
  const entry = { noteId, handler }
  listener = entry

  if (pending !== null && pending.noteId === noteId) {
    const queued = pending
    pending = null
    handler(queued.markdown)
  }

  return () => {
    if (listener === entry) listener = null
  }
}
