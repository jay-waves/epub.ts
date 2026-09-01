## 构建 / Build

### 构建依赖 / Build prerequisites

All builds require Node.js 24 LTS and pnpm 11. Native packaging additionally
requires:

- Go 1.27+ to build the launcher
- [nFPM](https://nfpm.goreleaser.com/docs/install/) to create `deb`/`rpm` packages
- NSIS and a PE resource compiler to create the Windows installer on Linux
- macOS system tools `hdiutil`, `sips`, `iconutil`, and `ditto` to create
  unsigned app bundles and disk images

```bash
corepack install --global pnpm@11.24.0
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

The arm64 macOS launcher, app bundle, and DMG must be built on Apple Silicon
macOS. Intel macOS is intentionally unsupported. The required
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
pnpm package:macos   # package the unsigned arm64 macOS app and DMG
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

## 渲染与交互 / Rendering & Interaction

```text
EPUB ZIP
   |
   v
读取 ZIP 目录与包信息，建立书脊和目录
Read the ZIP directory and package; build the spine and TOC
   |
   v
按需解压章节，重写 XHTML/CSS/SVG 中的资源 URL
Extract sections on demand and rewrite resource URLs
   |
   v
创建 iframe Document，注入基础阅读样式
Create the iframe Document and inject reader styles
   |
   +--------> 预加载字体 / PreLoad fonts
   +--------> 预加载图片 / PreLoad images
   +--------> 预加载 MathJax / Preload MathJax
   +--------> 预加载代码高亮 / Preload syntax highlighting
   |
   v
内容增强：语言、字体映射、语义、表格、脚注和图片布局
Enhance content: language, font mapping, semantics, tables, footnotes, and image layout
   |
   v
等待字体 / Wait for fonts (避免使用默认字体渲染，不同字体的高度不同，会抖动）
   |
   +--------> 渲染 MathJax 公式 / MathJax formulas
   +--------> 渲染代码高亮 / Syntax highlighting
   |
   v
确定书写方向，测量并完成分页或滚动布局
Resolve writing direction, measure, and lay out paginated or scrolled content
   |
   v
显示章节，绑定链接、图片、输入和标注交互
Reveal the section and bind link, image, input, and annotation interactions
   |
   v
章节卸载或换书时清理 / Clean up on unload or book change
```

Each pointer gesture should has only one owner and follow this priority order:

controls > links > highlights & annotations > images > text selection > page turning.

## 故障排查 / Troubleshooting

在 Edge 使用英文界面时，Language Detector API 可能会将现代中文错误识别为文言文（`lzh`），导致 Translator API 无法使用。

When Edge uses an English interface, the Language Detector API may incorrectly identify modern Chinese as Literary Chinese (`lzh`), preventing the Translator API from working.
