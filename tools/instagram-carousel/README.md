# Carousel Studio

Standalone, private-in-the-browser artwork preparation tool. Plain HTML, CSS and
ES-module JavaScript; no installation, build, API, account, tracking or runtime
dependency. The portfolio, its navigation and artwork catalogue are untouched.

## Open

Published path: `https://atamuratkalkan.art/tools/instagram-carousel/`

For local use, serve the repository with a static HTTP server, for example:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000/tools/instagram-carousel/`. Use HTTP rather than
opening `index.html` as a `file://` URL (browser module restrictions apply).

## Use

1. Choose or drop one JPEG, PNG or WebP. EXIF orientation is applied by the browser.
   The initial cover and three-tile sequence are generated automatically, ready
   in Carousel Preview. Grid Preview is shown first for framing.
2. Choose a slide ratio and output width. Custom accepts either a width:height
   ratio or exact pixel dimensions. Every slide gets the same dimensions.
3. Keep the optional independent cover in **Fit** mode to show the entire work.
   The cover is not a grid tile and does not connect to it. Its framing is separate.
4. In **Multi-Row Split**, choose **Columns** and **Rows** (1–10 each, default
   3 × 1). The total updates immediately, including the optional cover. Use
   **Rows: 1** for the original horizontal seamless split, or add rows for a grid.
   Adjust the **whole** master composition in **Grid Preview** with Fit/Crop,
   zoom and position controls. Drag to move, including on touch screens. A zoom
   value below 100% intentionally creates more background; above 100% enlarges.
   Keyboard: focus a preview; arrows move, Shift+arrows move faster, +/− zoom.
5. Pick a background colour, JPEG quality or lossless PNG. Click **Generate
   carousel** after changes. Previous results are cleared so stale files cannot
   accidentally be downloaded. Inspect the actual encoded files by swiping or
   using the carousel arrows/numbered controls.
6. Download the cover, a single tile or all files as one ZIP. Upload the files
   to Instagram in filename order. Without a cover: `01-slide.jpg`,
   `02-slide.jpg`, etc. With a cover: `01-cover.jpg`, `02-slide.jpg`, etc.
   Exports with 100+ files use three-digit padding so filename sorting still
   preserves the sequence (such large sets exceed one Instagram carousel).

### Grid order and previews

Tiles always read **left to right, then top to bottom**. For 3 × 2:

```text
1  2  3
4  5  6
```

No snake/zigzag ordering. Joins within a row are horizontally seamless. Moving
from the last tile of one row to the first of the next intentionally jumps to
the left of a lower part of the painting, not to a horizontally adjoining edge.
Carousel Preview labels the active row/column and explains each row break.
Grid Preview labels tiles with their actual export slide numbers; the cover is
never inserted into the grid. Switching previews preserves framing and exports.

The 20-slide Instagram warning counts the cover. Exceeding it warns without
blocking export; separate canvas memory limits can still require a smaller
resolution. Some accounts/publishing workflows may support fewer slides. Review
the native app guidance at [Instagram carousel help](https://help.instagram.com/269314186824048).
The threshold is the `INSTAGRAM_CAROUSEL_LIMIT` constant in `core.js`.

All processing is local. Image files are not sent to a server, persisted in
browser storage or added to the portfolio. Closing the page discards the work.

## Image quality, seams and limits

- Original proportions are always preserved. **Fit** keeps the entire painting;
  **Crop** fills the selected frame and may omit areas above/below or at the sides.
- Grid export first draws the complete composition on **one master canvas at
  final resolution**: `(slide width × columns)` by `(slide height × rows)`.
  Integer tiles start at `(column × slide width, row × slide height)` and are
  encoded row by row. No per-tile rescaling or reframing occurs; rectangles
  partition both axes with no missing or duplicated pixels.
  The cut guides are a separate UI layer and never appear in downloads.
- Previews in the results area use the exact JPEG/PNG download blobs. Draft
  framing previews use the same geometry at reduced resolution.
- Canvas output uses the browser's sRGB colour conversion. An sRGB source is
  preferable for consistent appearance. This is not a print-colour workflow.
- JPEG is lossy: separate encoding and Instagram recompression can slightly
  change edge colours. PNG preserves exact master pixels; both formats preserve
  exact geometric continuity. Enlarging a low-resolution source cannot create
  real detail; the UI warns when the detail composition upscales it.
- One source up to 80 MB / 100 megapixels. Only one decoded source is retained.
  Large buffers are released after export; blobs/URLs are disposed when replaced.
  Files are encoded sequentially. ZIP uses STORE because images are compressed
  already, reading one file at a time instead of duplicating all image buffers.
- Conservative export limits: 24 million master pixels, 16384 px master edge,
  8192 px slide edge (both master axes are checked). The standard 3 × 3 grid of
  1080 × 1440 slides fits. Larger grids/high resolutions may require a smaller
  output width. Some browsers/devices have lower memory
  limits; reduce resolution if an operation fails.
- The feed warning uses 3:4–1.91:1 and does not prevent exporting other ratios.
  Platform requirements can change. Official reference:
  [Instagram photo resolution](https://help.instagram.com/1631821640426723).
  Review the warning thresholds in `app.js` when platform guidance changes.

## Maintenance & checks

- `index.html`: standalone markup and controls.
- `styles.css`: isolated warm-paper interface and responsive layouts.
- `app.js`: upload lifecycle, interaction, draft/result previews and downloads.
- `core.js`: dimensions, grid coordinates/order, framing, canvas pipeline and filenames.
- `zip.js`: dependency-free standard ZIP writer, with CRC32 integrity checks.
- `tests/core.test.mjs`: Node built-in tests (no packages):
  `node --test tools/instagram-carousel/tests/core.test.mjs` from the repo root.
- `tests/index.html`: open `/tools/instagram-carousel/tests/` through the server
  for browser tests. Synthetic artwork exists only in memory. Tests cover the
  requested ratios, original 2/3/5 horizontal cuts, 3×1/3×2/3×3/2×2 grids with
  and without a cover, JPEG/PNG, ZIP integrity and byte-for-byte reconstruction
  of the PNG master, including every horizontal and vertical seam. Odd tile
  dimensions catch rounding errors; 3×3 is also tested at 1080 × 1440 per tile.
- `tests/ui.html`: browser interaction tests use an isolated copy of the actual
  app in an iframe. They exercise image input and drag/drop (PNG/JPEG/WebP),
  regeneration, zoom/pan controls, file/ZIP downloads, custom ratios, validation,
  row-major carousel navigation, preview switching, cover offsets, the count
  warning, and responsive grid/carousel layout at 1440, 768 and 390 px. The sample
  artwork is generated in memory; no test photos or test state ship in the app.

Deploy by uploading/committing only this directory to the existing GitHub Pages
repository. No changes to root routing or the portfolio are needed. Test on
desktop and mobile after changes; keep processing network-free.

When changing coupled assets, update the `?v=multi-row-1` cache version in the
tool HTML and module imports together so returning visitors receive the new UI
and grid engine consistently. The internal `generateSequence` function still
accepts legacy `count` as a single-row alias; new callers use `columns`/`rows`.
