# EPUB Viewer Extension

Chrome MV3 EPUB reader extension built with `pnpm`, `Vite`, `TypeScript`, and `foliate-js`.

## Features

- Redirects top-level `file://...epub` navigation into the extension reader.
- Opens local EPUB files inside the extension page.
- Supports direct file navigation, file picker, and drag-and-drop.
- Persists reading position and reader preferences locally.
- Uses `foliate-js` as the rendering engine.

## Local Commands

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm package
```

`pnpm build` generates an unpacked extension in `dist/`.

`pnpm package` builds the extension and creates a release ZIP in `release/`, for example `release/epub-viewer-extension-v0.1.0.zip`.

## Load In Chrome

### Unpacked build

1. Run `pnpm build`.
2. Open `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select the generated `dist` directory.
6. Open the extension details page and enable `Allow access to file URLs`.

### Release ZIP

1. Download the latest ZIP from the repository's GitHub Release page.
2. Extract it locally.
3. Open `chrome://extensions`.
4. Enable `Developer mode`.
5. Click `Load unpacked`.
6. Select the extracted folder.
7. Enable `Allow access to file URLs`.

## Release Flow

The repository includes a GitHub Actions workflow that packages the extension and uploads the ZIP to a GitHub Release.

1. Update `package.json` version.
2. Commit and push.
3. Create and publish a GitHub Release for the matching tag such as `v0.1.0`.
4. GitHub Actions will run `pnpm package` and attach the generated ZIP to that Release.

The extension `manifest.json` version is synced automatically from `package.json` during build, so the version only needs to be maintained in one place.

## How It Works

- The background service worker installs a dynamic `declarativeNetRequest` rule.
- Requests matching `file://...epub` or `https://...epub` are redirected to `viewer.html?src=<original-file-url>`.
- The viewer page passes that source URL to `foliate-view`.

## Notes

- `Allow access to file URLs` is required, otherwise Chrome will block local EPUB access.
- `dist/`, `release/`, and ZIP artifacts are treated as generated output and should not be committed.
- The project targets modern Chrome and Manifest V3.
