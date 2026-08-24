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
- `/usr/lib/systemd/user/epub.ts.service`

Removing a package leaves per-user reader data intact.

The daemon remains on-demand by default. To start it automatically for the
current user:

```sh
systemctl --user enable --now epub.ts.service
```

Disable it with `systemctl --user disable --now epub.ts.service` before removing
the package.

## Windows

[NSIS](https://nsis.sourceforge.io/) and a Windows launcher cross-build
toolchain are required. Both run on Linux. Run `pnpm package:windows` after
`pnpm compile`.

Install NSIS on Debian/Ubuntu with `sudo apt install nsis`, or on Fedora with
`sudo dnf install mingw32-nsis`. NSIS uses a traditional x86 installer
bootstrap to install the 64-bit launcher into `%ProgramFiles%`. Set
`EPUB_TS_MAKENSIS` when `makensis` is
installed outside `PATH`.

The all-users installer requests administrator permission, writes to
`%ProgramFiles%\epub.ts`, registers the EPUB file association, and appears in
Windows Installed Apps. Upgrade and uninstall stop the current user's daemon
first. Uninstall leaves every user's reader data intact.

Automatic daemon startup is opt-in. Copy
`%ProgramFiles%\epub.ts\epub.ts-startup.cmd` into the folder opened by
`shell:startup` for the current user. Remove that copied script to disable it.
