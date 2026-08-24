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
