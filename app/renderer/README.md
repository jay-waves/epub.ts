# Renderer

The EPUB rendering core used by this application.

It owns pagination, fixed-layout frames, rendered-document events, and range
decorations and overlays. Book loading, CFI, navigation, progress,
interaction policy, and document lifecycle live elsewhere under `app/`.

`viewport-navigation.ts` is the positioning core shared by the paginator's
TOC jumps, progress seeks, page turns, and gesture settling. It owns navigation
transactions and the conversion from logical section anchors to physical
viewport coordinates; `paginator.js` supplies DOM measurements and rendering.

`chapter-window.ts` owns the ordered set of loaded chapters, load de-duplication,
stale-load invalidation, and disposal. `visible-location.ts` turns a viewport
snapshot into the active chapter, visible range, and section-relative progress.
`scrolled-viewport.ts` owns scroll-mode target projection and throttled
reading-edge sampling, keeping full DOM range scans out of the scroll hot path.

The JavaScript renderer started as a trimmed copy of
[`johnfactotum/foliate-js`](https://github.com/johnfactotum/foliate-js).
Its original license is preserved in `LICENSE.txt`.
