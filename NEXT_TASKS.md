# KnowNote 후속 작업 가이드: Electron Sandbox 보안 + 테스트 프레임워크

> 이 문서는 로컬 Claude Code가 작업을 이어받기 위한 사전 조사 + 기획 + 테스트 계획입니다.
> 반드시 **실제 앱을 실행하여 테스트**한 후 변경사항을 확정하세요.

---

## 작업 1: Electron Sandbox 보안 강화

### 현재 상태
- `src/main/windows/mainWindow.ts` line 33: `sandbox: false`
- `src/preload/index.ts`: `contextBridge.exposeInMainWorld('api', api)` 사용 중
- contextIsolation은 electron-vite 기본값으로 `true` (명시적 설정 없음)

### 왜 sandbox: true가 중요한가
- sandbox가 false이면 preload 스크립트가 전체 Node.js API에 접근 가능
- XSS 취약점이 발생할 경우 공격자가 파일시스템, 네트워크 등에 접근 가능
- Electron 공식 보안 가이드에서 sandbox: true를 강력 권장

### 변경 방법
```typescript
// src/main/windows/mainWindow.ts line 31-34
webPreferences: {
  preload: join(__dirname, '../preload/index.js'),
  sandbox: true  // ← 변경
}
```

### 위험 분석

현재 preload 스크립트(`src/preload/index.ts`)는 이미 `contextBridge`를 올바르게 사용:
```typescript
contextBridge.exposeInMainWorld('api', api)      // line 309
contextBridge.exposeInMainWorld('electron', electronAPI)  // line 310
```

**잠재적 문제점:**
1. `@electron-toolkit/preload`의 `electronAPI`가 sandbox 모드에서 동작하는지 확인 필요
2. preload에서 `ipcRenderer`는 sandbox 모드에서도 사용 가능 (Electron 공식 지원)
3. `require()`나 `process`, `fs` 등 Node.js API를 preload에서 직접 사용하지 않으므로 대부분 안전

**확인 필요 사항 (각 항목별 앱 실행 테스트):**
- [ ] 앱 정상 시작 확인
- [ ] 채팅 메시지 전송/수신 확인
- [ ] 문서 업로드 (PDF, DOCX) 확인
- [ ] 벡터 검색 (RAG) 동작 확인
- [ ] 마인드맵/퀴즈/Anki 생성 확인
- [ ] 설정 저장/로드 확인
- [ ] 테마 전환 확인
- [ ] 프로바이더 설정 (LM Studio 연결) 확인

### 롤백 계획
sandbox: true가 문제를 일으키면 즉시 `sandbox: false`로 되돌리세요.

### 다른 윈도우도 확인
mindMapWindow, quizWindow, ankiWindow에도 sandbox 설정이 있을 수 있습니다:
- `src/main/windows/mindMapWindow.ts`
- `src/main/windows/quizWindow.ts`  
- `src/main/windows/ankiWindow.ts`
모든 윈도우의 webPreferences를 동일하게 변경해야 합니다.

---

## 작업 2: 테스트 프레임워크 도입 (vitest)

### 설치
```bash
pnpm add -D vitest @vitest/coverage-v8
```

### 설정 파일 생성
`vitest.config.ts` (프로젝트 루트):
```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'out', 'dist'],
    coverage: {
      provider: 'v8',
      include: ['src/main/**', 'src/shared/**']
    }
  },
  resolve: {
    alias: {
      '@main': '/src/main',
      '@shared': '/src/shared'
    }
  }
})
```

### package.json 스크립트 추가
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

### 우선순위별 테스트 파일

#### 1순위: 순수 유틸리티 (의존성 없음, 즉시 테스트 가능)
```
src/main/vectorstore/__tests__/quantize.test.ts
```
```typescript
import { describe, it, expect } from 'vitest'
import { float32ToInt8, int8ToFloat32 } from '../quantize'

describe('float32ToInt8', () => {
  it('양수값을 올바르게 양자화', () => {
    const input = new Float32Array([0.0, 0.5, 1.0])
    const result = float32ToInt8(input)
    expect(result).toBeInstanceOf(Int8Array)
    expect(result.length).toBe(3)
    expect(result[0]).toBe(-128)  // min → -128
    expect(result[2]).toBe(127)   // max → 127
  })

  it('음수값 포함 양자화', () => {
    const input = new Float32Array([-1.0, 0.0, 1.0])
    const result = float32ToInt8(input)
    expect(result[0]).toBe(-128)
    expect(result[1]).toBe(0)     // midpoint → ~0
    expect(result[2]).toBe(127)
  })

  it('모든 값이 동일한 경우', () => {
    const input = new Float32Array([0.5, 0.5, 0.5])
    const result = float32ToInt8(input)
    // range === 0이므로 모든 값이 0
    expect(result[0]).toBe(0)
    expect(result[1]).toBe(0)
  })

  it('빈 배열', () => {
    const input = new Float32Array([])
    const result = float32ToInt8(input)
    expect(result.length).toBe(0)
  })
})

describe('int8ToFloat32', () => {
  it('INT8을 Float32로 근사 복원', () => {
    const input = new Int8Array([-128, 0, 127])
    const result = int8ToFloat32(input)
    expect(result).toBeInstanceOf(Float32Array)
    expect(result[0]).toBeCloseTo(0, 1)
    expect(result[1]).toBeCloseTo(0.5, 1)
    expect(result[2]).toBeCloseTo(1, 1)
  })
})
```

#### 2순위: 내장 모델 설정 테스트
```
src/shared/config/models/__tests__/index.test.ts
```
```typescript
import { describe, it, expect } from 'vitest'
import { getBuiltinModels, hasBuiltinModels, getAllBuiltinModels } from '../index'

describe('getBuiltinModels', () => {
  it('LM Studio 모델 반환', () => {
    const models = getBuiltinModels('lmstudio')
    expect(models.length).toBeGreaterThan(0)
    expect(models.some(m => m.type === 'chat')).toBe(true)
    expect(models.some(m => m.type === 'embedding')).toBe(true)
  })

  it('Ollama 모델 반환', () => {
    const models = getBuiltinModels('ollama')
    expect(models.length).toBeGreaterThan(0)
  })

  it('존재하지 않는 프로바이더는 빈 배열', () => {
    const models = getBuiltinModels('nonexistent')
    expect(models).toEqual([])
  })

  it('삭제된 프로바이더는 빈 배열', () => {
    expect(getBuiltinModels('qwen')).toEqual([])
    expect(getBuiltinModels('kimi')).toEqual([])
    expect(getBuiltinModels('siliconflow')).toEqual([])
    expect(getBuiltinModels('zhipu')).toEqual([])
  })
})

describe('hasBuiltinModels', () => {
  it('등록된 프로바이더 확인', () => {
    expect(hasBuiltinModels('lmstudio')).toBe(true)
    expect(hasBuiltinModels('ollama')).toBe(true)
    expect(hasBuiltinModels('openai')).toBe(true)
    expect(hasBuiltinModels('deepseek')).toBe(true)
  })

  it('미등록 프로바이더 확인', () => {
    expect(hasBuiltinModels('qwen')).toBe(false)
    expect(hasBuiltinModels('nonexistent')).toBe(false)
  })
})

describe('getAllBuiltinModels', () => {
  it('모든 프로바이더의 모델 반환', () => {
    const all = getAllBuiltinModels()
    expect(Object.keys(all)).toContain('lmstudio')
    expect(Object.keys(all)).toContain('ollama')
    expect(Object.keys(all)).toContain('openai')
    expect(Object.keys(all)).toContain('deepseek')
    expect(Object.keys(all).length).toBe(4)
  })
})
```

#### 3순위: 프로바이더 레지스트리 테스트
```
src/main/providers/registry/__tests__/builtinProviders.test.ts
```
```typescript
import { describe, it, expect } from 'vitest'
import { BUILTIN_PROVIDERS, getBuiltinProvider, isBuiltinProvider } from '../builtinProviders'

describe('BUILTIN_PROVIDERS', () => {
  it('4개 프로바이더 등록됨', () => {
    expect(BUILTIN_PROVIDERS.length).toBe(4)
  })

  it('LM Studio가 첫 번째', () => {
    expect(BUILTIN_PROVIDERS[0].name).toBe('lmstudio')
    expect(BUILTIN_PROVIDERS[0].displayName).toBe('LM Studio')
    expect(BUILTIN_PROVIDERS[0].defaultBaseUrl).toBe('http://localhost:1234/v1')
    expect(BUILTIN_PROVIDERS[0].capabilities.chat).toBe(true)
    expect(BUILTIN_PROVIDERS[0].capabilities.embedding).toBe(true)
  })

  it('삭제된 프로바이더가 포함되지 않음', () => {
    const names = BUILTIN_PROVIDERS.map(p => p.name)
    expect(names).not.toContain('qwen')
    expect(names).not.toContain('kimi')
    expect(names).not.toContain('siliconflow')
    expect(names).not.toContain('zhipu')
  })
})

describe('getBuiltinProvider', () => {
  it('이름으로 프로바이더 조회', () => {
    const lmstudio = getBuiltinProvider('lmstudio')
    expect(lmstudio).toBeDefined()
    expect(lmstudio!.name).toBe('lmstudio')
  })

  it('존재하지 않는 프로바이더는 undefined', () => {
    expect(getBuiltinProvider('nonexistent')).toBeUndefined()
  })
})

describe('isBuiltinProvider', () => {
  it('내장 프로바이더 확인', () => {
    expect(isBuiltinProvider('lmstudio')).toBe(true)
    expect(isBuiltinProvider('ollama')).toBe(true)
  })

  it('비내장 프로바이더 확인', () => {
    expect(isBuiltinProvider('custom')).toBe(false)
  })
})
```

#### 4순위: RerankService 테스트 (mock 필요)
```
src/main/services/__tests__/RerankService.test.ts
```
```typescript
import { describe, it, expect, vi } from 'vitest'
import { RerankService } from '../RerankService'

// EmbeddingService mock
const mockEmbeddingService = {
  embed: vi.fn(),
  embedBatch: vi.fn()
} as any

describe('RerankService', () => {
  it('후보가 topN 이하이면 그대로 반환', async () => {
    const service = new RerankService(mockEmbeddingService)
    const candidates = [
      { chunkId: '1', content: 'test', score: 0.5 },
      { chunkId: '2', content: 'test2', score: 0.4 }
    ]
    const result = await service.rerank('query', candidates, 5)
    expect(result.length).toBe(2)
  })
})
```

#### 5순위: HybridSearchService의 RRF 테스트 (순수 로직)
```
src/main/services/__tests__/HybridSearchService.test.ts
```
이 테스트는 HybridSearchService의 private `rrfFusion` 메서드를 테스트하려면
메서드를 public이나 static으로 변경하거나, 전체 search를 mock으로 테스트해야 합니다.

### 테스트 실행
```bash
pnpm test           # 전체 실행
pnpm test:watch     # 감시 모드
pnpm test:coverage  # 커버리지 포함
```

### 주의사항
- Electron 의존 코드(ipcMain, BrowserWindow 등)는 vitest에서 직접 테스트 불가
- DB 의존 코드는 in-memory SQLite mock 필요 (better-sqlite3로 가능)
- 위 1~3순위 테스트는 순수 TypeScript 코드이므로 즉시 실행 가능

---

## 누락 사항 체크리스트

이 프로젝트에서 아직 남은 잠재적 개선사항:

- [ ] **Sandbox 보안**: 위 작업 1 참조
- [ ] **테스트 프레임워크**: 위 작업 2 참조
- [ ] **CSP 강화**: `src/renderer/index.html`의 `style-src 'unsafe-inline'` 제거 검토
- [ ] **ollama-ai-provider v1 제거 확인**: package.json에서 제거했으나 pnpm install 재실행 필요
- [ ] **앱 제목 변경**: `src/renderer/index.html` line 5의 `<title>Electron</title>` → `<title>KnowNote</title>`
- [ ] **onboarding 페이지**: LM Studio가 첫 번째 프로바이더로 안내되는지 확인

---

## 실행 순서 권장

1. `pnpm install` (패키지 정리 반영)
2. `pnpm dev` (앱 실행)
3. 전체 기능 수동 테스트
4. sandbox: true 변경 → 재시작 → 테스트
5. vitest 설치 → 테스트 작성 → `pnpm test`
6. 문제 없으면 커밋
