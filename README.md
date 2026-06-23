# EPUB Viewer Extension

Chrome EPUB reader extension.

EPUB 阅读器，Chrome 浏览器插件。

<img src="assets/screenshot1.png" width=800>

## 功能 Features 

用户通过 Chrome 打开某个 `.epub` 文件，本插件将拦截 `file://*.epub` 并重定向到插件页面阅读。

#### 美观性 Aesthetics

* 字体采用霞鹜文楷，英文字体采用 EBGaramond，等宽字体采用 Monaspace Argon 
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

## FAQ

#### 冷启动打开 epub 文件时，如何避免触发下载

插件会通过 `declarativeNetRequest` 注册一条持久重定向规则，把 `file://*.epub` 的主页面导航重定向到扩展阅读页。
这条规则会在浏览器侧持久化，Chrome 冷启动时也不依赖 background service worker 先启动。下载监听只作为兜底恢复逻辑。

#### 翻页模式加载新章节比滚动模式慢

因为渲染步骤比滚动模式复杂。这个通过缓存也无法解决。
