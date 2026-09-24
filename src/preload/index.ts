import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

/**
 * IPC 调用超时包装函数
 * @param channel IPC 频道名称
 * @param timeout 超时时间（毫秒）
 * @param args 参数
 * @returns Promise
 */
async function invokeWithTimeout<T>(channel: string, timeout: number, ...args: any[]): Promise<T> {
  return Promise.race([
    ipcRenderer.invoke(channel, ...args),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`IPC调用超时: ${channel} (${timeout}ms)`)), timeout)
    )
  ])
}

// Custom APIs for renderer
const api = {
  // 获取平台信息
  getPlatform: (): Promise<string> => ipcRenderer.invoke('get-platform'),

  // 获取应用版本号
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),

  // 在默认浏览器中打开外部链接
  openExternalUrl: (url: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('open-external-url', url),

  // 系统对话框相关
  dialog: {
    saveFile: (options: {
      title?: string
      defaultPath?: string
      filters?: { name: string; extensions: string[] }[]
    }) => ipcRenderer.invoke('dialog:saveFile', options)
  },

  // 应用设置相关
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    get: (key: string) => ipcRenderer.invoke('settings:get', { key }),
    update: (updates: any) => ipcRenderer.invoke('settings:update', { updates }),
    set: (key: string, value: any) => ipcRenderer.invoke('settings:set', { key, value }),
    reset: () => ipcRenderer.invoke('settings:reset'),
    getDefaultPrompts: () => ipcRenderer.invoke('settings:getDefaultPrompts'),
    // 监听设置变化
    onSettingsChange: (callback: (newSettings: any, oldSettings: any) => void) => {
      const listener = (_event: any, newSettings: any, oldSettings: any) =>
        callback(newSettings, oldSettings)
      ipcRenderer.on('settings:changed', listener)
      // 返回清理函数
      return () => ipcRenderer.removeListener('settings:changed', listener)
    }
  },

  // Notebook 相关
  createNotebook: (title: string, description?: string) =>
    ipcRenderer.invoke('create-notebook', { title, description }),
  getAllNotebooks: () => ipcRenderer.invoke('get-all-notebooks'),
  getNotebook: (id: string) => ipcRenderer.invoke('get-notebook', { id }),
  updateNotebook: (id: string, updates: any) =>
    ipcRenderer.invoke('update-notebook', { id, updates }),
  deleteNotebook: (id: string) => ipcRenderer.invoke('delete-notebook', { id }),

  // Note 相关
  createNote: (notebookId: string, content: string, customTitle?: string) =>
    ipcRenderer.invoke('create-note', { notebookId, title: customTitle || '', content }),
  getNotes: (notebookId: string) => ipcRenderer.invoke('get-notes', { notebookId }),
  getNote: (id: string) => ipcRenderer.invoke('get-note', { id }),
  updateNote: (id: string, updates: any) => ipcRenderer.invoke('update-note', { id, updates }),
  deleteNote: (id: string) => ipcRenderer.invoke('delete-note', { id }),

  // Items 相关（统一管理笔记、思维导图等）
  items: {
    getAll: (notebookId: string) => ipcRenderer.invoke('items:get', { notebookId }),
    updateOrder: (itemId: string, order: number) =>
      ipcRenderer.invoke('items:update-order', { itemId, order }),
    batchUpdateOrder: (updates: Record<string, number>) =>
      ipcRenderer.invoke('items:batch-update-order', { updates }),
    delete: (itemId: string, deleteResource = false) =>
      ipcRenderer.invoke('items:delete', { itemId, deleteResource })
  },

  // Chat Session 相关
  createChatSession: (notebookId: string, title: string) =>
    ipcRenderer.invoke('create-chat-session', { notebookId, title }),
  getChatSessions: (notebookId: string) => ipcRenderer.invoke('get-chat-sessions', { notebookId }),
  getActiveSession: (notebookId: string) =>
    ipcRenderer.invoke('get-active-session', { notebookId }),
  updateSessionTitle: (sessionId: string, title: string) =>
    ipcRenderer.invoke('update-session-title', { sessionId, title }),
  deleteSession: (sessionId: string) => ipcRenderer.invoke('delete-session', { sessionId }),

  // Chat Message 相关
  getMessages: (sessionId: string) => invokeWithTimeout('get-messages', 10000, { sessionId }),
  sendMessage: (sessionId: string, content: string) =>
    invokeWithTimeout('send-message', 60000, { sessionId, content }), // 60秒超时（流式消息可能较长）
  abortMessage: (messageId: string) => invokeWithTimeout('abort-message', 5000, { messageId }),

  // 流式消息监听
  onMessageChunk: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data)
    ipcRenderer.on('message-chunk', listener)
    // 返回清理函数
    return () => ipcRenderer.removeListener('message-chunk', listener)
  },

  onMessageError: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data)
    ipcRenderer.on('message-error', listener)
    return () => ipcRenderer.removeListener('message-error', listener)
  },

  // Session 自动切换监听
  onSessionAutoSwitched: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data)
    ipcRenderer.on('session-auto-switched', listener)
    return () => ipcRenderer.removeListener('session-auto-switched', listener)
  },

  // Model Connection 相关
  connections: {
    getAll: () => ipcRenderer.invoke('get-connections'),
    getProtocols: () => ipcRenderer.invoke('get-connection-protocols'),
    save: (capability: string, connection: any) =>
      invokeWithTimeout('save-connection', 5000, { capability, connection }),
    remove: (capability: string) => ipcRenderer.invoke('delete-connection', { capability }),
    test: (connection: any) => invokeWithTimeout('test-connection', 15000, { connection }), // 15秒超时（网络验证）
    fetchModels: (connection: any) =>
      invokeWithTimeout('fetch-connection-models', 15000, { connection }), // 15秒超时（网络请求）

    // 连接配置变更监听
    onChanged: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('connections-changed', listener)
      return () => ipcRenderer.removeListener('connections-changed', listener)
    }
  },

  // Knowledge 知识库相关
  knowledge: {
    // 添加文档
    addDocument: (notebookId: string, options: any) =>
      ipcRenderer.invoke('knowledge:add-document', { notebookId, options }),
    addDocumentFromFile: (notebookId: string, filePath: string) =>
      ipcRenderer.invoke('knowledge:add-document-from-file', { notebookId, filePath }),
    addDocumentFromUrl: (notebookId: string, url: string) =>
      ipcRenderer.invoke('knowledge:add-document-from-url', { notebookId, url }),
    addNote: (notebookId: string, noteId: string) =>
      ipcRenderer.invoke('knowledge:add-note', { notebookId, noteId }),

    // 搜索
    search: (notebookId: string, query: string, options?: any) =>
      ipcRenderer.invoke('knowledge:search', { notebookId, query, options }),

    // 文档管理
    getDocuments: (notebookId: string) =>
      ipcRenderer.invoke('knowledge:get-documents', { notebookId }),
    getDocument: (documentId: string) =>
      ipcRenderer.invoke('knowledge:get-document', { documentId }),
    getDocumentChunks: (documentId: string) =>
      ipcRenderer.invoke('knowledge:get-document-chunks', { documentId }),
    deleteDocument: (documentId: string) =>
      ipcRenderer.invoke('knowledge:delete-document', { documentId }),
    reindexDocument: (documentId: string) =>
      ipcRenderer.invoke('knowledge:reindex-document', { documentId }),

    // 统计
    getStats: (notebookId: string) => ipcRenderer.invoke('knowledge:get-stats', { notebookId }),

    // 文件选择
    selectFiles: () => ipcRenderer.invoke('knowledge:select-files'),

    // 打开源文件
    openSource: (documentId: string) => ipcRenderer.invoke('knowledge:open-source', { documentId }),

    // 进度监听
    onIndexProgress: (callback: (data: any) => void) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('knowledge:index-progress', listener)
      return () => ipcRenderer.removeListener('knowledge:index-progress', listener)
    }
  },

  // MindMap 思维导图相关
  mindmap: {
    // 生成思维导图
    generate: (notebookId: string) => ipcRenderer.invoke('mindmap:generate', { notebookId }),
    // 获取最新思维导图
    getLatest: (notebookId: string) => ipcRenderer.invoke('mindmap:get-latest', { notebookId }),
    // 获取思维导图详情
    get: (mindMapId: string) => ipcRenderer.invoke('mindmap:get', { mindMapId }),
    // 获取节点关联的chunks
    getNodeChunks: (mindMapId: string, nodeId: string) =>
      ipcRenderer.invoke('mindmap:get-node-chunks', { mindMapId, nodeId }),
    // 更新思维导图
    update: (mindMapId: string, updates: any) =>
      ipcRenderer.invoke('mindmap:update', { mindMapId, updates }),
    // 删除思维导图
    delete: (mindMapId: string) => ipcRenderer.invoke('mindmap:delete', { mindMapId }),
    // 打开思维导图窗口
    openWindow: (notebookId: string, mindMapId?: string) =>
      ipcRenderer.invoke('mindmap:open-window', { notebookId, mindMapId }),
    // 监听生成进度
    onProgress: (
      callback: (data: { notebookId: string; stage: string; progress: number }) => void
    ) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('mindmap:progress', listener)
      return () => ipcRenderer.removeListener('mindmap:progress', listener)
    }
  },

  // Quiz 答题相关
  quiz: {
    // 生成题目
    generate: (notebookId: string, options?: any) =>
      ipcRenderer.invoke('quiz:generate', { notebookId, options }),
    // 获取最新题库
    getLatest: (notebookId: string) => ipcRenderer.invoke('quiz:get-latest', { notebookId }),
    // 获取题库详情
    get: (quizId: string) => ipcRenderer.invoke('quiz:get', { quizId }),
    // 提交答题会话
    submitSession: (quizId: string, answers: Record<string, number>) =>
      ipcRenderer.invoke('quiz:submit-session', { quizId, answers }),
    // 获取答题会话
    getSession: (sessionId: string) => ipcRenderer.invoke('quiz:get-session', { sessionId }),
    // 更新题库
    update: (quizId: string, updates: { title?: string }) =>
      ipcRenderer.invoke('quiz:update', { quizId, updates }),
    // 删除题库
    delete: (quizId: string) => ipcRenderer.invoke('quiz:delete', { quizId }),
    // 打开答题窗口
    openWindow: (notebookId: string, quizId?: string) =>
      ipcRenderer.invoke('quiz:open-window', { notebookId, quizId }),
    // 监听生成进度
    onProgress: (
      callback: (data: { notebookId: string; stage: string; progress: number }) => void
    ) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('quiz:progress', listener)
      return () => ipcRenderer.removeListener('quiz:progress', listener)
    }
  },

  // Anki 卡片相关
  anki: {
    // 生成卡片
    generate: (notebookId: string, options?: any) =>
      ipcRenderer.invoke('anki:generate', { notebookId, options }),
    // 获取最新卡片集
    getLatest: (notebookId: string) => ipcRenderer.invoke('anki:get-latest', { notebookId }),
    // 获取卡片集详情
    get: (ankiCardId: string) => ipcRenderer.invoke('anki:get', { ankiCardId }),
    // 更新卡片集
    update: (ankiCardId: string, updates: { title?: string }) =>
      ipcRenderer.invoke('anki:update', { ankiCardId, updates }),
    // 删除卡片集
    delete: (ankiCardId: string) => ipcRenderer.invoke('anki:delete', { ankiCardId }),
    // 导出卡片
    export: (ankiCardId: string, format: any, deckName?: string) =>
      ipcRenderer.invoke('anki:export', { ankiCardId, format, deckName }),
    // 导出卡片到指定路径
    exportToPath: (ankiCardId: string, filePath: string) =>
      ipcRenderer.invoke('anki:exportToPath', { ankiCardId, filePath }),
    // 打开Anki窗口
    openWindow: (notebookId: string, ankiCardId?: string) =>
      ipcRenderer.invoke('anki:open-window', { notebookId, ankiCardId }),
    // 监听生成进度
    onProgress: (
      callback: (data: { notebookId: string; stage: string; progress: number }) => void
    ) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('anki:progress', listener)
      return () => ipcRenderer.removeListener('anki:progress', listener)
    }
  },

  // 应用更新相关
  update: {
    // 检查更新
    check: () => ipcRenderer.invoke('update:check'),
    // 下载更新
    download: () => ipcRenderer.invoke('update:download'),
    // 安装更新（退出并安装）
    install: () => ipcRenderer.invoke('update:install'),
    // 获取当前更新状态
    getState: () => ipcRenderer.invoke('update:get-state'),
    // 监听更新状态变化
    onStateChanged: (callback: (state: any) => void) => {
      const listener = (_event: any, state: any) => callback(state)
      ipcRenderer.on('update:state-changed', listener)
      return () => ipcRenderer.removeListener('update:state-changed', listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
