import { Overlay } from './overlay.ts'

const languageInfo = lang => {
    if (!lang) return {}
    try {
        const canonical = Intl.getCanonicalLocales(lang)[0]
        const locale = new Intl.Locale(canonical)
        const isCJK = ['zh', 'ja', 'ko'].includes(locale.language)
        const direction = (locale.getTextInfo?.() ?? locale.textInfo)?.direction
        return { canonical, locale, isCJK, direction }
    } catch (e) {
        console.warn(e)
        return {}
    }
}

export class View extends HTMLElement {
    #root = this.attachShadow({ mode: 'closed' })
    #events
    #contents = new Map()
    #destroyed = false
    #opened = false
    #decorations = new Map()
    isFixedLayout = false
    async open(book, navigation) {
        if (this.#opened) throw new Error('A renderer view can only open one book')
        this.#opened = true
        this.#events = new AbortController()
        const { signal } = this.#events
        this.book = book
        this.navigation = navigation
        this.language = languageInfo(book.metadata?.language)

        this.isFixedLayout = this.book.rendition?.layout === 'pre-paginated'
        if (this.isFixedLayout) {
            await import('./fixed-layout.js')
            if (this.#destroyed) throw new DOMException('View destroyed', 'AbortError')
            this.renderer = document.createElement('epub-fixed')
        } else {
            await import('./paginator.js')
            if (this.#destroyed) throw new DOMException('View destroyed', 'AbortError')
            this.renderer = document.createElement('epub-paginator')
        }
        this.renderer.beforeRenderDocument = (doc, index) => {
            const content = new AbortController()
            this.#contents.set(doc, content)
            return this.enhanceRenderedDocument?.(doc, index, content.signal)
        }
        this.renderer.setAttribute('exportparts', 'head,foot,filter')
        this.renderer.addEventListener('load', e => this.#onLoad(e.detail), { signal })
        this.renderer.addEventListener('unload', e => this.#onUnload(e.detail), { signal })
        this.renderer.addEventListener('relocate', e => this.#emit('relocate', e.detail), { signal })
        this.renderer.addEventListener('request-overlay', e =>
            e.detail.attach(this.#createOverlay(e.detail)), { signal })
        this.renderer.open(book)
        this.#root.append(this.renderer)

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
        this.navigation = null
        this.book = null
    }
    #emit(name, detail, cancelable) {
        return this.dispatchEvent(new CustomEvent(name, { detail, cancelable }))
    }
    #onLoad({ doc, index }) {
        // set language and dir if not already set
        doc.documentElement.lang ||= this.language.canonical ?? ''
        if (!this.language.isCJK)
            doc.documentElement.dir ||= this.language.direction ?? ''

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

customElements.define('epub-view', View)
