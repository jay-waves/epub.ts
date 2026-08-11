# foliate-js

Vendored and trimmed copy of `johnfactotum/foliate-js` for this EPUB extension.

This copy keeps only the runtime files used by the app:

- EPUB package parsing and resource loading
- paginated and fixed-layout renderers
- search helpers and an Overlay compatibility entry point

Removed from this fork: PDF, TTS, MOBI/AZW3, FB2, CBZ, OPDS, dictionaries, quote images, demo reader, tests, and upstream build/package metadata.

Original project: https://github.com/johnfactotum/foliate-js

EPUB file loading, CFI, navigation, progress, reader interactions, and the
Overlay implementation are owned by the application under `app/`. The Overlay
compatibility module keeps the original `Overlayer` export available.
