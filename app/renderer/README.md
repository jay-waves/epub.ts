# Renderer

The EPUB rendering core used by this application.

It owns pagination, fixed-layout frames, rendered-document events, and range
decorations and overlays. Book loading, CFI, navigation, progress,
interaction policy, and document lifecycle live elsewhere under `app/`.

The JavaScript renderer started as a trimmed copy of
[`johnfactotum/foliate-js`](https://github.com/johnfactotum/foliate-js).
Its original license is preserved in `LICENSE.txt`.
