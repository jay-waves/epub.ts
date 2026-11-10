# Reader

Reader is the application layer. It composes EPUB parsing, Renderer, and
Typography, and owns navigation, settings, persistence, input, and UI.

- `reader-app.ts`: application composition and lifecycle
- `context-menu/`: text and media menus, copy/translation actions, and annotation handling
- `interactions.ts`: rendered-content event delegation, links, and context routing
- `rendered-content.ts`: mounted content lifecycle subscriptions
- `ui/`: React components and application styles
- the remaining modules: reader state, navigation, settings, and services

Dependencies point from Reader to Renderer and Typography. Neither lower layer
depends on Reader.

Renderer relocation uses a section-bound `ReadingPosition`. Reader converts its
Range to an exact CFI when possible and always keeps whole-book progress as the
fallback. Saved positions restore in that order; a missing Range must not be
replaced with a section-start CFI.

Reflow and mode changes retain the logical reading edge; only user movement
samples a new edge. Restoration aligns that edge to the first visible column
or the top reading inset (clamped at book boundaries). Active navigation keeps
an already visible target in place. Geometry measurement uses a copy
of the anchor Range. CFI persistence uses its collapsed start, and mode changes
fall back to the current section fraction when no exact CFI is available.

## Input ownership and navigation boundaries

Input routing has two stages. OverlayInput first excludes reader gestures while
an overlay owns input and consumes the gesture that dismisses it. For content,
semantic ownership is resolved before page movement: editable/native controls,
links, annotations, zoomable images, then ordinary content. Generic focusability
is a fallback control classification; it must not hide a link's semantics.
Pointer claims retain the strongest owner until the gesture ends.

Text selection takes priority over mouse page gestures. A secondary press with
an existing selection goes to the context menu, without starting a page drag.
Primary selection movement suppresses the following click. Double-click handling
cancels a pending single-click page turn. Renderer selection-edge following is
limited to an active primary selection in the current document; delayed work
must not survive release, cancellation, context menu, or loss of focus.

Input converts spatial directions into reading-order commands. Navigation resolves
CFI, links, and book progress into section targets and delegates layout decisions
to Renderer. Renderer transactions serialize movement and exclude cache commits;
waiting tasks recheck ownership after waking because completion may start another
transaction. Relocation is the commit boundary for progress and persistence, not
an animation-frame notification. Direct scrolling supersedes animated and queued
scroll navigation. Cache expansion may change physical offsets while preserving
the same CFI; position checks must compare semantic anchors, not track pixels.
Mode switching transfers a semantic target to
the prepared renderer before replacing the active renderer.

Run the focused browser pipeline check with an existing dev server:
`node tests/browser-navigation.mjs` (`EPUB_TEST_URL` overrides localhost:5173).
It uses global Playwright and system Chrome, with generated chapter documents,
and checks chapter navigation, page movement, and exact CFI round trips through
both reflowable modes, resize preservation, selection gesture lifetime, and
direct scrolling during animation, and cancellation while loading the next
cache window. It complements unit tests; it does not cover every EPUB's
writing mode or delayed resource layout.

## Search

Each text query compiles its Segmenter, Collator, and normalized needle once.
The matcher streams DOM text through a query-sized window, preserving cross-node,
Unicode grapheme, overlapping-match, and whitespace normalization behavior.
`find` exposes synchronous ranges for renderer anchors; `scan` also exposes batch
checkpoints so book search can yield after its time slice and honor cancellation,
even when a long chapter has no matches. Document parsing and individual platform
segmentation calls remain synchronous; this is cooperative scheduling, not a worker.

Source documents provide persistent CFIs. Rendered documents are searched separately
because typography can change their structure. All anchors from one query share a
WeakMap of at most 200 matching ranges per rendered document. Anchors return clones;
selection cannot mutate the cache. Reloaded documents are new keys, and clearing a
query removes its decorations and releases its query-scoped cache. Reader-owned
rendered text is assumed stable after enhancement; this is not a live editable-text index.

`node tests/browser-search.mjs` against the dev server checks matching semantics,
scan reuse, range isolation, document replacement, result limits, cancellation during
loading and long scans, and disposal. It uses global Playwright with system Chrome.
