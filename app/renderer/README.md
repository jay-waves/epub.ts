# Renderer

Renderer owns low-level document mounting, layout, pagination, scrolling,
geometry, and positioning. It does not own book typography, reader features,
application state, or UI.

渲染层包含三种实现：

- `paginated/`：连续 spine 的多栏投影、步进和整屏翻页
- `scrolled/`：连续滚动、锚点投影和可见位置采样
- `fixed/`：固定版式 EPUB
- `shared/`：章节 iframe、spine 缓存与轨道、导航事务、坐标和选区工具

`ReaderView` 负责选择 renderer。Paginated 与 Scrolled 通过
`ReflowableSpine` 共享章节加载、样式注入和虚拟缓存。轨道布局、可见位置、
边界判断和翻页规划由各 renderer 自己的模式组件负责；共享导航事务只提供
串行执行与 reflow 互斥，不理解具体滚动模式。

`ReadingPosition` 是跨布局边界的唯一阅读位置：`index` 标识 section，
`fraction` 是始终存在的稳定回退，`range` 提供仍挂载时的精确文本位置。
像素偏移、栏号和缓存窗口坐标只存在于 renderer 内部。reflow、模式切换和
持久化不得把这些瞬时坐标当作阅读位置，也不得使用不属于对应 section 的 Range。

Paginated 与 Scrolled 都只允许 `#scrollTo()` 提交 ReadingPosition 和派发
`relocate`。动画帧及跨缓存窗口的中间落点只修改物理偏移；动画取消、renderer
销毁或模式切换后，旧导航 revision 不得再提交。布局变化在导航结束后合并为
一次 reflow，缓存加载可以并行，但 commit 必须等待导航空闲。

Paginated 始终以栏为最小单位：`prev()` / `next()` 移动一栏，
`prevPage()` / `nextPage()` 按当前可见栏数移动。相邻 section 在同一条
栏轨道上连续排列；iframe 仍是不可拆分的最小排版单元。

初始 renderer 与 EPUB parser 源自
[`foliate-js`](https://github.com/johnfactotum/foliate-js)，许可证见
`LICENSE.txt`。
