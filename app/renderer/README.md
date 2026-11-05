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

## 连续滚动管线与坐标边界

1. Reader 解析链接、CFI 或进度为 section target；Renderer 的导航事务串行处理目标。
2. ReflowableSpine 经 SpineBuffer.prepare 加载隐藏的 SectionFrame；
   SectionFrame 完成文档增强、样式应用、字体等待和尺寸测量。
3. SpineBuffer.commit 更新缓存成员；ScrolledTrack 将章节排成连续内容轨道。
   增删前置章节时，Spine 以活动章节的新旧偏移差补偿视口。
4. ScrolledRenderer 将目标投影为物理滚动位置；ScrollCoordinator 记录浏览器实际落点，
   避免程序滚动事件重复采样。用户滚动由帧合并后的采样更新位置。
5. relocate 只传递 section index、section fraction 与可选 Range；
   Reader 负责 CFI 和全书进度，不保存缓存窗口像素坐标。

滚动边界使用 start/end 与 contentExtent 的距离，容差为 2 CSS 像素。
不存在滚动模式的离散页码；按屏移动只是以视口大小为默认距离的滚动操作。
physicalExtent 包含尾部锚点对齐空间，只用于 DOM 轨道，不能参与书籍进度或末尾判断。

采样点在 iframe 与视口的交集内选择，并转换到 iframe 自身坐标。
横排从顶部阅读边缘采样；vertical-lr 从左侧、vertical-rl 从右侧采样。
不可见 iframe 不提供 Range。位置合并时，Range 和 fraction 均不能从其他章节借用。

共享层的职责保持独立：SpineBuffer 管成员和过期加载，Track 管几何，
NavigationTransaction 管导航互斥，SectionFrame 管文档生命周期。
销毁后不得重新调度缓存；文档初始化的同步和异步异常均须结束加载 Promise。

验证覆盖：scrolled-navigation（边界与步进）、scroll-coordinator（方向和缩放）、
reading-position（章节归属）、frame-document（加载失败与取消）、
spine-track（轨道补偿）、navigation-transaction（互斥）。
这些单元测试不替代浏览器对字体变化、图片延迟展开和实际 CFI 恢复的验证。
