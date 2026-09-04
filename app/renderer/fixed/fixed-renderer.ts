import type { Book, BookSection, Content, PublicationViewport, ResolvedNavigationTarget } from '../reader-view.js'
import type { FixedLayoutRenderer } from '../renderer.js'
import type { RelocationReason } from '../shared/navigation.js'
import { loadFrameDocument } from '../shared/frame-document.js'
import { observeSettledResize } from '../shared/settled-resize.js'

type Viewport = { width: number, height: number }
type ViewportSource = PublicationViewport | Record<string, string | number>
type ZoomHandler = (options: { doc: Document | null, scale: number }) => void
type FrameSource = string | { src?: string | null, onZoom?: ZoomHandler } | null
type FrameRequest = { index: number, src?: FrameSource }
type Frame = {
    blank?: boolean
    element: HTMLDivElement
    iframe: HTMLIFrameElement
    height?: number
    width?: number
    onZoom?: ZoomHandler | null
}
type Spread = { left?: BookSection, right?: BookSection, center?: BookSection }
type SpreadSide = 'left' | 'right' | 'center'

const parseViewport = (str: string | null | undefined): Viewport | null => {
    const entries = str
        ?.split(/[,;\s]/) // NOTE: technically, only the comma is valid
        .filter(Boolean)
        .map(part => part.split('=').map(value => value.trim()))
        .filter(([name, value]) => name && value)
    return entries?.length ? toViewport(Object.fromEntries(entries)) : null
}

const toViewport = (value: ViewportSource | null | undefined): Viewport | null => {
    if (!value || typeof value !== 'object') return null
    const width = Number(value.width)
    const height = Number(value.height)
    return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
        ? { width, height }
        : null
}

const getViewport = (doc: Document, viewport: PublicationViewport | undefined): Viewport => {
    // use `viewBox` for SVG
    if (doc.documentElement.localName === 'svg') {
        const [, , width, height] = doc.documentElement
            .getAttribute('viewBox')?.split(/\s+/) ?? []
        const parsed = toViewport({ width, height })
        if (parsed) return parsed
    }

    // get `viewport` `meta` element
    const meta = parseViewport(doc.querySelector('meta[name="viewport"]')
        ?.getAttribute('content'))
    if (meta) return meta

    // fallback to book's viewport
    if (typeof viewport === 'string') {
        const parsed = parseViewport(viewport)
        if (parsed) return parsed
    }
    const fallback = toViewport(viewport)
    if (fallback) return fallback

    // if no viewport (possibly with image directly in spine), get image size
    const img = doc.querySelector('img')
    const imageViewport = img && toViewport({ width: img.naturalWidth, height: img.naturalHeight })
    if (imageViewport) return imageViewport

    // just show *something*, i guess...
    console.warn(new Error('Missing viewport properties'))
    return { width: 1000, height: 2000 }
}

export class FixedRenderer extends HTMLElement implements FixedLayoutRenderer {
    static observedAttributes = ['zoom']
    #root = this.attachShadow({ mode: 'closed' })
    #lifecycle = new AbortController()
    #stopObservingResize?: () => void
    #spreads: Spread[] = []
    #index = -1
    defaultViewport?: PublicationViewport
    spread?: string
    #portrait = false
    #left?: Frame | null
    #right?: Frame | null
    #center?: Frame | null
    #side?: SpreadSide
    #zoom: number | 'fit-width' | 'fit-page' = 'fit-page'
    #destroyed = false
    #navigation = Promise.resolve()
    book!: Book
    rtl = false
    beforeRenderDocument?: FixedLayoutRenderer['beforeRenderDocument']
    constructor() {
        super()

        const sheet = new CSSStyleSheet()
        this.#root.adoptedStyleSheets = [sheet]
        sheet.replaceSync(`:host {
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
            overflow: auto;
            scrollbar-width: none;
        }`)

        this.#stopObservingResize = observeSettledResize(
            this, () => this.#render())
    }
    get mode(): 'fixed' {
        return 'fixed'
    }
    attributeChangedCallback(name: string, _: string | null, value: string | null) {
        if (value == null) return
        switch (name) {
            case 'zoom':
                if (value === 'fit-width' || value === 'fit-page') this.#zoom = value
                else {
                    const zoom = Number(value)
                    this.#zoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 'fit-page'
                }
                this.#render()
                break
        }
    }
    async #createFrame({ index, src: srcOption }: FrameRequest, signal: AbortSignal): Promise<Frame> {
        signal.throwIfAborted()
        const srcOptionIsString = typeof srcOption === 'string'
        const src = srcOptionIsString ? srcOption : srcOption?.src
        const onZoom = srcOptionIsString ? null : srcOption?.onZoom
        const element = document.createElement('div')
        element.setAttribute('dir', 'ltr')
        const iframe = document.createElement('iframe')
        iframe.dataset.index = String(index)
        element.append(iframe)
        Object.assign(iframe.style, {
            border: '0',
            display: 'none',
            overflow: 'hidden',
        })
        iframe.setAttribute('sandbox', 'allow-same-origin')
        iframe.setAttribute('scrolling', 'no')
        iframe.setAttribute('part', 'filter')
        this.#root.append(element)
        if (!src) return { blank: true, element, iframe }
        return loadFrameDocument(iframe, src, signal, async (doc, loadSignal) => {
            await this.beforeRenderDocument?.(doc, index)
            loadSignal.throwIfAborted()
            this.dispatchEvent(new CustomEvent('load', { detail: { doc, index } }))
            const { width, height } = getViewport(doc, this.defaultViewport)
            return {
                element, iframe,
                width,
                height,
                onZoom,
            }
        })
    }
    #render(side = this.#side) {
        if (!side) return
        const left: Partial<Frame> = this.#left ?? {}
        const right: Partial<Frame> = this.#center ?? this.#right ?? {}
        const target = side === 'left' ? left : right
        const { width, height } = this.getBoundingClientRect()
        const portrait = this.spread !== 'both' && this.spread !== 'portrait'
            && height > width
        this.#portrait = portrait
        const blankWidth = left.width ?? right.width ?? 0
        const blankHeight = left.height ?? right.height ?? 0

        const scale = typeof this.#zoom === 'number'
            ? this.#zoom
            : (this.#zoom === 'fit-width'
                ? (portrait || this.#center
                    ? width / (target.width ?? blankWidth)
                    : width / ((left.width ?? blankWidth) + (right.width ?? blankWidth)))
                : (portrait || this.#center
                    ? Math.min(
                        width / (target.width ?? blankWidth),
                        height / (target.height ?? blankHeight))
                    : Math.min(
                        width / ((left.width ?? blankWidth) + (right.width ?? blankWidth)),
                        height / Math.max(
                            left.height ?? blankHeight,
                            right.height ?? blankHeight)))
            ) || 1

        const transform = (frame: Frame) => {
            const {
                element, iframe, blank, onZoom,
                width: frameWidth = blankWidth,
                height: frameHeight = blankHeight,
            } = frame
            if (onZoom) onZoom({ doc: frame.iframe.contentDocument, scale })
            const iframeScale = onZoom ? scale : 1
            Object.assign(iframe.style, {
                width: `${frameWidth * iframeScale}px`,
                height: `${frameHeight * iframeScale}px`,
                transform: onZoom ? 'none' : `scale(${scale})`,
                transformOrigin: 'top left',
                display: blank ? 'none' : 'block',
            })
            Object.assign(element.style, {
                width: `${frameWidth * scale}px`,
                height: `${frameHeight * scale}px`,
                overflow: 'hidden',
                display: 'block',
                flexShrink: '0',
                marginBlock: 'auto',
            })
            if (portrait && frame !== target) {
                element.style.display = 'none'
            }
        }
        if (this.#center) {
            transform(this.#center)
        } else {
            transform(this.#left!)
            transform(this.#right!)
        }
    }
    async #showSpread({ left, right, center, side }: {
        left?: FrameRequest
        right?: FrameRequest
        center?: FrameRequest
        side?: SpreadSide
    }) {
        const loading = new AbortController()
        const signal = AbortSignal.any([this.#lifecycle.signal, loading.signal])
        this.#unloadDocuments()
        this.#root.replaceChildren()
        this.#left = null
        this.#right = null
        this.#center = null
        try {
            if (center) {
                this.#center = await this.#createFrame(center, signal)
                this.#side = 'center'
                this.#render()
            } else {
                ;[this.#left, this.#right] = await Promise.all([
                    this.#createFrame(left!, signal), this.#createFrame(right!, signal),
                ])
                this.#side = this.#left.blank ? 'right'
                    : this.#right.blank ? 'left' : side
                this.#render()
            }
        } catch (error) {
            loading.abort(error)
            throw error
        }
    }
    #goLeft() {
        if (this.#canShow(this.#left)) {
            this.#side = 'left'
            this.#render()
            this.#reportLocation('page')
            return true
        }
    }
    #goRight() {
        if (this.#canShow(this.#right)) {
            this.#side = 'right'
            this.#render()
            this.#reportLocation('page')
            return true
        }
    }
    #canShow(frame: Frame | null | undefined) {
        return !this.#center && !frame?.blank && this.#portrait
            && frame?.element.style.display === 'none'
    }
    open(book: Book) {
        this.book = book
        const { rendition } = book
        this.spread = rendition?.spread
        this.defaultViewport = rendition?.viewport

        const rtl = book.dir === 'rtl'
        const ltr = !rtl
        this.rtl = rtl

        if (rendition?.spread === 'none')
            this.#spreads = book.sections.map(section => ({ center: section }))
        else this.#spreads = book.sections.reduce<Spread[]>((arr, section, i) => {
            const last = arr[arr.length - 1]
            const { pageSpread } = section
            const newSpread = () => {
                const spread: Spread = {}
                arr.push(spread)
                return spread
            }
            if (pageSpread === 'center') {
                const spread = last.left || last.right ? newSpread() : last
                spread.center = section
            }
            else if (pageSpread === 'left') {
                const spread = last.center || last.left || ltr && i ? newSpread() : last
                spread.left = section
            }
            else if (pageSpread === 'right') {
                const spread = last.center || last.right || rtl && i ? newSpread() : last
                spread.right = section
            }
            else if (ltr) {
                if (last.center || last.right) newSpread().left = section
                else if (last.left || !i) last.right = section
                else last.left = section
            }
            else {
                if (last.center || last.left) newSpread().right = section
                else if (last.right || !i) last.left = section
                else last.right = section
            }
            return arr
        }, [{}])
    }
    get index() {
        const spread = this.#spreads[this.#index]
        const section = spread?.center ?? (this.#side === 'left'
            ? spread.left ?? spread.right : spread.right ?? spread.left)
        return section ? this.book.sections.indexOf(section) : -1
    }
    #reportLocation(reason?: RelocationReason) {
        this.dispatchEvent(new CustomEvent('relocate', { detail:
            { reason, index: this.index, fraction: 0, size: 1 } }))
    }
    #getSpreadOf(section: BookSection): { index: number, side: SpreadSide } | undefined {
        const spreads = this.#spreads
        for (let index = 0; index < spreads.length; index++) {
            const { left, right, center } = spreads[index]
            if (left === section) return { index, side: 'left' }
            if (right === section) return { index, side: 'right' }
            if (center === section) return { index, side: 'center' }
        }
    }
    #unloadSpread(spread?: Spread, keep: Spread = {}) {
        const retained = new Set([keep.left, keep.right, keep.center])
        for (const section of [spread?.left, spread?.right, spread?.center]) {
            if (section && !retained.has(section)) section.unload()
        }
    }
    async #goToSpread(index: number, side?: SpreadSide, reason?: RelocationReason) {
        if (index < 0 || index > this.#spreads.length - 1) return
        if (index === this.#index) {
            this.#side = side ?? this.#side
            this.#render()
            this.#reportLocation(reason)
            return
        }
        const previousIndex = this.#index
        const previousSpread = this.#spreads[previousIndex]
        this.#index = index
        const spread = this.#spreads[index]
        try {
            if (spread.center) {
                const index = this.book.sections.indexOf(spread.center)
                const src = await spread.center?.load()
                await this.#showSpread({ center: { index, src } })
            } else {
                const indexL = spread.left ? this.book.sections.indexOf(spread.left) : -1
                const indexR = spread.right ? this.book.sections.indexOf(spread.right) : -1
                const srcL = await spread.left?.load()
                const srcR = await spread.right?.load()
                const left = { index: indexL, src: srcL }
                const right = { index: indexR, src: srcR }
                await this.#showSpread({ left, right, side })
            }
        } catch (error) {
            this.#unloadDocuments()
            this.#root.replaceChildren()
            this.#unloadSpread(spread, previousSpread)
            this.#index = previousIndex
            throw error
        }
        this.#unloadSpread(previousSpread, spread)
        this.#reportLocation(reason)
    }
    #enqueue(task: () => Promise<void>) {
        const result = this.#navigation.then(() => {
            if (this.#destroyed) throw new DOMException('Fixed layout destroyed', 'AbortError')
            return task()
        })
        this.#navigation = result.catch(() => undefined)
        return result
    }
    goTo(target: ResolvedNavigationTarget) {
        return this.#enqueue(() => this.#goTo(target))
    }
    async #goTo(target: ResolvedNavigationTarget) {
        const { book } = this
        const section = book.sections[target.index]
        if (!section) return
        const spread = this.#getSpreadOf(section)
        if (!spread) return
        const { index, side } = spread
        await this.#goToSpread(index, side, target.select ? 'selection' : 'navigation')
        if (target.select && typeof target.anchor === 'function') {
            const content = this.getContents().find(item => item.index === target.index)
            const doc = content?.doc
            const Range = doc?.defaultView?.Range
            const range = doc && target.anchor(doc)
            if (Range && range instanceof Range) {
                const selection = doc.defaultView?.getSelection()
                selection?.removeAllRanges()
                selection?.addRange(range)
            }
        }
    }
    next() {
        return this.#enqueue(async () => {
            const shown = this.rtl ? this.#goLeft() : this.#goRight()
            if (!shown) await this.#goToSpread(
                this.#index + 1, this.rtl ? 'right' : 'left', 'page')
        })
    }
    prev() {
        return this.#enqueue(async () => {
            const shown = this.rtl ? this.#goRight() : this.#goLeft()
            if (!shown) await this.#goToSpread(
                this.#index - 1, this.rtl ? 'left' : 'right', 'page')
        })
    }
    get atStart() {
        const canMoveWithinSpread = this.rtl
            ? this.#canShow(this.#right) : this.#canShow(this.#left)
        return this.#index <= 0 && !canMoveWithinSpread
    }
    get atEnd() {
        const canMoveWithinSpread = this.rtl
            ? this.#canShow(this.#left) : this.#canShow(this.#right)
        return this.#index >= this.#spreads.length - 1 && !canMoveWithinSpread
    }
    getContents(): Content[] {
        return Array.from(this.#root.querySelectorAll('iframe')).flatMap(frame => {
            const index = Number(frame.dataset.index)
            const doc = frame.contentDocument
            return Number.isInteger(index) && index >= 0 && doc
                ? [{ doc, index }]
                : []
        })
    }
    #unloadDocuments() {
        for (const { doc } of this.getContents()) {
            if (doc) this.dispatchEvent(new CustomEvent('unload', { detail: { doc } }))
        }
    }
    destroy() {
        if (this.#destroyed) return
        this.#destroyed = true
        this.#lifecycle.abort(new DOMException('Fixed layout destroyed', 'AbortError'))
        this.#stopObservingResize?.()
        this.#unloadDocuments()
        this.#unloadSpread(this.#spreads?.[this.#index])
        this.#root.replaceChildren()
    }
}

customElements.define('epub-fixed-renderer', FixedRenderer)
