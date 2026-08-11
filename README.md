# epub.ts

基于 Web 技术构建的 EPUB 阅读器，提供以下形态：

A web-based EPUB reader available as:

- Chrome 浏览器插件<br>
  Chrome extension
- Web 应用<br>
  Web application
- 在浏览器中运行的桌面应用<br>
  Desktop application running in the browser

## 功能 / Features

- 单栏与双栏阅读切换<br>
  Switch between single- and double-column layouts
- 字体放大与缩小<br>
  Adjustable font size
- 整体排版调节：内容宽度、行距、字距和图片大小<br>
  Layout controls for content width, line spacing, letter spacing, and image size
- 通过 highlight.js 提供代码高亮<br>
  Code highlighting powered by highlight.js
- 通过 medium-zoom 提供图片放大与复制<br>
  Image zooming and copying powered by medium-zoom
- 通过 MathJax 提供数学公式渲染与复制<br>
  Math rendering and copying powered by MathJax
- 高亮与批注<br>
  Highlights and annotations
- 目录与阅读进度<br>
  Table of contents and reading progress
- 全文搜索<br>
  Full-text search

目录：

Table of contents:

<img src="assets/toc.png" width="800">

搜索：

Search:

<img src="assets/search.png" width="800">

自动隐藏的 Dock 工具栏：

Auto-hiding Dock toolbar:

<img src="assets/dock.png" width="800">

## 构建 / Build

运行环境至少需要 Chrome 120。

Chrome 120 or newer is required.

```bash
pnpm build:web     # static web app
pnpm build:chrome  # Chrome extension
pnpm build:windows # epub.ts.exe, embedded web app
pnpm build:linux   # epub.ts, embedded web app
```

主要跨端差异：

| 形态 | 打开本地 EPUB | 保存 | 字体与翻译 |
| --- | --- | --- | --- |
| 插件 | 拦截 `file://*.epub`；访问本地文件需授权 | 通过文件选择器保存完整 EPUB，并复用已授权的文件句柄 | 西文与等宽字体随插件提供；内置翻译模型可按需下载 |
| Web | 手动选择或拖入文件，不支持双击关联 | 文件选择器打开的文件可直接保存；拖入的文件保存为下载副本 | 正文使用系统字体，西文与等宽字体来自 CDN；未安装内置翻译模型时转到 Google 翻译 |
| 桌面 | 支持系统文件关联，通过 `epub.ts.localhost` 本地服务读取 | 本地服务写回批注；检测到外部修改时改存冲突副本 | 西文与等宽字体随应用提供；内置翻译模型可按需下载 |

Key differences between platforms:

| Application | Opening local EPUBs | Saving | Fonts and translation |
| --- | --- | --- | --- |
| Extension | Intercepts `file://*.epub`; local-file access requires permission | Saves a complete EPUB through a file picker and reuses approved file handles | Latin and monospace fonts are bundled; built-in translation models may be downloaded on demand |
| Web | Files must be selected or dropped; OS double-click association is unavailable | Picker-opened files can be saved directly; dropped files are saved as downloaded copies | Body text uses system fonts, while Latin and monospace fonts come from a CDN; translation falls back to Google Translate when no built-in model is installed |
| Desktop | Supports OS file association and reads through the local `epub.ts.localhost` service | The local service writes annotations back; external changes produce a conflict copy | Latin and monospace fonts are bundled; built-in translation models may be downloaded on demand |

<img src="assets/screenshot1.png" width="800">

## 渲染管线 / Rendering Pipeline

```text
EPUB ZIP
   |
   v
读取 ZIP 目录与包信息，建立书脊和目录
Read the ZIP directory and package; build the spine and TOC
   |
   v
按需解压章节，重写 CSS、图片和链接（书级 Blob URL LRU）
Extract sections on demand and rewrite resources (per-book Blob URL LRU)
   |
   v
创建 iframe Document，注入阅读样式
Create the iframe Document and inject reader styles
   |
   +--------> 语义、脚注和图片交互 / Semantics, footnotes, images
   |
   +--------> 代码高亮 / Code highlighting
   |
   +--------> 等待字体 / Wait for fonts ---> MathJax 公式 / formulas
   |
   v
测量、分页并显示 / Measure, paginate, and reveal
   |
   v
章节卸载或换书时清理 / Clean up on unload or book change
```

## 致谢 / Acknowledgements

- [foliate-js](https://github.com/johnfactotum/foliate-js)（初始 renderer 与 EPUB parser）
- EB Garamond font
- LXGW font
- Monaspace Argon
