import { Overlay } from './shared/overlay.js'
import type { OverlayDraw, OverlayDrawOptions } from './shared/overlay.js'
import { readingEdgeRange } from './shared/navigation.js'
import type { RelocateDetail } from './shared/navigation.js'
import { createRenderer, rendererModeForBook } from './renderer-factory.js'
import type { Renderer, RendererStyles } from './renderer.js'
import type { RenderMode } from './shared/flow-geometry.js'

export type { Renderer } from './renderer.js'
export type { ReadingPosition, RelocateDetail } from './shared/navigation.js'

export type TocItem = {
    label?: string
    href?: string
    subitems?: TocItem[]
}

export type LocalizedText = string | Record<string, string>
export type Contributor = string | { name?: LocalizedText, [key: string]: unknown }
export type Identifier = string | { scheme?: string, value?: string }

export type BookMetadata = {
    altIdentifier?: Identifier | Identifier[]
    title?: LocalizedText
    author?: Contributor | Contributor[]
    contributor?: unknown
    description?: unknown
    identifier?: string | string[] | Record<string, string> | Array<string | Record<string, string>>
    language?: string | string[]
    modified?: unknown
    publisher?: unknown
    published?: unknown
    subject?: unknown
    [key: string]: unknown
}

export type BookRendition = {
    layout?: string
    spread?: string
    viewport?: unknown
    [key: string]: unknown
}

export type BookSection = {
    cfi?: string
    createDocument?: () => Promise<Document>
    id?: number | string
    linear?: string
    load?: () => Promise<string | null>
    pageSpread?: string
    resolveHref?: (href: string) => string
    size?: number
    unload?: () => void
}

export type Anchor = number | ((doc: Document) => Node | Range | number | null)
export type Resolved = { anchor?: Anchor, index: number, select?: boolean }

export type Book = {
    dir?: string
    destroy?: () => void | Promise<void>
    getTOCFragment?: (doc: Document, id?: string) => Element | null
    isExternal?: (href: string) => boolean
    landmarks?: Array<{ href?: string, type: string[] }>
    loadText?: (path: string) => Promise<string | null>
    metadata?: BookMetadata
    pageList?: TocItem[]
    rendition?: BookRendition
    resolveCFI?: (cfi: string, filter?: (node: Node) => number) => Resolved
    resolveHref?: (href: string) => Resolved | null
    sections: BookSection[]
    splitTOCHref?: (href?: string) => [unknown, string?] | Promise<[unknown, string?]>
    toc?: TocItem[]
    transformTarget?: EventTarget
}

export type Content = {
    doc: Document
    index: number
    overlay?: Overlay
}

type ViewNavigation = {
    attach?(renderer: Renderer): void
    cfi?(index: number, range?: Range): string
    go(target: string, options?: { select?: boolean }): Promise<Resolved | undefined>
    label(index: number): string
    resolve(target: string): Resolved | undefined
}

export type Annotation = {
    value: string
    color?: string
    note?: string
    text?: string
    [key: string]: unknown
}

export type Decoration = {
    draw: OverlayDraw
    drawOptions?: OverlayDrawOptions
    key: string
    target: string | Anchor
}

type LoadedContent = Content & { overlay: Overlay }

type ViewEvents = {
    'create-overlay': { index: number }
    'draw-annotation': {
        annotation: Annotation
        doc: Document
        draw: <Options extends OverlayDrawOptions>(func: OverlayDraw<Options>, options?: Options) => void
        range: Range
    }
    load: { doc: Document, index: number }
    unload: { doc: Document }
    relocate: RelocateDetail
    'show-annotation': { index: number, range?: Range, value: string }
}

export class ReaderView extends HTMLElement {
    #root = this.attachShadow({ mode: 'closed' })
    #events?: AbortController
    #contents = new Map<Document, AbortController>()
    #destroyed = false
    #opened = false
    #decorations = new Map<number, Map<string, Decoration>>()
    #announcedOverlays = new WeakSet<Overlay>()
    #rendererEvents = new WeakMap<Renderer, AbortController>()
    #relocations = new WeakMap<Renderer, RelocateDetail>()
    #styles?: RendererStyles
    #switch: Promise<void> = Promise.resolve()
    book?: Book
    navigation?: ViewNavigation
    renderer!: Renderer
    enhanceRenderedDocument?: (doc: Document, index: number, signal: AbortSignal) => Promise<void> | void

    get renderMode() {
        return this.renderer?.mode ?? 'paginated'
    }
    async open(book: Book, navigation: ViewNavigation) {
        if (this.#opened) throw new Error('A renderer view can only open one book')
        this.#opened = true
        this.#events = new AbortController()
        const { signal } = this.#events
        this.book = book
        this.navigation = navigation

        this.renderer = await createRenderer(rendererModeForBook(book))
        if (this.#destroyed) throw new DOMException('View destroyed', 'AbortError')
        this.#wireRenderer(this.renderer, signal)
        await this.renderer.open(book)
        this.#root.append(this.renderer)

    }
    #wireRenderer(renderer: Renderer, signal: AbortSignal) {
        const events = new AbortController()
        this.#rendererEvents.set(renderer, events)
        const rendererSignal = AbortSignal.any([signal, events.signal])
        renderer.beforeRenderDocument = async (doc, index) => {
            const content = new AbortController()
            this.#contents.set(doc, content)
            try {
                await this.enhanceRenderedDocument?.(doc, index, content.signal)
            } catch (error) {
                content.abort()
                if (this.#contents.get(doc) === content) this.#contents.delete(doc)
                throw error
            }
        }
        renderer.setAttribute('exportparts', 'filter')
        renderer.addEventListener('load', event =>
            this.#onLoad((event as CustomEvent<{ doc: Document, index: number }>).detail),
        { signal: rendererSignal })
        renderer.addEventListener('unload', event =>
            this.#onUnload((event as CustomEvent<{ doc: Document }>).detail),
        { signal: rendererSignal })
        renderer.addEventListener('relocate', e => {
            const detail = (e as CustomEvent<RelocateDetail>).detail
            this.#relocations.set(renderer, detail)
            if (renderer === this.renderer) this.#emit('relocate', detail)
        }, { signal: rendererSignal })
        renderer.addEventListener('request-overlay', event => {
            const detail = (event as CustomEvent<{
                attach: (overlay: Overlay) => void
                doc: Document
                index: number
            }>).detail
            detail.attach(this.#createOverlay(detail, renderer))
        }, { signal: rendererSignal })
    }
    setRenderMode(mode: Exclude<RenderMode, 'fixed'>, configure?: (renderer: Renderer) => void) {
        this.#switch = this.#switch.catch(() => {}).then(() =>
            this.#replaceRenderer(mode, configure))
        return this.#switch
    }
    async #replaceRenderer(mode: Exclude<RenderMode, 'fixed'>, configure?: (renderer: Renderer) => void) {
        if (this.#destroyed) throw new DOMException('View destroyed', 'AbortError')
        const current = this.renderer
        if (!current || current.mode === 'fixed' || current.mode === mode) {
            if (current?.mode === mode) configure?.(current)
            return
        }

        current.capturePosition?.()
        const target = this.#readingTarget(current)
        current.cancelNavigation?.()
        const next = await createRenderer(mode)
        if (this.#destroyed) {
            next.destroy()
            throw new DOMException('View destroyed', 'AbortError')
        }
        this.#copyRendererAttributes(current, next)
        configure?.(next)
        if (this.#styles) next.setStyles?.(this.#styles)
        this.#wireRenderer(next, this.#events!.signal)
        const { width, height } = this.getBoundingClientRect()
        Object.assign(next.style, {
            position: 'fixed',
            left: '-100000px',
            top: '0',
            width: `${width}px`,
            height: `${height}px`,
            visibility: 'hidden',
        })
        this.#root.append(next)
        try {
            await next.open(this.book!)
            if (target) await next.goTo(target)
            if (this.#destroyed) throw new DOMException('View destroyed', 'AbortError')
        } catch (error) {
            next.destroy()
            this.#rendererEvents.get(next)?.abort()
            this.#rendererEvents.delete(next)
            next.remove()
            throw error
        }

        this.renderer = next
        this.navigation!.attach?.(next)
        for (const { index, overlay } of next.getContents()) {
            if (overlay) this.#announceOverlay(overlay, index)
        }
        for (const property of ['position', 'left', 'top', 'width', 'height', 'visibility'])
            next.style.removeProperty(property)
        current.destroy()
        this.#rendererEvents.get(current)?.abort()
        this.#rendererEvents.delete(current)
        current.remove()
        const relocation = this.#relocations.get(next)
        if (relocation) this.#emit('relocate', relocation)
    }
    #readingTarget(renderer: Renderer): Resolved | undefined {
        const location = this.#relocations.get(renderer)
        if (!location) return
        const { fraction, index, range } = location
        try {
            const readingEdge = readingEdgeRange(range)
            const cfi = readingEdge && this.navigation!.cfi?.(index, readingEdge)
            return cfi ? this.navigation!.resolve(cfi) ?? { index, anchor: fraction }
                : { index, anchor: fraction }
        } catch (error) {
            console.warn('Could not transfer the exact reading position.', error)
            return { index, anchor: fraction }
        }
    }
    #copyRendererAttributes(source: Renderer, target: Renderer) {
        for (const { name, value } of source.attributes) {
            if (name !== 'style') target.setAttribute(name, value)
        }
    }
    setStyles(styles: RendererStyles) {
        this.#styles = styles
        this.renderer?.setStyles?.(styles)
    }
    destroy() {
        if (this.#destroyed) return
        this.#destroyed = true
        this.#events?.abort()
        for (const content of this.#contents.values()) content.abort()
        this.#contents.clear()
        this.renderer?.destroy()
        this.renderer?.remove()
        this.#decorations.clear()
        this.navigation = undefined
        this.book = undefined
    }
    #emit(name: string, detail: unknown, cancelable = false) {
        return this.dispatchEvent(new CustomEvent(name, { detail, cancelable }))
    }
    #onLoad({ doc, index }: { doc: Document, index: number }) {
        this.#emit('load', { doc, index })
    }
    #onUnload(detail: { doc: Document }) {
        this.#contents.get(detail.doc)?.abort()
        this.#contents.delete(detail.doc)
        this.#emit('unload', detail)
    }
    async addAnnotation(annotation: Annotation, remove = false, target?: { index: number, range: Range }) {
        const navigation = this.navigation
        if (!navigation) return
        const { value } = annotation
        const resolved = target
            ? { index: target.index, anchor: () => target.range }
            : navigation.resolve(value)
        if (!resolved) return
        const { index, anchor } = resolved
        const obj = this.#getOverlay(index)
        if (obj) {
            const { overlay, doc } = obj
            overlay.remove(value)
            if (!remove) {
                let range = null
                try {
                    range = typeof anchor === 'function' ? anchor(doc) : null
                } catch (error) {
                    console.warn('Could not restore annotation range.', error)
                }
                const Range = doc.defaultView?.Range
                if (!Range || !(range instanceof Range)) return { index, label: navigation.label(index) }
                const draw = <Options extends OverlayDrawOptions>(func: OverlayDraw<Options>, opts?: Options) =>
                    overlay.add(value, range, func, opts)
                this.#emit('draw-annotation', { draw, annotation, doc, range })
            }
        }
        const label = navigation.label(index)
        return { index, label }
    }
    deleteAnnotation(annotation: Annotation) {
        return this.addAnnotation(annotation, true)
    }
    #getOverlay(index: number): LoadedContent | undefined {
        return this.renderer.getContents()
            .find((content): content is LoadedContent =>
                content.index === index && Boolean(content.doc && content.overlay))
    }
    #createOverlay({ doc, index }: { doc: Document, index: number }, renderer: Renderer) {
        const overlay = new Overlay()
        const signal = this.#contents.get(doc)?.signal
        doc.addEventListener('click', e => {
            const [value, range] = overlay.hitTest(e)
            if (value && !this.#decorations.get(index)?.has(value)) {
                this.#emit('show-annotation', { value, index, range })
            }
        }, { signal })

        const decorations = this.#decorations.get(index)
        if (decorations) for (const item of decorations.values())
            this.#paintDecoration(doc, overlay, item)

        queueMicrotask(() => {
            if (!signal?.aborted && renderer === this.renderer)
                this.#announceOverlay(overlay, index)
        })
        return overlay
    }
    #announceOverlay(overlay: Overlay, index: number) {
        if (this.#announcedOverlays.has(overlay)) return
        this.#announcedOverlays.add(overlay)
        this.#emit('create-overlay', { index })
    }
    addDecoration(index: number, decoration: Decoration) {
        const decorations = this.#decorations.get(index)
        if (decorations) decorations.set(decoration.key, decoration)
        else this.#decorations.set(index, new Map([[decoration.key, decoration]]))
        this.#drawDecoration(index, decoration)
    }
    removeDecoration(index: number, key: string) {
        const decorations = this.#decorations.get(index)
        decorations?.delete(key)
        if (!decorations?.size) this.#decorations.delete(index)
        this.#getOverlay(index)?.overlay.remove(key)
    }
    #drawDecoration(index: number, { key, target, draw, drawOptions }: Decoration) {
        const obj = this.#getOverlay(index)
        if (!obj) return
        this.#paintDecoration(obj.doc, obj.overlay,
            { key, target, draw, drawOptions })
    }
    #paintDecoration(doc: Document, overlay: Overlay,
        { key, target, draw, drawOptions }: Decoration) {
        const anchor = typeof target === 'string'
            ? this.navigation?.resolve(target)?.anchor
            : target
        let range = null
        try {
            range = typeof anchor === 'function' ? anchor(doc) : null
        } catch (error) {
            console.warn('Could not resolve decoration range.', error)
        }
        const Range = doc.defaultView?.Range
        if (Range && range instanceof Range)
            overlay.add(key, range, draw, drawOptions)
    }
}

export interface ReaderView {
    addEventListener<EventName extends keyof ViewEvents>(
        type: EventName,
        listener: (this: ReaderView, event: CustomEvent<ViewEvents[EventName]>) => void,
        options?: boolean | AddEventListenerOptions,
    ): void
    addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
    ): void
}

export type View = ReaderView

customElements.define('epub-view', ReaderView)
