# Packaging

Native packages are intentionally unsigned. They install the launcher and file
association, while reader data remains in the per-user application data directory.

## Chrome

`packaging/chrome/` contains the extension-only manifest and service worker.
Run `pnpm package:chrome` after `pnpm compile`.

## Linux

[nFPM](https://nfpm.goreleaser.com/) is required. Run `pnpm package:linux`
after `pnpm compile` to create both packages, or use `pnpm package:deb` and
`pnpm package:rpm` separately.

The packages install:

- `/usr/bin/epub.ts`
- `/usr/share/applications/epub.ts.desktop`
- `/usr/share/icons/hicolor/128x128/apps/epub.ts.png`

Removing a package leaves per-user reader data intact.

## Windows

[Inno Setup](https://jrsoftware.org/isinfo.php) and a Windows launcher build
toolchain are required. Run `pnpm package:windows` after `pnpm compile`.

The per-user installer writes to `%LocalAppData%\Programs\epub.ts`, registers
the EPUB file association, and appears in Windows Installed Apps. Upgrade and
uninstall stop the daemon first. Uninstall leaves reader data intact.
