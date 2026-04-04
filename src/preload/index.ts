import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

/**
 * IPC 호출 타임아웃 래핑 함수
 * @param channel IPC 채널 이름
 * @param timeout 타임아웃 시간 (밀리초)
 * @param args 매개변수
 * @returns Promise
 */
async function invokeWithTimeout<T>(channel: string, timeout: number, ...args: any[]): Promise<T> {
  return Promise.race([
    ipcRenderer.invoke(channel, ...args),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`IPC 호출 타임아웃: ${channel} (${timeout}ms)`)), timeout)
    )
  ])
}

// Custom APIs for renderer
const api = {
  // 플랫폼 정보 조회
  getPlatform: (): Promise<string> => ipcRenderer.invoke('get-platform'),

  // 앱 버전 번호 조회
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),

  // 기본 브라우저에서 외부 링크 열기
  openExternalUrl: (url: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('open-external-url', url),

  // 시스템 다이얼로그 관련
  dialog: {
    saveFile: (options: {
      title?: string
      defaultPath?: string
      filters?: { name: string; extensions: string[] }[]
    }) => ipcRenderer.invoke('dialog:saveFile', options)
  },

  // 앱 설정 관련
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    get: (key: string) => ipcRenderer.invoke('settings:get', { key }),
    update: (updates: any) => ipcRenderer.invoke('settings:update', { updates }),
    set: (key: string, value: any) => ipcRenderer.invoke('settings:set', { key, value }),
    reset: () => ipcRenderer.invoke('settings:reset'),
    getDefaultPrompts: () => ipcRenderer.invoke('settings:getDefaultPrompts'),
    // 설정 변경 감시
    onSettingsChange: (callback: (newSettings: any, oldSettings: any) => void) => {
      const listener = (_event: any, newSettings: any, oldSettings: any) =>
        callback(newSettings, oldSettings)
      ipcRenderer.on('settings:changed', listener)
      // 정리 함수 반환
      return () => ipcRenderer.removeListener('settings:changed', listener)
    }
  },

  // Notebook 관련
  createNotebook: (title: string, description?: string) =>
    ipcRenderer.invoke('create-notebook', { title, description }),
  getAllNotebooks: () => ipcRenderer.invoke('get-all-notebooks'),
  getNotebook: (id: string) => ipcRenderer.invoke('get-notebook', { id }),
  updateNotebook: (id: string, updates: any) =>
    ipcRenderer.invoke('update-notebook', { id, updates }),
  deleteNotebook: (id: string) => ipcRenderer.invoke('delete-notebook', { id }),

  // Note 관련
  createNote: (notebookId: string, content: string, customTitle?: string) =>
    ipcRenderer.invoke('create-note', { notebookId, title: customTitle || '', content }),
  getNotes: (notebookId: string) => ipcRenderer.invoke('get-notes', { notebookId }),
  getNote: (id: string) => ipcRenderer.invoke('get-note', { id }),
  updateNote: (id: string, updates: any) => ipcRenderer.invoke('update-note', { id, updates }),
  deleteNote: (id: string) => ipcRenderer.invoke('delete-note', { id }),

  // Items 관련 (노트, 마인드맵 등 통합 관리)
  items: {
    getAll: (notebookId: string) => ipcRenderer.invoke('items:get', { notebookId }),
    updateOrder: (itemId: string, order: number) =>
      ipcRenderer.invoke('items:update-order', { itemId, order }),
    batchUpdateOrder: (updates: Record<string, number>) =>
      ipcRenderer.invoke('items:batch-update-order', { updates }),
    delete: (itemId: string, deleteResource = false) =>
      ipcRenderer.invoke('items:delete', { itemId, deleteResource })
  },

  // Chat Session 관련
  createChatSession: (notebookId: string, title: string) =>
    ipcRenderer.invoke('create-chat-session', { notebookId, title }),
  getChatSessions: (notebookId: string) => ipcRenderer.invoke('get-chat-sessions', { notebookId }),
  getActiveSession: (notebookId: string) =>
    ipcRenderer.invoke('get-active-session', { notebookId }),
  updateSessionTitle: (sessionId: string, title: string) =>
    ipcRenderer.invoke('update-session-title', { sessionId, title }),
  deleteSession: (sessionId: string) => ipcRenderer.invoke('delete-session', { sessionId }),

  // Chat Message 관련
  getMessages: (sessionId: string) => invokeWithTimeout('get-messages', 10000, { sessionId }),
  sendMessage: (sessionId: string, content: string) =>
    invokeWithTimeout('send-message', 60000, { sessionId, content }), // 60초 타임아웃 (스트리밍 메시지는 시간이 더 걸릴 수 있음)
  abortMessage: (messageId: string) => invokeWithTimeout('abort-message', 5000, { messageId }),

  // 스트리밍 메시지 리스너
  onMessageChunk: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data)
    ipcRenderer.on('message-chunk', listener)
    // 정리 함수 반환
    return () => ipcRenderer.removeListener('message-chunk', listener)
  },

  onMessageError: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data)
    ipcRenderer.on('message-error', listener)
    return () => ipcRenderer.removeListener('message-error', listener)
  },

  // Session 자동 전환 리스너
  onSessionAutoSwitched: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data)
    ipcRenderer.on('session-auto-switched', listener)
    return () => ipcRenderer.removeListener('session-auto-switched', listener)
  },

  // Provider 설정 관련
  saveProviderConfig: (config: any) => invokeWithTimeout('save-provider-config', 5000, config),
  getProviderConfig: (providerName: string) =>
    ipcRenderer.invoke('get-provider-config', { providerName }),
  getAllProviderConfigs: () => ipcRenderer.invoke('get-all-provider-configs'),
  deleteProviderConfig: (providerName: string) =>
    ipcRenderer.invoke('delete-provider-config', { providerName }),
  validateProviderConfig: (providerName: string, config: any) =>
    invokeWithTimeout('validate-provider-config', 15000, { providerName, config }), // 15초 타임아웃 (네트워크 검증)
  fetchModels: (providerName: string, apiKey: string) =>
    invokeWithTimeout('fetch-models', 15000, { providerName, apiKey }), // 15초 타임아웃 (네트워크 요청)
  getProviderModels: (providerName: string) =>
    ipcRenderer.invoke('get-provider-models', { providerName }),

  // Provider 설정 변경 리스너
  onProviderConfigChanged: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('provider-config-changed', listener)
    return () => ipcRenderer.removeListener('provider-config-changed', listener)
  },

  // Knowledge 지식 베이스 관련
  knowledge: {
    // 문서 추가
    addDocument: (notebookId: string, options: any) =>
      ipcRenderer.invoke('knowledge:add-document', { notebookId, options }),
    addDocumentFromFile: (notebookId: string, filePath: string) =>
      ipcRenderer.invoke('knowledge:add-document-from-file', { notebookId, filePath }),
    addDocumentFromUrl: (notebookId: string, url: string) =>
      ipcRenderer.invoke('knowledge:add-document-from-url', { notebookId, url }),
    addNote: (notebookId: string, noteId: string) =>
      ipcRenderer.invoke('knowledge:add-note', { notebookId, noteId }),

    // 검색
    search: (notebookId: string, query: string, options?: any) =>
      ipcRenderer.invoke('knowledge:search', { notebookId, query, options }),

    // 문서 관리
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

    // 통계
    getStats: (notebookId: string) => ipcRenderer.invoke('knowledge:get-stats', { notebookId }),

    // 파일 선택
    selectFiles: () => ipcRenderer.invoke('knowledge:select-files'),

    // 소스 파일 열기
    openSource: (documentId: string) => ipcRenderer.invoke('knowledge:open-source', { documentId }),

    // 인덱싱 진행률 리스너
    onIndexProgress: (callback: (data: any) => void) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('knowledge:index-progress', listener)
      return () => ipcRenderer.removeListener('knowledge:index-progress', listener)
    }
  },

  // MindMap 마인드맵 관련
  mindmap: {
    // 마인드맵 생성
    generate: (notebookId: string) => ipcRenderer.invoke('mindmap:generate', { notebookId }),
    // 최신 마인드맵 조회
    getLatest: (notebookId: string) => ipcRenderer.invoke('mindmap:get-latest', { notebookId }),
    // 마인드맵 상세 조회
    get: (mindMapId: string) => ipcRenderer.invoke('mindmap:get', { mindMapId }),
    // 노드 연관 chunks 조회
    getNodeChunks: (mindMapId: string, nodeId: string) =>
      ipcRenderer.invoke('mindmap:get-node-chunks', { mindMapId, nodeId }),
    // 마인드맵 업데이트
    update: (mindMapId: string, updates: any) =>
      ipcRenderer.invoke('mindmap:update', { mindMapId, updates }),
    // 마인드맵 삭제
    delete: (mindMapId: string) => ipcRenderer.invoke('mindmap:delete', { mindMapId }),
    // 마인드맵 윈도우 열기
    openWindow: (notebookId: string, mindMapId?: string) =>
      ipcRenderer.invoke('mindmap:open-window', { notebookId, mindMapId }),
    // 생성 진행률 리스너
    onProgress: (
      callback: (data: { notebookId: string; stage: string; progress: number }) => void
    ) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('mindmap:progress', listener)
      return () => ipcRenderer.removeListener('mindmap:progress', listener)
    }
  },

  // Quiz 퀴즈 관련
  quiz: {
    // 문제 생성
    generate: (notebookId: string, options?: any) =>
      ipcRenderer.invoke('quiz:generate', { notebookId, options }),
    // 최신 문제 은행 조회
    getLatest: (notebookId: string) => ipcRenderer.invoke('quiz:get-latest', { notebookId }),
    // 문제 은행 상세 조회
    get: (quizId: string) => ipcRenderer.invoke('quiz:get', { quizId }),
    // 퀴즈 세션 제출
    submitSession: (quizId: string, answers: Record<string, number>) =>
      ipcRenderer.invoke('quiz:submit-session', { quizId, answers }),
    // 퀴즈 세션 조회
    getSession: (sessionId: string) => ipcRenderer.invoke('quiz:get-session', { sessionId }),
    // 문제 은행 업데이트
    update: (quizId: string, updates: { title?: string }) =>
      ipcRenderer.invoke('quiz:update', { quizId, updates }),
    // 문제 은행 삭제
    delete: (quizId: string) => ipcRenderer.invoke('quiz:delete', { quizId }),
    // 퀴즈 윈도우 열기
    openWindow: (notebookId: string, quizId?: string) =>
      ipcRenderer.invoke('quiz:open-window', { notebookId, quizId }),
    // 생성 진행률 리스너
    onProgress: (
      callback: (data: { notebookId: string; stage: string; progress: number }) => void
    ) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('quiz:progress', listener)
      return () => ipcRenderer.removeListener('quiz:progress', listener)
    }
  },

  // Anki 카드 관련
  anki: {
    // 카드 생성
    generate: (notebookId: string, options?: any) =>
      ipcRenderer.invoke('anki:generate', { notebookId, options }),
    // 최신 카드 세트 조회
    getLatest: (notebookId: string) => ipcRenderer.invoke('anki:get-latest', { notebookId }),
    // 카드 세트 상세 조회
    get: (ankiCardId: string) => ipcRenderer.invoke('anki:get', { ankiCardId }),
    // 카드 세트 업데이트
    update: (ankiCardId: string, updates: { title?: string }) =>
      ipcRenderer.invoke('anki:update', { ankiCardId, updates }),
    // 카드 세트 삭제
    delete: (ankiCardId: string) => ipcRenderer.invoke('anki:delete', { ankiCardId }),
    // 카드 내보내기
    export: (ankiCardId: string, format: any, deckName?: string) =>
      ipcRenderer.invoke('anki:export', { ankiCardId, format, deckName }),
    // 지정 경로로 카드 내보내기
    exportToPath: (ankiCardId: string, filePath: string) =>
      ipcRenderer.invoke('anki:exportToPath', { ankiCardId, filePath }),
    // Anki 윈도우 열기
    openWindow: (notebookId: string, ankiCardId?: string) =>
      ipcRenderer.invoke('anki:open-window', { notebookId, ankiCardId }),
    // 생성 진행률 리스너
    onProgress: (
      callback: (data: { notebookId: string; stage: string; progress: number }) => void
    ) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('anki:progress', listener)
      return () => ipcRenderer.removeListener('anki:progress', listener)
    }
  },

  // 앱 업데이트 관련
  update: {
    // 업데이트 확인
    check: () => ipcRenderer.invoke('update:check'),
    // 업데이트 다운로드
    download: () => ipcRenderer.invoke('update:download'),
    // 업데이트 설치 (종료 후 설치)
    install: () => ipcRenderer.invoke('update:install'),
    // 현재 업데이트 상태 조회
    getState: () => ipcRenderer.invoke('update:get-state'),
    // 업데이트 상태 변경 리스너
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
