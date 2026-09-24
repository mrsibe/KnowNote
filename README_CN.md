<div align="center">

# KnowNote

> 本地优先的开源 Google NotebookLM 替代方案
> 为希望拥有私有 LLM、无需 Docker 和完全掌控的学习者和开发者而构建。

**将您的文档转换为智能的、对话式的知识库**

[![GitHub release](https://img.shields.io/github/v/release/MrSibe/KnowNote)](https://github.com/MrSibe/KnowNote/releases)
[![GitHub stars](https://img.shields.io/github/stars/MrSibe/KnowNote)](https://github.com/MrSibe/KnowNote/stargazers)
[![License](https://img.shields.io/github/license/MrSibe/KnowNote)](https://github.com/MrSibe/KnowNote/blob/main/LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/MrSibe/KnowNote)](https://github.com/MrSibe/KnowNote/issues)

[English](README.md) | [简体中文](README_CN.md)

</div>

---

## 为什么选择 KnowNote？

我非常喜欢 **Google NotebookLM** 背后的理念：
上传文档、构建上下文，并使用 LLM 进行推理。

但我希望它能提供一些目前没有的功能：

- 使用我自己的**私有或自托管的 LLM API**
- 保持**所有数据本地化**，无需依赖云端
- **无需 Docker 或复杂部署**即可试用工具

在探索 GitHub 时，我发现了许多令人印象深刻的"开放笔记本"项目。
它们功能强大且设计精良——但几乎所有项目都依赖 Docker。
对于初学者和非后端用户来说，仅这一点就可能成为致命的障碍。

所以我构建了 **KnowNote**：
一个简单的基于 Electron 的桌面应用，将 NotebookLM 风格的工作流程
带入**本地优先、无需 Docker 的环境**。

这是我的**第一个开源项目**。
它仍处于早期阶段，但核心理念已经实现——我很高兴能分享它并向社区学习。

---

## KnowNote 目前能做什么

- 📚 从文档和笔记构建本地知识库
- 💬 使用 LLM 对内容进行聊天、总结和推理
- 🔌 基于提供商的 LLM 设计（OpenAI、DeepSeek、Ollama 等）
- 🔍 基于 RAG 的检索，具有精确的来源追溯能力
- 🖥️ 使用 Electron 构建的桌面应用——无需 Docker，无需服务器设置

---

## 这是为谁设计的？

如果您符合以下情况，KnowNote 适合您：

- 您喜欢 NotebookLM 但想要更多控制权
- 您更喜欢使用私有或自托管的 LLM API
- 您不想仅为尝试一个想法就启动 Docker
- 您想要一个用于学习和研究的简单桌面应用

---

## 预览

<div align="center">
  <img src="./.github/images/screenshot-main.png" alt="KnowNote 主界面" width="800">
  <p><i>三栏布局：知识库 · AI 问答 · 笔记输出</i></p>
</div>

---

## 主要特性

### 📚 文档管理

- PDF、Word (.docx)、PowerPoint (.pptx) 和网页
- 自动结构解析和内容提取
- 使用 SQLite 的快速本地存储

### 🤖 AI 驱动的问答

- 检索增强生成（RAG）
- 多种 LLM 提供商
- 带有精确来源引用的答案

### 🔒 本地优先设计

- 所有数据本地存储
- 离线友好（LLM API 可选）
- 完全控制您的知识资产

### 🔍 向量搜索

- 使用 sqlite-vec 的语义搜索
- 快速准确的检索

### ⚡ 轻量级且跨平台

- 基于 Electron 的桌面应用
- 支持 Windows 和 macOS

---

## 项目状态

KnowNote 是一个早期阶段的项目。
某些部分仍然粗糙，但基础已经到位。

我分享它主要是为了：

- 从实际使用中学习
- 改进学习和研究工作流程
- 探索更好的知识可视化和检索方式

非常欢迎反馈和建议。

---

## 路线图

### ✅ 已完成

- 支持多个提供商的 AI LLM 对话
- 结构化笔记生成
- 一键生成思维导图
- 基于 RAG 的文档检索
- 多格式文档导入（PDF / Word / PPT / 网页）

### 🚧 开发中

- 音频上传和转录
- 从文档生成测验
- 从笔记一键生成 PPT

### 📋 计划中

更多想法正在筹备中——欢迎在 Issues 中提出功能建议。

---

## 快速开始

### 下载

从 GitHub Releases 获取最新版本：

- **Windows**: `KnowNote-Setup-{version}.exe`
- **macOS**: `KnowNote-{version}.dmg` / `KnowNote-{version}-arm64.dmg`

### 开发

```bash
git clone https://github.com/MrSibe/KnowNote.git
cd KnowNote
npm install
npm run dev
```

---

## 技术栈

Electron · React · TypeScript · Vite · TailwindCSS
SQLite · sqlite-vec · Drizzle ORM
pdfjs-dist · mammoth · officeparser · Tiptap

---

## 项目结构

```plaintext
KnowNote/
├── src/
│   ├── main/              # Electron 主进程
│   │   ├── db/            # 数据库配置和架构
│   │   ├── services/      # 核心逻辑（文档解析、RAG 等）
│   │   └── providers/     # LLM 提供商抽象
│   ├── renderer/          # React 渲染进程
│   ├── preload/           # Electron 预加载脚本
│   └── shared/            # 共享类型和工具
├── resources/             # 应用资源（图标等）
├── build/                 # 构建配置
└── out/                   # 构建输出
```

---

## 反馈与贡献

欢迎提出 Issues、进行讨论和提交 Pull Request。

如果您对以下方面有想法：

- 学习工作流程
- 知识可视化
- 模型/提供商抽象

我很乐意听取。

---

## 许可证

本项目采用 **GPL-3.0 许可证**。

---

## 致谢

- Google NotebookLM —— 灵感来源
- Electron —— 跨平台桌面框架
- React —— UI 框架
- SQLite & sqlite-vec —— 本地存储和向量检索

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

如果这个项目与您产生共鸣，欢迎试用、点赞或留下反馈。
感谢您的关注 🙏

<div align="center">
  <p>由 <a href="https://github.com/MrSibe">@MrSibe</a> 用 ❤️ 构建</p>
</div>
