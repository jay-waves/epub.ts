import { SpineBuffer } from '../shared/spine-buffer'
import { SpineTrack } from '../shared/spine-track'
import {
    getAnchorRect,
    getFractionTarget,
    getRectTarget,
    isAtBookEdge,
    planViewportNavigation,
    ViewportNavigation,
} from '../shared/viewport-navigation'
import {
    getReadingEdge,
    resolveVisibleLocation,
} from '../shared/visible-location'
import { ScrollCoordinator } from './scroll-coordinator'
import { SectionFrame, getDocumentBackground, type SectionDirection } from '../shared/section-frame'
import { animateNumber, easeOutQuad } from '../shared/animation'
import { setSelectionTarget, uncollapseRange } from '../shared/selection'
import { scrolledGeometry } from './scrolled-geometry'
import type { Book, Content, RawRelocateDetail, Resolved } from '../reader-view.js'
import type { RendererStyles } from '../renderer'
import type { TrackProjection } from '../shared/flow-geometry'
import type { ScrolledSectionLayout } from '../shared/section-frame'

type ResolvedAnchor = number | Node | Range

// NOTE: everything here assumes the so-called "negative scroll type" for RTL
export class ScrolledRenderer extends HTMLElement {
    bookDir?: string
    sections: Book['sections'] = []
    beforeRenderDocument?: (doc: Document, index: number) => Promise<void> | void
    static observedAttributes = [
        'gap', 'margin', 'max-inline-size',
    ]
    #root = this.attachShadow({ mode: 'closed' })
    #observer = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect
        this.#containerWidth = width
        this.#containerHeight = height
        this.#scheduleRender()
    })
    #top!: HTMLElement
    #background!: HTMLElement
    #container!: HTMLElement
    #track!: HTMLElement
    #view: SectionFrame | null = null
    #spine = new SpineBuffer<SectionFrame>({
        create: index => this.#createChapter(index),
        destroy: (index, view) => {
            this.#destroyView(view)
            this.sections[index]?.unload?.()
        },
        getExtent: view => view.extent,
    })
    #spineTrack = new SpineTrack<SectionFrame>()
    #vertical = false
    #rtl = false
    #margin = 0
    #index = -1
    #anchor: ResolvedAnchor = 0 // anchor view to a fraction (0-1), Range, or Element
    #justAnchored = false
    #navigation = new ViewportNavigation()
    #styles?: RendererStyles
    #styleMap = new WeakMap<Document, [HTMLStyleElement, HTMLStyleElement]>()
    #mediaQuery = matchMedia('(prefers-color-scheme: dark)')
    #mediaQueryListener!: () => void
    #scrollBounds: [number, number, number] | null = null
    #renderFrame?: number
    #scrolledViewport!: ScrollCoordinator
    #geometry = scrolledGeometry
    #loadingChapters = false
    #cacheFrame?: number
    #containerWidth = 0
    #containerHeight = 0
    #destroyed = false
    constructor() {
        super()
        this.#root.innerHTML = `<style>
        :host {
            display: block;
            container-type: size;
        }
        :host, #top {
            box-sizing: border-box;
            position: relative;
            overflow: hidden;
            width: 100%;
            height: 100%;
        }
        #top {
            --_gap: 7%;
            --_margin: 48px;
            --_max-inline-size: 720px;
        }
        #background {
            position: absolute;
            inset: 0;
        }
        #container {
            position: relative;
            width: 100%;
            height: 100%;
            overflow: auto;
            scrollbar-width: none;
            overflow-anchor: none;
        }
        #track {
            position: relative;
            width: 100%;
            height: 100%;
        }
        </style>
        <div id="top">
            <div id="background" part="filter"></div>
            <div id="container"><div id="track"></div></div>
        </div>
        `

        this.#top = this.#root.getElementById('top')!
        this.#background = this.#root.getElementById('background')!
        this.#container = this.#root.getElementById('container')!
        this.#track = this.#root.getElementById('track')!
        this.#scrolledViewport = new ScrollCoordinator(this.#container, () => {
            if (!this.#destroyed) this.#afterScroll('scroll')
        })

        this.#observer.observe(this.#container)
        this.#container.addEventListener('scroll', () => {
            this.dispatchEvent(new Event('scroll'))
            if (this.#justAnchored) this.#justAnchored = false
            else this.#scrolledViewport.schedule()
        })

        this.addEventListener('relocate', (({ detail }: CustomEvent) => {
            if (detail.reason === 'selection') setSelectionTarget(this.#anchor, 0)
            else if (detail.reason === 'navigation') {
                if (this.#anchor === 1) setSelectionTarget(detail.range, 1)
                else if (typeof this.#anchor === 'number')
                    setSelectionTarget(detail.range, -1)
                else setSelectionTarget(this.#anchor, -1)
            }
        }) as EventListener)
        this.#mediaQueryListener = () => {
            if (!this.#view) return
            this.#background.style.background = getDocumentBackground(this.#view.document)
        }
        this.#mediaQuery.addEventListener('change', this.#mediaQueryListener)
    }
    attributeChangedCallback(name: string, _oldValue: string | null, value: string | null) {
        if (value == null) return
        switch (name) {
            case 'gap':
            case 'margin':
                this.#top.style.setProperty('--_' + name, value)
                break
            case 'max-inline-size':
                // needs explicit `render()` as it doesn't necessarily resize
                this.#top.style.setProperty('--_' + name, value)
                this.#scheduleRender()
                break
        }
    }
    open(book: Book) {
        this.bookDir = book.dir
        this.sections = book.sections
    }
    #createView() {
        const view = new SectionFrame({
            onExpand: () => {
                if (this.#spine.entries.some(entry => entry.view === view)) {
                    // Reflowing while a navigation is in progress can
                    // restore #anchor before #afterScroll has updated it to the
                    // destination page. Defer the layout so the new, landed
                    // range becomes the anchor instead of jumping back.
                    if (this.#navigation.deferReflow()) return
                    const activeEntry = this.#entryAtReadingEdge()
                    const oldOffset = activeEntry ? this.#entryOffset(activeEntry) : 0
                    this.#layoutEntries()
                    if (activeEntry) {
                        const shift = this.#entryOffset(activeEntry) - oldOffset
                        if (shift) {
                            this.#container[this.scrollProp] += shift
                            if (this.#scrollBounds) this.#scrollBounds[0] += shift
                        }
                        if (activeEntry.view === view && this.#anchorBelongsTo(view))
                            void this.#scrollToAnchor(this.#anchor, 'anchor', activeEntry)
                    }
                }
            },
        })
        this.#track.append(view.element)
        return view
    }
    #destroyView(view: SectionFrame | null = this.#view) {
        if (!view) return
        const doc = view.document
        if (doc) this.dispatchEvent(new CustomEvent('unload', { detail: { doc } }))
        view.destroy()
        view.element.remove()
        if (this.#view === view) this.#view = null
    }
    #clearEntries() {
        if (this.#cacheFrame !== undefined) cancelAnimationFrame(this.#cacheFrame)
        this.#cacheFrame = undefined
        this.#spine.clear()
        this.#spineTrack.reset()
    }
    async #createChapter(index: number) {
        const section = this.sections[index]
        if (!section) throw new RangeError(`Missing spine section ${index}`)
        const view = this.#createView()
        const afterLoad = async (doc: Document) => {
            if (doc.head) {
                const $styleBefore = doc.createElement('style')
                doc.head.prepend($styleBefore)
                const $style = doc.createElement('style')
                doc.head.append($style)
                this.#styleMap.set(doc, [$styleBefore, $style])
                this.#applyStyles(doc, this.#styles)
            }
            await this.beforeRenderDocument?.(doc, index)
        }
        try {
            const src = await section.load?.()
            if (!src) throw new Error(`Failed to load spine section ${index}`)
            await view.load(src, afterLoad, this.#beforeRender.bind(this))
        } catch (error) {
            this.#destroyView(view)
            section.unload?.()
            throw error
        }
        // Set initial geometry while SpineBuffer still keeps the view staged.
        // Its expand callback must not relayout the committed track.
        view.compact = false
        return view
    }
    #initializeSpineEntry({ index, view }: { index: number; view: SectionFrame }) {
        if (!this.continuous) view.element.style.position = 'relative'
        view.element.style.removeProperty('visibility')
        this.dispatchEvent(new CustomEvent('load', { detail: { doc: view.document, index } }))
        this.dispatchEvent(new CustomEvent('request-overlay', {
            detail: {
                doc: view.document, index,
                attach: (overlay: any) => view.overlay = overlay,
            },
        }))
    }
    #commitSpineChange(change: any, activeEntry = this.#entryAtReadingEdge()) {
        const oldOffset = activeEntry ? this.#entryOffset(activeEntry) : 0
        const applied = this.#spine.commit(change)
        if (!applied.added.length && !applied.removed.length) return applied

        if (this.continuous) {
            this.#spineTrack.updateForChange(
                applied, activeEntry?.index, this.#trackProjection())
            this.#layoutEntries()
            if (activeEntry) {
                const shift = this.#entryOffset(activeEntry) - oldOffset
                this.#shiftViewport(shift)
            }
        }
        for (const entry of applied.added) this.#initializeSpineEntry(entry)
        this.#spine.dispose(applied.removed)
        return applied
    }
    #layoutEntries() {
        if (!this.#spine.entries.length || !this.continuous) return
        for (const { view } of this.#spine.entries)
            view.compact = false
        const layout = this.#spineTrack.layout(
            this.#spine.entries,
            this.#trackProjection() as Exclude<TrackProjection, { kind: 'single' }>)
        for (const { entry, physicalStart } of layout.placements) {
            const { style } = entry.view.element
            style.position = 'absolute'
            style.left = '0'
            style.top = `${physicalStart}px`
            style.width = '100%'
        }
        this.#track.style.width = '100%'
        this.#track.style.height = `${this.#spineTrack.physicalExtent}px`
    }
    async #cacheAdjacentSections() {
        if (!this.continuous) return
        if (this.#loadingChapters) {
            this.#scheduleAdjacentCache()
            return
        }
        this.#loadingChapters = true
        try {
            const { start, end } = this.#contentViewportRange()
            const change = await this.#spine.reconcile({
                activeIndex: this.#index,
                adjacent: (index, direction) => this.#adjacentIndexFrom(index, direction),
                viewportEnd: end,
                viewportSize: this.size,
                viewportStart: start,
            })
            const committed = await this.#runNavigation(() => {
                this.#commitSpineChange(change)
                return true
            })
            if (!committed || change.needsMore) this.#scheduleAdjacentCache()
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') this.#scheduleAdjacentCache()
            else throw error
        } finally {
            this.#loadingChapters = false
        }
    }
    #contentViewportRange() {
        return this.#spineTrack.viewportRange(
            this.#spine.first, this.start, this.end, this.#trackProjection())
    }
    #scheduleAdjacentCache() {
        if (!this.continuous || this.#cacheFrame) return
        this.#cacheFrame = requestAnimationFrame(() => {
            this.#cacheFrame = requestAnimationFrame(() => {
                this.#cacheFrame = undefined
                void this.#cacheAdjacentSections().catch(error => {
                    if (error?.name !== 'AbortError')
                        console.warn('Failed to cache adjacent reader sections.', error)
                })
            })
        })
    }
    #beforeRender({ vertical, rtl, background = '' }: SectionDirection): ScrolledSectionLayout {
        this.#vertical = vertical
        this.#rtl = rtl
        this.#top.classList.toggle('vertical', vertical)

        // set background to `doc` background
        // this is needed because the iframe does not fill the whole element
        this.#background.style.background = background

        const { width, height } = this.#container.getBoundingClientRect()
        this.#containerWidth = width
        this.#containerHeight = height
        const size = vertical ? height : width

        const style = getComputedStyle(this.#top)
        const maxInlineSize = parseFloat(style.getPropertyValue('--_max-inline-size'))
        const margin = parseFloat(style.getPropertyValue('--_margin'))
        this.#margin = margin

        const g = parseFloat(style.getPropertyValue('--_gap')) / 100
        // The gap will be a percentage of the #container, not the whole view.
        // This means the outer padding will be bigger than the column gap. Let
        // `a` be the gap percentage. The actual percentage for the column gap
        // will be (1 - a) * a. Let us call this `b`.
        //
        // To make them the same, we start by shrinking the outer padding
        // setting to `b`, but keep the column gap setting the same at `a`. Then
        // the actual size for the column gap will be (1 - b) * a. Repeating the
        // process again and again, we get the sequence
        //     x₁ = (1 - b) * a
        //     x₂ = (1 - x₁) * a
        //     ...
        // which converges to x = (1 - x) * a. Solving for x, x = a / (1 + a).
        // So to make the spacing even, we must shrink the outer padding with
        //     f(x) = x / (1 + x).
        // But we want to keep the outer padding, and make the inner gap bigger.
        // So we apply the inverse, f⁻¹ = -x / (x - 1) to the column gap.
        const baseGap = -g / (g - 1) * size

        // FIXME: vertical-rl only, not -lr
        this.setAttribute('dir', vertical ? 'rtl' : 'ltr')
        this.#top.style.padding = '0'
        return { kind: 'scrolled', width, height, margin,
            gap: baseGap, columnWidth: maxInlineSize }
    }
    render() {
        if (!this.#view) return
        if (!this.#navigation.beginReflow()) return
        if (!this.continuous && this.#spine.entries.length > 1)
            this.#spine.removeWhere(entry => entry.view !== this.#view)
        for (const { view } of this.#spine.entries) {
            view.compact = false
            view.render(this.#beforeRender({
                vertical: this.#vertical,
                rtl: this.#rtl,
            }))
        }
        if (!this.continuous) {
            const { style } = this.#view.element
            style.removeProperty('position')
            style.removeProperty('left')
            style.removeProperty('top')
            this.#track.style.width = '100%'
            this.#track.style.height = '100%'
        } else this.#layoutEntries()
        // Clear overflow accidentally retained on the inactive axis.
        this.#container[this.#geometry.inactiveScrollAxis(this.#writingContext())] = 0
        this.#scrollToAnchor(this.#anchor)
    }
    #scheduleRender() {
        if (this.#destroyed || this.#renderFrame) return
        if (this.#navigation.deferReflow()) return
        this.#renderFrame = requestAnimationFrame(() => {
            this.#renderFrame = undefined
            this.render()
        })
    }
    get mode() {
        return this.#geometry.mode
    }
    get element() {
        return this
    }
    get continuous() {
        return this.#geometry.continuous(this.#writingContext())
    }
    get scrollProp() {
        return this.#geometry.scrollAxis(this.#writingContext())
    }
    get sideProp() {
        return this.#geometry.extentSide(this.#writingContext())
    }
    #writingContext() {
        return { bookDir: this.bookDir, rtl: this.#rtl, vertical: this.#vertical }
    }
    #trackProjection() {
        return this.#geometry.trackProjection(this.#writingContext(), this.size)
    }
    get size() {
        const size = this.sideProp === 'width'
            ? this.#containerWidth : this.#containerHeight
        return size || this.#container.getBoundingClientRect()[this.sideProp]
    }
    get viewSize() {
        // The scrolled track includes a physical alignment reserve so anchors
        // near the cache tail remain reachable. It is not logical book content
        // and must not affect page-turn boundaries or progress calculations.
        if (this.continuous) return this.#spineTrack.contentExtent
        return this.#view?.element.getBoundingClientRect()[this.sideProp] ?? 0
    }
    get start() {
        return Math.abs(this.#container[this.scrollProp])
    }
    get end() {
        return this.start + this.size
    }
    get page() {
        return Math.floor(((this.start + this.end) / 2) / this.size)
    }
    get pages() {
        return Math.round(this.viewSize / this.size)
    }
    panBy(dx: number, dy: number) {
        const delta = this.#vertical ? dy : dx
        const element = this.#container
        const { scrollProp } = this
        element[scrollProp] += delta
    }
    // allows one to process rects as if they were LTR and horizontal
    #getRectMapper(view: SectionFrame | null = this.#view) {
        return (rect: DOMRect) => view?.mapRect(rect) ?? rect
    }
    #entryForView(view: SectionFrame | null = this.#view) {
        return this.#spine.entries.find(entry => entry.view === view)
    }
    #entryAtReadingEdge(ignore?: any) {
        if (!this.continuous) return this.#entryForView()
        const edge = getReadingEdge({
            contentOffset: 0,
            layout: 'scrolled',
            margin: this.#margin,
            start: this.start,
        })
        const entries = ignore
            ? this.#spine.entries.filter(entry => entry !== ignore)
            : this.#spine.entries
        return entries.find(entry =>
            edge >= entry.start && edge < entry.start + entry.extent)
            ?? entries.at(-1)
    }
    #anchorBelongsTo(view: SectionFrame) {
        if (typeof this.#anchor === 'number') return true
        const node = this.#anchor instanceof Range ? this.#anchor.startContainer : this.#anchor
        return (node?.ownerDocument ?? node) === view.document
    }
    #entryOffset(entry = this.#entryForView()) {
        return this.#spineTrack.entryOffset(entry, this.#trackProjection())
    }
    #shiftViewport(shift: number) {
        if (!shift) return
        this.#container[this.scrollProp] += shift
        if (this.#scrollBounds) this.#scrollBounds[0] += shift
    }
    async #scrollToRect(rect: DOMRect, reason: string, entry = this.#entryForView()) {
        if (!entry) return
        const offset = getRectTarget(this.#entryOffset(entry),
            this.#getRectMapper(entry.view)(rect).left, this.#margin)
        return this.#scrollTo(offset, reason)
    }
    async #scrollTo(offset: number, reason: string, smooth = false) {
        const element = this.#container
        const { scrollProp, size } = this
        if (element[scrollProp] === offset) {
            this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size]
            this.#afterScroll(reason)
            this.#justAnchored = false
            return
        }
        // FIXME: vertical-rl only, not -lr
        if (this.#vertical) offset = -offset
        if ((reason === 'snap' || smooth) && this.hasAttribute('animated')) return animateNumber(
            element[scrollProp], offset, 300, easeOutQuad,
            x => element[scrollProp] = x,
        ).then(() => {
            this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size]
            this.#afterScroll(reason)
        })
        else {
            element[scrollProp] = offset
            this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size]
            this.#afterScroll(reason)
        }
    }
    async #scrollToPage(page: number, reason: string, smooth = false) {
        const offset = this.size * (this.#rtl ? -page : page)
        return this.#scrollTo(offset, reason, smooth)
    }
    async scrollToAnchor(anchor: number, select = false) {
        return this.#runNavigation(() => this.#scrollToAnchor(
            anchor, select ? 'selection' : 'navigation'))
    }
    async #scrollToAnchor(anchor: ResolvedAnchor, reason = 'anchor', entry = this.#entryForView()) {
        if (!entry) return
        this.#scrolledViewport.cancel()
        this.#anchor = anchor
        const rect = getAnchorRect(uncollapseRange(anchor))
        // if anchor is an element or a range
        if (rect) {
            if (!this.#vertical) {
                const target = this.#scrolledViewport.anchorTarget(
                    entry.view.document, rect, this.#margin)
                if (target) {
                    if (target.visible) {
                        this.#afterScroll(reason)
                        this.#justAnchored = false
                        return
                    }
                    await this.#scrollTo(target.offset, reason)
                    return
                }
            }
            await this.#scrollToRect(rect, reason, entry)
            return
        }
        if (typeof anchor !== 'number') return
        // if anchor is a fraction
        await this.#scrollTo(getFractionTarget(
            this.#entryOffset(entry), entry.view.extent, anchor), reason)
    }
    #afterScroll(reason: string) {
        const location = resolveVisibleLocation({
            current: this.#entryForView(),
            end: this.end,
            entryOffset: entry => this.#entryOffset(entry),
            findAt: offset => this.#spine.findAt(offset),
            layout: {
                kind: 'scrolled',
                continuous: this.continuous,
                range: entry => this.#scrolledViewport.readingRange(
                    entry.view.document, this.#margin),
            },
            margin: this.#margin,
            page: this.page,
            pages: this.pages,
            start: this.start,
            viewportSize: this.size,
        })
        if (!location) return

        const { entry, fraction, range, size } = location
        this.#view = entry.view
        this.#index = entry.index
        // don't set new anchor if relocation was to scroll to anchor
        if (reason !== 'selection' && reason !== 'navigation' && reason !== 'anchor')
            if (range) this.#anchor = range
        else this.#justAnchored = true

        const detail: RawRelocateDetail = { reason, range, index: entry.index }
        if (fraction !== undefined) {
            detail.fraction = fraction
            detail.size = size
        }
        this.dispatchEvent(new CustomEvent('relocate', { detail }))
        // Run iframe creation and disposal after the landed page has painted.
        // Exact jumps benefit from the same warm cache as user-driven turns.
        if (this.continuous) this.#scheduleAdjacentCache()
    }
    #canGoToIndex(index: number) {
        return index >= 0 && index <= this.sections.length - 1
    }
    #navigationState() {
        return {
            atBookEnd: this.#adjacentIndex(1) == null,
            atBookStart: this.#adjacentIndex(-1) == null,
            end: this.end,
            extent: this.viewSize,
            mode: this.mode,
            page: this.page,
            pages: this.pages,
            size: this.size,
            start: this.start,
        }
    }
    async #activateEntry(index: number) {
        let entry = this.#spine.find(index)
        if (!entry) {
            const adjacentToWindow = this.continuous && this.#spine.entries.some(candidate =>
                this.#adjacentIndexFrom(candidate.index, -1) === index
                || this.#adjacentIndexFrom(candidate.index, 1) === index)
            if (!adjacentToWindow) this.#clearEntries()
            const prepared = await this.#spine.prepare(index)
            this.#commitSpineChange(this.#spine.changeFor([prepared]))
            entry = this.#spine.find(index)
        }
        if (!entry) throw new DOMException('Stale spine entry', 'AbortError')
        this.#view = entry.view
        this.#index = index

        return entry
    }
    async #goTo({ index, anchor, select = false }: Resolved) {
        const hasFocus = this.#view?.document?.hasFocus()
        const entry = await this.#activateEntry(index)
        const resolvedAnchor = typeof anchor === 'function'
            ? anchor(entry.view.document) : anchor
        await this.#scrollToAnchor(resolvedAnchor ?? 0,
            select ? 'selection' : 'navigation', entry)
        if (hasFocus) this.#focusView()
    }
    async #runNavigation<T>(task: () => T | Promise<T>) {
        return this.#navigation.run(task, () => this.#scheduleRender())
    }
    async goTo(target: Resolved | Promise<Resolved>) {
        const resolved = await target
        if (this.#canGoToIndex(resolved.index))
            return this.#navigation.enqueue(
                () => this.#goTo(resolved), () => this.#scheduleRender())
    }
    get atStart() {
        return isAtBookEdge(this.#navigationState(), -1)
    }
    get atEnd() {
        return isAtBookEdge(this.#navigationState(), 1)
    }
    #adjacentIndex(dir: -1 | 1) {
        return this.#adjacentIndexFrom(this.#index, dir)
    }
    #adjacentIndexFrom(from: number, dir: -1 | 1) {
        for (let index = from + dir; this.#canGoToIndex(index); index += dir)
            if (this.sections[index]?.linear !== 'no') return index
    }
    #crossCacheWindow(dir: -1 | 1) {
        const boundary = this.continuous
            ? (dir < 0 ? this.#spine.first : this.#spine.last)?.index
            : this.#index
        if (boundary == null) return
        const index = this.#adjacentIndexFrom(boundary, dir)
        if (index == null) return
        return this.#goTo({
            index,
            anchor: dir < 0 ? 1 : 0,
            select: false,
        })
    }
    async #turnPage(dir: -1 | 1, distance?: number) {
        if (!this.#view) return
        return this.#runNavigation(async () => {
            const action = planViewportNavigation(this.#navigationState(), dir, distance)
            if (action.kind === 'scroll') {
                await this.#scrollTo(action.offset, 'scroll', true)
            } else if (action.kind === 'page') {
                await this.#scrollToPage(action.page, 'page', true)
                // A background chapter may have extended the cache during the
                // animation. Cross only if the landed viewport is still at the
                // physical cache edge; otherwise that chapter is already next.
                const stillAtCacheEdge = dir < 0
                    ? this.page <= 0 : this.page >= this.pages - 1
                if (action.crossWindowAfter && stillAtCacheEdge) {
                    await this.#crossCacheWindow(dir)
                }
            } else if (action.kind === 'cross-window') {
                await this.#crossCacheWindow(dir)
            }
        })
    }
    prev(distance?: number) {
        return this.#turnPage(-1, distance)
    }
    next(distance?: number) {
        return this.#turnPage(1, distance)
    }
    getContents(): Content[] {
        return this.#spine.entries.flatMap(({ index, view }) => {
            const doc = view.document
            return doc ? [{ index, overlay: view.overlay, doc } satisfies Content] : []
        })
    }
    #applyStyles(doc: Document, styles?: RendererStyles) {
        const $$styles = this.#styleMap.get(doc)
        if (!$$styles || styles == null) return false
        const [$beforeStyle, $style] = $$styles
        if (Array.isArray(styles)) {
            const [beforeStyle, style] = styles
            if ($beforeStyle.textContent !== beforeStyle) $beforeStyle.textContent = beforeStyle
            if ($style.textContent !== style) $style.textContent = style
        } else if ($style.textContent !== styles) $style.textContent = styles
        return true
    }
    setStyles(styles: RendererStyles) {
        this.#styles = styles
        const docs = this.#spine.entries
            .map(({ view }) => view.document)
            .filter(doc => doc && this.#applyStyles(doc, styles))
        if (!docs.length) return

        // NOTE: needs `requestAnimationFrame` in Chromium
        requestAnimationFrame(() => {
            const doc = this.#view?.document
            if (doc) this.#background.style.background = getDocumentBackground(doc)
        })

        // needed because the resize observer doesn't work in Firefox
        Promise.all(docs.map(doc => doc.fonts?.ready)).then(() => this.#scheduleRender())
    }
    #focusView() {
        this.#view?.document?.defaultView?.focus()
    }
    destroy() {
        if (this.#destroyed) return
        this.#destroyed = true
        if (this.#renderFrame !== undefined) cancelAnimationFrame(this.#renderFrame)
        this.#scrolledViewport.destroy()
        this.#observer.disconnect()
        this.#clearEntries()
        this.#mediaQuery.removeEventListener('change', this.#mediaQueryListener)
    }
}

customElements.define('epub-scrolled-renderer', ScrolledRenderer)
