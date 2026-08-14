# Renderer

The reader exposes exactly three renderer identities:

- `paginated/PaginatedRenderer` owns paginated reflowable presentation.
- `scrolled/ScrolledRenderer` owns continuous reflowable presentation.
- `fixed/FixedRenderer` owns pre-paginated and fixed-layout presentation.

`ReaderView` selects and atomically swaps these renderers. A renderer's mode is
fixed for its lifetime; switching mode creates a new renderer and transfers the
stable reading target, styles, and reusable book resources.

The folders reflect implementation ownership:

- `paginated/` contains column geometry and paginated renderer entry points.
- `scrolled/` contains scroll sampling, anchor projection, and its renderer.
- `fixed/` contains the fixed-layout renderer.
- `shared/` contains mode-neutral mechanisms only: section frames, spine
  buffering and projection, navigation transactions, visible-location
  resolution, overlays, and coordinate types.

`SectionFrame` owns one loaded reflowable spine iframe, including document
lifecycle, layout application, measurement, media constraints, overlay
geometry, and range projection. Reader styles and content enhancement enter
through hooks and remain outside the frame.

The JavaScript renderer started as a trimmed copy of
[`johnfactotum/foliate-js`](https://github.com/johnfactotum/foliate-js).
Its original license is preserved in `LICENSE.txt`.
