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

### 构建依赖 / Build prerequisites

All builds require Node.js with Corepack/pnpm. Native packaging additionally
requires:

- Go 1.23+ to build the launcher
- [nFPM](https://nfpm.goreleaser.com/docs/install/) to create `deb`/`rpm` packages
- NSIS and a PE resource compiler to create the Windows installer on Linux
- macOS system tools `hdiutil`, `sips`, `iconutil`, and `ditto` to create
  unsigned app bundles and disk images

```bash
corepack enable
pnpm install
```

```bash
# Debian / Ubuntu
sudo apt install golang-go binutils-mingw-w64-x86-64 nsis

# Fedora
sudo dnf install golang mingw64-binutils mingw32-nsis

# Install nFPM; ensure $(go env GOPATH)/bin is in PATH
go install github.com/goreleaser/nfpm/v2/cmd/nfpm@latest
```

macOS launchers, app bundles, and DMGs must be built on macOS. The required
packaging commands are provided by the operating system, so no third-party DMG
dependency is needed. The macOS artifacts are intentionally neither signed nor
notarized, and the packaging process does not invoke `codesign`. Set
`EPUB_TS_HDIUTIL` only when `hdiutil` is installed outside its normal system
location. Go may add the minimal ad-hoc code-signature structure required for
an Apple Silicon executable; this does not identify the developer or make the
app trusted by Gatekeeper.

The Fedora `mingw32-nsis` package is intentional: NSIS uses its traditional
x86 bootstrap to install the 64-bit `epub.ts.exe` into `%ProgramFiles%`.
Custom tool locations can be supplied through `EPUB_TS_GO`,
`EPUB_TS_WINDRES`, `EPUB_TS_MAKENSIS`, `EPUB_TS_NFPM`, and
`EPUB_TS_HDIUTIL`.

### 构建命令 / Build commands

```bash
pnpm compile         # compile the shared reader to release/web once
pnpm package:chrome  # package the compiled reader as a Chrome extension
pnpm package:windows # package the Windows binary and NSIS installer
pnpm package:linux   # package the Linux binary, deb, and Fedora-compatible rpm
pnpm package:macos   # package unsigned amd64 and arm64 macOS apps and DMGs
pnpm package:deb     # package only the Linux binary and deb
pnpm package:rpm     # package only the Linux binary and rpm
pnpm build:all       # compile once, then package Chrome, Linux, and Windows
```

See [`packaging/README.md`](packaging/README.md) for installed files and
platform-specific package behavior.

Portable launchers expose `epub.ts purge` to stop the current user's daemon and
delete that user's reader data. Installation, uninstallation, and file
association are owned by nFPM, NSIS, or the macOS app bundle instead of launcher
commands.

### 运行环境 / Runtime support

支持 Chrome/Edge 129+、Firefox 147+、Safari/iOS Safari 26+。项目直接使用现代 Web API，不为更早版本提供 polyfill 或降级实现；构建目标以 `package.json` 的 Browserslist 为准。

Supports Chrome/Edge 129+, Firefox 147+, and Safari/iOS Safari 26+. Modern Web APIs are used directly, without polyfills or fallbacks for older releases. See the Browserslist in `package.json` for canonical build targets.

剪贴板和本地文件功能需要安全上下文及用户授权。翻译仅在本地进行，并要求浏览器支持内置 Translator API；Microsoft Edge 需要 148 或更高版本。

Clipboard and local-file features require a secure context and user permission. Translation is local-only and requires browser support for the built-in Translator API; Microsoft Edge 148 or later is required.

### 高级配置 / Advanced settings

低频配置通过开发者工具 Console 中的 `epub.settings` 调整，并保存在浏览器 `localStorage`：

```js
epub.settings.fonts
epub.settings.textAlignment
epub.settings.translationTargetLanguage

await epub.settings.setSerifFont("Noto Serif, serif")
await epub.settings.setSansFont("Noto Sans, system-ui, sans-serif")
await epub.settings.setMonoFont("Fira Code, ui-monospace, monospace")
await epub.settings.setTextAlignment("justify") // "auto" | "start" | "justify"
await epub.settings.setTranslationTargetLanguage("ja") // BCP 47 language tag
await epub.settings.reset()
```

字体名称仅引用浏览器可用的本地字体，不会下载或安装字体。`auto` 按文档语言选择对齐方式。翻译目标语言默认取浏览器首选语言；未安装的翻译方向必须在翻译弹窗中点击确认后才会下载。`reset()` 清除全部高级覆盖并恢复默认值。应用每次启动时会在 Console 输出当前配置和命令提示。

翻译使用 [BCP 47](https://www.rfc-editor.org/info/bcp47) 标签；简体中文为 `zh-Hans`，繁体中文为 `zh-Hant`。可参考 [Edge 官方语言列表](https://github.com/MicrosoftEdge/Demos/blob/main/built-in-ai/static/translator-api.js) 或使用 [Edge Built-in AI Playground](https://microsoftedge.github.io/Demos/built-in-ai/) 检查模型。阅读器优先采用 EPUB 的 `lang`，缺失时才调用 Language Detector。

Translation uses [BCP 47](https://www.rfc-editor.org/info/bcp47) tags: `zh-Hans` for Simplified Chinese and `zh-Hant` for Traditional Chinese. Consult the [official Edge language list](https://github.com/MicrosoftEdge/Demos/blob/main/built-in-ai/static/translator-api.js) or check the model in the [Edge Built-in AI Playground](https://microsoftedge.github.io/Demos/built-in-ai/). The reader prefers the EPUB `lang` value and invokes the Language Detector only when it is missing.

### 应用形态 / Application variants

主要跨端差异：

| 形态 | 打开本地 EPUB | 保存 |
| --- | --- | --- |
| 插件 | 欢迎页可手动选择或拖入文件；也会重定向已打开的 `file://*.epub` 标签 | 通过文件选择器保存完整 EPUB，并复用已授权的文件句柄 |
| Web | 手动选择或拖入文件，不支持双击关联 | 文件选择器打开的文件可直接保存；拖入的文件保存为下载副本 |
| 桌面 | 无参数启动显示欢迎页；也支持系统文件关联 | 文件关联由本地服务写回；欢迎页选择沿用浏览器保存能力 |

Key differences between platforms:

| Application | Opening local EPUBs | Saving |
| --- | --- | --- |
| Extension | The welcome screen accepts selected or dropped files and redirects opened `file://*.epub` tabs | Saves a complete EPUB through a file picker and reuses approved file handles |
| Web | Files must be selected or dropped; OS double-click association is unavailable | Picker-opened files can be saved directly; dropped files are saved as downloaded copies |
| Desktop | Shows the welcome screen without arguments and also supports OS file associations | Associated files use local-service write-back; welcome-screen files use browser saving |

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
