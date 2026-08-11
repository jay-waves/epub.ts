import { Overlayer } from './overlayer.js'
import { textWalker } from './text-walker.js'

const SEARCH_PREFIX = 'foliate-search:'

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
    #searchResults = new Map()
    #searchDraw
    #searchDrawOptions
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
            this.renderer = document.createElement('foliate-fxl')
        } else {
            await import('./paginator.js')
            if (this.#destroyed) throw new DOMException('View destroyed', 'AbortError')
            this.renderer = document.createElement('foliate-paginator')
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
        this.renderer.addEventListener('create-overlayer', e =>
            e.detail.attach(this.#createOverlayer(e.detail)), { signal })
        this.renderer.open(book)
        this.#root.append(this.renderer)

        if (book.sections.some(section => section.mediaOverlay)) {
            const activeClass = book.media.activeClass
            const playbackActiveClass = book.media.playbackActiveClass
            this.mediaOverlay = book.getMediaOverlay()
            let lastActive
            this.mediaOverlay.addEventListener('highlight', e => {
                const resolved = this.navigation.resolve(e.detail.text)
                if (!resolved) return
                this.renderer.goTo(resolved)
                    .then(() => {
                        if (signal.aborted) return
                        const content = this.renderer.getContents()
                            .find(x => x.index === resolved.index)
                        const el = content?.doc && resolved.anchor?.(content.doc)
                        if (!el?.classList) return
                        if (activeClass) el.classList.add(activeClass)
                        if (playbackActiveClass) el.ownerDocument
                            .documentElement.classList.add(playbackActiveClass)
                        lastActive = new WeakRef(el)
                    })
                    .catch(error => {
                        if (!signal.aborted)
                            console.warn('Failed to follow media overlay.', error)
                    })
            }, { signal })
            this.mediaOverlay.addEventListener('unhighlight', () => {
                const el = lastActive?.deref()
                if (el) {
                    if (activeClass) el.classList.remove(activeClass)
                    if (playbackActiveClass) el.ownerDocument
                        .documentElement.classList.remove(playbackActiveClass)
                }
            }, { signal })
        }
    }
    destroy() {
        if (this.#destroyed) return
        this.#destroyed = true
        this.#events?.abort()
        for (const content of this.#contents.values()) content.abort()
        this.#contents.clear()
        this.mediaOverlay?.stop?.()
        this.renderer?.destroy()
        this.renderer?.remove()
        this.#searchResults = new Map()
        this.mediaOverlay = null
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
        if (value.startsWith(SEARCH_PREFIX)) {
            const cfi = value.replace(SEARCH_PREFIX, '')
            const { index, anchor } = this.navigation.resolve(cfi)
            const obj = this.#getOverlayer(index)
            if (obj) {
                const { overlayer, doc } = obj
                if (remove) {
                    overlayer.remove(value)
                    return
                }
                const range = doc ? anchor(doc) : anchor
                overlayer.add(value, range, this.#searchDraw, this.#searchDrawOptions)
            }
            return
        }
        const { index, anchor } = this.navigation.resolve(value)
        const obj = this.#getOverlayer(index)
        if (obj) {
            const { overlayer, doc } = obj
            overlayer.remove(value)
            if (!remove) {
                const range = doc ? anchor(doc) : anchor
                const draw = (func, opts) => overlayer.add(value, range, func, opts)
                this.#emit('draw-annotation', { draw, annotation, doc, range })
            }
        }
        const label = this.navigation.label(index)
        return { index, label }
    }
    deleteAnnotation(annotation) {
        return this.addAnnotation(annotation, true)
    }
    #getOverlayer(index) {
        return this.renderer.getContents()
            .find(x => x.index === index && x.overlayer)
    }
    #createOverlayer({ doc, index }) {
        const overlayer = new Overlayer()
        const signal = this.#contents.get(doc)?.signal
        doc.addEventListener('click', e => {
            const [value, range] = overlayer.hitTest(e)
            if (value && !value.startsWith(SEARCH_PREFIX)) {
                this.#emit('show-annotation', { value, index, range })
            }
        }, { signal })

        const list = this.#searchResults.get(index)
        if (list) for (const item of list) this.addAnnotation(item)

        this.#emit('create-overlay', { index })
        return overlayer
    }
    async showAnnotation(annotation) {
        const { value } = annotation
        const resolved = await this.navigation.go(value)
        if (resolved) {
            const { index, anchor } = resolved
            const { doc } =  this.#getOverlayer(index)
            const range = anchor(doc)
            this.#emit('show-annotation', { value, index, range })
        }
    }
    async * #searchSection(matcher, query, index) {
        const doc = await this.book.sections[index].createDocument()
        for (const { range, excerpt } of matcher(doc, query))
            yield { cfi: this.navigation.cfi(index, range), excerpt }
    }
    async * #searchBook(matcher, query) {
        const { sections } = this.book
        for (const [index, { createDocument }] of sections.entries()) {
            if (!createDocument) continue
            const doc = await createDocument()
            const subitems = Array.from(matcher(doc, query), ({ range, excerpt }) =>
                ({ cfi: this.navigation.cfi(index, range), excerpt }))
            const progress = (index + 1) / sections.length
            yield { progress }
            if (subitems.length) yield { index, subitems }
        }
    }
    async * search(opts) {
        this.clearSearch()
        this.#searchDraw = opts.draw ?? Overlayer.outline
        this.#searchDrawOptions = opts.drawOptions
        const { searchMatcher } = await import('./search.js')
        const { query, index } = opts
        const matcher = searchMatcher(textWalker,
            { defaultLocale: this.language, ...opts })
        const iter = index != null
            ? this.#searchSection(matcher, query, index)
            : this.#searchBook(matcher, query)

        const list = []
        this.#searchResults.set(index, list)

        for await (const result of iter) {
            if (result.subitems){
                const list = result.subitems
                    .map(({ cfi }) => ({ value: SEARCH_PREFIX + cfi }))
                this.#searchResults.set(result.index, list)
                for (const item of list) this.addAnnotation(item)
                yield {
                    label: this.navigation.label(result.index),
                    subitems: result.subitems,
                }
            }
            else {
                if (result.cfi) {
                    const item = { value: SEARCH_PREFIX + result.cfi }
                    list.push(item)
                    this.addAnnotation(item)
                }
                yield result
            }
        }
        yield 'done'
    }
    clearSearch() {
        for (const list of this.#searchResults.values())
            for (const item of list) this.deleteAnnotation(item)
        this.#searchResults.clear()
    }
    startMediaOverlay() {
        const index = this.renderer?.getContents?.()[0]?.index
        if (index == null || !this.mediaOverlay) return
        return this.mediaOverlay.start(index)
    }
}

customElements.define('foliate-view', View)
