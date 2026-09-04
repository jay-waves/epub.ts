import * as CFI from './cfi.js'
import { ResourceCache } from './resource-cache.js'
import type {
    Book,
    BookMetadata,
    BookRendition,
    BookSection,
    ContributorDetails,
    LocalizedText,
    ResolvedNavigationTarget,
    TocItem,
} from '../renderer/reader-view.js'

type LoadText = (path: string) => Promise<string | null> | string | null
type LoadBlob = (path: string) => Promise<Blob | null> | Blob | null
type Sha1 = (value: string) => Promise<Uint8Array>
type EPUBSource = {
    loadText: LoadText
    loadBlob: LoadBlob
    getSize: (path: string) => number
    sha1?: Sha1
    destroy?: () => void | Promise<void>
}
type ManifestItem = {
    href: string
    id: string
    mediaType: string
    properties?: string[]
    mediaOverlay?: string | null
}
type SpineItem = {
    idref: string
    id?: string | null
    linear?: string | null
    properties?: string[]
}
type GuideItem = { label: string | null; type: string[]; href: string }
type NavItem = TocItem & { type?: string[]; subitems?: NavItem[] | null }
type ReplaceCallback = (match: string, ...captures: string[]) => string | Promise<string | null>
type MutableRecord = Record<string, unknown>
type MetadataEntry = {
    attrs: Record<string, string>
    lang: string | null
    property: string | null
    props: Record<string, MetadataEntry[]>
    scheme: string | null
    value: string
}
type ParsedContributor = ContributorDetails & { role: string[] }
type AlternateIdentifier = string | { scheme: string, value: string }

const NS = {
    CONTAINER: 'urn:oasis:names:tc:opendocument:xmlns:container',
    XHTML: 'http://www.w3.org/1999/xhtml',
    OPF: 'http://www.idpf.org/2007/opf',
    EPUB: 'http://www.idpf.org/2007/ops',
    DC: 'http://purl.org/dc/elements/1.1/',
    ENC: 'http://www.w3.org/2001/04/xmlenc#',
    NCX: 'http://www.daisy.org/z3986/2005/ncx/',
    XLINK: 'http://www.w3.org/1999/xlink',
}

const MIME = {
    XML: 'application/xml',
    NCX: 'application/x-dtbncx+xml',
    XHTML: 'application/xhtml+xml',
    HTML: 'text/html',
    CSS: 'text/css',
    SVG: 'image/svg+xml',
    JS: /\/(x-)?(javascript|ecmascript)/,
}

// https://www.w3.org/TR/epub-33/#sec-reserved-prefixes
const PREFIX = {
    a11y: 'http://www.idpf.org/epub/vocab/package/a11y/#',
    dcterms: 'http://purl.org/dc/terms/',
    marc: 'http://id.loc.gov/vocabulary/',
    onix: 'http://www.editeur.org/ONIX/book/codelists/current.html#',
    rendition: 'http://www.idpf.org/vocab/rendition/#',
    schema: 'http://schema.org/',
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    msv: 'http://www.idpf.org/epub/vocab/structure/magazine/#',
    prism: 'http://www.prismstandard.org/specifications/3.0/PRISM_CV_Spec_3.0.htm#',
}

const RELATORS = {
    art: 'artist',
    aut: 'author',
    clr: 'colorist',
    edt: 'editor',
    ill: 'illustrator',
    nrt: 'narrator',
    trl: 'translator',
    pbl: 'publisher',
}

const ONIX5 = {
    '02': 'isbn',
    '06': 'doi',
    '15': 'isbn',
    '26': 'doi',
    '34': 'issn',
}

// convert to camel case
const camel = (value: string) => value.toLowerCase()
    .replace(/[-:](.)/g, (_, char: string) => char.toUpperCase())

// strip and collapse ASCII whitespace
// https://infra.spec.whatwg.org/#strip-and-collapse-ascii-whitespace
const normalizeWhitespace = (value?: string | null) => value ? value
    .replace(/[\t\n\f\r ]+/g, ' ')
    .replace(/^[\t\n\f\r ]+/, '')
    .replace(/[\t\n\f\r ]+$/, '') : ''

const hasAttributeValue = (name: string, value: string) => (element: Element) =>
    element.getAttribute(name) === value

const getElementText = (element?: Node | null) => normalizeWhitespace(element?.textContent)

const childGetter = (doc: Document, namespace: string) => {
    // ignore the namespace if it doesn't appear in document at all
    const useNS = doc.lookupNamespaceURI(null) === namespace || !!doc.lookupPrefix(namespace)
    const matches = (name: string) => useNS
        ? (element: Element) => element.namespaceURI === namespace && element.localName === name
        : (element: Element) => element.localName === name
    return {
        $: (element: Element, name: string) => [...element.children].find(matches(name)),
        $$: (element: Element, name: string) => [...element.children].filter(matches(name)),
        $$$: useNS
            ? (element: Document | Element, name: string) =>
                [...element.getElementsByTagNameNS(namespace, name)]
            : (element: Document | Element, name: string) =>
                [...element.getElementsByTagName(name)],
    }
}

const resolveURL = (url: string, relativeTo: string) => {
    try {
        if (relativeTo.includes(':')) return new URL(url, relativeTo).href
        // the base needs to be a valid URL, so set a base URL and then remove it
        const root = 'https://invalid.invalid/'
        const obj = new URL(url, root + relativeTo)
        obj.search = ''
        return decodeURI(obj.href.replace(root, ''))
    } catch(error) {
        console.warn(error)
        return url
    }
}

const isExternal = (uri: string) => /^(?!blob)\w+:/i.test(uri)

// like `path.relative()` in Node.js
const pathRelative = (from: string, to: string) => {
    if (!from) return to
    const as = from.replace(/\/$/, '').split('/')
    const bs = to.replace(/\/$/, '').split('/')
    const i = (as.length > bs.length ? as : bs).findIndex((_, i) => as[i] !== bs[i])
    return i < 0 ? '' : Array(as.length - i).fill('..').concat(bs.slice(i)).join('/')
}

const pathDirname = (value: string) => value.slice(0, value.lastIndexOf('/') + 1)

const replaceAsync = async (value: string, regex: RegExp, replace: ReplaceCallback) => {
    const matcher = new RegExp(regex.source, regex.flags)
    const matches: Array<{ end: number, start: number, value: string | Promise<string | null> }> = []
    let match: RegExpExecArray | null
    while ((match = matcher.exec(value))) {
        matches.push({
            end: match.index + match[0].length,
            start: match.index,
            value: replace(match[0], ...match.slice(1).map(capture => capture ?? '')),
        })
        if (!regex.global || match[0] === '') break
    }
    const replacements = await Promise.all(matches.map(item => item.value))
    let cursor = 0
    return matches.reduce((result, item, index) => {
        const next = result + value.slice(cursor, item.start) + (replacements[index] ?? '')
        cursor = item.end
        return next
    }, '') + value.slice(cursor)
}

const isMutableRecord = (value: unknown): value is MutableRecord =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

const tidy = (obj: MutableRecord): unknown => {
    for (const [key, val] of Object.entries(obj))
        if (val == null) delete obj[key]
        else if (Array.isArray(val)) {
            obj[key] = val.filter(x => x).map(x =>
                isMutableRecord(x) ? tidy(x) : x)
            const items = obj[key] as unknown[]
            if (!items.length) delete obj[key]
            else if (items.length === 1) obj[key] = items[0]
        }
        else if (isMutableRecord(val)) {
            obj[key] = tidy(val)
            if (!Object.keys(val).length) delete obj[key]
        }
    const keys = Object.keys(obj)
    if (keys.length === 1 && keys[0] === 'name') return obj.name
    return obj
}

// https://www.w3.org/TR/epub/#sec-prefix-attr
const getPrefixes = (doc: Document) => {
    const map = new Map(Object.entries(PREFIX))
    const value = doc.documentElement.getAttributeNS(NS.EPUB, 'prefix')
        || doc.documentElement.getAttribute('prefix')
    if (value) for (const [, prefix, url] of value
        .matchAll(/(.+): +(.+)[ \t\r\n]*/g)) map.set(prefix, url)
    return map
}

// https://www.w3.org/TR/epub-rs/#sec-property-values
// but ignoring the case where the prefix is omitted
const getPropertyURL = (value: string | null, prefixes: Map<string | null, string>) => {
    if (!value) return null
    const [a, b] = value.split(':')
    const prefix = b ? a : null
    const reference = b ? b : a
    const baseURL = prefixes.get(prefix)
    return baseURL ? baseURL + reference : null
}

const getMetadata = (opf: Document) => {
    const { $ } = childGetter(opf, NS.OPF)
    const $metadata = $(opf.documentElement, 'metadata')
    if (!$metadata) return { metadata: {}, rendition: {} }

    // first pass: convert to JS objects
    const els = Object.groupBy([...$metadata.children], el =>
        el.namespaceURI === NS.DC ? 'dc'
        : el.namespaceURI === NS.OPF && el.localName === 'meta' ?
            (el.hasAttribute('name') ? 'legacyMeta' : 'meta') : '') as
        Record<string, Element[] | undefined>
    const baseLang = $metadata.getAttribute('xml:lang')
        ?? opf.documentElement.getAttribute('xml:lang') ?? 'und'
    const prefixes = getPrefixes(opf)
    const parse = (el: Element): MetadataEntry => {
        const property = el.getAttribute('property')
        const scheme = el.getAttribute('scheme')
        return {
            property: getPropertyURL(property, prefixes) ?? property,
            scheme: getPropertyURL(scheme, prefixes) ?? scheme,
            lang: el.getAttribute('xml:lang'),
            value: getElementText(el),
            props: getProperties(el),
            // `opf:` attributes from EPUB 2 & EPUB 3.1 (removed in EPUB 3.2)
            attrs: Object.fromEntries([...el.attributes]
                .filter(attr => attr.namespaceURI === NS.OPF)
                .map(attr => [attr.localName, attr.value])),
        }
    }
    const refines = Map.groupBy(els.meta ?? [], el => el.getAttribute('refines'))
    const getProperties = (el?: Element | null): Record<string, MetadataEntry[]> => {
        const els = refines.get(el ? '#' + el.getAttribute('id') : null)
        if (!els) return {}
        return Object.groupBy(els.map(parse), x => String(x.property)) as
            Record<string, MetadataEntry[]>
    }
    const dcGroups = Object.groupBy(els.dc ?? [], el => el.localName)
    const dc: Record<string, MetadataEntry[]> = Object.fromEntries(
        Object.entries(dcGroups).flatMap(([name, elements]) =>
            elements ? [[name, elements.map(parse)]] : []))
    const properties = getProperties()
    const legacyMeta = Object.fromEntries(els.legacyMeta?.flatMap(el => {
        const name = el.getAttribute('name')
        return name ? [[name, el.getAttribute('content') ?? ''] as const] : []
    }) ?? [])

    // second pass: map to webpub
    const one = (items?: MetadataEntry[]) => items?.[0]?.value
    const prop = (item: MetadataEntry | undefined, property: string) => one(item?.props[property])
    const makeLanguageMap = (item?: MetadataEntry | null): LocalizedText | null => {
        const x = item
        if (!x) return null
        const alts = x.props?.['alternate-script'] ?? []
        const altRep = x.attrs['alt-rep']
        if (!alts.length && (!x.lang || x.lang === baseLang) && !altRep) return x.value
        const map = { [x.lang ?? baseLang]: x.value }
        if (altRep) map[x.attrs['alt-rep-lang']] = altRep
        for (const y of alts) map[y.lang ?? baseLang] ??= y.value
        return map
    }
    const makeContributor = (x: MetadataEntry): ParsedContributor => ({
        name: makeLanguageMap(x) ?? undefined,
        sortAs: makeLanguageMap(x.props['file-as']?.[0]) ?? x.attrs['file-as'],
        role: x.props.role?.filter(role =>
            role.scheme === PREFIX.marc + 'relators')
            .map(role => role.value) ?? (x.attrs.role ? [x.attrs.role] : []),
        code: prop(x, 'term') ?? x.attrs.term,
        scheme: prop(x, 'authority') ?? x.attrs.authority,
    })
    const makeCollection = (x: MetadataEntry) => ({
        name: makeLanguageMap(x) ?? undefined,
        // NOTE: webpub requires number but EPUB allows values like "2.2.1"
        position: one(x.props?.['group-position']),
    })
    const makeAltIdentifier = (x: MetadataEntry): AlternateIdentifier => {
        const { value } = x
        if (/^urn:/i.test(value)) return value
        if (/^doi:/i.test(value)) return `urn:${value}`
        const [type] = x.props['identifier-type'] ?? []
        if (!type) {
            const scheme = x.attrs.scheme
            if (!scheme) return value
            // https://idpf.github.io/epub-registries/identifiers/
            // but no "jdcn", which isn't a registered URN namespace
            if (/^(doi|isbn|uuid)$/i.test(scheme)) return `urn:${scheme}:${value}`
            // NOTE: webpub requires scheme to be a URI; EPUB allows anything
            return { scheme, value }
        }
        if (type.scheme === PREFIX.onix + 'codelist5') {
            const nid: string | undefined = Object.hasOwn(ONIX5, type.value)
                ? ONIX5[type.value as keyof typeof ONIX5] : undefined
            if (nid) return `urn:${nid}:${value}`
        }
        return value
    }
    const belongsTo = Object.groupBy(properties['belongs-to-collection'] ?? [],
        x => prop(x, 'collection-type') === 'series' ? 'series' : 'collection')
    const mainTitle = dc.title?.find(x => prop(x, 'title-type') === 'main') ?? dc.title?.[0]
    const identifier = getIdentifier(opf)
    const metadata: BookMetadata = {
        identifier,
        title: makeLanguageMap(mainTitle) ?? undefined,
        sortAs: makeLanguageMap(mainTitle?.props['file-as']?.[0])
            ?? mainTitle?.attrs?.['file-as']
            ?? legacyMeta?.['calibre:title_sort'],
        subtitle: dc.title?.find(x => prop(x, 'title-type') === 'subtitle')?.value,
        language: dc.language?.map(x => x.value),
        description: one(dc.description),
        publisher: dc.publisher?.map(makeContributor),
        published: dc.date?.find(x => x.attrs.event === 'publication')?.value
            ?? one(dc.date),
        modified: one(properties[PREFIX.dcterms + 'modified'])
            ?? dc.date?.find(x => x.attrs.event === 'modification')?.value,
        subject: dc.subject?.map(makeContributor),
        belongsTo: {
            collection: belongsTo.collection?.map(makeCollection),
            series: belongsTo.series?.map(makeCollection)
            ?? (legacyMeta?.['calibre:series'] ? {
                name: legacyMeta?.['calibre:series'],
                position: parseFloat(legacyMeta?.['calibre:series_index']),
            } : undefined),
        },
        altIdentifier: dc.identifier?.map(makeAltIdentifier)
            .filter(value => value !== identifier),
        source: dc.source?.map(makeAltIdentifier), // NOTE: not in webpub schema
        rights: one(dc.rights), // NOTE: not in webpub schema
        pageBreakSource: one(properties['pageBreakSource']), // NOTE: not in webpub schema
    }
    const remapContributor = (defaultKey: string) =>
        (x: ParsedContributor): [Iterable<string>, ParsedContributor] => {
        const keys = new Set(x.role.map(role =>
            Object.hasOwn(RELATORS, role)
                ? RELATORS[role as keyof typeof RELATORS] : defaultKey))
        return [keys.size ? keys : [defaultKey], x]
    }
    const contributors = [
        dc.creator?.map(makeContributor)?.map(remapContributor('author')) ?? [],
        dc.contributor?.map(makeContributor)?.map(remapContributor('contributor')) ?? [],
    ].flat()
    const contributorGroups: Record<string, ParsedContributor[]> = {}
    for (const [keys, val] of contributors)
        for (const key of keys)
            (contributorGroups[key] ??= []).push(val)
    Object.assign(metadata, contributorGroups)
    tidy(metadata)

    const rendition: BookRendition = {}
    for (const [key, val] of Object.entries(properties)) {
        if (!key.startsWith(PREFIX.rendition)) continue
        const property = camel(key.replace(PREFIX.rendition, ''))
        const value = one(val)
        if (property === 'flow' || property === 'layout'
            || property === 'orientation' || property === 'spread'
            || property === 'viewport') rendition[property] = value
    }
    return { metadata, rendition }
}

const parseNav = (doc: Document, resolve: (href: string) => string = href => href) => {
    const { $, $$, $$$ } = childGetter(doc, NS.XHTML)
    const resolveHref = (href?: string | null) => href ? decodeURI(resolve(href)) : undefined
    const parseLI = (getType = false) => ($li: Element): NavItem => {
        const $a = $($li, 'a') ?? $($li, 'span')
        const $ol = $($li, 'ol')
        const href = resolveHref($a?.getAttribute('href'))
        const label = getElementText($a) || $a?.getAttribute('title')
        // TODO: get and concat alt/title texts in content
        const result: NavItem = { label: label || undefined, href, subitems: parseOL($ol) }
        if (getType) result.type = $a?.getAttributeNS(NS.EPUB, 'type')?.split(/\s/)
        return result
    }
    const parseOL = ($ol?: Element, getType = false): NavItem[] | undefined =>
        $ol ? $$($ol, 'li').map(parseLI(getType)) : undefined
    const parseNavElement = ($nav: Element, getType = false) =>
        parseOL($($nav, 'ol'), getType)

    const $$nav = $$$(doc, 'nav')
    let toc: NavItem[] | undefined
    let pageList: NavItem[] | undefined
    let landmarks: NavItem[] | undefined
    const others: Array<{ label: string; type: string[]; list?: NavItem[] }> = []
    for (const $nav of $$nav) {
        const type = $nav.getAttributeNS(NS.EPUB, 'type')?.split(/\s/) ?? []
        if (type.includes('toc')) toc ??= parseNavElement($nav)
        else if (type.includes('page-list')) pageList ??= parseNavElement($nav)
        else if (type.includes('landmarks')) landmarks ??= parseNavElement($nav, true)
        else others.push({
            label: getElementText($nav.firstElementChild), type,
            list: parseNavElement($nav),
        })
    }
    return { toc, pageList, landmarks, others }
}

const parseNCX = (doc: Document, resolve: (href: string) => string = href => href) => {
    const { $, $$ } = childGetter(doc, NS.NCX)
    const resolveHref = (href: string | null) => href ? decodeURI(resolve(href)) : undefined
    const parseItem = (el: Element): NavItem => {
        const $label = $(el, 'navLabel')
        const $content = $(el, 'content')
        const label = getElementText($label)
        const href = resolveHref($content?.getAttribute('src') ?? null)
        if (el.localName === 'navPoint') {
            const els = $$(el, 'navPoint')
            return { label: label || undefined, href,
                subitems: els.length ? els.map(parseItem) : undefined }
        }
        return { label: label || undefined, href }
    }
    const parseList = (el: Element, itemName: string) => $$(el, itemName).map(parseItem)
    const getSingle = (container: string, itemName: string) => {
        const $container = $(doc.documentElement, container)
        return $container ? parseList($container, itemName) : undefined
    }
    return {
        toc: getSingle('navMap', 'navPoint'),
        pageList: getSingle('pageList', 'pageTarget'),
        others: $$(doc.documentElement, 'navList').map(el => ({
            label: getElementText($(el, 'navLabel')),
            list: parseList(el, 'navTarget'),
        })),
    }
}

const isUUID = /([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})/

const getUUID = (opf: Document) => {
    for (const el of opf.getElementsByTagNameNS(NS.DC, 'identifier')) {
        const [id] = getElementText(el).split(':').slice(-1)
        if (isUUID.test(id)) return id
    }
    return ''
}

const getIdentifier = (opf: Document) => getElementText(
    opf.getElementById(opf.documentElement.getAttribute('unique-identifier') ?? '')
    ?? opf.getElementsByTagNameNS(NS.DC, 'identifier')[0])

// https://www.w3.org/publishing/epub32/epub-ocf.html#sec-resource-obfuscation
const deobfuscate = async (key: Uint8Array, length: number, blob: Blob) => {
    const array = new Uint8Array(await blob.slice(0, length).arrayBuffer())
    length = Math.min(length, array.length)
    for (let i = 0; i < length; i++) array[i] ^= key[i % key.length]
    return new Blob([array, blob.slice(length)], { type: blob.type })
}

const WebCryptoSHA1: Sha1 = async value => {
    const data = new TextEncoder().encode(value)
    const buffer = await globalThis.crypto.subtle.digest('SHA-1', data)
    return new Uint8Array(buffer)
}

type EncryptionAlgorithm = {
    key: (opf: Document) => Uint8Array | Promise<Uint8Array>
    decode: (key: Uint8Array, blob: Blob) => Promise<Blob>
}

const deobfuscators = (sha1: Sha1 = WebCryptoSHA1): Record<string, EncryptionAlgorithm> => ({
    'http://www.idpf.org/2008/embedding': {
        key: opf => sha1(getIdentifier(opf)
            // eslint-disable-next-line no-control-regex
            .replaceAll(/[\u0020\u0009\u000d\u000a]/g, '')),
        decode: (key, blob) => deobfuscate(key, 1040, blob),
    },
    'http://ns.adobe.com/pdf/enc#RC': {
        key: opf => {
            const uuid = getUUID(opf).replaceAll('-', '')
            return Uint8Array.from({ length: 16 }, (_, i) =>
                parseInt(uuid.slice(i * 2, i * 2 + 2), 16))
        },
        decode: (key, blob) => deobfuscate(key, 1024, blob),
    },
})

class Encryption {
    #uris = new Map<string, string>()
    #decoders = new Map<string, (blob: Blob) => Blob | Promise<Blob>>()
    constructor(private readonly algorithms: Record<string, EncryptionAlgorithm>) {
    }
    async init(encryption: Document | null, opf: Document) {
        if (!encryption) return
        const data = Array.from(
            encryption.getElementsByTagNameNS(NS.ENC, 'EncryptedData'), el => ({
                algorithm: el.getElementsByTagNameNS(NS.ENC, 'EncryptionMethod')[0]
                    ?.getAttribute('Algorithm'),
                uri: el.getElementsByTagNameNS(NS.ENC, 'CipherReference')[0]
                    ?.getAttribute('URI'),
            }))
        for (const { algorithm, uri } of data) {
            if (!algorithm || !uri) continue
            if (!this.#decoders.has(algorithm)) {
                const algo = this.algorithms[algorithm]
                if (!algo) {
                    console.warn('Unknown encryption algorithm')
                    continue
                }
                const key = await algo.key(opf)
                this.#decoders.set(algorithm, blob => algo.decode(key, blob))
            }
            this.#uris.set(uri, algorithm)
        }
    }
    getDecoder(uri: string) {
        const algorithm = this.#uris.get(uri)
        return algorithm ? this.#decoders.get(algorithm) ?? ((blob: Blob) => blob)
            : (blob: Blob) => blob
    }
}

class Resources {
    readonly manifest: ManifestItem[]
    readonly manifestById: Map<string, ManifestItem>
    readonly manifestByHref: Map<string, ManifestItem>
    readonly spine: SpineItem[]
    readonly pageProgressionDirection: string | null
    readonly navPath?: string
    readonly ncxPath?: string
    readonly guide?: GuideItem[]
    readonly cover?: ManifestItem
    readonly cfis: string[]

    constructor(
        readonly opf: Document,
        resolveHref: (href: string) => string,
    ) {
        const { $, $$, $$$ } = childGetter(opf, NS.OPF)

        const $manifest = $(opf.documentElement, 'manifest')
        const $spine = $(opf.documentElement, 'spine')
        if (!$manifest || !$spine) throw new Error('Package document has no manifest or spine')
        const $$itemref = $$($spine, 'itemref')

        this.manifest = $$($manifest, 'item').flatMap(element => {
            const href = element.getAttribute('href')
            const id = element.getAttribute('id')
            const mediaType = element.getAttribute('media-type')
            if (!href || !id || !mediaType) return []
            return [{
                href: resolveHref(href), id, mediaType,
                properties: element.getAttribute('properties')?.split(/\s/),
                mediaOverlay: element.getAttribute('media-overlay'),
            }]
        })
        this.manifestById = new Map(this.manifest.map(item => [item.id, item]))
        this.manifestByHref = new Map(this.manifest.map(item => [item.href, item]))
        this.spine = $$itemref.flatMap(element => {
            const idref = element.getAttribute('idref')
            if (!idref) return []
            return [{
                idref,
                id: element.getAttribute('id'),
                linear: element.getAttribute('linear'),
                properties: element.getAttribute('properties')?.split(/\s/),
            }]
        })
        this.pageProgressionDirection = $spine
            .getAttribute('page-progression-direction')

        this.navPath = this.getItemByProperty('nav')?.href
        this.ncxPath = (this.getItemByID($spine.getAttribute('toc'))
            ?? this.manifest.find(item => item.mediaType === MIME.NCX))?.href

        const $guide = $(opf.documentElement, 'guide')
        if ($guide) this.guide = $$($guide, 'reference')
            .flatMap(element => {
                const type = element.getAttribute('type')
                const href = element.getAttribute('href')
                return type && href ? [{
                    label: element.getAttribute('title'),
                    type: type.split(/\s/),
                    href: resolveHref(href),
                }] : []
            })

        this.cover = this.getItemByProperty('cover-image')
            // EPUB 2 compat
            ?? this.getItemByID($$$(opf, 'meta')
                .find(hasAttributeValue('name', 'cover'))
                ?.getAttribute('content'))
            ?? this.getItemByHref(this.guide
                ?.find(ref => ref.type.includes('cover'))?.href)

        this.cfis = CFI.fromElements($$itemref)
    }
    getItemByID(id?: string | null) {
        return id ? this.manifestById.get(id) : undefined
    }
    getItemByHref(href?: string) {
        return href ? this.manifestByHref.get(href) : undefined
    }
    getItemByProperty(prop: string) {
        return this.manifest.find(item => item.properties?.includes(prop))
    }
    resolveCFI(cfi: string, filter?: (node: Node) => number): ResolvedNavigationTarget {
        const parts = CFI.parse(cfi)
        const path = Array.isArray(parts) ? parts : parts.parent
        const top = path[0]
        if (!top) return { index: -1 }
        let $itemref = CFI.toElement(this.opf, top)
        // make sure it's an idref; if not, try again without the ID assertion
        // mainly because Epub.js used to generate wrong ID assertions
        // https://github.com/futurepress/epub.js/issues/1236
        if ($itemref && $itemref.nodeName !== 'idref') {
            const last = top.at(-1)
            if (last) last.id = undefined
            $itemref = CFI.toElement(this.opf, top)
        }
        const idref = $itemref?.getAttribute('idref')
        const index = this.spine.findIndex(item => item.idref === idref)
        const anchor = (doc: Document) => CFI.toRange(doc, parts, filter)
        return { index, anchor }
    }
}

class Loader {
    #cache = new ResourceCache()
    #pending = new Map<string, Promise<string | null>>()
    #destroyed = false
    readonly eventTarget = new EventTarget()
    readonly manifestByHref: Map<string, ManifestItem>
    readonly assets: ManifestItem[]
    constructor(
        private readonly loadText: LoadText,
        private readonly loadBlob: LoadBlob,
        resources: Resources,
    ) {
        this.manifestByHref = resources.manifestByHref
        this.assets = resources.manifest
        // needed only when replacing in (X)HTML w/o parsing (see below)
        //.filter(({ mediaType }) => ![MIME.XHTML, MIME.HTML].includes(mediaType))
    }
    async createURL(
        href: string,
        data: BlobPart | Promise<BlobPart>,
        type: string,
        parent?: string,
    ): Promise<string | null> {
        if (!data) return ''
        const detail: { data: BlobPart | Promise<BlobPart>; type: string } = { data, type }
        Object.defineProperty(detail, 'name', { value: href }) // readonly
        const event = new CustomEvent('data', { detail })
        this.eventTarget.dispatchEvent(event)
        const newData = await event.detail.data
        const newType = await event.detail.type
        if (this.#destroyed) return null
        return this.#cache.add(href, new Blob([newData], { type: newType }), parent)
    }
    // load manifest item, recursively loading all resources as needed
    async loadItem(item?: ManifestItem, parents: string[] = []): Promise<string | null> {
        if (!item) return null
        const { href, mediaType } = item

        const isScript = MIME.JS.test(item.mediaType)
        const detail = { type: mediaType, isScript, allow: true}
        const event = new CustomEvent('load', { detail })
        this.eventTarget.dispatchEvent(event)
        const allow = await event.detail.allow
        if (!allow) return null

        const parent = parents.at(-1)
        const cached = this.#cache.get(href, parent)
        if (cached) return cached

        const shouldReplace =
            (isScript || [MIME.XHTML, MIME.HTML, MIME.CSS, MIME.SVG].includes(mediaType))
            // prevent circular references
            && parents.every(p => p !== href)
        let pending = this.#pending.get(href)
        if (!pending) {
            pending = shouldReplace
                ? this.loadReplaced(item, parents)
                : Promise.resolve().then(() => this.loadBlob(href))
                    .then(blob => blob ? this.createURL(href, blob, mediaType) : null)
            this.#pending.set(href, pending)
        }

        try {
            const url = await pending
            if (url && parent) this.#cache.link(parent, href)
            return url
        } catch (error) {
            this.#cache.discardParent(href)
            throw error
        } finally {
            if (this.#pending.get(href) === pending) this.#pending.delete(href)
        }
    }
    async loadHref(href: string, base: string, parents: string[] = []): Promise<string> {
        if (isExternal(href)) return href
        const path = resolveURL(href, base)
        if (parents.includes(path)) return 'data:,'
        const item = this.manifestByHref.get(path)
        if (!item) return href
        return await this.loadItem(item, [...parents, base]) ?? ''
    }
    async loadReplaced(item: ManifestItem, parents: string[] = []) {
        const { href, mediaType } = item
        const parent = parents.at(-1)
        const str = await this.loadText(href)
        if (!str) return null

        // note that one can also just use `replaceString` for everything:
        // ```
        // const replaced = await this.replaceString(str, href, parents)
        // return this.createURL(href, replaced, mediaType, parent)
        // ```
        // which is basically what Epub.js does, which is simpler, but will
        // break things like iframes (because you don't want to replace links)
        // or text that just happen to be paths

        // parse and replace in HTML
        if ([MIME.XHTML, MIME.HTML, MIME.SVG].includes(mediaType)) {
            let doc = new DOMParser().parseFromString(str,
                mediaType as DOMParserSupportedType)
            // change to HTML if it's not valid XHTML
            if (mediaType === MIME.XHTML && (doc.querySelector('parsererror')
            || !doc.documentElement?.namespaceURI)) {
                console.warn(doc.querySelector('parsererror')?.textContent ?? 'Invalid XHTML')
                item.mediaType = MIME.HTML
                doc = new DOMParser().parseFromString(str,
                    item.mediaType as DOMParserSupportedType)
            }
            doc.querySelectorAll('script').forEach(el => el.remove())
            for (const image of doc.querySelectorAll('img'))
                image.setAttribute('decoding', 'async')
            // replace hrefs in XML processing instructions
            // this is mainly for SVGs that use xml-stylesheet
            if ([MIME.XHTML, MIME.SVG].includes(item.mediaType)) {
                let child = doc.firstChild
                while (child instanceof ProcessingInstruction) {
                    if (child.data) {
                        const replacedData = await replaceAsync(child.data,
                            /(?:^|\s*)(href\s*=\s*['"])([^'"]*)(['"])/i,
                            (_, p1, p2, p3) => this.loadHref(p2, href, parents)
                                .then(p2 => `${p1}${p2}${p3}`))
                        child.replaceWith(doc.createProcessingInstruction(
                            child.target, replacedData))
                    }
                    child = child.nextSibling
                }
            }
            // replace hrefs (excluding anchors)
            const replace = async (el: Element, attr: string) => {
                const value = el.getAttribute(attr)
                if (value != null) el.setAttribute(attr,
                    await this.loadHref(value, href, parents))
            }
            await Promise.all([
                ...Array.from(doc.querySelectorAll('link[href]'), el => replace(el, 'href')),
                ...Array.from(doc.querySelectorAll('[src]'), el => replace(el, 'src')),
                ...Array.from(doc.querySelectorAll('[poster]'), el => replace(el, 'poster')),
                ...Array.from(doc.querySelectorAll('object[data]'), el => replace(el, 'data')),
                ...Array.from(doc.querySelectorAll('[*|href]:not([href])'), async el =>
                    el.setAttributeNS(NS.XLINK, 'href', await this.loadHref(
                        el.getAttributeNS(NS.XLINK, 'href') ?? '', href, parents))),
                ...Array.from(doc.querySelectorAll('[srcset]'), async el =>
                    el.setAttribute('srcset', await replaceAsync(el.getAttribute('srcset') ?? '',
                        /(\s*)(.+?)\s*((?:\s[\d.]+[wx])+\s*(?:,|$)|,\s+|$)/g,
                        (_, p1, p2, p3) => this.loadHref(p2, href, parents)
                            .then(p2 => `${p1}${p2}${p3}`)))),
                ...Array.from(doc.querySelectorAll('style'), async el => {
                    if (el.textContent) el.textContent =
                        await this.replaceCSS(el.textContent, href, parents)
                }),
                ...Array.from(doc.querySelectorAll('[style]'), async el =>
                    el.setAttribute('style',
                        await this.replaceCSS(el.getAttribute('style') ?? '', href, parents))),
            ])
            // TODO: replace inline scripts? probably not worth the trouble
            const result = new XMLSerializer().serializeToString(doc)
            return this.createURL(href, result, item.mediaType, parent)
        }

        const result = mediaType === MIME.CSS
            ? await this.replaceCSS(str, href, parents)
            : await this.replaceString(str, href, parents)
        return this.createURL(href, result, mediaType, parent)
    }
    async replaceCSS(str: string, href: string, parents: string[] = []) {
        const replacedUrls = await replaceAsync(str,
            /url\(\s*["']?([^'"\n]*?)\s*["']?\s*\)/gi,
            (_, url) => this.loadHref(url, href, parents)
                .then(url => `url("${url}")`))
        // apart from `url()`, strings can be used for `@import` (but why?!)
        return replaceAsync(replacedUrls,
            /@import\s*["']([^"'\n]*?)["']/gi,
            (_, url) => this.loadHref(url, href, parents)
                .then(url => `@import "${url}"`))
    }
    // find & replace all possible relative paths for all assets without parsing
    replaceString(str: string, href: string, parents: string[] = []) {
        const assetMap = new Map<string, ManifestItem>()
        const urls = this.assets.map(asset => {
            // do not replace references to the file itself
            if (asset.href === href) return
            // href was decoded and resolved when parsing the manifest
            const relative = pathRelative(pathDirname(href), asset.href)
            const relativeEnc = encodeURI(relative)
            const rootRelative = '/' + asset.href
            const rootRelativeEnc = encodeURI(rootRelative)
            const set = new Set([relative, relativeEnc, rootRelative, rootRelativeEnc])
            for (const url of set) assetMap.set(url, asset)
            return Array.from(set)
        }).flat().filter((url): url is string => !!url)
        if (!urls.length) return str
        const regex = new RegExp(urls.map(RegExp.escape).join('|'), 'g')
        return replaceAsync(str, regex, async match =>
            this.loadItem(assetMap.get(match.replace(/^\//, '')),
                parents.concat(href)))
    }
    async loadSection(item: ManifestItem) {
        const url = await this.loadItem(item)
        if (url) this.#cache.pin(item.href)
        return url
    }
    unloadSection(item?: ManifestItem) {
        if (item) this.#cache.release(item.href)
    }
    destroy() {
        this.#destroyed = true
        this.#cache.clear()
    }
}

const getHTMLFragment = (doc: Document, id = '') => {
    let decoded = id
    try { decoded = decodeURIComponent(id) } catch {}
    return doc.getElementById(decoded)
        ?? doc.querySelector(`[id="${CSS.escape(decoded)}"]`)
        ?? doc.querySelector(`[name="${CSS.escape(decoded)}"]`)
}

const getPageSpread = (properties: string[]) => {
    for (const p of properties) {
        if (p === 'page-spread-left' || p === 'rendition:page-spread-left')
            return 'left'
        if (p === 'page-spread-right' || p === 'rendition:page-spread-right')
            return 'right'
        if (p === 'rendition:page-spread-center') return 'center'
    }
}

const getDisplayOptions = (doc: Document | null) => {
    if (!doc) return null
    return {
        fixedLayout: getElementText(doc.querySelector('option[name="fixed-layout"]')),
        openToSpread: getElementText(doc.querySelector('option[name="open-to-spread"]')),
    }
}

export class EPUB implements Book {
    readonly parser = new DOMParser()
    readonly loadText: (path: string) => Promise<string | null>
    readonly loadBlob: (path: string) => Promise<Blob | null>
    readonly getSize: (path: string) => number
    sections: BookSection[] = []
    toc?: TocItem[]
    pageList?: TocItem[]
    landmarks?: Array<{ href?: string; type: string[] }>
    metadata?: BookMetadata
    rendition: BookRendition = {}
    dir?: string
    transformTarget!: EventTarget
    resources!: Resources
    #loader?: Loader
    readonly #encryption: Encryption
    readonly #destroySource?: () => void | Promise<void>
    constructor({ loadText, loadBlob, getSize, sha1, destroy }: EPUBSource) {
        this.loadText = async path => await loadText(path)
        this.loadBlob = async path => await loadBlob(path)
        this.getSize = getSize
        this.#destroySource = destroy
        this.#encryption = new Encryption(deobfuscators(sha1))
    }
    async #loadXML(uri: string) {
        const str = await this.loadText(uri)
        if (!str) return null
        const doc = this.parser.parseFromString(str, MIME.XML as DOMParserSupportedType)
        const parseError = doc.querySelector('parsererror')
        if (parseError)
            throw new Error(`XML parsing error: ${uri}
${parseError.textContent}`)
        return doc
    }
    async init() {
        const $container = await this.#loadXML('META-INF/container.xml')
        if (!$container) throw new Error('Failed to load container file')

        const opfs = [...$container.getElementsByTagNameNS(NS.CONTAINER, 'rootfile')]
            .flatMap(element => {
                const fullPath = element.getAttribute('full-path')
                const mediaType = element.getAttribute('media-type')
                return fullPath && mediaType ? [{ fullPath, mediaType }] : []
            })
            .filter(file => file.mediaType === 'application/oebps-package+xml')

        if (!opfs.length) throw new Error('No package document defined in container')
        const opfPath = opfs[0].fullPath
        const opf = await this.#loadXML(opfPath)
        if (!opf) throw new Error('Failed to load package document')

        const $encryption = await this.#loadXML('META-INF/encryption.xml')
        await this.#encryption.init($encryption, opf)

        this.resources = new Resources(opf, url => resolveURL(url, opfPath))
        const loader = new Loader(
            this.loadText,
            async uri => {
                const blob = await this.loadBlob(uri)
                return blob ? this.#encryption.getDecoder(uri)(blob) : null
            },
            this.resources,
        )
        this.#loader = loader
        this.transformTarget = loader.eventTarget
        this.sections = this.resources.spine.flatMap((spineItem, index): BookSection[] => {
            const { idref, linear, properties = [] } = spineItem
            const item = this.resources.getItemByID(idref)
            if (!item) {
                console.warn(`Could not find item with ID "${idref}" in manifest`)
                return []
            }
            return [{
                id: item.href,
                load: () => loader.loadSection(item),
                unload: () => loader.unloadSection(item),
                createDocument: () => this.loadDocument(item),
                size: this.getSize(item.href),
                cfi: this.resources.cfis[index],
                linear: linear ?? undefined,
                pageSpread: getPageSpread(properties),
                resolveHref: href => resolveURL(href, item.href),
            }]
        })

        const { navPath, ncxPath } = this.resources
        if (navPath) try {
            const resolve = (url: string) => resolveURL(url, navPath)
            const doc = await this.#loadXML(navPath)
            if (!doc) throw new Error(`Failed to load navigation document: ${navPath}`)
            const nav = parseNav(doc, resolve)
            this.toc = nav.toc
            this.pageList = nav.pageList
            this.landmarks = nav.landmarks?.flatMap(item =>
                item.type ? [{ href: item.href, type: item.type }] : [])
        } catch(e) {
            console.warn(e)
        }
        if (!this.toc && ncxPath) try {
            const resolve = (url: string) => resolveURL(url, ncxPath)
            const doc = await this.#loadXML(ncxPath)
            if (!doc) throw new Error(`Failed to load NCX document: ${ncxPath}`)
            const ncx = parseNCX(doc, resolve)
            this.toc = ncx.toc
            this.pageList = ncx.pageList
        } catch(e) {
            console.warn(e)
        }
        this.landmarks ??= this.resources.guide

        const { metadata, rendition } = getMetadata(opf)
        this.metadata = metadata
        this.rendition = rendition
        this.dir = this.resources.pageProgressionDirection ?? undefined
        const displayOptions = getDisplayOptions(
            await this.#loadXML('META-INF/com.apple.ibooks.display-options.xml')
            ?? await this.#loadXML('META-INF/com.kobobooks.display-options.xml'))
        if (displayOptions) {
            if (displayOptions.fixedLayout === 'true')
                this.rendition.layout ??= 'pre-paginated'
            if (displayOptions.openToSpread === 'false') {
                const firstSection = this.sections.find(section => section.linear !== 'no')
                if (firstSection) firstSection.pageSpread ??=
                    this.dir === 'rtl' ? 'left' : 'right'
            }
        }
        return this
    }
    async loadDocument(item: ManifestItem) {
        const str = await this.loadText(item.href)
        if (str == null) throw new Error(`Failed to load resource: ${item.href}`)
        let doc = this.parser.parseFromString(str, item.mediaType as DOMParserSupportedType)
        if (item.mediaType === MIME.XHTML && (doc.querySelector('parsererror')
        || !doc.documentElement?.namespaceURI)) {
            item.mediaType = MIME.HTML
            doc = this.parser.parseFromString(str, item.mediaType as DOMParserSupportedType)
        }
        return doc
    }
    resolveCFI(cfi: string, filter?: (node: Node) => number) {
        return this.resources.resolveCFI(cfi, filter)
    }
    resolveHref(href: string): ResolvedNavigationTarget | null {
        const [path, hash] = href.split('#')
        const item = this.resources.getItemByHref(decodeURI(path))
        if (!item) return null
        const index = this.resources.spine.findIndex(({ idref }) => idref === item.id)
        return {
            index,
            ...(hash ? { anchor: (doc: Document) => getHTMLFragment(doc, hash) } : {}),
        }
    }
    splitTOCHref(href?: string): [string, string?] {
        const [path = '', hash] = href?.split('#') ?? []
        return [path, hash]
    }
    getTOCFragment(doc: Document, id?: string) {
        return getHTMLFragment(doc, id)
    }
    isExternal(uri: string) {
        return isExternal(uri)
    }
    async destroy() {
        this.#loader?.destroy()
        try {
            await this.#destroySource?.()
        } catch (error) {
            console.warn('Failed to close EPUB source.', error)
        }
    }
}
