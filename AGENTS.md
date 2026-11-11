# Repository instructions

## Language and documentation

- Use English.
- Keep documentation concise and maintain it only in code comments or these root
  files: `README.md` (usage), `GLOSSARY.md` (terms), `RENDERING.md` (rendering design),
  and `AGENTS.md` (instructions and workflows). Do not create a `docs/` directory
  or additional documentation files.
- `RENDERING.md` is the sole authoritative rendering design source. Read it before
  changing the pipeline and update it in the same change. Do not duplicate its
  design rules elsewhere.
- Keep development, testing, packaging, and release workflows here. Keep historical
  audit results in commit/PR descriptions, not additional documentation files.

## Development and testing

- Requires Node.js 24+ and pnpm 12 (`corepack install --global pnpm@12.3.4`).
  Run `pnpm install`, then `pnpm dev`. In WSL use `pnpm dev:wsl` and open or
  forward `http://localhost:5174`. Choose or drop an EPUB; no native service or
  packaging is needed for frontend work.
- Prefer low-cost, targeted checks using existing tools and environments.
  `pnpm check` runs type checking and Node tests; use `node --test <test-file>`
  for focused coverage. Run only relevant Go tests with `go test ./desktop -run <pattern>`.
- Browser scripts are ad hoc local integration checks, not release gates. Never
  add them to release CI/CD or the default test/build commands.
- Run browser checks only when needed: start a Vite dev server, then use
  `pnpm test:browser <check-or-suite>`. `--list` shows choices; no arguments runs
  smoke (navigation). Select the smallest scope. Each check times out after 180 seconds.
- `EPUB_TEST_URL` defaults to `http://127.0.0.1:5173`; set it to port 5174 for WSL.
  Static preview is insufficient because these checks import source modules.
  `navigation` covers mode switches, CFI restoration, resize, selection lifetime,
  and cancelled navigation; `search` covers matching, cache isolation, cancellation,
  and disposal; `popovers` covers positioning, resizing, dismissal, and input release.
- Reuse global Playwright at `/home/jay-waves/.local/lib/node_modules/playwright`
  and system Chrome via `chromium.launch({ channel: "chrome" })`. Do not add
  Playwright to the project. Do not download browsers or reinstall Playwright
  without user approval.
- The existing archive, annotation, save-state, and release tests cover different
  boundaries. Unit tests do not prove file-picker or native installer behavior;
  generated browser fixtures do not cover every EPUB or delayed resource layout.
- The development console exposes `epub.settings`, including `fonts`,
  `textAlignment`, `setSerifFont`, `setSansFont`, `setMonoFont`,
  `setTextAlignment("auto" | "start" | "justify")`, and `reset()`.

## Tools and packaging

- Keep packaging/release tools in `scripts/`, manual browser integration scripts
  in `tests/browser/`, shared fixtures/helpers in `tests/support/`, and manual
  diagnostics in `tools/diagnostics/`. Reuse existing helpers before adding files.
  Diagnostics are not test gates.
- Run `pnpm compile`, then `pnpm package:chrome`, `pnpm package:linux`,
  `pnpm package:windows`, or `pnpm package:macos`. Native builds need Go 1.27+;
  Linux packages need nFPM, Windows needs NSIS and rsrc v0.10.2, and macOS needs
  Apple Silicon and Xcode Command Line Tools. Linux can cross-build Windows.
- `node packaging/build.mjs <chrome|linux|windows|macos>` is the packaging entry.
  Append `deb`/`rpm` for one Linux package or `binary` for a native service only.
  Do not build the same output concurrently in one worktree.
- Platform jobs reuse `release/web`; embedded assets and Windows resources are
  generated in isolated temporary workspaces and cleaned on success or failure.
  Preserve the web build timestamp as part of the native build identity.
- Custom tool paths use `EPUB_TS_GO`, `EPUB_TS_NFPM`, `EPUB_TS_RSRC`,
  `EPUB_TS_MAKENSIS`, and `EPUB_TS_HDIUTIL`. Local nFPM can be installed with
  `go install github.com/goreleaser/nfpm/v2/cmd/nfpm@v2.43.4`; rsrc uses
  `go install github.com/akavel/rsrc@v0.10.2`. Put Go's bin directory in `PATH`.
- macOS packaging uses system signing/image tools and ad-hoc signs the launcher
  and app for ServiceManagement. It supplies no Developer ID signature or
  notarization. Regenerate icons only when branding changes.

## Releases

- Run `pnpm check` and `pnpm compile`, commit changes, then
  `bash scripts/release.sh vVERSION` matching `package.json`. Hyphen or dot
  suffix tags are also supported. Existing SSH/HTTPS Git credentials are used;
  optional `GITHUB_TOKEN` applies only to GitHub HTTPS pushes.
- The script atomically pushes branch and tag. CI builds the web reader once,
  packages Linux, Windows, and macOS, verifies Windows install/upgrade/uninstall
  and macOS login registration, then publishes through `scripts/publish-release.sh`.
  Browser checks stay local. Manual workflow runs build and verify without publishing.
- Linux CI downloads pinned nFPM binaries and verifies the archive SHA-256;
  update the version and digest together in `.github/workflows/release.yml`.
- Installer names use `epub-ts-<version>-<triplet>.<extension>`: Linux x64
  `deb`/`rpm`, Windows x64 `exe`, and Apple Silicon macOS `dmg`. Chrome ZIPs are
  a local build option. Artifacts expire after one day; rerun all jobs if needed.
- GitHub Pages must use GitHub Actions and allow version tags in its environment.
  Release jobs need contents write permission. Rolling tags use `v0.MINOR-latest`
  for 0.x and `vMAJOR-latest` for 1.x+. Permanent version tags remain unchanged.
  Do not enable immutable Releases or protect rolling tags against workflow writes.
- Uploads precede old-asset removal; rerun interrupted jobs to finish updates.
  Older versions cannot replace newer releases; divergent histories are rejected.
  Only the highest series updates Latest and deploys Pages.
