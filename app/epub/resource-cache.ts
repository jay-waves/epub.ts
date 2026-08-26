/*
 * Per-book Blob resource cache. Entries remain reusable after a section closes,
 * active sections are pinned, and an over-64 MiB cache is reduced to 48 MiB.
 * Clearing the cache revokes every Blob URL.
 */

const MiB = 1024 * 1024

type CacheEntry = {
    url: string
    bytes: number
    parents: Set<string>
    pins: number
    used: number
}

type ResourceCacheOptions = {
    maxBytes?: number
    targetBytes?: number
}

export class ResourceCache {
    #entries = new Map<string, CacheEntry>()
    #children = new Map<string, Set<string>>()
    #totalBytes = 0
    #clock = 0
    readonly maxBytes: number
    readonly targetBytes: number

    constructor({ maxBytes = 64 * MiB, targetBytes = 48 * MiB }: ResourceCacheOptions = {}) {
        this.maxBytes = maxBytes
        this.targetBytes = targetBytes
    }

    get(href: string, parent?: string) {
        const entry = this.#entries.get(href)
        if (!entry) return null
        entry.used = ++this.#clock
        if (parent) this.link(parent, href)
        return entry.url
    }

    add(href: string, blob: Blob, parent?: string) {
        const existing = this.get(href, parent)
        if (existing) return existing

        const entry = {
            url: URL.createObjectURL(blob),
            bytes: blob.size,
            parents: new Set<string>(),
            pins: 0,
            used: ++this.#clock,
        }
        this.#entries.set(href, entry)
        this.#totalBytes += entry.bytes
        if (parent) this.link(parent, href)
        return entry.url
    }

    link(parent: string, child: string) {
        if (!parent || parent === child) return
        const entry = this.#entries.get(child)
        if (!entry || entry.parents.has(parent)) return

        entry.parents.add(parent)
        const children = this.#children.get(parent)
        if (children) children.add(child)
        else this.#children.set(parent, new Set([child]))
    }

    pin(href: string) {
        const entry = this.#entries.get(href)
        if (!entry) return
        entry.pins++
        entry.used = ++this.#clock
        this.#trim()
    }

    release(href: string) {
        const entry = this.#entries.get(href)
        if (!entry) return
        entry.pins = Math.max(0, entry.pins - 1)
        entry.used = ++this.#clock
        this.#trim()
    }

    discardParent(parent: string) {
        const children = this.#children.get(parent)
        if (!children) return
        for (const child of children) this.#entries.get(child)?.parents.delete(parent)
        this.#children.delete(parent)
        this.#trim()
    }

    clear() {
        for (const { url } of this.#entries.values()) URL.revokeObjectURL(url)
        this.#entries.clear()
        this.#children.clear()
        this.#totalBytes = 0
    }

    #trim() {
        if (this.#totalBytes <= this.maxBytes) return

        while (this.#totalBytes > this.targetBytes) {
            const candidate = this.#oldestUnreferencedEntry()
            if (!candidate) return
            this.#delete(candidate)
        }
    }

    #oldestUnreferencedEntry() {
        let candidate: string | null = null
        let oldest = Infinity
        for (const [href, entry] of this.#entries) {
            if (entry.pins || entry.parents.size || entry.used >= oldest) continue
            candidate = href
            oldest = entry.used
        }
        return candidate
    }

    #delete(href: string) {
        const entry = this.#entries.get(href)
        if (!entry) return

        URL.revokeObjectURL(entry.url)
        this.#entries.delete(href)
        this.#totalBytes -= entry.bytes

        const children = this.#children.get(href)
        if (!children) return
        for (const child of children) this.#entries.get(child)?.parents.delete(href)
        this.#children.delete(href)
    }
}
