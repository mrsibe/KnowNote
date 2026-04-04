# KnowNote 에이전트 아키텍처 설계

## 개요

KnowNote의 기존 서비스 레이어를 확장하여 에이전트 패턴을 도입합니다.
현재의 서비스 아키텍처를 유지하면서 점진적으로 에이전트 시스템을 구축할 수 있도록 설계합니다.

## 현재 아키텍처

```
[Main Process]
├── ProviderManager (AI 프로바이더 관리)
├── KnowledgeService (RAG 파이프라인)
├── EmbeddingService (벡터 생성)
├── ChunkingService (문서 분할)
├── MindMapService (마인드맵 생성)
├── QuizService (퀴즈 생성)
└── AnkiCardService (Anki 카드 생성)
```

## 목표 아키텍처: 3계층 에이전트 시스템

```
┌─────────────────────────────────────────────────────────┐
│                 Agent Team Coordinator                   │
│  (작업 조율, 에이전트 상태 관리, 리소스 배분)              │
└────────┬──────────┬──────────┬──────────┬───────────────┘
         │          │          │          │
    ┌────▼────┐ ┌───▼────┐ ┌──▼───┐ ┌───▼────┐
    │Knowledge│ │  Chat  │ │Create│ │Analysis│
    │ Agent   │ │ Agent  │ │Agent │ │ Agent  │
    └────┬────┘ └───┬────┘ └──┬───┘ └───┬────┘
         │          │         │          │
    Sub-Agents Sub-Agents Sub-Agents Sub-Agents
```

---

## 계층 1: Agent Team Coordinator

### 역할
- 사용자 요청을 분석하여 적절한 에이전트에 작업 배분
- 에이전트 간 의존성 관리
- LLM 리소스(토큰, 동시 요청) 관리
- 작업 큐 관리

### 인터페이스
```typescript
interface AgentTeamCoordinator {
  // 작업 배분
  dispatch(task: AgentTask): Promise<AgentResult>
  
  // 에이전트 상태 조회
  getAgentStatus(agentId: string): AgentStatus
  
  // 작업 큐 관리
  getTaskQueue(): AgentTask[]
  cancelTask(taskId: string): void
  
  // 리소스 관리
  getResourceUsage(): ResourceUsage
}

interface AgentTask {
  id: string
  type: 'knowledge' | 'chat' | 'creative' | 'analysis'
  priority: number
  payload: any
  dependencies?: string[] // 선행 작업 ID
  onProgress?: (progress: number) => void
}

interface AgentResult {
  taskId: string
  status: 'success' | 'error' | 'cancelled'
  data: any
  metadata: {
    tokensUsed: number
    duration: number
    agentId: string
  }
}
```

### 구현 위치
- `src/main/agents/AgentTeamCoordinator.ts`

---

## 계층 2: 전문 에이전트 (Specialized Agents)

### 2-1. Knowledge Agent
**기존 서비스**: KnowledgeService, EmbeddingService, ChunkingService, FileParserService

**역할**: 문서 처리 파이프라인 전체를 관리하는 에이전트

```typescript
interface KnowledgeAgent {
  // 문서 수집 및 처리
  ingestDocument(source: DocumentSource): Promise<ProcessedDocument>
  
  // 지식 검색 (RAG)
  search(query: string, options: SearchOptions): Promise<SearchResult[]>
  
  // 지식 베이스 관리
  reindex(notebookId: string): Promise<void>
  getStats(notebookId: string): KnowledgeStats
}
```

**서브에이전트**:
| 서브에이전트 | 기존 서비스 | 역할 |
|---|---|---|
| Document Parser | FileParserService | PDF, DOCX, PPT, MD, Web 파싱 |
| Chunking Worker | ChunkingService | 의미 단위 문서 분할 |
| Embedding Worker | EmbeddingService | 벡터 임베딩 생성 (배치 처리) |

**구현 위치**: `src/main/agents/KnowledgeAgent.ts`

---

### 2-2. Chat Agent
**기존 서비스**: chatHandlers.ts의 RAG + 스트리밍 로직

**역할**: 대화 관리, RAG 컨텍스트 구성, 응답 생성

```typescript
interface ChatAgent {
  // 메시지 처리 (RAG 포함)
  processMessage(
    sessionId: string, 
    message: string, 
    onChunk: (chunk: StreamChunk) => void
  ): Promise<ChatResponse>
  
  // 세션 관리
  summarizeSession(sessionId: string): Promise<string>
  autoSwitchSession(notebookId: string, context: string): Promise<string>
}
```

**서브에이전트**:
| 서브에이전트 | 기존 코드 | 역할 |
|---|---|---|
| RAG Retriever | VectorStore search | 관련 문서 검색 및 컨텍스트 구성 |
| Response Generator | LLM streaming | 스트리밍 응답 생성 |

**구현 위치**: `src/main/agents/ChatAgent.ts`

---

### 2-3. Creative Agent
**기존 서비스**: MindMapService, QuizService, AnkiCardService

**역할**: 지식 기반 콘텐츠 생성

```typescript
interface CreativeAgent {
  // 마인드맵 생성
  generateMindMap(notebookId: string, options: MindMapOptions): Promise<MindMap>
  
  // 퀴즈 생성
  generateQuiz(notebookId: string, options: QuizOptions): Promise<Quiz>
  
  // Anki 카드 생성
  generateAnkiCards(notebookId: string, options: AnkiOptions): Promise<AnkiCard[]>
}
```

**서브에이전트**:
| 서브에이전트 | 기존 서비스 | 역할 |
|---|---|---|
| MindMap Generator | MindMapService | 계층적 지식 구조 생성 |
| Quiz Generator | QuizService | 객관식 문제 생성 |
| Anki Generator | AnkiCardService | 플래시카드 생성 |

**구현 위치**: `src/main/agents/CreativeAgent.ts`

---

### 2-4. Analysis Agent (향후 확장)
**역할**: 지식 분석 및 인사이트 도출

```typescript
interface AnalysisAgent {
  // 노트북 요약
  summarize(notebookId: string): Promise<Summary>
  
  // 주제 분류
  classifyTopics(notebookId: string): Promise<Topic[]>
  
  // 지식 갭 분석
  analyzeGaps(notebookId: string): Promise<GapAnalysis>
  
  // 유사 문서 추천
  recommend(documentId: string): Promise<Recommendation[]>
}
```

**구현 위치**: `src/main/agents/AnalysisAgent.ts`

---

## 계층 3: 서브에이전트 (Sub-Agents)

서브에이전트는 기존 서비스 클래스를 래핑하여 에이전트 인터페이스를 제공합니다.

```typescript
interface SubAgent<TInput, TOutput> {
  name: string
  status: 'idle' | 'busy' | 'error'
  
  execute(input: TInput): Promise<TOutput>
  cancel(): void
  getProgress(): number
}
```

---

## LM Studio 통합 전략

### 로컬 LLM 우선 정책
```
요청 수신 → LM Studio 연결 확인 → 
  ├── 연결됨: LM Studio로 처리
  └── 연결 안됨: 
      ├── Ollama 확인 → 연결됨: Ollama로 처리  
      └── 연결 안됨: API 프로바이더로 폴백 (OpenAI/DeepSeek)
```

### Provider 우선순위 설정
```typescript
interface ProviderPriority {
  chat: string[]     // ['lmstudio', 'ollama', 'openai', 'deepseek']
  embedding: string[] // ['lmstudio', 'ollama', 'openai', 'deepseek']
}
```

---

## 구현 로드맵

### Phase 1 (완료)
- [x] LM Studio 프로바이더 추가
- [x] 기존 서비스 아키텍처 유지

### Phase 2 (다음 단계)
- [ ] `AgentTeamCoordinator` 기본 클래스 구현
- [ ] 기존 서비스를 래핑하는 에이전트 어댑터 생성
- [ ] IPC 핸들러에서 Coordinator를 통한 작업 배분

### Phase 3 (향후)
- [ ] 에이전트 간 의존성 관리
- [ ] 작업 큐 및 우선순위 시스템
- [ ] Provider 자동 폴백 시스템
- [ ] Analysis Agent 구현

### Phase 4 (장기)
- [ ] 에이전트 성능 모니터링 대시보드
- [ ] 에이전트 학습 및 최적화
- [ ] 멀티 에이전트 협업 패턴

---

## 디렉토리 구조 (예정)

```
src/main/agents/
├── AgentTeamCoordinator.ts
├── types.ts
├── KnowledgeAgent.ts
├── ChatAgent.ts
├── CreativeAgent.ts
├── AnalysisAgent.ts
└── sub/
    ├── DocumentParserSubAgent.ts
    ├── ChunkingSubAgent.ts
    ├── EmbeddingSubAgent.ts
    ├── RAGRetrieverSubAgent.ts
    ├── ResponseGeneratorSubAgent.ts
    ├── MindMapSubAgent.ts
    ├── QuizSubAgent.ts
    └── AnkiSubAgent.ts
```

---

## 핵심 설계 원칙

1. **점진적 도입**: 기존 서비스를 유지하면서 에이전트 레이어를 추가
2. **로컬 우선**: LM Studio → Ollama → API 순서로 Provider 사용
3. **느슨한 결합**: 에이전트 간 인터페이스를 통한 통신
4. **관찰 가능성**: 각 에이전트의 상태, 진행률, 리소스 사용량 추적
5. **장애 허용**: Provider 연결 실패 시 자동 폴백
