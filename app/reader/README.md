# Reader

Reader is the application layer. It composes EPUB parsing, Renderer, and
Typography, and owns navigation, settings, persistence, input, and UI.

- `reader-app.ts`: application composition and lifecycle
- `annotation.ts`: annotation interaction and rendering
- `annotation-overlay.ts`: annotation SVG and hit targets
- `annotation-repository.ts`: indexed local annotation working set
- `interactions.ts`: rendered-content event delegation, links, and context routing
- `ui/`: React components and application styles
- the remaining modules: reader state, navigation, settings, and services

Dependencies point from Reader to Renderer and Typography. Neither lower layer
depends on Reader.
