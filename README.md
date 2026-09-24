<div align="center">

# KnowNote

> A local-first, open-source alternative to Google NotebookLM  
> Built for learners and developers who want private LLMs, no Docker, and full control.

**Transform your documents into an intelligent, conversational knowledge base**

[![GitHub release](https://img.shields.io/github/v/release/MrSibe/KnowNote)](https://github.com/MrSibe/KnowNote/releases)
[![GitHub stars](https://img.shields.io/github/stars/MrSibe/KnowNote)](https://github.com/MrSibe/KnowNote/stargazers)
[![License](https://img.shields.io/github/license/MrSibe/KnowNote)](https://github.com/MrSibe/KnowNote/blob/main/LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/MrSibe/KnowNote)](https://github.com/MrSibe/KnowNote/issues)

[English](README.md) | [简体中文](README_CN.md)

</div>

---

## Why KnowNote?

I really like the idea behind **Google NotebookLM**:
upload documents, build context, and reason over them with LLMs.

But I wanted a few things it doesn’t give me:

- Using my own **private or self-managed LLM APIs**
- Keeping **all data local**, without cloud lock-in
- Trying the tool **without Docker or complex deployment**

While exploring GitHub, I found many impressive “Open Notebook” projects.
They are powerful and well-designed — but almost all of them rely on Docker.
For beginners and non-backend users, that alone can be a deal-breaker.

So I built **KnowNote**:  
a simple Electron-based desktop app that brings NotebookLM-style workflows
to a **local-first, Docker-free environment**.

This is my **first open-source project**.  
It’s still early, but the core idea works — and I’m excited to share it and learn from the community.

---

## What KnowNote does (so far)

- 📚 Build a local knowledge base from documents and notes
- 💬 Chat, summarize, and reason with your content using LLMs
- 🔌 Provider-based LLM design (OpenAI, DeepSeek, Ollama, and more)
- 🔍 RAG-powered retrieval with precise source traceability
- 🖥️ Desktop app built with Electron — no Docker, no server setup

---

## Who is this for?

KnowNote is for you if:

- You like NotebookLM but want more control
- You prefer using private or self-hosted LLM APIs
- You don’t want to spin up Docker just to try an idea
- You want a simple desktop app for learning and research

---

## Preview

<div align="center">
  <img src="./.github/images/screenshot-main.png" alt="KnowNote Main Interface" width="800">
  <p><i>Three-column layout: Knowledge Library · AI Q&A · Note Output</i></p>
</div>

---

## Key Features

### 📚 Document Management

- PDF, Word (.docx), PowerPoint (.pptx), and web pages
- Automatic structure parsing and content extraction
- Fast local storage with SQLite

### 🤖 AI-Powered Q&A

- Retrieval-Augmented Generation (RAG)
- Multiple LLM providers
- Answers with precise source references

### 🔒 Local-First by Design

- All data stored locally
- Offline-friendly (LLM APIs optional)
- Full control over your knowledge assets

### 🔍 Vector Search

- Semantic search with sqlite-vec
- Fast and accurate retrieval

### ⚡ Lightweight & Cross-Platform

- Electron-based desktop app
- Windows and macOS support

---

## Project Status

KnowNote is an early-stage project.  
Some parts are still rough, but the foundation is in place.

I’m sharing it mainly to:

- learn from real usage
- improve learning and research workflows
- explore better knowledge visualization and retrieval

Feedback and suggestions are very welcome.

---

## Roadmap

### ✅ Completed

- AI LLM conversation with multiple providers
- Structured note generation
- One-click mind map generation
- RAG-based document retrieval
- Multi-format document import (PDF / Word / PPT / Web)

### 🚧 In Development

- Audio upload and transcription
- Quiz generation from documents
- One-click PPT generation from notes

### 📋 Planned

More ideas are in the pipeline — feel free to suggest features in Issues.

---

## Quick Start

### Download

Get the latest version from GitHub Releases:

- **Windows**: `KnowNote-Setup-{version}.exe`
- **macOS**: `KnowNote-{version}.dmg` / `KnowNote-{version}-arm64.dmg`

### Development

```bash
git clone https://github.com/MrSibe/KnowNote.git
cd KnowNote
npm install
npm run dev
```

---

## Tech Stack

Electron · React · TypeScript · Vite · TailwindCSS
SQLite · sqlite-vec · Drizzle ORM
pdfjs-dist · mammoth · officeparser · Tiptap

---

## Project Structure

```plaintext
KnowNote/
├── src/
│   ├── main/              # Electron main process
│   │   ├── db/            # Database configuration and schema
│   │   ├── services/      # Core logic (document parsing, RAG, etc.)
│   │   └── providers/     # LLM provider abstraction
│   ├── renderer/          # React renderer process
│   ├── preload/           # Electron preload scripts
│   └── shared/            # Shared types and utilities
├── resources/             # App resources (icons, etc.)
├── build/                 # Build configuration
└── out/                   # Build output
```

---

## Feedback & Contributions

Issues, discussions, and pull requests are all welcome.

If you have ideas about:

- learning workflows
- knowledge visualization
- model/provider abstraction

I’d love to hear them.

---

## License

This project is licensed under the **GPL-3.0 License**.

---

## Acknowledgments

- Google NotebookLM — inspiration
- Electron — cross-platform desktop framework
- React — UI framework
- SQLite & sqlite-vec — local storage and vector retrieval

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

If this project resonates with you, feel free to try it, star it, or leave feedback.
Thanks for checking it out 🙏

<div align="center">
  <p>Built with ❤️ by <a href="https://github.com/MrSibe">@MrSibe</a></p>
</div>
