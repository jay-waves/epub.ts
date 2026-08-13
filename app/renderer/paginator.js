import { ChapterWindow } from './chapter-window.ts'
import {
    getAnchorPage,
    getAnchorRect,
    getEntryOffset,
    getFractionTarget,
    getRectTarget,
    getScrolledTrackSize,
    isAtBookEdge,
    planViewportNavigation,
    ViewportNavigation,
} from './viewport-navigation.ts'
import {
    getReadingEdge,
    getVisibleRange,
    resolveVisibleLocation,
} from './visible-location.ts'
import { ScrolledViewport } from './scrolled-viewport.ts'

const debounce = (f, wait, immediate) => {
    let timeout
    return (...args) => {
        const later = () => {
            timeout = null
            if (!immediate) f(...args)
        }
        const callNow = immediate && !timeout
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(later, wait)
        if (callNow) f(...args)
    }
}

const lerp = (min, max, x) => x * (max - min) + min
const easeOutQuad = x => 1 - (1 - x) * (1 - x)
const animate = (a, b, duration, ease, render) => new Promise(resolve => {
    let start
    const step = now => {
        if (document.hidden) {
            render(lerp(a, b, 1))
            return resolve()
        }
        start ??= now
        const fraction = Math.min(1, (now - start) / duration)
        render(lerp(a, b, ease(fraction)))
        if (fraction < 1) requestAnimationFrame(step)
        else resolve()
    }
    if (document.hidden) {
        render(lerp(a, b, 1))
        return resolve()
    }
    requestAnimationFrame(step)
})

// collapsed range doesn't return client rects sometimes (or always?)
// try make get a non-collapsed range or element
const uncollapse = range => {
    if (!range?.collapsed) return range
    const { endOffset, endContainer } = range
    if (endContainer.nodeType === 1) {
        const node = endContainer.childNodes[endOffset]
        if (node?.nodeType === 1) return node
        return endContainer
    }
    if (endOffset + 1 < endContainer.length) range.setEnd(endContainer, endOffset + 1)
    else if (endOffset > 1) range.setStart(endContainer, endOffset - 1)
    else return endContainer.parentNode
    return range
}

const selectionIsBackward = sel => {
    const range = document.createRange()
    range.setStart(sel.anchorNode, sel.anchorOffset)
    range.setEnd(sel.focusNode, sel.focusOffset)
    return range.collapsed
}

const setSelectionTo = (target, collapse) => {
    let range
    if (target.startContainer) range = target.cloneRange()
    else if (target.nodeType) {
        range = document.createRange()
        range.selectNode(target)
    }
    if (range) {
        const sel = range.startContainer.ownerDocument.defaultView.getSelection()
        if (sel) {
            sel.removeAllRanges()
            if (collapse === -1) range.collapse(true)
            else if (collapse === 1) range.collapse()
            sel.addRange(range)
        }
    }
}

const getDirection = doc => {
    const { defaultView } = doc
    const { writingMode, direction } = defaultView.getComputedStyle(doc.body)
    const vertical = writingMode === 'vertical-rl'
        || writingMode === 'vertical-lr'
    const rtl = doc.body.dir === 'rtl'
        || direction === 'rtl'
        || doc.documentElement.dir === 'rtl'
    return { vertical, rtl }
}

const getBackground = doc => {
    const bodyStyle = doc.defaultView.getComputedStyle(doc.body)
    return bodyStyle.backgroundColor === 'rgba(0, 0, 0, 0)'
        && bodyStyle.backgroundImage === 'none'
        ? doc.defaultView.getComputedStyle(doc.documentElement).background
        : bodyStyle.background
}

const makeMarginals = (length, part) => Array.from({ length }, () => {
    const div = document.createElement('div')
    const child = document.createElement('div')
    div.append(child)
    child.setAttribute('part', part)
    return div
})

const setStylesImportant = (el, styles) => {
    const { style } = el
    for (const [k, v] of Object.entries(styles)) {
        if (style.getPropertyValue(k) !== String(v)
        || style.getPropertyPriority(k) !== 'important')
            style.setProperty(k, v, 'important')
    }
}

class View {
    #observer = new ResizeObserver(() => this.#scheduleExpand())
    #element = document.createElement('div')
    #iframe = document.createElement('iframe')
    #contentRange = document.createRange()
    #expandFrame
    #media
    #mediaLimits = new WeakMap()
    #overlay
    #vertical = false
    #rtl = false
    #column = true
    #size
    #columnCount = 1
    #columnStep = 0
    #contentColumns = 1
    #contentExtent = 1
    #compact = false
    #layout = {}
    #destroyed = false
    constructor({ container, onExpand }) {
        this.container = container
        this.onExpand = onExpand
        this.#iframe.setAttribute('part', 'filter')
        this.#element.append(this.#iframe)
        Object.assign(this.#element.style, {
            boxSizing: 'content-box',
            position: 'absolute',
            visibility: 'hidden',
            overflow: 'hidden',
            flex: '0 0 auto',
            width: '100%', height: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
        })
        Object.assign(this.#iframe.style, {
            overflow: 'hidden',
            border: '0',
            display: 'none',
            width: '100%', height: '100%',
        })
        this.#iframe.setAttribute('sandbox', 'allow-same-origin')
        this.#iframe.setAttribute('scrolling', 'no')
    }
    get element() {
        return this.#element
    }
    get document() {
        return this.#iframe.contentDocument
    }
    get columnCount() {
        return this.#columnCount
    }
    get columnStep() {
        return this.#columnStep
    }
    get contentColumns() {
        return this.#contentColumns
    }
    get extent() {
        return this.#column ? this.#contentColumns * this.#columnStep : this.#contentExtent
    }
    set compact(value) {
        if (this.#compact === value) return
        this.#compact = value
        this.expand()
    }
    async load(src, afterLoad, beforeRender) {
        if (typeof src !== 'string') throw new Error(`${src} is not string`)
        return new Promise((resolve, reject) => {
            this.#iframe.addEventListener('load', async () => {
                try {
                    const doc = this.document
                    // Content enhancement may depend on computed styles and
                    // layout measurements (for example, MathJax line breaking).
                    this.#iframe.style.display = 'block'
                    await afterLoad?.(doc)
                    if (this.#destroyed)
                        throw new DOMException('View destroyed', 'AbortError')

                    // it needs to be visible for Firefox to get computed style
                    const { vertical, rtl } = getDirection(doc)
                    const background = getBackground(doc)
                    this.#iframe.style.display = 'none'

                    this.#vertical = vertical
                    this.#rtl = rtl

                    this.#contentRange.selectNodeContents(doc.body)
                    const layout = beforeRender?.({ vertical, rtl, background })
                    this.#iframe.style.display = 'block'
                    this.render(layout)
                    this.#observer.observe(doc.body)

                    // Commit the initial layout only after document fonts have
                    // settled. Resolving earlier lets navigation publish a
                    // location that a second font-driven expand immediately
                    // invalidates.
                    await doc.fonts.ready
                    if (this.#destroyed)
                        throw new DOMException('View destroyed', 'AbortError')
                    this.expand()

                    resolve()
                } catch (error) {
                    reject(error)
                }
            }, { once: true })
            this.#iframe.src = src
        })
    }
    render(layout) {
        if (!layout) return
        this.#column = layout.flow !== 'scrolled'
        this.#layout = layout
        if (this.#column) this.columnize(layout)
        else this.scrolled(layout)
    }
    scrolled({ gap, columnWidth }) {
        const vertical = this.#vertical
        const doc = this.document
        this.#iframe.style.flex = '0 0 auto'
        this.#element.style.justifyContent = 'center'
        this.#element.style.alignItems = 'center'
        setStylesImportant(doc.documentElement, {
            'box-sizing': 'border-box',
            'padding': vertical ? `${gap}px 0` : `0 ${gap}px`,
            'column-width': 'auto',
            'height': 'auto',
            'width': 'auto',
        })
        setStylesImportant(doc.body, {
            [vertical ? 'max-height' : 'max-width']: `${columnWidth}px`,
            'margin': 'auto',
        })
        this.#setImageSize()
        this.expand()
    }
    columnize({ width, height, gap, columnWidth, columnCount, columnStep }) {
        const vertical = this.#vertical
        this.#size = vertical ? height : width
        this.#columnCount = columnCount
        this.#columnStep = columnStep

        const doc = this.document
        setStylesImportant(doc.documentElement, {
            'box-sizing': 'border-box',
            'column-width': `${Math.trunc(columnWidth)}px`,
            'column-gap': `${gap}px`,
            'column-fill': 'auto',
            ...(vertical
                ? { 'width': `${width}px` }
                : { 'height': `${height}px` }),
            'padding': vertical ? `${gap / 2}px 0` : `0 ${gap / 2}px`,
            'overflow': 'hidden',
            // force wrap long words
            'overflow-wrap': 'break-word',
            // reset some potentially problematic props
            'position': 'static', 'border': '0', 'margin': '0',
            'max-height': 'none', 'max-width': 'none',
            'min-height': 'none', 'min-width': 'none',
            // fix glyph clipping in WebKit
            '-webkit-line-box-contain': 'block glyphs replaced',
        })
        setStylesImportant(doc.body, {
            'max-height': 'none',
            'max-width': 'none',
            'margin': '0',
        })
        this.#setImageSize()
        this.expand()
    }
    #setImageSize() {
        const { width, height, margin } = this.#layout
        const vertical = this.#vertical
        const doc = this.document
        this.#media ??= Array.from(doc.body.querySelectorAll('img, svg, video'))
        for (const el of this.#media) {
            // preserve max size if they are already set
            let limits = this.#mediaLimits.get(el)
            if (!limits) {
                const { maxHeight, maxWidth } = doc.defaultView.getComputedStyle(el)
                limits = { maxHeight, maxWidth }
                this.#mediaLimits.set(el, limits)
            }
            const { maxHeight, maxWidth } = limits
            setStylesImportant(el, {
                'max-height': vertical
                    ? (maxHeight !== 'none' && maxHeight !== '0px' ? maxHeight : '100%')
                    : `${height - margin * 2}px`,
                'max-width': vertical
                    ? `${width - margin * 2}px`
                    : (maxWidth !== 'none' && maxWidth !== '0px' ? maxWidth : '100%'),
                'object-fit': 'contain',
                'page-break-inside': 'avoid',
                'break-inside': 'avoid',
                'box-sizing': 'border-box',
            })
        }
    }
    #scheduleExpand() {
        if (this.#destroyed || this.#expandFrame) return
        this.#expandFrame = requestAnimationFrame(() => {
            this.#expandFrame = null
            this.expand()
        })
    }
    expand() {
        if (this.#destroyed) return
        const { documentElement } = this.document
        if (this.#column) {
            const side = this.#vertical ? 'height' : 'width'
            const otherSide = this.#vertical ? 'width' : 'height'
            const contentRect = this.#contentRange.getBoundingClientRect()
            const rootRect = documentElement.getBoundingClientRect()
            // offset caused by column break at the start of the page
            // which seem to be supported only by WebKit and only for horizontal writing
            const contentStart = this.#vertical ? 0
                : this.#rtl ? rootRect.right - contentRect.right : contentRect.left - rootRect.left
            const contentSize = contentStart + contentRect[side]
            this.#contentColumns = Math.max(1, Math.ceil(contentSize / this.#columnStep))
            this.#contentExtent = this.#contentColumns * this.#columnStep
            const pageCount = Math.ceil(this.#contentColumns / this.#columnCount)
            const expandedSize = pageCount * this.#size
            this.#element.style.padding = '0'
            this.#iframe.style[side] = `${expandedSize}px`
            this.#iframe.style.flex = `0 0 ${expandedSize}px`
            this.#element.style[side] = this.#compact
                ? `${this.extent}px`
                : `${expandedSize + this.#size * 2}px`
            this.#element.style.justifyContent = this.#compact ? 'flex-start' : 'center'
            this.#element.style.alignItems = this.#compact ? 'flex-start' : 'center'
            this.#iframe.style[otherSide] = '100%'
            this.#element.style[otherSide] = '100%'
            documentElement.style[side] = `${this.#size}px`
            if (this.#overlay) {
                this.#overlay.element.style.margin = '0'
                this.#overlay.element.style.left = this.#compact || this.#vertical
                    ? '0' : `${this.#size}px`
                this.#overlay.element.style.top = this.#compact || !this.#vertical
                    ? '0' : `${this.#size}px`
                this.#overlay.element.style[side] = `${expandedSize}px`
                this.#overlay.redraw()
            }
        } else {
            const side = this.#vertical ? 'width' : 'height'
            const otherSide = this.#vertical ? 'height' : 'width'
            const contentSize = documentElement.getBoundingClientRect()[side]
            const expandedSize = contentSize
            const { margin } = this.#layout
            this.#contentExtent = expandedSize + margin * 2
            const padding = this.#vertical ? `0 ${margin}px` : `${margin}px 0`
            this.#element.style.padding = padding
            this.#iframe.style[side] = `${expandedSize}px`
            this.#element.style[side] = `${expandedSize}px`
            this.#iframe.style[otherSide] = '100%'
            this.#element.style[otherSide] = '100%'
            if (this.#overlay) {
                this.#overlay.element.style.margin = padding
                this.#overlay.element.style.left = '0'
                this.#overlay.element.style.top = '0'
                this.#overlay.element.style[side] = `${expandedSize}px`
                this.#overlay.redraw()
            }
        }
        this.onExpand()
    }
    set overlay(overlay) {
        this.#overlay = overlay
        this.#element.append(overlay.element)
    }
    get overlay() {
        return this.#overlay
    }
    mapRect(rect) {
        if (!this.#column) {
            const size = this.element.getBoundingClientRect()[this.#vertical ? 'width' : 'height']
            const margin = this.#layout.margin
            return this.#vertical
                ? ({ left, right }) => ({ left: size - right - margin, right: size - left - margin })(rect)
                : ({ top, bottom }) => ({ left: top + margin, right: bottom + margin })(rect)
        }
        const pxSize = Math.ceil(this.#contentColumns / this.#columnCount) * this.#size
        return this.#rtl
            ? ({ left, right }) => ({ left: pxSize - right, right: pxSize - left })(rect)
            : this.#vertical
                ? ({ top, bottom }) => ({ left: top, right: bottom })(rect)
                : rect
    }
    visibleRange(start, end) {
        return getVisibleRange(this.document, start, end, rect => this.mapRect(rect))
    }
    destroy() {
        if (this.#destroyed) return
        this.#destroyed = true
        cancelAnimationFrame(this.#expandFrame)
        this.#observer.disconnect()
        this.#media = null
        this.#overlay = null
    }
}

// NOTE: everything here assumes the so-called "negative scroll type" for RTL
export class Paginator extends HTMLElement {
    static observedAttributes = [
        'flow', 'gap', 'margin',
        'max-inline-size', 'max-block-size', 'max-column-count',
    ]
    #root = this.attachShadow({ mode: 'closed' })
    #observer = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect
        this.#containerWidth = width
        this.#containerHeight = height
        this.#scheduleRender()
    })
    #top
    #background
    #container
    #track
    #header
    #footer
    #view
    #flow = new ChapterWindow({
        create: index => this.#createChapter(index),
        destroy: (index, view) => {
            this.#destroyView(view)
            this.sections[index]?.unload?.()
        },
        onAdd: entry => this.#addChapter(entry),
    })
    #vertical = false
    #rtl = false
    #margin = 0
    #index = -1
    #anchor = 0 // anchor view to a fraction (0-1), Range, or Element
    #justAnchored = false
    #navigation = new ViewportNavigation()
    #styles
    #styleMap = new WeakMap()
    #mediaQuery = matchMedia('(prefers-color-scheme: dark)')
    #mediaQueryListener
    #scrollBounds
    #lastVisibleRange
    #renderFrame
    #scrolledViewport
    #loadingChapters = false
    #cacheFrame
    #leadingRemainder = 0
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
            --_max-block-size: 1440px;
            --_max-column-count: 2;
            --_max-column-count-portrait: 1;
            --_max-column-count-spread: var(--_max-column-count);
            --_half-gap: calc(var(--_gap) / 2);
            --_max-width: calc(var(--_max-inline-size) * var(--_max-column-count-spread));
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
            -ms-overflow-style: none;
            overflow-anchor: none;
        }
        #container::-webkit-scrollbar {
            width: 0;
            height: 0;
            display: none;
        }
        #track {
            position: relative;
            width: 100%;
            height: 100%;
        }
        :host([flow="scrolled"]) #container {
            grid-column: 1 / -1;
            grid-row: 1 / -1;
            overflow: auto;
        }
        #header {
            grid-column: 3 / 4;
            grid-row: 1;
        }
        #footer {
            grid-column: 3 / 4;
            grid-row: 3;
            align-self: end;
        }
        #header, #footer {
            display: grid;
            height: var(--_margin);
        }
        :is(#header, #footer) > * {
            display: flex;
            align-items: center;
            min-width: 0;
        }
        :is(#header, #footer) > * > * {
            width: 100%;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            text-align: center;
            font-size: .75em;
            opacity: .6;
        }
        </style>
        <div id="top">
            <div id="background" part="filter"></div>
            <div id="header"></div>
            <div id="container"><div id="track"></div></div>
            <div id="footer"></div>
        </div>
        `

        this.#top = this.#root.getElementById('top')
        this.#background = this.#root.getElementById('background')
        this.#container = this.#root.getElementById('container')
        this.#track = this.#root.getElementById('track')
        this.#header = this.#root.getElementById('header')
        this.#footer = this.#root.getElementById('footer')
        this.#scrolledViewport = new ScrolledViewport(this.#container, () => {
            if (this.scrolled && !this.#destroyed) this.#afterScroll('scroll')
        })

        this.#observer.observe(this.#container)
        this.#container.addEventListener('scroll', () => {
            this.dispatchEvent(new Event('scroll'))
            if (!this.scrolled) return
            if (this.#justAnchored) this.#justAnchored = false
            else this.#scrolledViewport.schedule()
        })

        this.addEventListener('relocate', ({ detail }) => {
            if (detail.reason === 'selection') setSelectionTo(this.#anchor, 0)
            else if (detail.reason === 'navigation') {
                if (this.#anchor === 1) setSelectionTo(detail.range, 1)
                else if (typeof this.#anchor === 'number')
                    setSelectionTo(detail.range, -1)
                else setSelectionTo(this.#anchor, -1)
            }
        })
        const checkPointerSelection = debounce((range, sel) => {
            if (!sel.rangeCount) return
            const selRange = sel.getRangeAt(0)
            const backward = selectionIsBackward(sel)
            if (backward && selRange.compareBoundaryPoints(Range.START_TO_START, range) < 0)
                this.prev()
            else if (!backward && selRange.compareBoundaryPoints(Range.END_TO_END, range) > 0)
                this.next()
        }, 700)
        this.addEventListener('load', ({ detail: { doc } }) => {
            let isPointerSelecting = false
            doc.addEventListener('pointerdown', () => isPointerSelecting = true)
            doc.addEventListener('pointerup', () => isPointerSelecting = false)
            let isKeyboardSelecting = false
            doc.addEventListener('keydown', () => isKeyboardSelecting = true)
            doc.addEventListener('keyup', () => isKeyboardSelecting = false)
            doc.addEventListener('selectionchange', () => {
                if (this.scrolled) return
                const range = this.#lastVisibleRange
                if (!range) return
                const sel = doc.getSelection()
                if (!sel.rangeCount) return
                if (isPointerSelecting && sel.type === 'Range')
                    checkPointerSelection(range, sel)
                else if (isKeyboardSelecting) {
                    const selRange = sel.getRangeAt(0).cloneRange()
                    const backward = selectionIsBackward(sel)
                    if (!backward) selRange.collapse()
                    this.#scrollToAnchor(selRange)
                }
            })
            doc.addEventListener('focusin', e => this.scrolled ? null :
                // NOTE: `requestAnimationFrame` is needed in WebKit
                requestAnimationFrame(() => this.#scrollToAnchor(e.target)))
        })

        this.#mediaQueryListener = () => {
            if (!this.#view) return
            this.#background.style.background = getBackground(this.#view.document)
        }
        this.#mediaQuery.addEventListener('change', this.#mediaQueryListener)
    }
    attributeChangedCallback(name, _, value) {
        switch (name) {
            case 'flow':
                if (value !== 'scrolled') this.#scrolledViewport?.cancel()
                this.#scheduleRender()
                break
            case 'gap':
            case 'margin':
            case 'max-block-size':
            case 'max-column-count':
                this.#top.style.setProperty('--_' + name, value)
                break
            case 'max-inline-size':
                // needs explicit `render()` as it doesn't necessarily resize
                this.#top.style.setProperty('--_' + name, value)
                this.#scheduleRender()
                break
        }
    }
    open(book) {
        this.bookDir = book.dir
        this.sections = book.sections
        book.transformTarget?.addEventListener('data', ({ detail }) => {
            if (detail.type !== 'text/css') return
            const w = innerWidth
            const h = innerHeight
            detail.data = Promise.resolve(detail.data).then(data => data
                // unprefix as most of the props are (only) supported unprefixed
                .replace(/(?<=[{\s;])-epub-/gi, '')
                // replace vw and vh as they cause problems with layout
                .replace(/(\d*\.?\d+)vw/gi, (_, d) => parseFloat(d) * w / 100 + 'px')
                .replace(/(\d*\.?\d+)vh/gi, (_, d) => parseFloat(d) * h / 100 + 'px')
                // `page-break-*` unsupported in columns; replace with `column-break-*`
                .replace(/page-break-(after|before|inside)\s*:/gi, (_, x) =>
                    `-webkit-column-break-${x}:`)
                .replace(/break-(after|before|inside)\s*:\s*(avoid-)?page/gi, (_, x, y) =>
                    `break-${x}: ${y ?? ''}column`))
        })
    }
    #createView() {
        const view = new View({
            container: this,
            onExpand: () => {
                if (this.#flow.entries.some(entry => entry.view === view)) {
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
    #destroyView(view = this.#view) {
        if (!view) return
        const doc = view.document
        if (doc) this.dispatchEvent(new CustomEvent('unload', { detail: { doc } }))
        view.destroy()
        view.element.remove()
        if (this.#view === view) this.#view = null
    }
    #clearEntries() {
        cancelAnimationFrame(this.#cacheFrame)
        this.#cacheFrame = null
        this.#flow.clear()
        this.#leadingRemainder = 0
    }
    async #createChapter(index) {
        const section = this.sections[index]
        const view = this.#createView()
        const afterLoad = async doc => {
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
            const src = await section.load()
            await view.load(src, afterLoad, this.#beforeRender.bind(this))
        } catch (error) {
            this.#destroyView(view)
            section.unload?.()
            throw error
        }
        return view
    }
    #addChapter(entry) {
        const { index, view } = entry
        // #view can briefly lag behind the physical scroll position while an
        // adjacent chapter finishes loading.
        // `entry` has been inserted but is not laid out yet (start/extent are
        // both zero). Exclude it when snapshotting the chapter that currently
        // owns the viewport, otherwise the tail fallback can compensate from
        // the new chapter and move the viewport by an entire cache window.
        const activeEntry = this.#entryAtReadingEdge(entry)
        const oldOffset = activeEntry ? this.#entryOffset(activeEntry) : 0
        view.compact = this.continuous && !this.scrolled
        if (this.continuous) {
            this.#layoutEntries()
            if (activeEntry) {
                const shift = this.#entryOffset(activeEntry) - oldOffset
                this.#container[this.scrollProp] += shift
                if (this.#scrollBounds) this.#scrollBounds[0] += shift
            }
        } else view.element.style.position = 'relative'
        view.element.style.removeProperty('visibility')
        this.dispatchEvent(new CustomEvent('load', { detail: { doc: view.document, index } }))
        this.dispatchEvent(new CustomEvent('request-overlay', {
            detail: {
                doc: view.document, index,
                attach: overlay => view.overlay = overlay,
            },
        }))
    }
    #layoutEntries() {
        if (!this.#flow.entries.length || !this.continuous) return
        if (this.scrolled) {
            const extent = this.#flow.layout(view => view.extent)
            this.#track.style.removeProperty('display')
            this.#track.style.removeProperty('flex-direction')
            for (const entry of this.#flow.entries) {
                entry.view.compact = false
                const { style } = entry.view.element
                style.position = 'absolute'
                style.left = '0'
                style.top = `${entry.start}px`
                style.width = '100%'
                style.removeProperty('order')
            }
            this.#track.style.width = '100%'
            // Keep logical anchor coordinates reachable independently of how
            // many following chapters happen to be cached. The extra viewport
            // is a virtual alignment reserve, not part of any chapter.
            this.#track.style.height = `${getScrolledTrackSize(extent, this.size)}px`
            return
        }
        const { columnCount, columnStep } = this.#flow.entries[0].view
        if (!columnStep) return
        this.#track.style.removeProperty('display')
        this.#track.style.removeProperty('flex-direction')
        const size = columnCount * columnStep
        const leading = size + this.#leadingRemainder
        let columnStart = 0
        for (const entry of this.#flow.entries) {
            entry.start = columnStart * columnStep
            entry.extent = entry.view.extent
            entry.view.compact = true
            const { style } = entry.view.element
            style.removeProperty('order')
            style.position = 'absolute'
            style.left = this.#vertical ? '0' : `${leading + columnStart * columnStep}px`
            style.top = this.#vertical ? `${leading + columnStart * columnStep}px` : '0'
            columnStart += entry.view.contentColumns
        }
        const pages = Math.ceil((leading + columnStart * columnStep) / size) + 1
        const side = this.#vertical ? 'height' : 'width'
        const otherSide = this.#vertical ? 'width' : 'height'
        this.#track.style[side] = `${pages * size}px`
        this.#track.style[otherSide] = '100%'
    }
    async #fillPaginatedSpread() {
        if (this.#loadingChapters || !this.continuous || this.scrolled
            || !this.#flow.entries.length) return
        this.#loadingChapters = true
        try {
            const firstView = this.#flow.entries[0].view
            const { columnCount } = firstView
            const active = this.#entryForView() ?? this.#flow.last
            const nextIndex = this.#adjacentIndexFrom(active.index, 1)
            const hasNext = nextIndex == null || Boolean(this.#flow.find(nextIndex))
            if (columnCount > 1 && !hasNext && active.view.contentColumns % columnCount) {
                const section = this.sections[nextIndex]
                if (!this.sections[active.index]?.pageSpread && !section?.pageSpread)
                    await this.#flow.load(nextIndex)
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
        const activeEntry = this.#entryForView()
        if (!activeEntry) return
        this.#loadingChapters = true
        try {
            for (const dir of [-1, 1]) {
                const index = this.#adjacentIndexFrom(activeEntry.index, dir)
                if (index != null && !this.#flow.find(index)) await this.#flow.load(index)
            }
        } finally {
            this.#loadingChapters = false
        }
    }
    #scheduleAdjacentCache() {
        if (!this.continuous || this.#cacheFrame) return
        this.#cacheFrame = requestAnimationFrame(() => {
            this.#cacheFrame = requestAnimationFrame(() => {
                this.#cacheFrame = null
                void this.#cacheAdjacentSections().catch(error => {
                    if (error?.name !== 'AbortError')
                        console.warn('Failed to cache adjacent reader sections.', error)
                })
            })
        })
    }
    #beforeRender({ vertical, rtl, background }) {
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
        const maxColumnCount = parseInt(style.getPropertyValue('--_max-column-count-spread'))
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
        const gap = -g / (g - 1) * size

        const flow = this.getAttribute('flow')
        if (flow === 'scrolled') {
            // FIXME: vertical-rl only, not -lr
            this.setAttribute('dir', vertical ? 'rtl' : 'ltr')
            this.#top.style.padding = '0'
            const columnWidth = maxInlineSize

            this.heads = null
            this.feet = null
            this.#header.replaceChildren()
            this.#footer.replaceChildren()

            return { flow, margin, gap, columnWidth }
        }

        const divisor = Math.min(maxColumnCount, Math.ceil(size / maxInlineSize))
        const columnStep = size / divisor
        const columnWidth = columnStep - gap
        this.setAttribute('dir', rtl ? 'rtl' : 'ltr')

        const marginalDivisor = vertical
            ? Math.min(2, Math.ceil(width / maxInlineSize))
            : divisor
        const marginalStyle = {
            gridTemplateColumns: `repeat(${marginalDivisor}, 1fr)`,
            gap: `${gap}px`,
            direction: this.bookDir === 'rtl' ? 'rtl' : 'ltr',
        }
        Object.assign(this.#header.style, marginalStyle)
        Object.assign(this.#footer.style, marginalStyle)
        const heads = makeMarginals(marginalDivisor, 'head')
        const feet = makeMarginals(marginalDivisor, 'foot')
        this.heads = heads.map(el => el.children[0])
        this.feet = feet.map(el => el.children[0])
        this.#header.replaceChildren(...heads)
        this.#footer.replaceChildren(...feet)

        return { height, width, margin, gap, columnWidth, columnCount: divisor, columnStep }
    }
    render() {
        if (!this.#view) return
        if (!this.#navigation.beginReflow()) return
        if (!this.continuous && this.#flow.entries.length > 1)
            this.#flow.removeWhere(entry => entry.view !== this.#view)
        for (const { view } of this.#flow.entries) {
            view.compact = this.continuous && !this.scrolled
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
            style.removeProperty('order')
            this.#track.style.removeProperty('display')
            this.#track.style.removeProperty('flex-direction')
            this.#track.style.width = '100%'
            this.#track.style.height = '100%'
        } else {
            this.#layoutEntries()
            if (!this.scrolled) void this.#fillPaginatedSpread().catch(error =>
                console.warn('Failed to fill paginated reader spread.', error))
        }
        // Scrolled and paginated layouts use different scroll axes. Browsers
        // preserve the inactive axis when overflow changes, which can leave the
        // newly laid-out view completely outside the viewport.
        const inactiveScrollProp = this.#vertical
            ? (this.scrolled ? 'scrollTop' : 'scrollLeft')
            : (this.scrolled ? 'scrollLeft' : 'scrollTop')
        this.#container[inactiveScrollProp] = 0
        this.#scrollToAnchor(this.#anchor)
    }
    #scheduleRender() {
        if (this.#destroyed || this.#renderFrame) return
        if (this.#navigation.deferReflow()) return
        this.#renderFrame = requestAnimationFrame(() => {
            this.#renderFrame = null
            this.render()
        })
    }
    get scrolled() {
        return this.getAttribute('flow') === 'scrolled'
    }
    get continuous() {
        return !this.#vertical && !this.#rtl && this.bookDir !== 'rtl'
    }
    get scrollProp() {
        const { scrolled } = this
        return this.#vertical ? (scrolled ? 'scrollLeft' : 'scrollTop')
            : scrolled ? 'scrollTop' : 'scrollLeft'
    }
    get sideProp() {
        const { scrolled } = this
        return this.#vertical ? (scrolled ? 'width' : 'height')
            : scrolled ? 'height' : 'width'
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
        if (this.continuous && this.scrolled) return this.#flow.extent
        return (this.continuous ? this.#track : this.#view.element)
            .getBoundingClientRect()[this.sideProp]
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
    scrollBy(dx, dy) {
        const delta = this.#vertical ? dy : dx
        const element = this.#container
        const { scrollProp } = this
        if (this.scrolled) {
            element[scrollProp] += delta
            return
        }
        const [offset, a, b] = this.#scrollBounds
        const rtl = this.#rtl
        const min = rtl ? offset - b : offset - a
        const max = rtl ? offset + a : offset + b
        element[scrollProp] = Math.max(min, Math.min(max,
            element[scrollProp] + delta))
    }
    async #snap(vx, vy) {
        return this.#runNavigation(async () => {
            const velocity = this.#vertical ? vy : vx
            const [offset, backward, forward] = this.#scrollBounds
            const min = Math.abs(offset) - backward
            const max = Math.abs(offset) + forward
            const projected = velocity * (this.#rtl ? -this.size : this.size)
            const page = Math.floor(Math.max(min, Math.min(max,
                (this.start + this.end) / 2 + (isNaN(projected) ? 0 : projected))) / this.size)

            await this.#scrollToPage(page, 'snap')
            if (page <= 0) return this.#crossCacheWindow(-1)
            if (page >= this.pages - 1) return this.#crossCacheWindow(1)
        })
    }
    settle(velocityX, velocityY) {
        if (!this.scrolled && globalThis.visualViewport.scale === 1)
            void this.#snap(velocityX, velocityY).catch(error =>
                console.warn('Failed to snap reader page.', error))
    }
    // allows one to process rects as if they were LTR and horizontal
    #getRectMapper(view = this.#view) {
        return rect => view.mapRect(rect)
    }
    #entryForView(view = this.#view) {
        return this.#flow.entries.find(entry => entry.view === view)
    }
    #entryAtReadingEdge(ignore) {
        if (!this.continuous) return this.#entryForView()
        const firstOffset = this.#entryOffset(this.#flow.first)
        const edge = getReadingEdge({
            contentOffset: this.scrolled ? 0 : firstOffset,
            margin: this.#margin,
            scrolled: this.scrolled,
            start: this.start,
        })
        const entries = ignore
            ? this.#flow.entries.filter(entry => entry !== ignore)
            : this.#flow.entries
        return entries.find(entry =>
            edge >= entry.start && edge < entry.start + entry.extent)
            ?? entries.at(-1)
    }
    #anchorBelongsTo(view) {
        if (typeof this.#anchor === 'number') return true
        const node = this.#anchor?.startContainer ?? this.#anchor
        return (node?.ownerDocument ?? node) === view.document
    }
    #entryOffset(entry = this.#entryForView()) {
        return getEntryOffset({
            continuous: this.continuous,
            leadingRemainder: this.#leadingRemainder,
            scrolled: this.scrolled,
            start: entry?.start,
            viewportSize: this.size,
        })
    }
    #trimChapterCache(activeEntry) {
        const entries = this.#flow.entries
        const activePosition = entries.indexOf(activeEntry)
        if (activePosition < 0) return
        const stale = new Set(entries.filter((_, index) => Math.abs(index - activePosition) > 1))
        if (!stale.size) return
        const oldOffset = this.#entryOffset(activeEntry)
        const removed = this.#flow.removeWhere(entry => stale.has(entry))
        const removedBefore = removed
            .filter(entry => entry.index < activeEntry.index)
            .reduce((sum, entry) => sum + entry.extent, 0)
        if (!this.scrolled && this.size > 0)
            this.#leadingRemainder = (this.#leadingRemainder + removedBefore) % this.size

        this.#layoutEntries()
        const shift = this.#entryOffset(activeEntry) - oldOffset
        this.#container[this.scrollProp] += shift
        if (this.#scrollBounds) this.#scrollBounds[0] += shift
    }
    async #scrollToRect(rect, reason, entry = this.#entryForView()) {
        if (this.scrolled) {
            const offset = getRectTarget(this.#entryOffset(entry),
                this.#getRectMapper(entry.view)(rect).left, this.#margin)
            return this.#scrollTo(offset, reason)
        }
        const offset = this.#getRectMapper(entry.view)(rect).left
        return this.#scrollToPage(this.continuous
            ? getAnchorPage(this.#entryOffset(entry), offset, this.size)
            : Math.floor(offset / this.size) + (this.#rtl ? -1 : 1), reason)
    }
    async #scrollTo(offset, reason, smooth) {
        const element = this.#container
        const { scrollProp, size } = this
        if (element[scrollProp] === offset) {
            this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size]
            this.#afterScroll(reason)
            this.#justAnchored = false
            return
        }
        // FIXME: vertical-rl only, not -lr
        if (this.scrolled && this.#vertical) offset = -offset
        if ((reason === 'snap' || smooth) && this.hasAttribute('animated')) return animate(
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
    async #scrollToPage(page, reason, smooth) {
        const offset = this.size * (this.#rtl ? -page : page)
        return this.#scrollTo(offset, reason, smooth)
    }
    async scrollToAnchor(anchor, select) {
        return this.#runNavigation(() => this.#scrollToAnchor(
            anchor, select ? 'selection' : 'navigation'))
    }
    async #scrollToAnchor(anchor, reason = 'anchor', entry = this.#entryForView()) {
        if (!entry) return
        if (this.scrolled) this.#scrolledViewport.cancel()
        this.#anchor = anchor
        const rect = getAnchorRect(uncollapse(anchor))
        // if anchor is an element or a range
        if (rect) {
            if (this.scrolled && !this.#vertical) {
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
        // if anchor is a fraction
        if (this.scrolled) {
            await this.#scrollTo(getFractionTarget(
                this.#entryOffset(entry), entry.view.extent, anchor), reason)
            return
        }
        if (this.continuous) {
            const offset = this.#entryOffset(entry) + anchor * Math.max(0, entry.view.extent - 1)
            await this.#scrollToPage(Math.floor(offset / this.size), reason)
            return
        }
        const textPages = this.pages - 2
        const newPage = Math.round(anchor * (textPages - 1))
        await this.#scrollToPage(newPage + 1, reason)
    }
    #afterScroll(reason) {
        const location = resolveVisibleLocation({
            continuous: this.continuous,
            current: this.#entryForView(),
            end: this.end,
            entryOffset: entry => this.#entryOffset(entry),
            findAt: offset => this.#flow.findAt(offset),
            margin: this.#margin,
            page: this.page,
            pages: this.pages,
            rtl: this.#rtl,
            scrolled: this.scrolled,
            scrolledRange: entry => this.#scrolledViewport.readingRange(
                entry.view.document, this.#margin),
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
            this.#anchor = range
        else this.#justAnchored = true

        const detail = { reason, range, index: entry.index }
        if (fraction !== undefined) {
            detail.fraction = fraction
            detail.size = size
        }
        if (!this.scrolled && this.pages > 0) {
            this.#header.style.visibility = this.page > 1 ? 'visible' : 'hidden'
        }
        this.dispatchEvent(new CustomEvent('relocate', { detail }))
        if (this.continuous) this.#trimChapterCache(entry)
        // Exact positioning must settle without starting another layout race.
        // User-driven scrolling and page turns will populate the next window.
        if (reason !== 'selection' && reason !== 'navigation' && reason !== 'anchor')
            this.#scheduleAdjacentCache()
    }
    #canGoToIndex(index) {
        return index >= 0 && index <= this.sections.length - 1
    }
    #navigationState() {
        return {
            atBookEnd: this.#adjacentIndex(1) == null,
            atBookStart: this.#adjacentIndex(-1) == null,
            end: this.end,
            extent: this.viewSize,
            mode: this.scrolled ? 'scrolled' : 'paginated',
            page: this.page,
            pages: this.pages,
            size: this.size,
            start: this.start,
        }
    }
    async #activateEntry(index) {
        let entry = this.#flow.find(index)
        if (!entry) {
            const adjacentToWindow = this.continuous && this.#flow.entries.some(candidate =>
                this.#adjacentIndexFrom(candidate.index, -1) === index
                || this.#adjacentIndexFrom(candidate.index, 1) === index)
            if (!adjacentToWindow) this.#clearEntries()
            entry = await this.#flow.load(index)
        }
        this.#view = entry.view
        this.#index = index

        if (this.continuous && !this.scrolled) await this.#fillPaginatedSpread()
        return entry
    }
    async #goTo({ index, anchor, select}) {
        const hasFocus = this.#view?.document?.hasFocus()
        const entry = await this.#activateEntry(index)
        const resolvedAnchor = typeof anchor === 'function'
            ? anchor(entry.view.document) : anchor
        await this.#scrollToAnchor(resolvedAnchor ?? 0,
            select ? 'selection' : 'navigation', entry)
        if (hasFocus) this.#focusView()
    }
    async #runNavigation(task) {
        return this.#navigation.run(task, () => this.#scheduleRender())
    }
    async goTo(target) {
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
    #adjacentIndex(dir) {
        return this.#adjacentIndexFrom(this.#index, dir)
    }
    #adjacentIndexFrom(from, dir) {
        for (let index = from + dir; this.#canGoToIndex(index); index += dir)
            if (this.sections[index]?.linear !== 'no') return index
    }
    #crossCacheWindow(dir) {
        const boundary = this.continuous
            ? (dir < 0 ? this.#flow.first : this.#flow.last)?.index
            : this.#index
        const index = this.#adjacentIndexFrom(boundary, dir)
        if (index == null) return
        return this.#goTo({
            index,
            anchor: dir < 0 ? () => 1 : () => 0,
        })
    }
    async #turnPage(dir, distance) {
        if (!this.#view) return
        return this.#runNavigation(async () => {
            const action = planViewportNavigation(this.#navigationState(), dir, distance)
            if (action.kind === 'scroll') {
                await this.#scrollTo(action.offset, null, true)
            } else if (action.kind === 'page') {
                await this.#scrollToPage(action.page, 'page', true)
                if (action.crossWindowAfter) {
                    await this.#crossCacheWindow(dir)
                }
            } else if (action.kind === 'cross-window') {
                await this.#crossCacheWindow(dir)
            }
        })
    }
    prev(distance) {
        return this.#turnPage(-1, distance)
    }
    next(distance) {
        return this.#turnPage(1, distance)
    }
    getContents() {
        return this.#flow.entries.map(({ index, view }) => ({
            index,
            overlay: view.overlay,
            doc: view.document,
        }))
    }
    #applyStyles(doc, styles) {
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
    setStyles(styles) {
        this.#styles = styles
        const docs = this.#flow.entries
            .map(({ view }) => view.document)
            .filter(doc => doc && this.#applyStyles(doc, styles))
        if (!docs.length) return

        // NOTE: needs `requestAnimationFrame` in Chromium
        requestAnimationFrame(() => {
            const doc = this.#view?.document
            if (doc) this.#background.style.background = getBackground(doc)
        })

        // needed because the resize observer doesn't work in Firefox
        Promise.all(docs.map(doc => doc.fonts?.ready)).then(() => this.#scheduleRender())
    }
    #focusView() {
        this.#view.document.defaultView.focus()
    }
    destroy() {
        if (this.#destroyed) return
        this.#destroyed = true
        cancelAnimationFrame(this.#renderFrame)
        this.#scrolledViewport.destroy()
        this.#observer.disconnect()
        this.#clearEntries()
        this.#mediaQuery.removeEventListener('change', this.#mediaQueryListener)
    }
}

customElements.define('epub-paginator', Paginator)
