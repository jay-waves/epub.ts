import type { SpineEntry } from '../shared/spine-buffer'
import { ReflowableSpine } from '../shared/reflowable-spine'
import {
    getAnchorTurn,
    getAnchorRect,
} from '../shared/anchor-location'
import { NavigationTransaction } from '../shared/navigation-transaction'
import { isAtPaginatedBookEdge, planPaginatedNavigation } from './paginated-navigation'
import { paginatedReadingEdge, resolvePaginatedLocation } from './paginated-visible-location'
import { SectionFrame, type SectionDirection } from '../shared/section-frame'
import { animateNumber, easeOutQuad } from '../shared/animation'
import { setSelectionTarget, uncollapseRange } from '../shared/selection'
import { getPaginatedColumnGeometry } from './paginated-layout'
import { PaginatedTrack } from './paginated-track'
import type { Book, RawRelocateDetail, Resolved } from '../reader-view.js'
import type { RendererStyles } from '../renderer'
import { getLayoutGap, supportsContinuousSpine } from '../shared/flow-geometry'

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
    const doc = sel.anchorNode.ownerDocument
    if (!doc || sel.focusNode.ownerDocument !== doc) return false
    const range = doc.createRange()
    range.setStart(sel.anchorNode, sel.anchorOffset)
    range.setEnd(sel.focusNode, sel.focusOffset)
    return range.collapsed
}

// NOTE: everything here assumes the so-called "negative scroll type" for RTL
export class PaginatedRenderer extends HTMLElement {
    beforeRenderDocument?: (doc: Document, index: number) => Promise<void> | void
    static observedAttributes = [
        'gap', 'margin',
        'max-inline-size', 'max-column-inline-size',
        'max-column-count',
    ]
    #bookDir?: string
    #observer = new ResizeObserver(() => {
        const containerRect = this.#container.getBoundingClientRect()
        const viewportRect = this.getBoundingClientRect()
        const changed = containerRect.width !== this.#containerWidth
            || containerRect.height !== this.#containerHeight
            || viewportRect.width !== this.#viewportWidth
            || viewportRect.height !== this.#viewportHeight
        if (!changed) return

        this.#containerWidth = containerRect.width
        this.#containerHeight = containerRect.height
        this.#viewportWidth = viewportRect.width
        this.#viewportHeight = viewportRect.height
        this.#invalidateViewportGeometry()
    })
    #top!: HTMLElement
    #background!: HTMLElement
    #container!: HTMLElement
    #track!: HTMLElement
    #view: SectionFrame | null = null
    #spine!: ReflowableSpine
    #navigation = new NavigationTransaction()
    #vertical = false
    #rtl = false
    #index = -1
    #anchor: ResolvedAnchor = 0 // anchor view to a fraction (0-1), Range, or Element
    #scrollBounds: [number, number, number] | null = null
    #lastVisibleRange?: Range
    #renderFrame?: number
    #containerWidth = 0
    #containerHeight = 0
    #viewportWidth = 0
    #viewportHeight = 0
    #pageSize = 0
    #turnSize = 1
    #edgeTurns = 1
    #pageOrigin = 0
    #layoutRevision = 0
    #trackLayoutInvalid = false
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

        this.#top = root.getElementById('top')!
        this.#background = root.getElementById('background')!
        this.#container = root.getElementById('container')!
        this.#track = root.getElementById('track')!
        this.#spine = new ReflowableSpine({
            activeEntry: () => this.#entryAtReadingEdge(),
            backgroundElement: this.#background,
            beforeRenderDocument: (doc, index) => this.beforeRenderDocument?.(doc, index),
            compact: () => this.continuous,
            continuous: () => this.continuous,
            currentView: () => this.#view,
            host: this,
            layout: () => this.#layoutEntries(),
            layoutFor: direction => this.#beforeRender(direction),
            layoutRevision: () => this.#layoutRevision,
            navigation: this.#navigation,
            onClear: () => this.#pageOrigin = 0,
            onDestroyCurrent: view => {
                if (this.#view === view) this.#view = null
            },
            onExpand: view => this.#onViewExpand(view),
            restoreViewport: offset => this.#restoreViewport(offset),
            scheduleRender: () => this.#scheduleRender(),
            trackElement: this.#track,
            track: new PaginatedTrack(() => this.size),
            viewportOffset: () => this.#container[this.scrollProp],
            viewport: () => {
                const { start, end } = this.#spine.viewportRange(this.start, this.end)
                return {
                    activeIndex: this.#index,
                    viewportEnd: end,
                    viewportSize: this.size,
                    viewportStart: start,
                }
            },
        })
        this.#observer.observe(this)
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
            // A delayed selectionchange can outlive the currently visible spine
            // item. DOM ranges from different documents cannot be compared.
            if (selRange.startContainer.ownerDocument
                !== range.startContainer.ownerDocument) return
            const backward = selectionIsBackward(sel)
            if (backward && selRange.compareBoundaryPoints(Range.START_TO_START, range) < 0)
                this.prev()
            else if (!backward && selRange.compareBoundaryPoints(Range.END_TO_END, range) > 0)
                this.next()
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

    }
    attributeChangedCallback(name: string, _oldValue: string | null, value: string | null) {
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
        }
    }
    open(book: Book) {
        this.#bookDir = book.dir
        this.#spine.open(book)
    }
    #onViewExpand(view: SectionFrame) {
        if (!this.#spine.entries.some(entry => entry.view === view)) return
        if (this.#navigation.deferReflow()) return
        const activeEntry = this.#entryAtReadingEdge()
        const oldOffset = activeEntry ? this.#entryOffset(activeEntry) : 0
        this.#layoutEntries()
        if (activeEntry) {
            const shift = this.#entryOffset(activeEntry) - oldOffset
            if (shift) this.#restoreViewport(this.#container[this.scrollProp] + shift)
        }
    }
    #layoutEntries() {
        if (!this.#spine.entries.length || !this.continuous) return
        for (const { view } of this.#spine.entries)
            view.compact = true
        const layout = this.#spine.layout()
        for (const { entry, physicalStart } of layout.placements) {
            const { style } = entry.view.element
            style.position = 'absolute'
            style.left = this.#vertical ? '0' : `${physicalStart}px`
            style.top = this.#vertical ? `${physicalStart}px` : '0'
        }
        const side = this.#vertical ? 'height' : 'width'
        const otherSide = this.#vertical ? 'width' : 'height'
        this.#track.style[side] = `${this.#spine.physicalExtent}px`
        this.#track.style[otherSide] = '100%'
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
            this.getBoundingClientRect().width >= 2000 ? 3
                : this.getBoundingClientRect().width >= 1500 ? 2 : 1,
        )
        const maxInlineSize = parseFloat(style.getPropertyValue(
            maxColumnCount > 1 ? '--_max-column-inline-size' : '--_max-inline-size'))
        const margin = parseFloat(style.getPropertyValue('--_margin'))

        const baseGap = getLayoutGap(style.getPropertyValue('--_gap'), size)

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
        this.#turnSize = columnStep
        this.#edgeTurns = Math.max(1, Math.round(pageSize / this.#turnSize))
        this.setAttribute('dir', rtl ? 'rtl' : 'ltr')

        return { kind: 'columns' as const,
            height: vertical ? pageSize : height,
            width: vertical ? width : pageSize,
            margin, gap,
            columnWidth, columnCount: divisor, columnStep }
    }
    render() {
        if (!this.#view) return
        if (!this.#navigation.beginReflow()) return
        if (this.#lastVisibleRange) this.#anchor = this.#lastVisibleRange.cloneRange()
        if (this.#trackLayoutInvalid) {
            this.#spine.track.reset()
            this.#trackLayoutInvalid = false
        }
        if (!this.continuous && this.#spine.entries.length > 1)
            this.#spine.removeOtherThan(this.#view)
        for (const { view } of this.#spine.entries) {
            view.setCompact(this.continuous, false)
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
        } else {
            this.#layoutEntries()
        }
        // Clear overflow accidentally retained on the inactive axis.
        this.#container[this.#vertical ? 'scrollLeft' : 'scrollTop'] = 0
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
    #invalidateViewportGeometry() {
        if (this.#destroyed) return
        this.#layoutRevision += 1
        this.#trackLayoutInvalid = true
        this.#pageSize = 0
        this.#scrollBounds = null
        this.#scheduleRender()
    }
    get mode() {
        return 'paginated' as const
    }
    get element() {
        return this
    }
    get continuous() {
        return supportsContinuousSpine(this.#bookDir, this.#rtl, this.#vertical)
    }
    get scrollProp() {
        return this.#vertical ? 'scrollTop' as const : 'scrollLeft' as const
    }
    get sideProp() {
        return this.#vertical ? 'height' as const : 'width' as const
    }
    get size() {
        if (this.#pageSize) return this.#pageSize
        const size = this.sideProp === 'width'
            ? this.#containerWidth : this.#containerHeight
        return size || this.#container.getBoundingClientRect()[this.sideProp]
    }
    get turnSize() {
        return this.#turnSize
    }
    get edgeTurns() {
        return this.#edgeTurns
    }
    get viewSize() {
        if (this.continuous) return this.#spine.physicalExtent
        return this.#view?.element.getBoundingClientRect()[this.sideProp] ?? 0
    }
    get start() {
        return Math.abs(this.#container[this.scrollProp])
    }
    get end() {
        return this.start + this.size
    }
    get turn() {
        return Math.round((this.start - this.#pageOrigin) / this.turnSize)
    }
    get turns() {
        return Math.floor(Math.max(0,
            this.viewSize - this.size - this.#pageOrigin) / this.turnSize) + 1
    }
    panBy(dx: number, dy: number) {
        if (this.#navigation.busy) return
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
        return this.#enqueueNavigation(async () => {
            const velocity = this.#vertical ? vy : vx
            const [offset, backward, forward] = this.#scrollBounds
                ?? [this.start, this.turnSize, this.turnSize]
            const min = Math.abs(offset) - backward
            const max = Math.abs(offset) + forward
            const projected = velocity * (this.#rtl ? -this.turnSize : this.turnSize)
            const target = Math.max(min, Math.min(max,
                this.start + (isNaN(projected) ? 0 : projected)))
            const turn = Math.round((target - this.#pageOrigin) / this.turnSize)

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
        return this.#spine.entryForView(view)
    }
    #entryAtReadingEdge() {
        if (!this.continuous) return this.#entryForView()
        const firstOffset = this.#entryOffset(this.#spine.first)
        const edge = paginatedReadingEdge(this.start, firstOffset)
        return this.#spine.entries.find(entry =>
            edge >= entry.start && edge < entry.start + entry.extent)
            ?? this.#spine.entries.at(-1)
    }
    #entryOffset(entry = this.#entryForView()) {
        return this.#spine.entryOffset(entry)
    }
    #restoreViewport(offset: number) {
        this.#container[this.scrollProp] = offset
        if (this.#scrollBounds) this.#scrollBounds[0] = offset
    }
    async #scrollToRect(rect: DOMRect, reason: string, entry = this.#entryForView()) {
        if (!entry) return
        const offset = this.#getRectMapper(entry.view)(rect).left
        return this.#scrollToTurn(this.continuous
            ? getAnchorTurn(this.#entryOffset(entry), offset, this.turnSize)
            : Math.floor(offset / this.turnSize) + (this.#rtl ? -this.edgeTurns : this.edgeTurns), reason)
    }
    async #scrollTo(offset: number, reason: string, smooth = false,
        preferred?: { entry: SpineEntry<SectionFrame>; fraction: number; range?: Range }) {
        const element = this.#container
        const { scrollProp, turnSize } = this
        if (element[scrollProp] === offset) {
            this.#scrollBounds = [offset, this.atStart ? 0 : turnSize, this.atEnd ? 0 : turnSize]
            this.#afterScroll(reason, preferred)
            return
        }
        if ((reason === 'snap' || smooth) && this.hasAttribute('animated')) return animateNumber(
            element[scrollProp], offset, 300, easeOutQuad,
            x => element[scrollProp] = x,
        ).then(() => {
            this.#scrollBounds = [offset, this.atStart ? 0 : turnSize, this.atEnd ? 0 : turnSize]
            this.#afterScroll(reason, preferred)
        })
        else {
            element[scrollProp] = offset
            this.#scrollBounds = [offset, this.atStart ? 0 : turnSize, this.atEnd ? 0 : turnSize]
            this.#afterScroll(reason, preferred)
        }
    }
    async #scrollToTurn(turn: number, reason: string, smooth = false) {
        const logicalOffset = this.#pageOrigin + this.turnSize * turn
        const offset = this.#rtl ? -logicalOffset : logicalOffset
        return this.#scrollTo(offset, reason, smooth)
    }
    async scrollToAnchor(anchor: number, select = false) {
        await this.#enqueueNavigation(() => this.#scrollToAnchor(
            anchor, select ? 'selection' : 'navigation'))
    }
    async #scrollToAnchor(anchor: ResolvedAnchor, reason = 'anchor', entry = this.#entryForView()) {
        if (!entry) return
        this.#anchor = anchor
        const rect = typeof anchor === 'number' ? undefined : getAnchorRect(uncollapseRange(anchor))
        // if anchor is an element or a range
        if (rect) {
            const mapped = this.#getRectMapper(entry.view)(rect)
            if (this.continuous) {
                return this.#projectTarget(entry, mapped.left, reason, anchor)
            }
            await this.#scrollToRect(rect, reason, entry)
            return
        }
        if (typeof anchor !== 'number') return
        // if anchor is a fraction
        if (this.continuous) {
            const localOffset = anchor * Math.max(0, entry.view.extent - 1)
            const visible = await this.#projectTarget(entry, localOffset, reason)
            if (visible && reason === 'navigation' && anchor === 0) {
                const heading = entry.view.document.querySelector('h1, h2, h3, h4, h5, h6')
                if (heading) this.#emphasizeTarget(heading)
            }
            return
        }
        const contentTurns = this.turns - this.edgeTurns * 2
        const turn = Math.round(anchor * (contentTurns - 1))
        await this.#scrollToTurn(turn + this.edgeTurns, reason)
    }
    #targetRange(anchor: ResolvedAnchor) {
        if (typeof anchor === 'number') return undefined
        if ('startContainer' in anchor) return anchor as Range
        if (!('nodeType' in anchor)) return undefined
        const range = anchor.ownerDocument?.createRange()
        range?.selectNode(anchor as Node)
        return range
    }
    #emphasizeTarget(anchor: ResolvedAnchor) {
        if (typeof anchor === 'number') return
        const node = 'startContainer' in anchor ? anchor.startContainer : anchor
        const element = node?.nodeType === Node.ELEMENT_NODE
            ? node as Element : node?.parentElement
        element?.animate([
            { backgroundColor: 'color-mix(in srgb, currentColor 18%, transparent)' },
            { backgroundColor: 'transparent' },
        ], { duration: 900, easing: 'ease-out' })
    }
    async #projectTarget(entry: SpineEntry<SectionFrame>, localOffset: number,
        reason: string, anchor?: ResolvedAnchor) {
        const target = this.#entryOffset(entry) + localOffset
        const preferred = {
            entry,
            fraction: Math.min(1, Math.max(0, localOffset / entry.view.extent)),
            range: anchor === undefined ? undefined : this.#targetRange(anchor),
        }
        if (target >= this.start && target < this.end) {
            if (reason === 'navigation' && anchor !== undefined) this.#emphasizeTarget(anchor)
            this.#afterScroll(reason, preferred)
            return true
        }

        const columnStep = Math.max(1, entry.view.columnStep)
        const column = this.#entryOffset(entry) + Math.floor(localOffset / columnStep) * columnStep
        const middle = Math.floor(entry.view.columnCount / 2) * columnStep
        const max = Math.max(0, this.viewSize - this.size)
        const offset = Math.max(0, Math.min(max, column - middle))
        this.#pageOrigin = ((offset % this.turnSize) + this.turnSize) % this.turnSize
        await this.#scrollTo(offset, reason, false, preferred)
        return false
    }
    #afterScroll(reason: string, preferred?: {
        entry: SpineEntry<SectionFrame>; fraction: number; range?: Range
    }) {
        const location = resolvePaginatedLocation({
            continuous: this.continuous,
            current: this.#entryForView(),
            end: this.end,
            edgeTurns: this.edgeTurns,
            entryOffset: entry => this.#entryOffset(entry),
            findAt: offset => this.#spine.findAt(offset),
            rtl: this.#rtl,
            page: this.turn,
            pages: this.turns,
            start: this.start,
            viewportSize: this.size,
        })
        if (!location) return

        const entry = preferred?.entry ?? location.entry
        const range = preferred ? preferred.range : location.range
        const fraction = preferred?.fraction ?? location.fraction
        const size = preferred ? Math.min(1, this.size / entry.view.extent) : location.size
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
        if (this.continuous) this.#spine.scheduleCache()
    }
    #navigationState() {
        return {
            atBookEnd: this.#adjacentIndex(1) == null,
            atBookStart: this.#adjacentIndex(-1) == null,
            edgeTurns: this.edgeTurns,
            turn: this.turn,
            turns: this.turns,
        }
    }
    async #goTo({ index, anchor, select = false }: Resolved) {
        const hasFocus = this.#view?.document?.hasFocus()
        const entry = await this.#spine.activate(index)
        this.#view = entry.view
        this.#index = index
        const resolvedAnchor = typeof anchor === 'function'
            ? anchor(entry.view.document) : anchor
        await this.#scrollToAnchor(resolvedAnchor ?? 0,
            select ? 'selection' : 'navigation', entry)
        if (hasFocus) this.#view?.document?.defaultView?.focus()
    }
    #enqueueNavigation<T>(task: () => T | Promise<T>) {
        return this.#navigation.enqueue(task, () => this.#scheduleRender())
    }
    async goTo(target: Resolved | Promise<Resolved>) {
        const resolved = await target
        if (this.#spine.contains(resolved.index))
            return this.#enqueueNavigation(() => this.#goTo(resolved))
    }
    get atStart() {
        return isAtPaginatedBookEdge(this.#navigationState(), -1)
    }
    get atEnd() {
        return isAtPaginatedBookEdge(this.#navigationState(), 1)
    }
    #adjacentIndex(dir: -1 | 1) {
        return this.#spine.adjacent(this.#index, dir)
    }
    async #crossCacheWindow(dir: -1 | 1) {
        const boundary = this.continuous
            ? (dir < 0 ? this.#spine.first : this.#spine.last)?.index
            : this.#index
        if (boundary == null) return false
        const index = this.#spine.adjacent(boundary, dir)
        if (index == null) return false
        await this.#goTo({
            index,
            anchor: dir < 0 ? 1 : 0,
            select: false,
        })
        return true
    }
    async #turnPage(dir: -1 | 1, turns = 1) {
        if (!this.#view) return
        return this.#enqueueNavigation(async () => {
            let remaining = Math.max(1, turns)
            while (remaining > 0) {
                const action = planPaginatedNavigation(
                    this.#navigationState(), dir, remaining)
                if (action.kind === 'book-edge') return

                await this.#scrollToTurn(action.turn, 'page', true)
                // A background chapter may have extended the cache during the
                // animation. Cross only if the landed viewport is still at the
                // physical cache edge; otherwise that chapter is already next.
                const stillAtCacheEdge = dir < 0
                    ? this.turn <= 0 : this.turn >= this.turns - 1
                if (action.kind === 'turn-and-cross' && stillAtCacheEdge) {
                    if (!await this.#crossCacheWindow(dir)) return
                    remaining = action.turnsAfterCross
                    continue
                }
                return
            }
        })
    }
    prev() {
        return this.#turnPage(-1)
    }
    next() {
        return this.#turnPage(1)
    }
    prevPage() {
        return this.#turnPage(-1, this.edgeTurns)
    }
    nextPage() {
        return this.#turnPage(1, this.edgeTurns)
    }
    getContents() { return this.#spine.getContents() }
    setStyles(styles: RendererStyles) {
        this.#spine.setStyles(styles)
    }
    destroy() {
        if (this.#destroyed) return
        this.#destroyed = true
        if (this.#renderFrame !== undefined) cancelAnimationFrame(this.#renderFrame)
        this.#observer.disconnect()
        this.#spine.destroy()
    }
}

customElements.define('epub-paginated-renderer', PaginatedRenderer)
