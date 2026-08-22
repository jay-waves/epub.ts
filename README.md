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

```bash
pnpm compile         # compile the shared reader to release/web once
pnpm package:chrome  # package the compiled reader as a Chrome extension
pnpm package:windows # package epub.ts.exe with the compiled reader
pnpm package:linux   # package epub.ts with the compiled reader
pnpm build:all       # compile once, then package every host
```

### 运行环境 / Runtime support

支持 Chrome/Edge 129+、Firefox 147+、Safari/iOS Safari 26+。项目直接使用现代 Web API，不为更早版本提供 polyfill 或降级实现；构建目标以 `package.json` 的 Browserslist 为准。

Supports Chrome/Edge 129+, Firefox 147+, and Safari/iOS Safari 26+. Modern Web APIs are used directly, without polyfills or fallbacks for older releases. See the Browserslist in `package.json` for canonical build targets.

剪贴板和本地文件功能需要安全上下文及用户授权。内置翻译不可用时不影响阅读，Web 版可转到外部翻译服务。

Clipboard and local-file features require a secure context and user permission. Built-in translation is optional; the web build can use an external service instead.

### 高级排版配置 / Advanced typography settings

低频配置通过开发者工具 Console 中的 `epub.settings` 调整，并保存在浏览器 `localStorage`：

```js
epub.settings.fonts
epub.settings.textAlignment

await epub.settings.setSerifFont("Noto Serif, serif")
await epub.settings.setSansFont("Noto Sans, system-ui, sans-serif")
await epub.settings.setMonoFont("Fira Code, ui-monospace, monospace")
await epub.settings.setTextAlignment("justify") // "auto" | "start" | "justify"
await epub.settings.reset()
```

字体名称仅引用浏览器可用的本地字体，不会下载或安装字体。`auto` 按文档语言选择对齐方式；`reset()` 清除全部高级覆盖并恢复默认值。应用每次启动时会在 Console 输出当前配置和命令提示。

### 应用形态 / Application variants

主要跨端差异：

| 形态 | 运行环境 | 打开本地 EPUB | 保存 | 翻译 |
| --- | --- | --- | --- | --- |
| 插件 | Chrome 129+ | 重定向已打开的 `file://*.epub` 标签；访问本地文件需授权 | 通过文件选择器保存完整 EPUB，并复用已授权的文件句柄 | 内置翻译模型可按需下载 |
| Web | Chrome/Edge 129+、Firefox 147+、Safari/iOS 26+ | 手动选择或拖入文件，不支持双击关联 | 文件选择器打开的文件可直接保存；拖入的文件保存为下载副本 | 未安装内置翻译模型时转到 Google 翻译 |
| 桌面 | Chrome/Edge 129+、Firefox 147+ 或 Safari 26+ | 支持系统文件关联，通过 `epub.ts.localhost` 本地服务读取 | 本地服务写回批注；检测到外部修改时改存冲突副本 | 内置翻译模型可按需下载 |

Key differences between platforms:

| Application | Runtime | Opening local EPUBs | Saving | Translation |
| --- | --- | --- | --- | --- |
| Extension | Chrome 129+ | Redirects opened `file://*.epub` tabs; local-file access requires permission | Saves a complete EPUB through a file picker and reuses approved file handles | Built-in translation models may be downloaded on demand |
| Web | Chrome/Edge 129+, Firefox 147+, Safari/iOS 26+ | Files must be selected or dropped; OS double-click association is unavailable | Picker-opened files can be saved directly; dropped files are saved as downloaded copies | Translation falls back to Google Translate when no built-in model is installed |
| Desktop | Chrome/Edge 129+, Firefox 147+, or Safari 26+ | Supports OS file association and reads through the local `epub.ts.localhost` service | The local service writes annotations back; external changes produce a conflict copy | Built-in translation models may be downloaded on demand |

### EPUB 内容兼容 / EPUB content compatibility

放弃旧浏览器兼容不等于放弃旧书兼容。解析与排版层仍保留常见 EPUB 2/3 内容修复，包括旧命名空间与 `xlink:href`、`-epub-*` CSS 归一化、非规范元数据，以及既有批注数据迁移。这里兼容的是书籍内容，而不是过时的浏览器运行时。

Dropping old-browser support does not drop old-book support. The parser and typography layers retain common EPUB 2/3 repairs, including legacy namespaces and `xlink:href`, `-epub-*` CSS normalization, irregular metadata, and migration of existing annotation data. These paths preserve publication compatibility, not obsolete browser runtimes.

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

## 交互与界面层 / Interaction and UI Layers

一次指针操作只交给一个处理者，优先级为：控件 > 链接 > 高亮与批注 > 图片 > 文本选择 > 翻页。右键操作同样优先命中高亮，再处理图片或普通文本。

Each pointer gesture has one owner: controls > links > highlights and annotations > images > text selection > page turning. Right-clicks also prefer highlights before media or ordinary text.

界面简化为三层：EPUB iframe 正文、SVG 内容装饰层（高亮与批注）、应用界面层（Dock、菜单、弹窗与图片放大）。

The UI has three broad layers: EPUB iframe content, SVG content decorations (highlights and annotations), and application chrome (Dock, menus, dialogs, and image zoom).

## 快捷键与交互 / Shortcuts and Interaction

| 输入 / Input | Paginated | Scrolled |
| --- | --- | --- |
| 屏幕左/右侧单击 | 前/后一栏 | 前/后一屏 |
| 鼠标后退/前进侧键 | 按阅读顺序前/后一屏 | 按阅读顺序前/后一屏 |
| `←/→`、`h/l` | 前/后一栏 | 前/后一屏 |
| `↑/↓`、`k/j` | 前/后一屏 | 向上/下滚动 |
| `Space` | — | 向下滚动 |
| 打开目录 / Open TOC | `t` | `t` |
| 打开搜索 / Open search | `/` | `/` |
| 跳转进度 / Go to progress | 输入百分比后按 `G`，如 `50G` | 同左 / Same |
| 返回跳转前位置 / Return | `Ctrl+O` | `Ctrl+O` |
| 保存 / Save | `Ctrl+S` / `⌘S` | 同左 / Same |

## 致谢 / Acknowledgements

- [foliate-js](https://github.com/johnfactotum/foliate-js)（初始 renderer 与 EPUB parser）
- EB Garamond font
- Monaspace Argon
