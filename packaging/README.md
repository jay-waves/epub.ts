# Packaging

Native packages have no publisher certificate signatures (macOS uses ad-hoc
signing). They install the launcher and file
association, while reader data remains in the per-user application data directory.
Platform packages own installation and file associations. The macOS app also
provides commands to manage its bundled login agent. Portable launchers provide only `purge`
for explicitly deleting the current user's reader data.

## Automated releases

Set GitHub Settings → Pages → Build and deployment → Source to **GitHub Actions**
(the old `gh-pages` branch is no longer used). Commit all changes, run local
`pnpm check`, then run `./scripts/release.sh v0.8.1` for the version in
`package.json`. Matching tags with hyphen or dot suffixes such as `v0.8.1-test` and
`v0.8.1.betaxxx` are also
accepted and run the same publishing flow. `GITHUB_TOKEN` is optional when Git
already has push credentials. The script pushes the branch and version tag;
it does not build or deploy locally.

Actions builds the web reader once and shares it with Debian, Fedora, Windows
x64 and Apple Silicon macOS packaging jobs. Linux builds the Windows installer
with Go, `rsrc`, and NSIS. Native jobs need only Node built-ins, Go and platform
packaging tools. Windows verifies installation, daemon startup, upgrade and
uninstall on the disposable runner. After all four installers pass,
the workflow uploads them to a rolling Release (`v0.8-latest` for 0.8.x;
`v1-latest` for 1.x). Permanent version tags remain unchanged. New assets are
uploaded before old assets are removed; failed uploads can be retried. Older
versions and ancestor tags cannot overwrite a newer published version, and
divergent histories are rejected. The highest series is marked Latest and
also deploys GitHub Pages; maintenance updates to older series do neither.
Do not enable immutable releases or protect rolling tags against workflow updates.

A manual workflow run builds packages without publishing or deploying Pages.
Only the frontend job installs pnpm dependencies. Local packaging remains
available and reuses `release/web` after `pnpm compile`. The Linux packaging job
also installs `rsrc` and NSIS to cross-build the Windows installer.

Native installer filenames use `epub-ts-<version>-<triplet>.<extension>`:

- `epub-ts-<version>-x86_64-unknown-linux-gnu.deb`
- `epub-ts-<version>-x86_64-unknown-linux-gnu.rpm`
- `epub-ts-<version>-x86_64-pc-windows.exe`
- `epub-ts-<version>-aarch64-apple-darwin.dmg`

Versions come from `package.json`. The Go-built Windows launcher uses no
compiler ABI suffix. The shared web build preserves its timestamp and embeds
it as the launcher's build ID.

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

Windows packages can be cross-built on Linux with Go, `rsrc`, and NSIS.
Install the resource compiler with `go install github.com/akavel/rsrc@v0.10.2`
and NSIS with `sudo apt install nsis`. Run `pnpm package:windows` after
`pnpm compile`. CI verifies installation, upgrade, and uninstall on a Windows
runner. NSIS uses a traditional x86 installer bootstrap to install the 64-bit
launcher into `%ProgramFiles%`. Set `EPUB_TS_RSRC` and `EPUB_TS_MAKENSIS` when
the tools are installed outside `PATH`.

The all-users installer requests administrator permission, writes to
`%ProgramFiles%\epub.ts`, registers the EPUB file association, and appears in
Windows Installed Apps. Upgrade and uninstall stop the current user's daemon
first. Uninstall leaves every user's reader data intact.

Automatic daemon startup is opt-in. Select **Start background service at login**
on the installer's Installation options page to create a shortcut in the all-users
Startup folder. It runs the GUI executable directly with `daemon`,
without a CMD script or a browser window. Upgrades preserve the existing choice;
unchecking the option removes the shortcut, and uninstall removes it too.
Silent installs accept `/AUTOSTART=1` or `/AUTOSTART=0` before the final `/D=...`
argument. Remove any startup CMD scripts previously copied into `shell:startup`
manually; those user-owned copies are not managed by the installer.

## macOS

Run `pnpm package:macos` on Apple Silicon macOS after `pnpm compile` to build the
arm64 application and disk image. Intel macOS is intentionally unsupported.

The app requires macOS 13 or later. The app bundle and DMG packaging step runs
only on macOS and uses Xcode Command Line Tools (`xcrun swiftc`), plus the system
`codesign`, `plutil`, `sips`, `iconutil`, `ditto`, and `hdiutil` commands; there is no third-party
packaging dependency. Linux DMG writers are intentionally unsupported because
they do not provide the same compatibility guarantees. Override the `hdiutil`
path with `EPUB_TS_HDIUTIL` when necessary.

The resulting `epub.ts.app` and DMG have no Developer ID signature and are not
notarized. Packaging ad-hoc signs the launcher and app bundle for ServiceManagement.
The app bundle declares EPUB metadata in `Info.plist`; macOS owns
application discovery and file-association registration when the app is copied
to or launched from `/Applications`.

After copying the app to `/Applications`, opt into login startup with:

```sh
/Applications/epub.ts.app/Contents/MacOS/epub.ts autostart enable
/Applications/epub.ts.app/Contents/MacOS/epub.ts autostart status
/Applications/epub.ts.app/Contents/MacOS/epub.ts autostart disable
```

The native app entry point uses Apple's `SMAppService` to register the LaunchAgent
inside `Contents/Library/LaunchAgents`; it does not copy a plist into the user's
Library or use `launchctl`. If macOS requires approval, `enable` opens Login Items
in System Settings and reports `requires-approval`. Status reports `enabled`,
`disabled`, `requires-approval`, or `not-found`. The agent runs only `daemon`,
without opening the viewer. Disable it before removing or moving the app.
Disabling unregisters the agent; use `epub.ts stop` to stop an independently
started, on-demand daemon if needed. Login registration is per user and is not
enabled by packaging or by opening an EPUB.
