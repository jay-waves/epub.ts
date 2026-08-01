# EPUB Viewer Extension

Chrome EPUB reader extension.

EPUB 阅读器，Chrome 浏览器插件。

## Desktop launcher

The launcher is built into this repository and only accepts EPUB files. It
serves the reader from `epub.ts.localhost`, persists annotations inside the
EPUB, and installs only the EPUB file association.

```bash
pnpm build:linux
pnpm build:windows
```

Artifacts are written to `release/launcher/epub.ts` and
`release/launcher/epub.ts.exe`.

Requires Chrome 120 or newer.

需要 Chrome 120 或更高版本。

<img src="assets/screenshot1.png" width=800>

## 功能 Features 

用户通过 Chrome 打开某个 `.epub` 文件，本插件将拦截 `file://*.epub` 并重定向到插件页面阅读。

#### 美观性 Aesthetics

* 中文优先使用系统安装的霞鹜文楷，英文字体采用 EB Garamond 可变直立体和斜体 TTF，等宽字体采用 Monaspace Argon WOFF2
* 支持多种主题颜色：Light, Dark, Grey, Nord
* 亚克力面板，Dock 栏

#### 高效性 Efficiency

* 支持单栏、双栏切换
* 支持字体放大、缩小调整
* 支持页面排版调整：包括留白宽度、行间距、字间距、图大小等
* 支持 Vim 键绑定：hjkl 
* 高亮：右键菜单中高亮文本，删除高亮文本等
* `Ctrl+S` 保存带高亮和注释的 EPUB 副本
* 目录以及快速跳转进度条
* 搜索：全文搜索，仅搜索高亮文本

#### 展示

目录功能：

<img src="assets/toc.png" width=800>

搜索功能：

<img src="assets/search.png" width=800>

Dock 工具栏：（自动隐藏）

<img src="assets/dock.png" width=800>
