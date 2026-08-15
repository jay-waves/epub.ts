import { SpineBuffer } from '../shared/spine-buffer'
import { SpineTrack } from '../shared/spine-track'
import {
    getAnchorTurn,
    getAnchorRect,
    isAtBookEdge,
    planViewportNavigation,
    ViewportNavigation,
} from '../shared/viewport-navigation'
import {
    getReadingEdge,
    resolveVisibleLocation,
} from '../shared/visible-location'
import { SectionFrame, getDocumentBackground, type SectionDirection } from '../shared/section-frame'
import { animateNumber, easeOutQuad } from '../shared/animation'
import { setSelectionTarget, uncollapseRange } from '../shared/selection'
import { getPaginatedColumnGeometry } from './paginated-layout'
import { paginatedGeometry } from './paginated-geometry'
import type { Book, Content, RawRelocateDetail, Resolved } from '../reader-view.js'
import type { RendererStyles } from '../renderer'
import type { TrackProjection } from '../shared/flow-geometry'

type ResolvedAnchor = number | Node | Range

const debounce = <Args extends unknown[]>(
    f: (...args: Args) => void,
    wait: number,
    immediate = false,
) => {
    let timeout: number | undefined
    return (...args: Args) => {
        const later = () => {
            timeout = undefined
            if (!immediate) f(...args)
        }
        const callNow = immediate && !timeout
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(later, wait)
        if (callNow) f(...args)
    }
}

const selectionIsBackward = (sel: Selection) => {
    if (!sel.anchorNode || !sel.focusNode) return false
    const range = document.createRange()
    range.setStart(sel.anchorNode, sel.anchorOffset)
    range.setEnd(sel.focusNode, sel.focusOffset)
    return range.collapsed
}

// NOTE: everything here assumes the so-called "negative scroll type" for RTL
export class PaginatedRenderer extends HTMLElement {
    bookDir?: string
    sections: Book['sections'] = []
    beforeRenderDocument?: (doc: Document, index: number) => Promise<void> | void
    static observedAttributes = [
        'gap', 'margin',
        'max-inline-size', 'max-column-inline-size',
        'max-column-count', 'pagination-mode',
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
    #navigation = new ViewportNavigation()
    #styles?: RendererStyles
    #styleMap = new WeakMap<Document, [HTMLStyleElement, HTMLStyleElement]>()
    #mediaQuery = matchMedia('(prefers-color-scheme: dark)')
    #mediaQueryListener!: () => void
    #scrollBounds: [number, number, number] | null = null
    #lastVisibleRange?: Range
    #renderFrame?: number
    #geometry = paginatedGeometry
    #loadingChapters = false
    #cacheFrame?: number
    #containerWidth = 0
    #containerHeight = 0
    #pageSize = 0
    #turnSize = 1
    #edgeTurns = 1
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
            --_max-column-inline-size: var(--_max-inline-size);
            --_max-block-size: 1440px;
            --_max-column-count: 1;
            --_max-column-count-portrait: 1;
            --_max-column-count-spread: var(--_max-column-count);
            --_half-gap: calc(var(--_gap) / 2);
            --_max-width: calc(100% - var(--_gap));
            --_max-height: var(--_max-block-size);
            display: grid;
            grid-template-columns:
                minmax(var(--_half-gap), 1fr)
                var(--_half-gap)
                minmax(0, calc(var(--_max-width) - var(--_gap)))
                var(--_half-gap)
                minmax(var(--_half-gap), 1fr);
            grid-template-rows:
                minmax(var(--_margin), 1fr)
                minmax(0, var(--_max-height))
                minmax(var(--_margin), 1fr);
            &.vertical {
                --_max-column-count-spread: var(--_max-column-count-portrait);
                --_max-width: var(--_max-block-size);
                --_max-height: calc(var(--_max-inline-size) * var(--_max-column-count-spread));
            }
            @container (orientation: portrait) {
                & {
                    --_max-column-count-spread: var(--_max-column-count-portrait);
                }
                &.vertical {
                    --_max-column-count-spread: var(--_max-column-count);
                }
            }
        }
        #background {
            grid-column: 1 / -1;
            grid-row: 1 / -1;
        }
        #container {
            grid-column: 2 / 5;
            grid-row: 2;
            position: relative;
            overflow: hidden;
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
        this.#observer.observe(this.#container)
        this.#container.addEventListener('scroll', () =>
            this.dispatchEvent(new Event('scroll')))

        this.addEventListener('relocate', (({ detail }: CustomEvent) => {
            if (detail.reason === 'selection') setSelectionTarget(this.#anchor, 0)
            else if (detail.reason === 'navigation') {
                if (this.#anchor === 1) setSelectionTarget(detail.range, 1)
                else if (typeof this.#anchor === 'number')
                    setSelectionTarget(detail.range, -1)
                else setSelectionTarget(this.#anchor, -1)
            }
        }) as EventListener)
        const checkPointerSelection = debounce((range: Range, sel: Selection) => {
            if (!sel.rangeCount) return
            const selRange = sel.getRangeAt(0)
            const backward = selectionIsBackward(sel)
            if (backward && selRange.compareBoundaryPoints(Range.START_TO_START, range) < 0)
                this.prev(0)
            else if (!backward && selRange.compareBoundaryPoints(Range.END_TO_END, range) > 0)
                this.next(0)
        }, 700)
        this.addEventListener('load', (({ detail: { doc } }: CustomEvent<{ doc: Document }>) => {
            let isPointerSelecting = false
            doc.addEventListener('pointerdown', () => isPointerSelecting = true)
            doc.addEventListener('pointerup', () => isPointerSelecting = false)
            let isKeyboardSelecting = false
            doc.addEventListener('keydown', () => isKeyboardSelecting = true)
            doc.addEventListener('keyup', () => isKeyboardSelecting = false)
            doc.addEventListener('selectionchange', () => {
                const range = this.#lastVisibleRange
                if (!range) return
                const sel = doc.getSelection()
                if (!sel?.rangeCount) return
                if (isPointerSelecting && sel.type === 'Range')
                    checkPointerSelection(range, sel)
                else if (isKeyboardSelecting) {
                    const selRange = sel.getRangeAt(0).cloneRange()
                    const backward = selectionIsBackward(sel)
                    if (!backward) selRange.collapse()
                    this.#scrollToAnchor(selRange)
                }
            })
            // NOTE: `requestAnimationFrame` is needed in WebKit
            doc.addEventListener('focusin', (event: FocusEvent) =>
                requestAnimationFrame(() => this.#scrollToAnchor(event.target as Node)))
        }) as EventListener)

        this.#mediaQueryListener = () => {
            if (!this.#view) return
            this.#background.style.background = getDocumentBackground(this.#view.document)
        }
        this.#mediaQuery.addEventListener('change', this.#mediaQueryListener)
    }
    attributeChangedCallback(name: string, oldValue: string | null, value: string | null) {
        if (value == null) return
        switch (name) {
            case 'gap':
            case 'margin':
            case 'max-column-count':
                this.#top.style.setProperty('--_' + name, value)
                break
            case 'max-inline-size':
            case 'max-column-inline-size':
                // needs explicit `render()` as it doesn't necessarily resize
                this.#top.style.setProperty('--_' + name, value)
                this.#scheduleRender()
                break
            case 'pagination-mode':
                if (oldValue != null && oldValue !== value && this.#lastVisibleRange)
                    this.#anchor = this.#lastVisibleRange.cloneRange()
                this.#scrollBounds = null
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
        const view = this.#createView()
        if (!section) throw new RangeError(`Missing spine section ${index}`)
        const afterLoad = async (doc: Document) => {
            if (doc.head) {
                const $styleBefore = doc.createElement('style')
                doc.head.prepend($styleBefore)
                const $style = doc.createElement('style')
                $style.dataset.readerBookStyles = ''
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
        view.compact = this.continuous && this.#geometry.sectionLayout === 'columns'
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
            view.compact = this.#geometry.sectionLayout === 'columns'
        const layout = this.#spineTrack.layout(
            this.#spine.entries,
            this.#trackProjection() as Exclude<TrackProjection, { kind: 'single' }>)
        for (const { entry, physicalStart } of layout.placements) {
            const { style } = entry.view.element
            style.position = 'absolute'
            style.left = this.#vertical ? '0' : `${physicalStart}px`
            style.top = this.#vertical ? `${physicalStart}px` : '0'
        }
        const side = this.#vertical ? 'height' : 'width'
        const otherSide = this.#vertical ? 'width' : 'height'
        this.#track.style[side] = `${this.#spineTrack.physicalExtent}px`
        this.#track.style[otherSide] = '100%'
    }
    async #fillPaginatedSpread(insideNavigation = false) {
        if (this.#loadingChapters || !this.continuous || !this.#spine.entries.length) return
        this.#loadingChapters = true
        try {
            const firstView = this.#spine.entries[0].view
            const { columnCount } = firstView
            const active = this.#entryForView() ?? this.#spine.last
            if (!active) return
            const nextIndex = this.#adjacentIndexFrom(active.index, 1)
            const hasNext = nextIndex == null || Boolean(this.#spine.find(nextIndex))
            if (columnCount > 1 && !hasNext && active.view.contentColumns % columnCount) {
                const section = this.sections[nextIndex]
                if (!this.sections[active.index]?.pageSpread && !section?.pageSpread) {
                    const entry = await this.#spine.prepare(nextIndex)
                    const commit = () => {
                        this.#commitSpineChange(this.#spine.changeFor([entry]))
                        return true
                    }
                    const committed = insideNavigation ? commit() : await this.#runNavigation(commit)
                    if (!committed) this.#scheduleAdjacentCache()
                }
            }
        } finally {
            this.#loadingChapters = false
        }
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
    #beforeRender({ vertical, rtl, background = '' }: SectionDirection) {
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
        const maxColumnCount = Math.min(
            parseInt(style.getPropertyValue('--_max-column-count-spread')),
            this.#geometry.columnCount(this.getBoundingClientRect().width),
        )
        const maxInlineSize = parseFloat(style.getPropertyValue(
            maxColumnCount > 1 ? '--_max-column-inline-size' : '--_max-inline-size'))
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

        // Responsive policy has already selected the spread count. Do not
        // derive it again from the preferred text width: that would change the
        // number of visible columns when Zoom out crosses a width boundary.
        const {
            columnCount: divisor,
            columnStep,
            columnWidth,
            gap,
            pageSize,
        } = getPaginatedColumnGeometry(
            size, maxColumnCount, maxInlineSize, baseGap)
        this.#pageSize = pageSize
        this.#turnSize = this.#stepsByColumn ? columnStep : pageSize
        this.#edgeTurns = Math.max(1, Math.round(pageSize / this.#turnSize))
        this.setAttribute('dir', rtl ? 'rtl' : 'ltr')

        return { kind: this.#geometry.sectionLayout,
            height: vertical ? pageSize : height,
            width: vertical ? width : pageSize,
            margin, gap,
            columnWidth, columnCount: divisor, columnStep }
    }
    render() {
        if (!this.#view) return
        if (!this.#navigation.beginReflow()) return
        if (!this.continuous && this.#spine.entries.length > 1)
            this.#spine.removeWhere(entry => entry.view !== this.#view)
        for (const { view } of this.#spine.entries) {
            view.compact = this.continuous && this.#geometry.sectionLayout === 'columns'
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
        } else {
            this.#layoutEntries()
            void this.#fillPaginatedSpread().catch(error =>
                console.warn('Failed to fill paginated reader spread.', error))
        }
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
        if (this.#pageSize) return this.#pageSize
        const size = this.sideProp === 'width'
            ? this.#containerWidth : this.#containerHeight
        return size || this.#container.getBoundingClientRect()[this.sideProp]
    }
    get #stepsByColumn() {
        return this.getAttribute('pagination-mode') === 'stepping'
    }
    get turnSize() {
        return this.#turnSize
    }
    get edgeTurns() {
        return this.#edgeTurns
    }
    get viewSize() {
        if (this.continuous) return this.#spineTrack.physicalExtent
        return this.#view?.element.getBoundingClientRect()[this.sideProp] ?? 0
    }
    get start() {
        return Math.abs(this.#container[this.scrollProp])
    }
    get end() {
        return this.start + this.size
    }
    get turn() {
        return Math.round(this.start / this.turnSize)
    }
    get turns() {
        return Math.floor(Math.max(0, this.viewSize - this.size) / this.turnSize) + 1
    }
    panBy(dx: number, dy: number) {
        const delta = this.#vertical ? dy : dx
        const element = this.#container
        const { scrollProp } = this
        const [offset, a, b] = this.#scrollBounds ?? [this.start, this.turnSize, this.turnSize]
        const rtl = this.#rtl
        const min = rtl ? offset - b : offset - a
        const max = rtl ? offset + a : offset + b
        element[scrollProp] = Math.max(min, Math.min(max,
            element[scrollProp] + delta))
    }
    async #snap(vx: number, vy: number) {
        return this.#runNavigation(async () => {
            const velocity = this.#vertical ? vy : vx
            const [offset, backward, forward] = this.#scrollBounds
                ?? [this.start, this.turnSize, this.turnSize]
            const min = Math.abs(offset) - backward
            const max = Math.abs(offset) + forward
            const projected = velocity * (this.#rtl ? -this.turnSize : this.turnSize)
            const target = Math.max(min, Math.min(max,
                this.start + (isNaN(projected) ? 0 : projected)))
            const turn = Math.round(target / this.turnSize)

            await this.#scrollToTurn(turn, 'snap')
            if (this.turn <= 0) return this.#crossCacheWindow(-1)
            if (this.turn >= this.turns - 1) return this.#crossCacheWindow(1)
        })
    }
    settle(velocityX: number, velocityY: number) {
        if ((globalThis.visualViewport?.scale ?? 1) === 1)
            void this.#snap(velocityX, velocityY).catch(error =>
                console.warn('Failed to snap reader page.', error))
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
        const firstOffset = this.#entryOffset(this.#spine.first)
        const edge = getReadingEdge({
            contentOffset: firstOffset,
            layout: 'paginated',
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
        const offset = this.#getRectMapper(entry.view)(rect).left
        return this.#scrollToTurn(this.continuous
            ? getAnchorTurn(this.#entryOffset(entry), offset, this.turnSize)
            : Math.floor(offset / this.turnSize) + (this.#rtl ? -this.edgeTurns : this.edgeTurns), reason)
    }
    async #scrollTo(offset: number, reason: string, smooth = false) {
        const element = this.#container
        const { scrollProp, turnSize } = this
        if (element[scrollProp] === offset) {
            this.#scrollBounds = [offset, this.atStart ? 0 : turnSize, this.atEnd ? 0 : turnSize]
            this.#afterScroll(reason)
            return
        }
        if ((reason === 'snap' || smooth) && this.hasAttribute('animated')) return animateNumber(
            element[scrollProp], offset, 300, easeOutQuad,
            x => element[scrollProp] = x,
        ).then(() => {
            this.#scrollBounds = [offset, this.atStart ? 0 : turnSize, this.atEnd ? 0 : turnSize]
            this.#afterScroll(reason)
        })
        else {
            element[scrollProp] = offset
            this.#scrollBounds = [offset, this.atStart ? 0 : turnSize, this.atEnd ? 0 : turnSize]
            this.#afterScroll(reason)
        }
    }
    async #scrollToTurn(turn: number, reason: string, smooth = false) {
        const offset = this.turnSize * (this.#rtl ? -turn : turn)
        return this.#scrollTo(offset, reason, smooth)
    }
    async scrollToAnchor(anchor: number, select = false) {
        return this.#runNavigation(() => this.#scrollToAnchor(
            anchor, select ? 'selection' : 'navigation'))
    }
    async #scrollToAnchor(anchor: ResolvedAnchor, reason = 'anchor', entry = this.#entryForView()) {
        if (!entry) return
        this.#anchor = anchor
        const rect = getAnchorRect(uncollapseRange(anchor))
        // if anchor is an element or a range
        if (rect) {
            await this.#scrollToRect(rect, reason, entry)
            return
        }
        if (typeof anchor !== 'number') return
        // if anchor is a fraction
        if (this.continuous) {
            const offset = this.#entryOffset(entry) + anchor * Math.max(0, entry.view.extent - 1)
            await this.#scrollToTurn(Math.floor(offset / this.turnSize), reason)
            return
        }
        const contentTurns = this.turns - this.edgeTurns * 2
        const turn = Math.round(anchor * (contentTurns - 1))
        await this.#scrollToTurn(turn + this.edgeTurns, reason)
    }
    #afterScroll(reason: string) {
        const location = resolveVisibleLocation({
            current: this.#entryForView(),
            end: this.end,
            edgeTurns: this.edgeTurns,
            entryOffset: entry => this.#entryOffset(entry),
            findAt: offset => this.#spine.findAt(offset),
            layout: {
                kind: 'paginated',
                continuous: this.continuous,
                rtl: this.#rtl,
            },
            margin: this.#margin,
            page: this.turn,
            pages: this.turns,
            start: this.start,
            viewportSize: this.size,
        })
        if (!location) return

        const { entry, fraction, range, size } = location
        this.#view = entry.view
        this.#index = entry.index
        this.#lastVisibleRange = range
        // don't set new anchor if relocation was to scroll to anchor
        if (reason !== 'selection' && reason !== 'navigation' && reason !== 'anchor')
            if (range) this.#anchor = range

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
            edgeTurns: this.edgeTurns,
            extent: this.viewSize,
            mode: this.mode,
            turn: this.turn,
            turns: this.turns,
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

        if (this.continuous) await this.#fillPaginatedSpread(true)
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
                await this.#scrollTo(action.offset, 'page', true)
            } else if (action.kind === 'turn') {
                await this.#scrollToTurn(action.turn, 'page', true)
                // A background chapter may have extended the cache during the
                // animation. Cross only if the landed viewport is still at the
                // physical cache edge; otherwise that chapter is already next.
                const stillAtCacheEdge = dir < 0
                    ? this.turn <= 0 : this.turn >= this.turns - 1
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
        this.#observer.disconnect()
        this.#clearEntries()
        this.#mediaQuery.removeEventListener('change', this.#mediaQueryListener)
    }
}

customElements.define('epub-paginated-renderer', PaginatedRenderer)
