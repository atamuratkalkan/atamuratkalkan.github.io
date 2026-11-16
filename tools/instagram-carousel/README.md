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
   The initial cover and three-detail sequence are generated automatically.
2. Choose a slide ratio and output width. Custom accepts either a width:height
   ratio or exact pixel dimensions. Every slide gets the same dimensions.
3. Keep the optional independent cover in **Fit** mode to show the entire work.
   The cover does not connect to the panorama. Its framing is separate.
4. Choose 2–10 detail slides. Adjust the **whole** panorama with Fit/Crop,
   zoom and position controls. Drag to move, including on touch screens. A zoom
   value below 100% intentionally creates more background; above 100% enlarges.
   Keyboard: focus a preview; arrows move, Shift+arrows move faster, +/− zoom.
5. Pick a background colour, JPEG quality or lossless PNG. Click **Generate
   carousel** after changes. Previous results are cleared so stale files cannot
   accidentally be downloaded. Inspect the actual encoded files by swiping or
   using the carousel arrows/numbered controls.
6. Download the cover, a single detail or all files as one ZIP. Upload the files
   to Instagram in filename order. Without a cover the first detail is `01`.

All processing is local. Image files are not sent to a server, persisted in
browser storage or added to the portfolio. Closing the page discards the work.

## Image quality, seams and limits

- Original proportions are always preserved. **Fit** keeps the entire painting;
  **Crop** fills the selected frame and may omit areas above/below or at the sides.
- Detail export first draws the entire panorama on **one master canvas at final
  resolution**, then cuts integer, non-overlapping ranges `[i*w, (i+1)*w)`.
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
  8192 px slide edge. All ten standard 1080 × 1440 detail slides fit. Higher
  resolutions may require fewer slides. Some browsers/devices have lower memory
  limits; reduce resolution if an operation fails.
- The feed warning uses 3:4–1.91:1 and does not prevent exporting other ratios.
  Platform requirements can change. Official reference:
  [Instagram photo resolution](https://help.instagram.com/1631821640426723).
  Review the warning thresholds in `app.js` when platform guidance changes.

## Maintenance & checks

- `index.html`: standalone markup and controls.
- `styles.css`: isolated warm-paper interface and responsive layouts.
- `app.js`: upload lifecycle, interaction, draft/result previews and downloads.
- `core.js`: dimensions, framing, canvas pipeline and filenames.
- `zip.js`: dependency-free standard ZIP writer, with CRC32 integrity checks.
- `tests/core.test.mjs`: Node built-in tests (no packages):
  `node --test tools/instagram-carousel/tests/core.test.mjs` from the repo root.
- `tests/index.html`: open `/tools/instagram-carousel/tests/` through the server
  for browser tests. Synthetic artwork exists only in memory. Tests cover the
  requested ratios, 2/3/5 cuts, a cover + 3 details, JPEG/PNG, ZIP integrity and
  byte-for-byte reconstruction of the PNG panorama, including every seam.
- `tests/ui.html`: browser interaction tests use an isolated copy of the actual
  app in an iframe. They exercise image input and drag/drop (PNG/JPEG/WebP),
  regeneration, zoom/pan controls, file/ZIP downloads, custom ratios, validation,
  carousel navigation, and responsive layout at 1440, 768 and 390 px. The sample
  artwork is generated in memory; no test photos or test state ship in the app.

Deploy by uploading/committing only this directory to the existing GitHub Pages
repository. No changes to root routing or the portfolio are needed. Test on
desktop and mobile after changes; keep processing network-free.
