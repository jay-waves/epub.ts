import { ReflowableSpine } from '../shared/reflowable-spine'
import {
    getAnchorRect,
    getFractionTarget,
    getRectTarget,
    isAtBookEdge,
    planViewportNavigation,
} from '../shared/viewport-navigation'
import {
    getReadingEdge,
    resolveVisibleLocation,
} from '../shared/visible-location'
import { ScrollCoordinator } from './scroll-coordinator'
import { SectionFrame, type SectionDirection } from '../shared/section-frame'
import { animateNumber, easeOutQuad } from '../shared/animation'
import { setSelectionTarget, uncollapseRange } from '../shared/selection'
import { scrolledGeometry } from './scrolled-geometry'
import type { Book, RawRelocateDetail, Resolved } from '../reader-view.js'
import type { RendererStyles } from '../renderer'
import { getLayoutGap, type TrackProjection } from '../shared/flow-geometry'
import type { ScrolledSectionLayout } from '../shared/section-frame'

type ResolvedAnchor = number | Node | Range

// NOTE: everything here assumes the so-called "negative scroll type" for RTL
export class ScrolledRenderer extends HTMLElement {
    bookDir?: string
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
    #spine!: ReflowableSpine
    #vertical = false
    #rtl = false
    #margin = 0
    #index = -1
    #anchor: ResolvedAnchor = 0 // anchor view to a fraction (0-1), Range, or Element
    #justAnchored = false
    #scrollBounds: [number, number, number] | null = null
    #renderFrame?: number
    #scrolledViewport!: ScrollCoordinator
    #geometry = scrolledGeometry
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
        this.#spine = new ReflowableSpine({
            activeEntry: () => this.#entryAtReadingEdge(),
            backgroundElement: this.#background,
            beforeRenderDocument: (doc, index) => this.beforeRenderDocument?.(doc, index),
            compact: () => false,
            continuous: () => this.continuous,
            currentView: () => this.#view,
            host: this,
            layout: () => this.#layoutEntries(),
            layoutFor: direction => this.#beforeRender(direction),
            onDestroyCurrent: view => {
                if (this.#view === view) this.#view = null
            },
            onExpand: view => this.#onViewExpand(view),
            projection: () => this.#trackProjection(),
            restoreViewport: offset => this.#restoreViewport(offset),
            scheduleRender: () => this.#scheduleRender(),
            trackElement: this.#track,
            viewportOffset: () => this.#container[this.scrollProp],
            viewport: () => {
                const { start, end } = this.#contentViewportRange()
                return {
                    activeIndex: this.#index,
                    viewportEnd: end,
                    viewportSize: this.size,
                    viewportStart: start,
                }
            },
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
        this.#spine.open(book)
    }
    #onViewExpand(view: SectionFrame) {
        if (!this.#spine.entries.some(entry => entry.view === view)) return
        if (this.#spine.navigation.deferReflow()) return
        this.#scrolledViewport.flush()
        const activeEntry = this.#entryAtReadingEdge()
        const oldOffset = activeEntry ? this.#entryOffset(activeEntry) : 0
        this.#layoutEntries()
        if (activeEntry) this.#shiftViewport(this.#entryOffset(activeEntry) - oldOffset)
    }
    #layoutEntries() {
        if (!this.#spine.entries.length || !this.continuous) return
        for (const { view } of this.#spine.entries)
            view.compact = false
        const layout = this.#spine.layout(
            this.#trackProjection() as Exclude<TrackProjection, { kind: 'single' }>)
        for (const { entry, physicalStart } of layout.placements) {
            const { style } = entry.view.element
            style.position = 'absolute'
            style.left = '0'
            style.top = `${physicalStart}px`
            style.width = '100%'
        }
        this.#track.style.width = '100%'
        this.#track.style.height = `${this.#spine.physicalExtent}px`
    }
    #contentViewportRange() {
        return this.#spine.viewportRange(this.start, this.end, this.#trackProjection())
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

        const baseGap = getLayoutGap(style.getPropertyValue('--_gap'), size)

        // FIXME: vertical-rl only, not -lr
        this.setAttribute('dir', vertical ? 'rtl' : 'ltr')
        this.#top.style.padding = '0'
        return { kind: 'scrolled', width, height, margin,
            gap: baseGap, columnWidth: maxInlineSize }
    }
    render() {
        if (!this.#view) return
        // A viewport resize may race the final idle scroll sample in exactly
        // the same way as section content expansion.
        this.#scrolledViewport.flush()
        if (!this.#spine.navigation.beginReflow()) return
        if (!this.continuous && this.#spine.entries.length > 1)
            this.#spine.removeOtherThan(this.#view)
        for (const { view } of this.#spine.entries) {
            view.setCompact(false, false)
            view.render(this.#beforeRender({
                vertical: this.#vertical,
                rtl: this.#rtl,
            }), false)
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
        if (this.#spine.navigation.deferReflow()) return
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
        if (this.continuous) return this.#spine.contentExtent
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
        return this.#spine.entryForView(view)
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
    #entryOffset(entry = this.#entryForView()) {
        return this.#spine.entryOffset(entry, this.#trackProjection())
    }
    #restoreViewport(offset: number) {
        this.#container[this.scrollProp] = offset
        if (this.#scrollBounds) this.#scrollBounds[0] = offset
    }
    #shiftViewport(shift: number) {
        if (shift) this.#restoreViewport(this.#container[this.scrollProp] + shift)
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
        if (this.continuous) this.#spine.scheduleCache()
    }
    #canGoToIndex(index: number) {
        return this.#spine.contains(index)
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
        const entry = await this.#spine.activate(index)
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
        return this.#spine.navigation.run(task, () => this.#scheduleRender())
    }
    async goTo(target: Resolved | Promise<Resolved>) {
        const resolved = await target
        if (this.#canGoToIndex(resolved.index))
            return this.#spine.navigation.enqueue(
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
        return this.#spine.adjacent(from, dir)
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
            const action = planViewportNavigation(this.#navigationState(), dir, { distance })
            if (action.kind === 'scroll') {
                await this.#scrollTo(action.offset, 'scroll', true)
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
    getContents() { return this.#spine.getContents() }
    setStyles(styles: RendererStyles) {
        this.#spine.setStyles(styles)
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
        this.#spine.destroy()
    }
}

customElements.define('epub-scrolled-renderer', ScrolledRenderer)
