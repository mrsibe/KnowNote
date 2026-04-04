import type { AppSettings } from './types'
import { ShortcutAction, type ShortcutConfig } from '../../shared/types'

/**
 * 기본 설정 - 단일 데이터 소스
 * 모든 기본 설정이 여기에 정의되며, 다른 곳에서는 참조만 함
 */
export const defaultSettings: AppSettings = {
  theme: 'light',
  language: 'ko-KR',
  autoLaunch: false,
  hasCompletedOnboarding: false,
  defaultChatModel: undefined,
  defaultEmbeddingModel: undefined,
  prompts: {
    mindMap: {
      'ko-KR': `당신은 지식 구조 분석 전문가로, 노트북 내용에서 핵심 지식 구조를 추출하는 역할을 합니다.

**중요: 한국어로 답변하세요. 모든 노드 라벨은 반드시 한국어로 작성해야 합니다.**

**출력 형식 요구사항 (반드시 엄격히 준수):**
rootNode와 metadata를 포함하는 JSON 객체를 반환해야 합니다:
{
  "rootNode": {
    "id": "노드 고유 ID (문자열)",
    "label": "노드 라벨 (반드시 12자 이하)",
    "metadata": {
      "level": 0,
      "chunkIds": ["관련 chunk ID 배열"],
      "keywords": ["키워드 배열 (선택)"]
    },
    "children": [자식 노드 배열, 각 자식 노드는 동일한 구조]
  },
  "metadata": {
    "totalNodes": 총 노드 수 (숫자),
    "maxDepth": 최대 깊이 (숫자)
  }
}

**내용 요구사항:**
1. **모든 노드 라벨은 한국어로, 엄격히 12자 이하** (매우 중요!)
2. 계층 깊이 ≤ 4단계 (루트 노드 level=0, 최대 level=3)
3. 각 부모 노드는 2-5개의 자식 노드를 가져야 함
4. 각 노드의 id는 고유해야 함
5. 가능한 한 metadata.chunkIds에 관련 chunk ID를 연결
6. totalNodes는 실제 총 노드 수와 일치해야 함
7. maxDepth는 실제 최대 계층 깊이와 일치해야 함

**노트북 내용:**
{{CONTENT}}

위 내용을 기반으로 마인드맵 구조를 생성하고, 형식 요구사항에 따라 엄격히 JSON을 반환하세요.`,
      'en-US': `You are a knowledge structure analysis expert, responsible for extracting core knowledge structures from notebook content.

**IMPORTANT: Please respond in English. All node labels must be in English.**

**Output Format Requirements (MUST strictly follow):**
You must return a JSON object with rootNode and metadata:
{
  "rootNode": {
    "id": "unique node ID (string)",
    "label": "node label (must be ≤24 characters)",
    "metadata": {
      "level": 0,
      "chunkIds": ["array of related chunk IDs"],
      "keywords": ["array of keywords (optional)"]
    },
    "children": [array of child nodes, each with same structure]
  },
  "metadata": {
    "totalNodes": total number of nodes (number),
    "maxDepth": maximum depth (number)
  }
}

**Content Requirements:**
1. **All node labels must be in English and strictly ≤ 24 characters** (VERY IMPORTANT!)
2. Hierarchy depth ≤ 4 levels (root node level=0, deepest level=3)
3. Each parent node must have 2-5 child nodes
4. Each node's id must be unique
5. Associate relevant chunk IDs in metadata.chunkIds whenever possible
6. totalNodes must equal the actual total number of nodes
7. maxDepth must equal the actual maximum hierarchy depth

**Notebook Content:**
{{CONTENT}}

Please generate a mind map structure based on the above content, strictly following the format requirements to return JSON.`
    },
    quiz: {
      'ko-KR': `당신은 전문 문제 생성 전문가입니다. 아래 지식 베이스 내용을 기반으로 지식 테스트를 위한 {{QUESTION_COUNT}}개의 객관식 문제를 생성하세요.

**중요: 한국어로 답변하세요. 모든 문제와 선택지는 반드시 한국어로 작성해야 합니다.**

**출력 형식 요구사항 (반드시 엄격히 준수):**
questions와 metadata를 포함하는 JSON 객체를 반환해야 합니다:
{
  "questions": [
    {
      "id": "문제 고유 ID (문자열)",
      "questionText": "문제 텍스트 (200자 이내)",
      "options": ["선택지 A", "선택지 B", "선택지 C", "선택지 D"],
      "correctAnswer": 0,
      "explanation": "답 해설 (300자 이내)",
      "hints": ["힌트 1", "힌트 2"],
      "metadata": {
        "chunkIds": ["관련 chunk ID 배열"]
      }
    }
  ],
  "metadata": {
    "totalQuestions": {{QUESTION_COUNT}}
  }
}

**문제 요구사항:**
1. **{{QUESTION_COUNT}}개의 문제**를 생성하고, 각 문제는 4개의 선택지 (A, B, C, D)를 포함
2. **정답은 하나만**, correctAnswer는 0-3의 인덱스 값
3. **각 문제에 상세한 답 해설 제공** (왜 정답인지, 다른 선택지가 틀린 이유)
4. **각 문제에 1-2개의 힌트 제공** (답을 직접 주지 않고, 사고 방향을 안내)
5. 문제는 **제공된 지식 내용에 기반**해야 하며, 지어내지 말 것
6. **다양한 지식 포인트**를 다룰 것
7. {{DIFFICULTY_INSTRUCTION}}
8. 가능한 한 metadata.chunkIds에 관련 chunk ID를 연결

**지식 베이스 내용:**
{{CONTENT}}

{{QUESTION_COUNT}}개의 고품질 객관식 문제를 생성하고, 형식 요구사항에 따라 엄격히 JSON을 반환하세요.`,
      'en-US': `You are an expert quiz generator. Based on the knowledge base content below, generate {{QUESTION_COUNT}} multiple-choice questions for knowledge testing.

**IMPORTANT: Please respond in English. All questions and options must be in English.**

**Output Format Requirements (MUST strictly follow):**
You must return a JSON object with questions and metadata:
{
  "questions": [
    {
      "id": "unique question ID (string)",
      "questionText": "question text (max 200 chars)",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": 0,
      "explanation": "answer explanation (max 300 chars)",
      "hints": ["Hint 1", "Hint 2"],
      "metadata": {
        "chunkIds": ["array of related chunk IDs"]
      }
    }
  ],
  "metadata": {
    "totalQuestions": {{QUESTION_COUNT}}
  }
}

**Question Requirements:**
1. Generate **{{QUESTION_COUNT}} questions**, each with 4 options (A, B, C, D)
2. **Only one correct answer**, correctAnswer is an index value from 0-3
3. **Provide detailed explanation for each answer** (why it's correct, why others are wrong)
4. **Include 1-2 hints per question** (guide thinking, don't reveal answer directly)
5. Questions must be **based on provided content**, no fabrication
6. Cover **different knowledge points**
7. {{DIFFICULTY_INSTRUCTION}}
8. Associate relevant chunk IDs in metadata.chunkIds whenever possible

**Knowledge base content:**
{{CONTENT}}

Generate {{QUESTION_COUNT}} high-quality multiple-choice questions, strictly following the format requirements to return JSON.`
    },
    anki: {
      'ko-KR': `당신은 Anki 카드 생성 전문가입니다. 아래 지식 베이스 내용을 기반으로 {{CARD_COUNT}}장의 고품질 간격 반복 학습 카드를 생성하세요.

**중요: 한국어로 답변하세요. 모든 카드 내용은 반드시 한국어로 작성해야 합니다.**

**출력 형식 요구사항 (반드시 엄격히 준수):**
cards와 metadata를 포함하는 JSON 객체를 반환해야 합니다:
{
  "cards": [
    {
      "id": "카드 고유 ID (문자열)",
      "type": "basic",
      "front": "질문 텍스트",
      "back": "답변 텍스트",
      "tags": ["태그1", "태그2"],
      "metadata": {
        "chunkIds": ["관련 chunk ID 배열"],
        "difficulty": "medium"
      }
    }
  ],
  "metadata": {
    "totalCards": 총 카드 수
  }
}

**Basic 카드 설명:**
- type: "basic"
- front: 직접적인 질문
- back: 상세한 답변
- 적합: 정의, 개념, 원리, 질의응답

**생성 요구사항:**
1. **{{CARD_COUNT}}장의 카드**를 생성, 전부 basic 타입
2. 각 카드는 front(질문)와 back(답변) 필드를 포함해야 함
3. 질문은 간결하고 명확하게, 답변은 상세하고 정확하게
4. 각 카드에 관련 chunkIds를 연결
5. 적절한 태그 추가 (예: "중요", "개념", "원리", "공식" 등)
6. 실제 내용에 기반하여, 지어내지 말 것
7. {{DIFFICULTY_INSTRUCTION}}

**지식 베이스 내용:**
{{CONTENT}}

{{CARD_COUNT}}장의 고품질 Basic 타입 Anki 카드를 생성하고, 형식 요구사항에 따라 엄격히 JSON을 반환하세요.`,
      'en-US': `You are an Anki card generation expert. Based on the knowledge base content below, generate {{CARD_COUNT}} high-quality spaced repetition learning cards.

**IMPORTANT: Please respond in English. All card content must be in English.**

**Output Format Requirements (MUST strictly follow):**
You must return a JSON object with cards and metadata:
{
  "cards": [
    {
      "id": "unique card ID (string)",
      "type": "basic",
      "front": "question text",
      "back": "answer text",
      "tags": ["tag1", "tag2"],
      "metadata": {
        "chunkIds": ["array of related chunk IDs"],
        "difficulty": "medium"
      }
    }
  ],
  "metadata": {
    "totalCards": total number of cards
  }
}

**Basic Card Description:**
- type: "basic"
- front: direct question
- back: detailed answer
- Best for: definitions, concepts, principles, Q&A

**Generation Requirements:**
1. Generate **{{CARD_COUNT}} cards**, all of basic type
2. Each card must have front (question) and back (answer) fields
3. Questions should be concise and clear
4. Answers should be detailed and accurate
5. Associate relevant chunkIds for each card
6. Add appropriate tags (like "important", "concept", "principle", "formula")
7. Based on actual content, no fabrication
8. {{DIFFICULTY_INSTRUCTION}}

**Knowledge base content:**
{{CONTENT}}

Generate {{CARD_COUNT}} high-quality Basic type Anki cards, strictly following the format requirements to return JSON.`
    }
  }
}

/**
 * 기본 단축키 설정
 */
export const defaultShortcuts: ShortcutConfig[] = [
  // 노트북 관리
  {
    action: ShortcutAction.CREATE_NOTEBOOK,
    accelerator: 'CommandOrControl+N',
    enabled: true,
    description: 'shortcuts:createNotebook'
  },
  {
    action: ShortcutAction.CLOSE_NOTEBOOK,
    accelerator: 'Escape',
    enabled: true,
    description: 'shortcuts:closeNotebook'
  },

  // 패널 전환
  {
    action: ShortcutAction.TOGGLE_KNOWLEDGE_BASE,
    accelerator: 'CommandOrControl+[',
    enabled: true,
    description: 'shortcuts:toggleKnowledgeBase'
  },
  {
    action: ShortcutAction.TOGGLE_CREATIVE_SPACE,
    accelerator: 'CommandOrControl+]',
    enabled: true,
    description: 'shortcuts:toggleCreativeSpace'
  },
  // 편집기
  {
    action: ShortcutAction.SAVE_NOTE,
    accelerator: 'CommandOrControl+S',
    enabled: true,
    description: 'shortcuts:saveNote'
  }
]
