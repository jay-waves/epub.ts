import type { SpineEntry } from '../shared/spine-state'
import { ReflowableSpine } from '../shared/reflowable-spine'
import {
    anchorForPosition,
    animateNumber,
    createReadingPosition,
    easeOutQuad,
    getAnchorRect,
    NavigationTransaction,
    resolveReadingPosition,
    setSelectionTarget,
    uncollapseRange,
    type NavigationAnchor,
    type ReadingPosition,
    type RelocateDetail,
} from '../shared/navigation'
import {
    isAtPaginatedBookEdge,
    planPaginatedNavigation,
} from './paginated-navigation'
import { paginatedReadingEdge, resolvePaginatedLocation } from './paginated-visible-location'
import {
    sameSectionDirection,
    SectionFrame,
    type SectionDirection,
} from '../shared/section-frame'
import { getPaginatedColumnGeometry } from './paginated-layout'
import { PaginatedTrack } from './paginated-track'
import type { Book, Resolved } from '../reader-view.js'
import type { RendererStyles } from '../renderer'
import { getLayoutGap } from '../shared/flow-geometry'

type PreferredPosition = {
    entry: SpineEntry<SectionFrame>
    fraction: number
    range?: Range
}

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
    #spine!: ReflowableSpine
    #navigation = new NavigationTransaction(() => this.#scheduleRender())
    #vertical = false
    #rtl = false
    #writingMode: SectionDirection['writingMode'] = 'horizontal-tb'
    #position?: ReadingPosition
    #targetAnchor: NavigationAnchor = 0
    #motion?: AbortController
    #scrollBounds: [number, number, number] | null = null
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
            continuous: () => true,
            host: this,
            layout: () => this.#layoutEntries(),
            layoutFor: direction => this.#beforeRender(direction),
            layoutRevision: () => this.#layoutRevision,
            canJoinWindow: (current, candidate) =>
                sameSectionDirection(current.direction, candidate.direction),
            navigation: this.#navigation,
            onClear: () => this.#pageOrigin = 0,
            restoreViewport: offset => this.#restoreViewport(offset),
            scheduleRender: () => this.#scheduleRender(),
            trackElement: this.#track,
            track: new PaginatedTrack(() => this.size),
            viewportOffset: () => this.start,
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
        // Observe only the external viewport. Observing #container as well
        // feeds our own paginated reflow back into ResizeObserver; Edge can
        // oscillate forever near a responsive column-count boundary.
        this.#observer.observe(this)
        this.#container.addEventListener('scroll', () =>
            this.dispatchEvent(new Event('scroll')))

        this.addEventListener('relocate', (({ detail }: CustomEvent) => {
            if (detail.reason === 'selection') setSelectionTarget(this.#targetAnchor, 0)
            else if (detail.reason === 'navigation') {
                if (this.#targetAnchor === 1) setSelectionTarget(detail.range, 1)
                else if (typeof this.#targetAnchor === 'number')
                    setSelectionTarget(detail.range, -1)
                else setSelectionTarget(this.#targetAnchor, -1)
                const cueTarget = typeof this.#targetAnchor === 'number'
                    ? detail.range : this.#targetAnchor
                this.#spine.showNavigationCue(cueTarget)
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
                const range = this.#position?.range
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
                this.#invalidateViewportGeometry()
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
    #layoutEntries() {
        if (!this.#spine.entries.length) return
        const layout = this.#spine.layout()
        for (const { entry, physicalStart } of layout.placements) {
            const { style } = entry.view.element
            style.position = 'absolute'
            if (this.#vertical) {
                style.left = '0'
                style.right = 'auto'
                style.top = `${physicalStart}px`
            } else {
                style.left = this.reversed ? 'auto' : `${physicalStart}px`
                style.right = this.reversed ? `${physicalStart}px` : 'auto'
                style.top = '0'
            }
        }
        const side = this.#vertical ? 'height' : 'width'
        const otherSide = this.#vertical ? 'width' : 'height'
        this.#track.style[side] = `${this.#spine.physicalExtent}px`
        this.#track.style[otherSide] = '100%'
    }
    #beforeRender({ vertical }: SectionDirection) {
        const activeVertical = this.#top.classList.contains('vertical')
        this.#top.classList.toggle('vertical', vertical)

        const { width, height } = this.#container.getBoundingClientRect()
        this.#containerWidth = width
        this.#containerHeight = height
        const size = vertical ? height : width

        const style = getComputedStyle(this.#top)
        const spreadWidth = this.getBoundingClientRect().width
        const responsiveColumnCount = spreadWidth >= 2400 ? 3
            : spreadWidth >= 1360 ? 2 : 1
        const maxColumnCount = Math.min(
            parseInt(style.getPropertyValue('--_max-column-count-spread')),
            responsiveColumnCount,
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
        const layout = { kind: 'columns' as const,
            height: vertical ? pageSize : height,
            width: vertical ? width : pageSize,
            margin, gap,
            columnWidth, columnCount: divisor, columnStep }
        this.#top.classList.toggle('vertical', activeVertical)
        return layout
    }
    #activateEntry(entry: SpineEntry<SectionFrame>) {
        const { direction, columnCount, columnStep } = entry.view
        const changed = direction.vertical !== this.#vertical
            || direction.rtl !== this.#rtl
            || direction.writingMode !== this.#writingMode
        this.#spine.activate(entry)
        if (changed && this.#spine.entries.length > 1) this.#spine.removeOtherThanCurrent()
        this.#vertical = direction.vertical
        this.#rtl = direction.rtl
        this.#writingMode = direction.writingMode
        this.#top.classList.toggle('vertical', direction.vertical)
        this.#pageSize = Math.max(1, columnCount * columnStep)
        this.#turnSize = Math.max(1, columnStep)
        this.#edgeTurns = Math.max(1, columnCount)
        this.setAttribute('dir', this.reversed ? 'rtl' : 'ltr')
        if (changed) {
            this.#spine.track.reset()
            this.#layoutEntries()
            this.#scrollBounds = null
        }
    }
    render() {
        const view = this.#spine.currentView
        if (!view) return
        if (!this.#navigation.beginReflow()) return
        const entry = this.#entryForView()
        const anchor = entry
            ? anchorForPosition(this.#position, entry.index, entry.view.document)
            : 0
        if (this.#trackLayoutInvalid) {
            this.#spine.track.reset()
            this.#trackLayoutInvalid = false
        }
        for (const { view } of this.#spine.entries) {
            view.render(this.#beforeRender({
                vertical: this.#vertical,
                rtl: this.#rtl,
                writingMode: this.#writingMode,
            }), false)
        }
        this.#layoutEntries()
        // Position restoration must use the geometry produced by this reflow,
        // not the page pitch retained from before the viewport resize.
        if (entry) this.#activateEntry(entry)
        // Clear overflow accidentally retained on the inactive axis.
        this.#container[this.#vertical ? 'scrollLeft' : 'scrollTop'] = 0
        void this.#restoreAfterReflow(anchor, entry).catch(error => {
            if (!this.#destroyed) console.warn('Failed to restore paginated reading position.', error)
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
    get reversed() {
        return !this.#vertical && (this.#rtl || this.#bookDir === 'rtl')
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
        return this.#spine.physicalExtent
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
        const min = this.reversed ? offset - b : offset - a
        const max = this.reversed ? offset + a : offset + b
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
            const projected = velocity * (this.reversed ? -this.turnSize : this.turnSize)
            const target = Math.max(min, Math.min(max,
                this.start + (isNaN(projected) ? 0 : projected)))
            const turn = Math.round((target - this.#pageOrigin) / this.turnSize)

            const crossing = turn <= 0 || turn >= this.turns - 1
            if (!await this.#scrollToTurn(turn, crossing ? null : 'snap')) return
            if (this.turn <= 0) {
                if (!await this.#crossCacheWindow(-1, 'snap'))
                    await this.#scrollTo(this.#container[this.scrollProp], 'snap')
            } else if (this.turn >= this.turns - 1) {
                if (!await this.#crossCacheWindow(1, 'snap'))
                    await this.#scrollTo(this.#container[this.scrollProp], 'snap')
            }
        })
    }
    settle(velocityX: number, velocityY: number) {
        if ((globalThis.visualViewport?.scale ?? 1) === 1)
            void this.#snap(velocityX, velocityY).catch(error =>
                console.warn('Failed to snap reader page.', error))
    }
    // allows one to process rects as if they were LTR and horizontal
    #getRectMapper(view: SectionFrame | null = this.#spine.currentView) {
        return (rect: DOMRect) => view?.mapRect(rect) ?? rect
    }
    #entryForView(view: SectionFrame | null = this.#spine.currentView) {
        return this.#spine.entryForView(view)
    }
    #entryAtReadingEdge() {
        const firstOffset = this.#entryOffset(this.#spine.first)
        const edge = paginatedReadingEdge(this.start, firstOffset)
        return this.#spine.entries.find(entry =>
            edge >= entry.start && edge < entry.start + entry.extent)
            ?? this.#spine.entries.at(-1)
    }
    #entryOffset(entry = this.#entryForView()) {
        return this.#spine.entryOffset(entry)
    }
    #toPhysicalOffset(logicalOffset: number) {
        return this.reversed ? -logicalOffset : logicalOffset
    }
    #restoreViewport(offset: number) {
        const physicalOffset = this.#toPhysicalOffset(offset)
        this.#container[this.scrollProp] = physicalOffset
        if (this.#scrollBounds) this.#scrollBounds[0] = physicalOffset
    }
    async #scrollTo(offset: number, reason: string | null, smooth = false,
        preferred?: PreferredPosition) {
        if (this.#destroyed) return false
        const element = this.#container
        const { scrollProp, turnSize } = this
        const commit = () => {
            if (this.#destroyed) return false
            const actualOffset = element[scrollProp]
            this.#scrollBounds = [
                actualOffset,
                this.atStart ? 0 : turnSize,
                this.atEnd ? 0 : turnSize,
            ]
            if (reason === null) return true
            const location = resolvePaginatedLocation({
                current: this.#entryForView(),
                end: this.end,
                entryOffset: entry => this.#entryOffset(entry),
                findAt: value => this.#spine.findAt(value),
                start: this.start,
                viewportSize: this.size,
            })
            if (!location) return false

            const entry = preferred?.entry ?? location.entry
            const preferredRange = preferred?.range ?? (preferred
                ? preferred.entry.view.visibleRange(
                    Math.max(0, this.start - this.#entryOffset(preferred.entry)),
                    Math.min(preferred.entry.view.extent,
                        this.end - this.#entryOffset(preferred.entry)),
                )
                : undefined)
            const measured = createReadingPosition(
                location.entry.index, location.fraction, location.range)
            const position = resolveReadingPosition(measured, preferred && {
                index: preferred.entry.index,
                fraction: preferred.fraction,
                range: preferredRange,
            })
            const size = preferred
                ? Math.min(1, this.size / entry.view.extent)
                : location.size
            this.#activateEntry(entry)
            this.#position = position
            if (reason !== 'selection' && reason !== 'navigation' && reason !== 'anchor')
                this.#targetAnchor = position.range ?? position.fraction

            const detail: RelocateDetail = { ...position, reason, size }
            this.dispatchEvent(new CustomEvent('relocate', { detail }))
            this.#spine.scheduleCache()
            return true
        }

        if (element[scrollProp] === offset) return commit()
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
    async #scrollToTurn(turn: number, reason: string | null, smooth = false) {
        const logicalOffset = this.#pageOrigin + this.turnSize * turn
        return this.#scrollTo(this.#toPhysicalOffset(logicalOffset), reason, smooth)
    }
    async scrollToAnchor(anchor: number, select = false) {
        await this.#enqueueNavigation(() => this.#scrollToAnchor(
            anchor, select ? 'selection' : 'navigation'))
    }
    async #scrollToAnchor(anchor: NavigationAnchor, reason: string | null = 'anchor',
        entry = this.#entryForView()) {
        if (!entry) return false
        this.#targetAnchor = anchor
        const projection = this.#resolveAnchorProjection(anchor, entry)
        if (!projection) return false
        return this.#projectTarget(entry, projection.localOffset, reason, projection.target)
    }
    #resolveAnchorProjection(anchor: NavigationAnchor, entry: SpineEntry<SectionFrame>) {
        const rect = typeof anchor === 'number' ? undefined : getAnchorRect(uncollapseRange(anchor))
        if (rect) {
            const mapped = this.#getRectMapper(entry.view)(rect)
            return { localOffset: mapped.left, target: anchor }
        }
        if (typeof anchor === 'number') return {
            localOffset: anchor * Math.max(0, entry.view.extent - 1),
        }
    }
    async #restoreAfterReflow(anchor: NavigationAnchor,
        entry = this.#entryForView()) {
        if (!entry) return false
        this.#targetAnchor = anchor
        const projection = this.#resolveAnchorProjection(anchor, entry)
        if (!projection) return false
        return this.#projectAlignedTarget(
            entry, projection.localOffset, 'anchor', projection.target)
    }
    #targetRange(anchor: NavigationAnchor) {
        if (typeof anchor === 'number') return undefined
        if ('startContainer' in anchor) return anchor as Range
        const range = anchor.ownerDocument?.createRange()
        range?.selectNode(anchor)
        return range
    }
    async #projectTarget(entry: SpineEntry<SectionFrame>, localOffset: number,
        reason: string | null, anchor?: NavigationAnchor) {
        const target = this.#entryOffset(entry) + localOffset
        const preferred = {
            entry,
            fraction: Math.min(1, Math.max(0, localOffset / entry.view.extent)),
            range: anchor === undefined ? undefined : this.#targetRange(anchor),
        }
        if (target >= this.start && target < this.end) {
            return this.#scrollTo(this.#container[this.scrollProp], reason, false, preferred)
        }

        return this.#projectAlignedTarget(entry, localOffset, reason, anchor)
    }
    #projectAlignedTarget(entry: SpineEntry<SectionFrame>, localOffset: number,
        reason: string | null, anchor?: NavigationAnchor) {
        const preferred = {
            entry,
            fraction: Math.min(1, Math.max(0, localOffset / entry.view.extent)),
            range: anchor === undefined ? undefined : this.#targetRange(anchor),
        }

        const columnStep = Math.max(1, entry.view.columnStep)
        const column = this.#entryOffset(entry) + Math.floor(localOffset / columnStep) * columnStep
        const middle = Math.floor(entry.view.columnCount / 2) * columnStep
        const max = Math.max(0, this.viewSize - this.size)
        const offset = Math.max(0, Math.min(max, column - middle))
        this.#pageOrigin = ((offset % this.turnSize) + this.turnSize) % this.turnSize
        return this.#scrollTo(this.#toPhysicalOffset(offset), reason, false, preferred)
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
    async #goTo({ index, anchor, select = false }: Resolved,
        revision = this.#navigation.revision,
        reason: string | null = select ? 'selection' : 'navigation') {
        const hasFocus = this.#spine.currentView?.document?.hasFocus()
        const entry = await this.#spine.prepare(index)
        if (this.#destroyed || revision !== this.#navigation.revision) return false
        this.#activateEntry(entry)
        const resolvedAnchor = typeof anchor === 'function'
            ? anchor(entry.view.document) : anchor
        const landed = await this.#scrollToAnchor(resolvedAnchor ?? 0, reason, entry)
        if (landed !== false && hasFocus)
            this.#spine.currentView?.document?.defaultView?.focus()
        return landed !== false
    }
    #enqueueNavigation<T>(task: (revision: number) => T | Promise<T>,
        revision = this.#navigation.revision) {
        return this.#navigation.enqueueCurrent(current => {
            if (this.#destroyed) return
            return task(current)
        }, revision)
    }
    capturePosition() {
        // Commit the physical offset synchronously before a mode switch aborts
        // an in-flight page animation.
        void this.#scrollTo(this.#container[this.scrollProp], 'switch')
    }
    cancelNavigation() {
        this.#navigation.invalidate()
        this.#motion?.abort()
        this.#motion = undefined
        this.#scrollBounds = null
    }
    async goTo(target: Resolved | Promise<Resolved>) {
        const revision = this.#navigation.revision
        const resolved = await target
        if (this.#destroyed || revision !== this.#navigation.revision) return
        if (this.#spine.contains(resolved.index))
            return this.#enqueueNavigation(
                current => this.#goTo(resolved, current), revision)
    }
    get atStart() {
        return isAtPaginatedBookEdge(this.#navigationState(), -1)
    }
    get atEnd() {
        return isAtPaginatedBookEdge(this.#navigationState(), 1)
    }
    #adjacentIndex(dir: -1 | 1) {
        return this.#spine.adjacent(
            this.#entryForView()?.index ?? this.#position?.index ?? -1, dir)
    }
    async #crossCacheWindow(dir: -1 | 1, reason: string | null = 'page') {
        const boundary = (dir < 0 ? this.#spine.first : this.#spine.last)?.index
        if (boundary == null) return false
        const index = this.#spine.adjacent(boundary, dir)
        if (index == null) return false
        return this.#goTo({
            index,
            anchor: dir < 0 ? 1 : 0,
            select: false,
        }, this.#navigation.revision, reason)
    }
    async #turnPage(dir: -1 | 1, turns = 1) {
        if (!this.#spine.currentView) return
        return this.#enqueueNavigation(async () => {
            let remaining = Math.max(1, turns)
            while (remaining > 0) {
                const action = planPaginatedNavigation(
                    this.#navigationState(), dir, remaining)
                if (action.kind === 'book-edge') return

                const crossing = action.kind === 'turn-and-cross'
                if (!await this.#scrollToTurn(
                    action.turn, crossing ? null : 'page', true)) return
                // A background chapter may have extended the cache during the
                // animation. Cross only if the landed viewport is still at the
                // physical cache edge; otherwise that chapter is already next.
                const stillAtCacheEdge = dir < 0
                    ? this.turn <= 0 : this.turn >= this.turns - 1
                if (action.kind === 'turn-and-cross' && stillAtCacheEdge) {
                    const finalReason = action.turnsAfterCross ? null : 'page'
                    if (!await this.#crossCacheWindow(dir, finalReason)) {
                        await this.#scrollTo(
                            this.#container[this.scrollProp], 'page')
                        return
                    }
                    remaining = action.turnsAfterCross
                    continue
                }
                if (crossing)
                    await this.#scrollTo(this.#container[this.scrollProp], 'page')
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
        this.cancelNavigation()
        if (this.#renderFrame !== undefined) cancelAnimationFrame(this.#renderFrame)
        this.#observer.disconnect()
        this.#spine.destroy()
    }
}

customElements.define('epub-paginated-renderer', PaginatedRenderer)
