<div align="center">

# KnowNote

**本地优先的研究工作台。**

### 读你的文档。信每一个回答。

桌面应用 · 本地 RAG · 自带模型 · 开源

[![GitHub release](https://img.shields.io/github/v/release/MrSibe/KnowNote)](https://github.com/MrSibe/KnowNote/releases)
[![GitHub stars](https://img.shields.io/github/stars/MrSibe/KnowNote)](https://github.com/MrSibe/KnowNote/stargazers)
[![License](https://img.shields.io/github/license/MrSibe/KnowNote)](https://github.com/MrSibe/KnowNote/blob/main/LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/MrSibe/KnowNote)](https://github.com/MrSibe/KnowNote/issues)

[English](README.md) | [简体中文](README_CN.md)

</div>

---

KnowNote 把你自己的文档变成可以提问的知识库，并让每个回答都带上它所依据的原文片段。

它是一款桌面应用，而不是一套自托管服务：不需要 Docker，不需要服务器，也不需要账号。解析、切分、嵌入和向量检索都在应用进程内完成，唯一离开这台机器的，是你发送到所配置模型端点的那一次请求。如果那个端点就是本地服务，那就什么都不会离开。

**完整说明在官网：[knownote.pages.dev](https://knownote.pages.dev)** —— 机制、边界，以及与 NotebookLM、AnythingLLM 的诚实对比。中文页面在 [knownote.pages.dev/zh](https://knownote.pages.dev/zh/)。

## 预览

<div align="center">
  <img src="./.github/images/screenshot-main.png" alt="KnowNote 主界面" width="800">
  <p><i>三栏布局：知识库 · AI 问答 · 笔记输出</i></p>
</div>

## 它能做什么

- **本地检索（RAG）。** 导入 PDF、Word、PowerPoint 和网页。文本被切成片段，由在进程内运行的模型完成嵌入，所以断网时检索依然可用。
- **可追溯的回答。** 每个回答都保留它依据的片段，以及每个片段在抽取文本中的位置 —— 你可以核对回答到底基于什么，而不是只能凭信。
- **自带模型。** 任何兼容 OpenAI、Anthropic 或 Google 协议的端点，或 Ollama 这类本地服务。没有内置对话模型，也没有账号。
- **笔记与思维导图。** 把你的结论作为结构化笔记保存在资料旁边，也可以把一本笔记本转成思维导图。
- **无需部署。** 下载、打开、开始阅读。嵌入模型只下载一次，之后都在你的机器上运行。

## 还没有的部分

写出来，是因为不说的话，你就只能在安装之后才发现。

- 音频上传与转录、测验生成、幻灯片生成仍在开发中，不在任何已发布的版本里。
- 没有 Linux 构建，macOS 构建也只有 Apple 芯片版本。
- 安装包未签名、未公证 —— 见下面的安装步骤。
- 没有账号、没有同步、没有协作，也没有遥测：KnowNote 是单用户桌面工具。

## 快速开始

### 安装

从 [GitHub Releases](https://github.com/MrSibe/KnowNote/releases/latest) 下载对应平台的安装包：

- **Windows**：`knownote-{version}-setup.exe`
- **macOS（Apple 芯片）**：`knownote-{version}-arm64.dmg`

> **安装包未签名。** 发布流程中没有 Apple Developer ID 证书，所以 macOS 首次打开会拒绝启动，Windows SmartScreen 也会拦截安装程序。这不代表下载损坏，两个提示都只需处理一次，按下面的步骤走即可。

#### macOS

1. 打开 `.dmg`，把 **KnowNote** 拖进 _Applications_（应用程序）。
2. 清除一次隔离标记：

   ```bash
   sudo xattr -rd com.apple.quarantine /Applications/KnowNote.app
   ```

3. 之后正常启动即可。

目前没有 Intel Mac 的构建产物，只提供 arm64 版本。

不做第 2 步，macOS 会提示 _"KnowNote 已损坏，无法打开"_ 或 _"无法验证开发者"_。这条命令只对本仓库 Releases 页面下载的应用使用。

#### Windows

如果 SmartScreen 提示 _"Windows 已保护你的电脑"_，点 **更多信息** → **仍要运行**。

#### 首次启动

应用默认没有任何模型配置：先在 **设置** 的 **Models** 中添加至少一个连接（OpenAI / Anthropic / Google 兼容端点，或 Ollama 等本地服务），然后就可以开始提问。笔记本、笔记和嵌入数据全部保存在本地。

### 开发

```bash
git clone https://github.com/MrSibe/KnowNote.git
cd KnowNote
npm install
npm run dev
```

完整的命令列表、CI 使用的 Node 版本，以及提交 PR 前必须通过的检查，都在 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 架构

这里是简版。官网上有更详细的[本地 RAG](https://knownote.pages.dev/zh/features/local-rag/) 和[引用机制](https://knownote.pages.dev/zh/features/citations/)说明，界面部分见 [DESIGN.md](DESIGN.md)。

- **外壳** —— Electron + React + TypeScript + TailwindCSS，由 electron-vite 打包。笔记编辑器使用 Tiptap。
- **解析** —— `pdfjs-dist`、`mammoth`、`officeparser`、`turndown`。每种格式都保留它自带的结构：页面边界、标题、幻灯片。
- **切分** —— 片段约 500 字符，重叠约 50 字符。每个片段记录它在抽取文本中的起止偏移，这正是引用能指向片段而不是文件的原因。
- **嵌入** —— `Xenova/multilingual-e5-small`，通过 ONNX 在 Electron 主进程内运行。384 维、`q8`、版本锁定，并且关闭了远程模型加载。按需下载后缓存在磁盘。
- **存储** —— SQLite + `sqlite-vec`，通过 Drizzle ORM。每本笔记本有自己的向量表，携带自己的宽度，所以来自不同嵌入空间的向量永远不会被比较。
- **模型** —— 对话模型由你配置的端点提供，不属于应用本身。

```plaintext
KnowNote/
├── src/
│   ├── main/              # Electron 主进程
│   │   ├── db/            # 数据库配置和架构
│   │   ├── services/      # 核心逻辑（文档解析、RAG 等）
│   │   └── models/        # 模型连接解析与 API 协议适配器
│   ├── renderer/          # React 渲染进程
│   ├── preload/           # Electron 预加载脚本
│   └── shared/            # 共享类型和工具
├── resources/             # 应用资源（图标等）
├── build/                 # 构建配置
└── out/                   # 构建输出
```

## 参与贡献

欢迎提出 Issue、参与讨论和提交 Pull Request。如果你对学习工作流程、知识可视化，或模型连接层有想法，尤其欢迎。开始之前请先看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

GPL-3.0，见 [LICENSE](LICENSE)。

## 致谢

- Google NotebookLM —— 工作流上的灵感来源
- Electron —— 跨平台桌面框架
- React —— UI 框架
- SQLite & sqlite-vec —— 本地存储与向量检索

## Star History

<a href="https://www.star-history.com/#MrSibe/KnowNote&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=MrSibe/KnowNote&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=MrSibe/KnowNote&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=MrSibe/KnowNote&type=date&legend=top-left" />
 </picture>
</a>

---

如果这个项目与您产生共鸣，欢迎试用、点赞或留下反馈。感谢您的关注 🙏

<div align="center">
  <p>由 <a href="https://github.com/MrSibe">@MrSibe</a> 用 ❤️ 构建</p>
</div>
