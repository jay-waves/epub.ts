# Typography

Typography turns an EPUB HTML document into readable content. It owns book
styles, fonts, semantic enhancement, footnotes, code highlighting, and math
rendering. It does not own navigation, application state, or UI interactions.

The Reader calls `prepareTypography()` for documents mounted by a Renderer.
Typography and Renderer do not import each other.
