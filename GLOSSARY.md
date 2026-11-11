# Glossary

## Publications and resources

| Term | Meaning |
| --- | --- |
| EPUB | ZIP publication containing a package manifest, ordered content, and resources. |
| Spine | Ordered list of publication sections, with optional non-linear entries. |
| Section | One spine item and its document; not necessarily a printed chapter or page. |
| `Book` | Parsed publication, metadata, section loaders, navigation data, and resource ownership. |
| `PlatformDocument` | Opened file or URL with platform-specific saving and release capabilities. |
| Resource URL | Blob URL for extracted or rewritten publication data; not a stable reading location. |
| Pin | Reference keeping an active section's resource tree from being evicted. |

## Rendering and navigation

| Term | Meaning |
| --- | --- |
| Reader | Application layer composing publication loading, typography, rendering, input, and persistence. |
| Typography | Content and style enhancement: fonts, semantics, tables, images, code, and math. |
| `ReaderView` | View that creates and replaces the active renderer and manages decorations. |
| Renderer | Paginated, scrolled, or fixed-layout implementation of document layout and navigation. |
| `SectionFrame` | One mounted reflowable section iframe and its layout measurements. |
| `ReflowableSpine` | Shared loading, style application, and section-window lifecycle for reflowable renderers. |
| `SpineBuffer` | Staged and committed section-window membership, with generation/revision checks. |
| Track | Geometry of the mounted sections in a continuous column or scroll layout. |
| `ReadingPosition` | Section index, section fraction, and optional live DOM Range. |
| CFI | EPUB Canonical Fragment Identifier for a position in publication content. |
| Book fraction | Whole-book progress derived from section sizes; a fallback, not a pixel offset. |
| Reading edge | Logical start of the visible reading area, respecting writing direction. |
| Reflow | Recalculate layout after size, font, style, or resource changes. |
| `relocate` | Committed reading-position event consumed by progress and persistence. |
| `contentExtent` | Readable track extent used for navigation boundaries. |
| `physicalExtent` | DOM track extent including trailing alignment space. |
| Column / screen | Minimum paginated step / current visible set of columns or scroll viewport. |

## State and platform

| Term | Meaning |
| --- | --- |
| Overlay | Annotation or search decoration; also used for UI popovers that claim input. |
| Navigation revision | Ownership token used to reject work from superseded navigation. |
| Book generation | Identity of the current open-book session; prevents old save results from clearing new state. |
| Save revision | Edit state captured by a save; later edits remain unsaved after that save completes. |
| Launcher | Go desktop executable and local service serving the web reader and local files. |
| Platform adapter | Browser, extension, or desktop implementation of files, settings, and external actions. |

See [rendering design](RENDERING.md) for ownership and lifecycle rules, and
[development](AGENTS.md) for tooling and release workflows.
