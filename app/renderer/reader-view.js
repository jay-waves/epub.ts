import { Overlay } from './shared/overlay.ts'
import { createRenderer, rendererModeForBook } from './renderer-factory.ts'

export class ReaderView extends HTMLElement {
    #root = this.attachShadow({ mode: 'closed' })
    #events
    #contents = new Map()
    #destroyed = false
    #opened = false
    #decorations = new Map()
    #rendererEvents = new WeakMap()
    #relocations = new WeakMap()
    #styles
    #switch = Promise.resolve()
    get renderMode() {
        return this.renderer?.mode ?? 'paginated'
    }
    async open(book, navigation) {
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
        this.#root.append(this.renderer.element)

    }
    #wireRenderer(renderer, signal) {
        const events = new AbortController()
        this.#rendererEvents.set(renderer, events)
        signal.addEventListener('abort', () => events.abort(), { once: true })
        const rendererSignal = events.signal
        renderer.beforeRenderDocument = (doc, index) => {
            const content = new AbortController()
            this.#contents.set(doc, content)
            return this.enhanceRenderedDocument?.(doc, index, content.signal)
        }
        renderer.element.setAttribute('exportparts', 'filter')
        renderer.element.addEventListener('load', e => this.#onLoad(e.detail), { signal: rendererSignal })
        renderer.element.addEventListener('unload', e => this.#onUnload(e.detail), { signal: rendererSignal })
        renderer.element.addEventListener('relocate', e => {
            this.#relocations.set(renderer, e.detail)
            if (renderer === this.renderer) this.#emit('relocate', e.detail)
        }, { signal: rendererSignal })
        renderer.element.addEventListener('request-overlay', e =>
            e.detail.attach(this.#createOverlay(e.detail)), { signal: rendererSignal })
    }
    setRenderMode(mode, configure) {
        this.#switch = this.#switch.catch(() => {}).then(() =>
            this.#replaceRenderer(mode, configure))
        return this.#switch
    }
    async #replaceRenderer(mode, configure) {
        if (this.#destroyed) throw new DOMException('View destroyed', 'AbortError')
        const current = this.renderer
        if (!current || current.mode === 'fixed' || mode === 'fixed'
        || current.mode === mode) {
            if (current?.mode === mode) configure?.(current)
            return
        }

        const target = this.#readingTarget(current)
        const next = await createRenderer(mode)
        if (this.#destroyed) {
            next.destroy()
            throw new DOMException('View destroyed', 'AbortError')
        }
        this.#copyRendererAttributes(current, next)
        configure?.(next)
        if (this.#styles) next.setStyles?.(this.#styles)
        this.#wireRenderer(next, this.#events.signal)
        const { width, height } = this.getBoundingClientRect()
        Object.assign(next.element.style, {
            position: 'fixed',
            left: '-100000px',
            top: '0',
            width: `${width}px`,
            height: `${height}px`,
            visibility: 'hidden',
        })
        this.#root.append(next.element)
        try {
            await next.open(this.book)
            if (target) await next.goTo(target)
            if (this.#destroyed) throw new DOMException('View destroyed', 'AbortError')
        } catch (error) {
            next.destroy()
            this.#rendererEvents.get(next)?.abort()
            this.#rendererEvents.delete(next)
            next.element.remove()
            throw error
        }

        this.renderer = next
        this.navigation.attach?.(next)
        for (const property of ['position', 'left', 'top', 'width', 'height', 'visibility'])
            next.element.style.removeProperty(property)
        current.destroy()
        this.#rendererEvents.get(current)?.abort()
        this.#rendererEvents.delete(current)
        current.element.remove()
        const relocation = this.#relocations.get(next)
        if (relocation) this.#emit('relocate', relocation)
    }
    #readingTarget(renderer) {
        const location = this.#relocations.get(renderer)
        if (!location) return
        const { fraction = 0, index, range } = location
        try {
            const cfi = range && this.navigation.cfi?.(index, range)
            return cfi ? this.navigation.resolve(cfi) ?? { index, anchor: fraction }
                : { index, anchor: fraction }
        } catch (error) {
            console.warn('Could not transfer the exact reading position.', error)
            return { index, anchor: fraction }
        }
    }
    #copyRendererAttributes(source, target) {
        for (const { name, value } of source.element.attributes) {
            if (name !== 'flow' && name !== 'style') target.element.setAttribute(name, value)
        }
    }
    setStyles(styles) {
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
        this.renderer?.element.remove()
        this.#decorations.clear()
        this.navigation = null
        this.book = null
    }
    #emit(name, detail, cancelable) {
        return this.dispatchEvent(new CustomEvent(name, { detail, cancelable }))
    }
    #onLoad({ doc, index }) {
        this.#emit('load', { doc, index })
    }
    #onUnload(detail) {
        this.#contents.get(detail.doc)?.abort()
        this.#contents.delete(detail.doc)
        this.#emit('unload', detail)
    }
    async addAnnotation(annotation, remove) {
        const { value } = annotation
        const resolved = this.navigation.resolve(value)
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
                if (!Range || !(range instanceof Range)) return { index, label: this.navigation.label(index) }
                const draw = (func, opts) => overlay.add(value, range, func, opts)
                this.#emit('draw-annotation', { draw, annotation, doc, range })
            }
        }
        const label = this.navigation.label(index)
        return { index, label }
    }
    deleteAnnotation(annotation) {
        return this.addAnnotation(annotation, true)
    }
    #getOverlay(index) {
        return this.renderer.getContents()
            .find(x => x.index === index && x.overlay)
    }
    #createOverlay({ doc, index }) {
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
            if (!signal?.aborted) this.#emit('create-overlay', { index })
        })
        return overlay
    }
    async showAnnotation(annotation) {
        const { value } = annotation
        const resolved = await this.navigation.go(value)
        if (resolved) {
            const { index, anchor } = resolved
            const { doc } = this.#getOverlay(index) ?? {}
            if (!doc || typeof anchor !== 'function') return
            let range
            try {
                range = anchor(doc)
            } catch (error) {
                console.warn('Could not show annotation range.', error)
                return
            }
            this.#emit('show-annotation', { value, index, range })
        }
    }
    addDecoration(index, decoration) {
        const decorations = this.#decorations.get(index)
        if (decorations) decorations.set(decoration.key, decoration)
        else this.#decorations.set(index, new Map([[decoration.key, decoration]]))
        this.#drawDecoration(index, decoration)
    }
    removeDecoration(index, key) {
        const decorations = this.#decorations.get(index)
        decorations?.delete(key)
        if (!decorations?.size) this.#decorations.delete(index)
        this.#getOverlay(index)?.overlay.remove(key)
    }
    #drawDecoration(index, { key, target, draw, drawOptions }) {
        const obj = this.#getOverlay(index)
        if (!obj) return
        this.#paintDecoration(obj.doc, obj.overlay,
            { key, target, draw, drawOptions })
    }
    #paintDecoration(doc, overlay, { key, target, draw, drawOptions }) {
        const anchor = typeof target === 'string'
            ? this.navigation.resolve(target)?.anchor
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

customElements.define('epub-view', ReaderView)
