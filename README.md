<div align="center">

# KnowNote

**A local-first research workspace.**

### Research your documents. Trust every answer.

Desktop · Local RAG · Bring your own model · Open source

[![GitHub release](https://img.shields.io/github/v/release/MrSibe/KnowNote)](https://github.com/MrSibe/KnowNote/releases)
[![GitHub stars](https://img.shields.io/github/stars/MrSibe/KnowNote)](https://github.com/MrSibe/KnowNote/stargazers)
[![License](https://img.shields.io/github/license/MrSibe/KnowNote)](https://github.com/MrSibe/KnowNote/blob/main/LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/MrSibe/KnowNote)](https://github.com/MrSibe/KnowNote/issues)

[English](README.md) | [简体中文](README_CN.md)

</div>

---

KnowNote turns your own documents into a knowledge base you can question, and
answers from those documents with a reference back to the passage the answer came
from.

It is a desktop application rather than a self-hosted stack: no Docker, no
server, no account. Parsing, splitting, embedding and vector search all run
inside the app, and the only thing that leaves your machine is the request you
send to the model endpoint you configured. If that endpoint is a local server,
nothing leaves at all.

**The website is the full story: [knownote.pages.dev](https://knownote.pages.dev)** —
the mechanism, the limits, and an honest comparison with NotebookLM and
AnythingLLM.

## Preview

<div align="center">
  <img src="./.github/images/screenshot-main.png" alt="KnowNote main interface" width="800">
  <p><i>Three-column layout: Knowledge Library · AI Q&amp;A · Note Output</i></p>
</div>

## What it does

- **Local retrieval (RAG).** Import PDF, Word, PowerPoint and web pages. Text is
  split into passages and embedded by a model that runs in-process, so retrieval
  keeps working with the network off.
- **Traceable answers.** Every answer keeps the passages it was built from, along
  with where each passage sat in the extracted text — so you can inspect what the
  answer was actually based on instead of taking it on faith.
- **Bring your own model.** Any OpenAI-, Anthropic- or Google-compatible endpoint,
  or a local server such as Ollama. No bundled chat model and no account.
- **Notes and mind maps.** Save what you concluded as structured notes beside the
  sources, and turn a notebook into a mind map.
- **No deployment.** Download, open, start reading. The embedder downloads once
  and then runs on your machine.

## What is not here yet

Written down because the alternative is that you find out after installing.

- Audio upload and transcription, quiz generation and slide generation are in
  development. They are not in any release.
- There is no Linux build, and the macOS build is Apple Silicon only.
- Builds are unsigned and not notarised — see the install steps below.
- No accounts, no sync, no collaboration and no telemetry: KnowNote is a
  single-user desktop tool.

## Quick start

### Install

Download the build for your platform from
[GitHub Releases](https://github.com/MrSibe/KnowNote/releases/latest):

- **Windows**: `knownote-{version}-setup.exe`
- **macOS (Apple Silicon)**: `knownote-{version}-arm64.dmg`

> **The builds are unsigned.** There is no Apple Developer ID certificate in the
> release pipeline, so macOS refuses to launch the app on first run and Windows
> SmartScreen flags the installer. Neither means the download is broken — both
> are one-time prompts, and the steps below clear them.

#### macOS

1. Open the `.dmg` and drag **KnowNote** into _Applications_.
2. Clear the quarantine flag once:

   ```bash
   sudo xattr -rd com.apple.quarantine /Applications/KnowNote.app
   ```

3. Launch it as usual.

Intel Macs are not built at the moment — the release ships an arm64 build only.

Without step 2, macOS reports _"KnowNote is damaged and can't be opened"_ or
_"Apple cannot check it for malicious software"_. Only run this command on an app
taken from this repository's Releases page.

#### Windows

If SmartScreen shows _"Windows protected your PC"_, choose **More info** →
**Run anyway**.

#### First run

Nothing is configured out of the box: open **Settings**, add at least one model
connection under **Models** (any OpenAI-, Anthropic- or Google-compatible
endpoint, or a local server such as Ollama), then start asking questions.
Notebooks, notes and embeddings all stay on your machine.

### Development

```bash
git clone https://github.com/MrSibe/KnowNote.git
cd KnowNote
npm install
npm run dev
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the full command list, the Node version CI
uses, and the checks that are gates before a pull request.

## Architecture

A short version. The website goes further on
[local RAG](https://knownote.pages.dev/features/local-rag) and
[citations](https://knownote.pages.dev/features/citations), and
[DESIGN.md](DESIGN.md) covers the interface.

- **Shell** — Electron with React, TypeScript and TailwindCSS, bundled by
  electron-vite. Tiptap for the note editor.
- **Parsing** — `pdfjs-dist`, `mammoth`, `officeparser` and `turndown`. Each
  format keeps the structure it has: page boundaries, headings, slides.
- **Splitting** — passages of roughly 500 characters with about 50 characters of
  overlap. Each passage records its start and end offset in the extracted text,
  and that is what lets a citation point at a passage rather than a file.
- **Embedding** — `Xenova/multilingual-e5-small` through ONNX, running in the
  Electron main process. 384 dimensions, `q8`, the revision pinned, and remote
  model loading disabled. Downloaded on demand and cached on disk.
- **Storage** — SQLite with `sqlite-vec`, through Drizzle ORM. Each notebook gets
  its own vector table carrying its own width, so vectors produced by different
  embedding spaces are never compared.
- **Models** — the chat model is whatever endpoint you configure; it is not part
  of the application.

```plaintext
KnowNote/
├── src/
│   ├── main/              # Electron main process
│   │   ├── db/            # Database configuration and schema
│   │   ├── services/      # Core logic (document parsing, RAG, etc.)
│   │   └── models/        # Model connection resolution and API protocol adapters
│   ├── renderer/          # React renderer process
│   ├── preload/           # Electron preload scripts
│   └── shared/            # Shared types and utilities
├── resources/             # App resources (icons, etc.)
├── build/                 # Build configuration
└── out/                   # Build output
```

## Contributing

Issues, discussions and pull requests are all welcome. If you have ideas about
learning workflows, knowledge visualization, or the model-connection layer, they
are especially useful. See [CONTRIBUTING.md](CONTRIBUTING.md) before you start.

## License

GPL-3.0. See [LICENSE](LICENSE).

## Acknowledgments

- Google NotebookLM — inspiration for the workflow
- Electron — cross-platform desktop framework
- React — UI framework
- SQLite & sqlite-vec — local storage and vector retrieval

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
