import { ReflowableSpine } from '../shared/reflowable-spine'
import {
    anchorForPosition,
    animateNumber,
    createReadingPosition,
    easeOutQuad,
    getAnchorRect,
    getFractionTarget,
    getRectTarget,
    NavigationTransaction,
    setSelectionTarget,
    uncollapseRange,
    type NavigationAnchor,
    type ReadingPosition,
    type RelocateDetail,
} from '../shared/navigation'
import { isAtScrolledBookEdge, planScrolledNavigation } from './scrolled-navigation'
import { resolveScrolledLocation, scrolledReadingEdge } from './scrolled-visible-location'
import { ScrollCoordinator } from './scroll-coordinator'
import { ScrolledTrack } from './scrolled-track'
import { SectionFrame, type SectionDirection } from '../shared/section-frame'
import type { Book, Resolved } from '../reader-view.js'
import type { RendererStyles } from '../renderer'
import { getLayoutGap, supportsContinuousSpine } from '../shared/flow-geometry'
import type { ScrolledSectionLayout } from '../shared/section-frame'

// NOTE: everything here assumes the so-called "negative scroll type" for RTL
export class ScrolledRenderer extends HTMLElement {
    beforeRenderDocument?: (doc: Document, index: number) => Promise<void> | void
    static observedAttributes = [
        'gap', 'margin', 'max-inline-size',
    ]
    #bookDir?: string
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
    #spine!: ReflowableSpine
    #navigation = new NavigationTransaction()
    #vertical = false
    #rtl = false
    #margin = 0
    #position?: ReadingPosition
    #targetAnchor: NavigationAnchor = 0
    #motion?: AbortController
    #navigationRevision = 0
    #justAnchored = false
    #scrollBounds: [number, number, number] | null = null
    #renderFrame?: number
    #scrolledViewport!: ScrollCoordinator
    #containerWidth = 0
    #containerHeight = 0
    #destroyed = false
    constructor() {
        super()
        const root = this.attachShadow({ mode: 'closed' })
        root.innerHTML = `<style>
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

        this.#top = root.getElementById('top')!
        this.#background = root.getElementById('background')!
        this.#container = root.getElementById('container')!
        this.#track = root.getElementById('track')!
        this.#scrolledViewport = new ScrollCoordinator(this.#container, () => {
            if (!this.#destroyed)
                void this.#scrollTo(this.start, 'scroll').catch(error =>
                    console.warn('Failed to commit reader scroll position.', error))
        })
        this.#spine = new ReflowableSpine({
            activeEntry: () => this.#entryAtReadingEdge(),
            backgroundElement: this.#background,
            beforeRenderDocument: (doc, index) => this.beforeRenderDocument?.(doc, index),
            continuous: () => this.continuous,
            host: this,
            layout: () => this.#layoutEntries(),
            layoutFor: direction => this.#beforeRender(direction),
            navigation: this.#navigation,
            restoreViewport: offset => this.#restoreViewport(offset),
            scheduleRender: () => this.#scheduleRender(),
            trackElement: this.#track,
            track: new ScrolledTrack(() => this.size),
            viewportOffset: () => this.#container[this.scrollProp],
            viewport: () => {
                const { start, end } = this.#spine.viewportRange(this.start, this.end)
                return {
                    activeIndex: this.#position?.index ?? -1,
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
            if (detail.reason === 'selection') setSelectionTarget(this.#targetAnchor, 0)
            else if (detail.reason === 'navigation') {
                if (this.#targetAnchor === 1) setSelectionTarget(detail.range, 1)
                else if (typeof this.#targetAnchor === 'number')
                    setSelectionTarget(detail.range, -1)
                else setSelectionTarget(this.#targetAnchor, -1)
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
        this.#bookDir = book.dir
        this.#spine.open(book)
    }
    #layoutEntries() {
        if (!this.#spine.entries.length || !this.continuous) return
        const layout = this.#spine.layout()
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
        const view = this.#spine.currentView
        if (!view) return
        // A viewport resize may race the final idle scroll sample in exactly
        // the same way as section content expansion.
        this.#scrolledViewport.flush()
        if (!this.#navigation.beginReflow()) return
        const entry = this.#entryForView()
        const anchor = entry
            ? anchorForPosition(this.#position, entry.index, entry.view.document)
            : 0
        if (!this.continuous && this.#spine.entries.length > 1)
            this.#spine.removeOtherThanCurrent()
        for (const { view } of this.#spine.entries) {
            view.render(this.#beforeRender({
                vertical: this.#vertical,
                rtl: this.#rtl,
            }), false)
        }
        if (!this.continuous) {
            const { style } = view.element
            style.removeProperty('position')
            style.removeProperty('left')
            style.removeProperty('top')
            this.#track.style.width = '100%'
            this.#track.style.height = '100%'
        } else this.#layoutEntries()
        // Clear overflow accidentally retained on the inactive axis.
        this.#container[this.#vertical ? 'scrollTop' : 'scrollLeft'] = 0
        void this.#scrollToAnchor(anchor, 'anchor', entry).catch(error => {
            if (!this.#destroyed) console.warn('Failed to restore scrolled reading position.', error)
        })
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
        return 'scrolled' as const
    }
    get element() {
        return this
    }
    get continuous() {
        return supportsContinuousSpine(this.#bookDir, this.#rtl, this.#vertical)
    }
    get scrollProp() {
        return this.#vertical ? 'scrollLeft' as const : 'scrollTop' as const
    }
    get sideProp() {
        return this.#vertical ? 'width' as const : 'height' as const
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
        return this.#spine.currentView?.element.getBoundingClientRect()[this.sideProp] ?? 0
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
    #getRectMapper(view: SectionFrame | null = this.#spine.currentView) {
        return (rect: DOMRect) => view?.mapRect(rect) ?? rect
    }
    #entryForView(view: SectionFrame | null = this.#spine.currentView) {
        return this.#spine.entryForView(view)
    }
    #entryAtReadingEdge() {
        if (!this.continuous) return this.#entryForView()
        const edge = scrolledReadingEdge(this.start, this.#margin)
        return this.#spine.entries.find(entry =>
            edge >= entry.start && edge < entry.start + entry.extent)
            ?? this.#spine.entries.at(-1)
    }
    #entryOffset(entry = this.#entryForView()) {
        return this.#spine.entryOffset(entry)
    }
    #restoreViewport(offset: number) {
        if (this.#container[this.scrollProp] !== offset) {
            this.#justAnchored = true
            this.#scrolledViewport.cancel(true)
        }
        this.#container[this.scrollProp] = offset
        if (this.#scrollBounds) this.#scrollBounds[0] = offset
    }
    async #scrollToRect(rect: DOMRect, reason: string, entry = this.#entryForView()) {
        if (!entry) return false
        const offset = getRectTarget(this.#entryOffset(entry),
            this.#getRectMapper(entry.view)(rect).left, this.#margin)
        return this.#scrollTo(offset, reason)
    }
    async #scrollTo(offset: number, reason: string, smooth = false) {
        if (this.#destroyed) return false
        const element = this.#container
        const { scrollProp, size } = this
        // FIXME: vertical-rl only, not -lr
        if (this.#vertical) offset = -offset
        const moved = element[scrollProp] !== offset
        const commit = () => {
            if (this.#destroyed) return false
            const actualOffset = element[scrollProp]
            this.#scrollBounds = [
                actualOffset,
                this.atStart ? 0 : size,
                this.atEnd ? 0 : size,
            ]
            const location = resolveScrolledLocation({
                continuous: this.continuous,
                current: this.#entryForView(),
                entryOffset: entry => this.#entryOffset(entry),
                findAt: value => this.#spine.findAt(value),
                margin: this.#margin,
                range: entry => this.#scrolledViewport.readingRange(
                    entry.view.document, this.#margin),
                start: this.start,
                viewportSize: this.size,
            })
            if (!location) return false

            const { entry, fraction, range, size: viewportSize } = location
            const position = createReadingPosition(entry.index, fraction, range)
            if (moved) {
                this.#scrolledViewport.cancel(true)
                this.#justAnchored = true
            }
            this.#spine.activate(entry)
            this.#position = position
            if (reason !== 'selection' && reason !== 'navigation' && reason !== 'anchor')
                this.#targetAnchor = position.range ?? position.fraction
            else {
                this.#scrolledViewport.cancel()
                this.#justAnchored = true
            }

            const detail: RelocateDetail = {
                ...position,
                reason,
                size: viewportSize,
            }
            this.dispatchEvent(new CustomEvent('relocate', { detail }))
            if (this.continuous) this.#spine.scheduleCache()
            if (!moved) this.#justAnchored = false
            return true
        }

        if (!moved) return commit()
        if ((reason === 'snap' || smooth) && this.hasAttribute('animated')
            && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
            this.#motion?.abort()
            const motion = new AbortController()
            this.#motion = motion
            try {
                const completed = await animateNumber(
                    element[scrollProp], offset, 300, easeOutQuad,
                    x => element[scrollProp] = x,
                    motion.signal,
                )
                return completed && !motion.signal.aborted ? commit() : false
            } finally {
                if (this.#motion === motion) this.#motion = undefined
            }
        }
        element[scrollProp] = offset
        return commit()
    }
    async scrollToAnchor(anchor: number, select = false) {
        await this.#enqueueNavigation(() => this.#scrollToAnchor(
            anchor, select ? 'selection' : 'navigation'))
    }
    async #scrollToAnchor(anchor: NavigationAnchor, reason = 'anchor', entry = this.#entryForView()) {
        if (!entry) return false
        this.#scrolledViewport.cancel()
        this.#targetAnchor = anchor
        const rect = typeof anchor === 'number' ? undefined : getAnchorRect(uncollapseRange(anchor))
        // if anchor is an element or a range
        if (rect) {
            if (!this.#vertical) {
                const target = this.#scrolledViewport.anchorTarget(
                    entry.view.document, rect, this.#margin)
                if (target) {
                    if (target.visible) {
                        return this.#scrollTo(
                            this.#container[this.scrollProp], reason)
                    }
                    return this.#scrollTo(target.offset, reason)
                }
            }
            return this.#scrollToRect(rect, reason, entry)
        }
        if (typeof anchor !== 'number') return false
        // if anchor is a fraction
        return this.#scrollTo(getFractionTarget(
            this.#entryOffset(entry), entry.view.extent, anchor), reason)
    }
    #navigationState() {
        return {
            atBookEnd: this.#adjacentIndex(1) == null,
            atBookStart: this.#adjacentIndex(-1) == null,
            end: this.end,
            extent: this.viewSize,
            page: this.page,
            pages: this.pages,
            size: this.size,
            start: this.start,
        }
    }
    async #goTo({ index, anchor, select = false }: Resolved,
        revision = this.#navigationRevision,
        reason = select ? 'selection' : 'navigation') {
        const hasFocus = this.#spine.currentView?.document?.hasFocus()
        const entry = await this.#spine.prepare(index)
        if (this.#destroyed || revision !== this.#navigationRevision) return false
        this.#spine.activate(entry)
        const resolvedAnchor = typeof anchor === 'function'
            ? anchor(entry.view.document) : anchor
        const landed = await this.#scrollToAnchor(resolvedAnchor ?? 0, reason, entry)
        if (landed !== false && hasFocus)
            this.#spine.currentView?.document?.defaultView?.focus()
        return landed !== false
    }
    #enqueueNavigation<T>(task: (revision: number) => T | Promise<T>,
        revision = this.#navigationRevision) {
        return this.#navigation.enqueue(() => {
            if (this.#destroyed || revision !== this.#navigationRevision) return
            return task(revision)
        }, () => this.#scheduleRender())
    }
    capturePosition() {
        // Commit the physical offset synchronously before a mode switch aborts
        // an in-flight animation or a pending scroll sample.
        void this.#scrollTo(this.start, 'switch')
    }
    cancelNavigation() {
        this.#navigationRevision += 1
        this.#motion?.abort()
        this.#motion = undefined
        this.#scrollBounds = null
        this.#scrolledViewport.cancel(true)
    }
    async goTo(target: Resolved | Promise<Resolved>) {
        const revision = this.#navigationRevision
        const resolved = await target
        if (this.#destroyed || revision !== this.#navigationRevision) return
        if (this.#spine.contains(resolved.index))
            return this.#enqueueNavigation(
                current => this.#goTo(resolved, current), revision)
    }
    get atStart() {
        return isAtScrolledBookEdge(this.#navigationState(), -1)
    }
    get atEnd() {
        return isAtScrolledBookEdge(this.#navigationState(), 1)
    }
    #adjacentIndex(dir: -1 | 1) {
        return this.#spine.adjacent(
            this.#entryForView()?.index ?? this.#position?.index ?? -1, dir)
    }
    #crossCacheWindow(dir: -1 | 1, reason = 'scroll') {
        const boundary = this.continuous
            ? (dir < 0 ? this.#spine.first : this.#spine.last)?.index
            : this.#entryForView()?.index ?? this.#position?.index
        if (boundary == null) return
        const index = this.#spine.adjacent(boundary, dir)
        if (index == null) return
        return this.#goTo({
            index,
            anchor: dir < 0 ? 1 : 0,
            select: false,
        }, this.#navigationRevision, reason)
    }
    async #turnPage(dir: -1 | 1, distance?: number) {
        if (!this.#spine.currentView) return
        return this.#enqueueNavigation(async () => {
            const action = planScrolledNavigation(this.#navigationState(), dir, distance)
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
    destroy() {
        if (this.#destroyed) return
        this.#destroyed = true
        this.cancelNavigation()
        if (this.#renderFrame !== undefined) cancelAnimationFrame(this.#renderFrame)
        this.#scrolledViewport.destroy()
        this.#observer.disconnect()
        this.#spine.destroy()
    }
}

customElements.define('epub-scrolled-renderer', ScrolledRenderer)
