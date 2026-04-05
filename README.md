<div align="center">

# KnowNote

> 로컬 우선, 오픈소스 Google NotebookLM 대안  
> 프라이빗 LLM, Docker 불필요, 완전한 제어를 원하는 학습자와 개발자를 위해 만들어졌습니다.

**문서를 지능형 대화식 지식 베이스로 변환하세요**

[![GitHub release](https://img.shields.io/github/v/release/MrSibe/KnowNote)](https://github.com/MrSibe/KnowNote/releases)
[![GitHub stars](https://img.shields.io/github/stars/MrSibe/KnowNote)](https://github.com/MrSibe/KnowNote/stargazers)
[![License](https://img.shields.io/github/license/MrSibe/KnowNote)](https://github.com/MrSibe/KnowNote/blob/main/LICENSE)

[한국어](README.md) | [English (원본)](https://github.com/MrSibe/KnowNote)

</div>

> **이 프로젝트는 [@MrSibe](https://github.com/MrSibe)님의 [KnowNote](https://github.com/MrSibe/KnowNote)를 Fork하여 회사 내부용으로 커스터마이징한 버전입니다.**  
> 원본 프로젝트의 모든 저작권과 라이선스는 원저작자에게 있습니다.

---

## 감사의 말

이 프로젝트는 [@MrSibe](https://github.com/MrSibe)님이 처음 개발하고 오픈소스로 공개한 [KnowNote](https://github.com/MrSibe/KnowNote)를 기반으로 합니다.

훌륭한 아이디어와 깔끔한 아키텍처를 오픈소스로 공유해주신 MrSibe님께 진심으로 감사드립니다. 원본 프로젝트가 없었다면 이 한국어 버전도 존재하지 않았을 것입니다. Thank you, MrSibe!

> **원본 프로젝트**: [https://github.com/MrSibe/KnowNote](https://github.com/MrSibe/KnowNote)  
> **라이선스**: GPL-3.0 License

---

## 왜 KnowNote인가?

**Google NotebookLM**의 아이디어는 정말 훌륭합니다:
문서를 업로드하고, 컨텍스트를 구축하고, LLM으로 추론하는 것.

하지만 다음과 같은 것들이 필요했습니다:

- 자체 **프라이빗 또는 자체 관리 LLM API** 사용
- 클라우드 종속 없이 **모든 데이터를 로컬에 보관**
- **Docker나 복잡한 배포 없이** 도구 사용

GitHub에서 많은 인상적인 "Open Notebook" 프로젝트를 발견했지만,
거의 모든 프로젝트가 Docker에 의존합니다.
초보자나 비백엔드 사용자에게는 그것만으로도 진입 장벽이 됩니다.

그래서 **KnowNote**가 만들어졌습니다:  
NotebookLM 스타일의 워크플로우를 **로컬 우선, Docker 불필요 환경**에서
실현하는 간단한 Electron 기반 데스크톱 앱입니다.

---

## 이 포크(Fork) 버전의 변경사항

이 버전은 **회사 온프레미스 환경**에 최적화된 한국어 커스텀 버전입니다:

- **LM Studio 프로바이더 추가** - 로컬 LLM 서버 1순위 지원
- **한국어 완전 지원** - UI, 주석, 프롬프트 모두 한국어화
- **보안 강화** - 자동 업데이트 비활성화, 불필요한 외부 프로바이더 제거
- **밝은 테마** - 깔끔한 기업용 라이트 테마 기본 적용
- **에이전트 아키텍처 설계** - 향후 확장을 위한 3계층 에이전트 시스템 설계

---

## KnowNote가 하는 일

- 📚 문서와 노트로 로컬 지식 베이스 구축
- 💬 LLM을 활용한 채팅, 요약, 추론
- 🔌 프로바이더 기반 LLM 설계 (LM Studio, Ollama, OpenAI, DeepSeek)
- 🔍 정확한 출처 추적이 가능한 RAG 기반 검색
- 🖥️ Electron 기반 데스크톱 앱 — Docker 불필요, 서버 설정 불필요

---

## 이런 분들을 위해 만들어졌습니다

- NotebookLM이 좋지만 더 많은 제어가 필요한 분
- 프라이빗 또는 자체 호스팅 LLM API를 선호하는 분
- 아이디어를 시도하기 위해 Docker를 띄우고 싶지 않은 분
- 학습과 연구를 위한 간단한 데스크톱 앱을 원하는 분
- **회사 내부에서 보안이 보장된 지식관리 도구**가 필요한 분

---

## 미리보기

<div align="center">
  <img src="./.github/images/screenshot-main.png" alt="KnowNote 메인 인터페이스" width="800">
  <p><i>3단 레이아웃: 지식 라이브러리 · AI 질의응답 · 노트 출력</i></p>
</div>

---

## 주요 기능

### 📚 문서 관리

- PDF, Word (.docx), PowerPoint (.pptx), 웹 페이지 지원
- 자동 구조 분석 및 콘텐츠 추출
- SQLite 기반 빠른 로컬 저장

### 🤖 AI 기반 질의응답

- 검색 증강 생성 (RAG)
- 다중 LLM 프로바이더 지원
- 정확한 출처 참조가 포함된 답변

### 🔒 로컬 우선 설계

- 모든 데이터 로컬 저장
- 오프라인 친화적 (LLM API는 선택사항)
- 지식 자산에 대한 완전한 제어

### 🔍 벡터 검색

- sqlite-vec를 활용한 시맨틱 검색
- 빠르고 정확한 검색

### ⚡ 경량 & 크로스 플랫폼

- Electron 기반 데스크톱 앱
- Windows 및 macOS 지원

---

## 프로바이더 지원

| 프로바이더    | 유형 | 채팅 | 임베딩 | 비고                           |
| ------------- | ---- | ---- | ------ | ------------------------------ |
| **LM Studio** | 로컬 | ✅   | ✅     | 1순위 권장, OpenAI 호환 API    |
| **Ollama**    | 로컬 | ✅   | ✅     | 로컬 LLM 대안                  |
| **OpenAI**    | API  | ✅   | ✅     | GPT-4o, text-embedding-3-small |
| **DeepSeek**  | API  | ✅   | ✅     | DeepSeek-Chat, 추론 지원       |

---

## 프로젝트 상태

KnowNote는 초기 단계 프로젝트입니다.  
일부는 아직 다듬어지지 않았지만, 기반은 갖추어져 있습니다.

### ✅ 완료

- 다중 프로바이더 AI LLM 대화
- 구조화된 노트 생성
- 원클릭 마인드맵 생성
- RAG 기반 문서 검색
- 다중 형식 문서 가져오기 (PDF / Word / PPT / 웹)
- Anki 플래시카드 생성 및 내보내기
- 퀴즈 생성

### 🚧 개발 중

- 오디오 업로드 및 전사
- 노트에서 PPT 자동 생성

### 📋 계획

- 에이전트 팀 아키텍처 구현 (설계 완료, [AGENT_ARCHITECTURE.md](AGENT_ARCHITECTURE.md) 참조)
- 더 많은 아이디어가 진행 중입니다 — Issues에서 기능을 제안해 주세요.

---

## 빠른 시작

### 다운로드

GitHub Releases에서 최신 버전을 받으세요:

- **Windows**: `KnowNote-Setup-{version}.exe`
- **macOS**: `KnowNote-{version}.dmg` / `KnowNote-{version}-arm64.dmg`

### 개발 환경

```bash
git clone https://github.com/MrSibe/KnowNote.git
cd KnowNote
pnpm install
pnpm dev
```

---

## 기술 스택

Electron · React · TypeScript · Vite · TailwindCSS
SQLite · sqlite-vec · Drizzle ORM
pdfjs-dist · mammoth · officeparser · Tiptap

---

## 프로젝트 구조

```plaintext
KnowNote/
├── src/
│   ├── main/              # Electron 메인 프로세스
│   │   ├── db/            # 데이터베이스 설정 및 스키마
│   │   ├── services/      # 핵심 로직 (문서 파싱, RAG 등)
│   │   └── providers/     # LLM 프로바이더 추상화
│   ├── renderer/          # React 렌더러 프로세스
│   ├── preload/           # Electron 프리로드 스크립트
│   └── shared/            # 공유 타입 및 유틸리티
├── resources/             # 앱 리소스 (아이콘 등)
├── build/                 # 빌드 설정
└── out/                   # 빌드 출력
```

---

## 피드백 & 기여

Issues, 토론, Pull Request 모두 환영합니다.

다음에 대한 아이디어가 있으시면:

- 학습 워크플로우
- 지식 시각화
- 모델/프로바이더 추상화

언제든지 의견을 나눠주세요.

---

## 라이선스

이 프로젝트는 **GPL-3.0 License**로 라이선스됩니다.

---

## 감사 (Acknowledgments)

- **[@MrSibe](https://github.com/MrSibe)** — KnowNote 원본 프로젝트 개발자. 이 훌륭한 프로젝트를 오픈소스로 공개해주셔서 감사합니다!
- [Google NotebookLM](https://notebooklm.google/) — 영감의 원천
- [Electron](https://www.electronjs.org/) — 크로스 플랫폼 데스크톱 프레임워크
- [React](https://react.dev/) — UI 프레임워크
- [SQLite](https://www.sqlite.org/) & [sqlite-vec](https://github.com/asg017/sqlite-vec) — 로컬 저장 및 벡터 검색
- [LM Studio](https://lmstudio.ai/) — 로컬 LLM 서버
- [Ollama](https://ollama.com/) — 로컬 LLM 실행기

---

## Star History

<a href="https://www.star-history.com/#MrSibe/KnowNote&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=MrSibe/KnowNote&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=MrSibe/KnowNote&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=MrSibe/KnowNote&type=date&legend=top-left" />
 </picture>
</a>

---

이 프로젝트가 마음에 드신다면, 사용해보시고, 스타를 눌러주시거나, 피드백을 남겨주세요.
확인해주셔서 감사합니다!

<div align="center">
  <p>원본 프로젝트: <a href="https://github.com/MrSibe">@MrSibe</a> | 한국어 포크: 온프레미스 최적화 버전</p>
</div>
