# Renderer

渲染层包含三种实现：

- `paginated/`：连续 spine 的多栏投影、步进和整屏翻页
- `scrolled/`：连续滚动、锚点投影和可见位置采样
- `fixed/`：固定版式 EPUB
- `shared/`：章节 iframe、spine 缓存与轨道、导航事务、坐标和选区工具

`ReaderView` 负责选择 renderer。Paginated 与 Scrolled 通过
`ReflowableSpine` 共享章节加载、样式注入、虚拟缓存和轨道维护；各 renderer
只处理自身的布局、滚动、吸附与定位投影。

Paginated 始终以栏为最小单位：`prev()` / `next()` 移动一栏，
`prevPage()` / `nextPage()` 按当前可见栏数移动。`SpineFlow` 以一级目录项
建立分页边界，未命名的开头内容和嵌套目录内容保持连续。

初始 renderer 与 EPUB parser 源自
[`foliate-js`](https://github.com/johnfactotum/foliate-js)，许可证见
`LICENSE.txt`。
