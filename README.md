<p align="center">
  <img src="assets/logo.png" width="96" alt="epub.ts logo">
</p>

<h1 align="center">epub.ts</h1>

<p align="center">A focused EPUB reader built for the web and desktop.</p>

Available as:

- A Chrome extension
- A web app
- A browser-powered desktop app (linux, windows and macos)

[Try it now !](https://jay-waves.cn/epub.ts)

## Features

- Single- and double-column layouts
- Adjustable font size
- Controls for content width, line spacing, letter spacing, and image size
- Code highlighting powered by highlight.js
- Image zooming and copying powered by medium-zoom
- Math rendering and copying powered by MathJax
- Highlights and annotations
- Table of contents and reading progress
- Full-text search
- Remote LLM translation and Ask with streaming replies and follow-up questions

Table of contents:

<img src="assets/toc.png" width="800">

Search:

<img src="assets/search.png" width="800">

Auto-hiding Dock toolbar:

<img src="assets/dock.png" width="800">

### Runtime support

Supports Chrome and Edge 152+, Firefox 154+, and Safari and iOS Safari 26+.
The app uses modern Web APIs directly, with no polyfills or fallbacks for older releases.
See the Browserslist in `package.json` for the canonical build targets.

Clipboard and local-file features require a secure context and user permission.
Translate uses a remote LLM; when LLM is off, it opens Google Translate in a new tab.

### Advanced settings

Open **Settings** from the Dock or press **Ctrl+,** to configure typography, LLM connection settings, and its dependent Translate feature. Reader preferences are stored in this browser. The controller also exposes these settings for development:

```js
epub.settings.fonts
epub.settings.textAlignment

await epub.settings.setSerifFont("Noto Serif, serif")
await epub.settings.setSansFont("Noto Sans, system-ui, sans-serif")
await epub.settings.setMonoFont("Fira Code, ui-monospace, monospace")
await epub.settings.setTextAlignment("justify") // "auto" | "start" | "justify"
await epub.settings.reset()
```

Font names refer only to locally available browser fonts; the app does not download or install fonts.
The `auto` text-alignment setting chooses an alignment based on the document language.
`reset()` removes all advanced overrides and restores the defaults.
On each launch, the app logs the current settings and command hints to the console.

The **Translate** card owns the translation prompt. Its default uses `{{browserDefault}}`, replaced at request time with the browser's preferred language. You can replace this placeholder with a fixed language such as French or Japanese. `{{selectedText}}` inserts the selection. There are no source/target language fields, browser translation models, model downloads, or language detection.

### LLM

Enable **LLM** in Settings, then enter an OpenAI-compatible model, Base URL, and API key. Translate uses this connection with the prompt in its own card; Ask sends your message directly without applying the translation prompt. Select text and choose **Ask LLM** to open a separate, editable popover with the selection quoted and the caret below it. Press Send or **Ctrl+Enter / Command+Enter** to stream a response. Use the follow-up action to continue the conversation, copy its text, or drag the bottom-right handle to resize. Annotation popovers support the same resizing handle. When LLM is off, the menu explicitly shows **Translate (Google Translate)** and opens Google Translate directly with the selected text; Google manages language choices on its page. If LLM is on but its connection is incomplete, translation reports the configuration error.

All variants (web, desktop, and Chrome) call the provider directly from browser JavaScript, including during development. The provider must allow your reader's origin through CORS. Use HTTPS, or HTTP only for `localhost`, `127.0.0.1`, or `[::1]`. Changing the Base URL clears the existing key; enter a key again for the new endpoint. Requests block redirects and omit browser credentials and referrers.

Browser LLM requests always send `reasoning_effort: "none"` through the OpenAI-compatible Chat Completions API, including streaming responses, follow-ups, and connection tests. Use an endpoint and model that support this setting. An incompatible provider error is reported without retrying with reasoning enabled. Providers that ignore this parameter must be configured to disable thinking on their side or use a compatible gateway.

API keys stay in memory by default and disappear when the page reloads or closes. **Remember API key in this browser** is an explicit opt-in to unencrypted browser storage; the warning below the switch explains the risks. Neither mode protects against injected scripts (XSS). Use a separate, revocable key with a hard spending limit. **Clear key** removes the current key and revokes persistence. Model settings and the reusable prompt are saved separately from reader typography; LLM Reset restores provider defaults while preserving the Translate prompt. Clearing the Translate prompt restores the default browser-language template when it saves. Token usage is counted for the current page and resets on model changes.

Upgrading from the Go LLM proxy removes its stored AI configuration and `master.key`, without exporting credentials to the browser. Re-enter your provider settings and key. Existing reading preferences, documents, and browser-side custom prompts are preserved.

### Application variants

Key platform differences:

| Application | Opening local EPUBs | Saving |
| --- | --- | --- |
| Extension | Select or drop a file on the welcome screen, or open a `file://*.epub` tab and be redirected to the reader | Saves the complete EPUB through a file picker and reuses approved file handles |
| Web | Select or drop a file; OS file associations are unavailable | Files opened through the picker can be saved directly; dropped files are saved as downloaded copies |
| Desktop | Launch without arguments to show the welcome screen, or open a file through an OS file association | Associated files are written back by the local service; files selected on the welcome screen use browser-based saving |

Dropping support for old browsers does not mean dropping support for old books.
The parser and typography layers retain common EPUB 2 and EPUB 3 repairs, including legacy namespaces and `xlink:href`, `-epub-*` CSS normalization, irregular metadata, and migration of existing annotation data.
These paths preserve publication compatibility, not obsolete browser runtimes.

<img src="assets/screenshot1.png" width="800">

## Shortcuts

| Input | Paginated | Scrolled |
| --- | --- | --- |
| Click the left or right side of the screen | Previous or next column | Previous or next screen |
| Mouse Back or Forward button | Previous or next screen in reading order | Previous or next screen in reading order |
| `Left` / `Right`, `h` / `l` | Previous or next column | Previous or next screen |
| `Up` / `Down`, `k` / `j` | Previous or next screen | Scroll up or down |
| `Space` | Not applicable | Scroll down |
| Open the table of contents | `t` | `t` |
| Open search | `/` | `/` |
| Go to a reading position | Enter a percentage followed by `G`, such as `50G` | Same |
| Return to the previous position | `Ctrl+O` | `Ctrl+O` |
| Save | `Ctrl+S` / `Command+S` | Same |

## Acknowledgements

- [foliate-js](https://github.com/johnfactotum/foliate-js) for the original renderer and EPUB parser
- Fonts: EB Garamond, Monaspace Argon, Noto Sans, and Noto Serif

### Packaging workflow

Run `pnpm compile`, then `pnpm package:linux`, `pnpm package:windows`, or
`pnpm package:macos`. Local commands and CI share `packaging/build.mjs`;
`linux deb` / `linux rpm` select one format and `<platform> binary` builds only
the native service. Native sources live in `desktop/`, including the macOS
Swift entry point. Embedded web assets and Windows resources are generated in
an isolated temporary workspace and cleaned after success or failure.
The EPUB web build timestamp remains part of the native build identity.
