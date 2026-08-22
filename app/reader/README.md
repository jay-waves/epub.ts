# Reader

Reader is the application layer. It composes EPUB parsing, Renderer, and
Typography, and owns navigation, settings, persistence, features, input, and UI.

- `reader-app.ts`: application composition and lifecycle
- `features/`: user-facing reading features
- `ui/`: React components and application styles
- the remaining modules: reader state, navigation, settings, and services

Dependencies point from Reader to Renderer and Typography. Neither lower layer
depends on Reader.
