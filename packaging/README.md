# Packaging

Native packages are intentionally unsigned. They install the launcher and file
association, while reader data remains in the per-user application data directory.
The launcher itself does not install or uninstall platform integration; each
platform package owns that lifecycle. Portable launchers provide only `purge`
for explicitly deleting the current user's reader data.

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

## macOS

Run `pnpm package:macos` on Apple Silicon macOS after `pnpm compile` to build the
arm64 application and disk image. Intel macOS is intentionally unsupported.

The app bundle and DMG packaging step runs only on macOS and uses the system
`sips`, `iconutil`, `ditto`, and `hdiutil` commands; there is no third-party
packaging dependency. Linux DMG writers are intentionally unsupported because
they do not provide the same compatibility guarantees. Override the `hdiutil`
path with `EPUB_TS_HDIUTIL` when necessary.

The resulting `epub.ts.app` and DMG have no Developer ID signature and are not
notarized. The packaging script does not invoke `codesign`; the Go linker may
add the minimal ad-hoc signature structure required for an Apple Silicon
executable. The app bundle declares EPUB metadata in `Info.plist`; macOS owns
application discovery and file-association registration when the app is copied
to or launched from `/Applications`.
