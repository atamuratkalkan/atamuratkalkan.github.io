# Paint Studio

A browser-local painting companion: upload one reference, select the tubes you
own, generate connected broad-to-detail painting stages, and pick colours for
estimated one-, two- or three-tube recipes. White counts toward the three-tube
limit. Plain HTML/CSS/ES modules; no installation, build, account, API, analytics,
image upload or runtime CDN. Published path: `https://atamuratkalkan.art/paint-studio/`.

## Open & use

Direct path: `/paint-studio/`. The homepage footer links to Paint Studio alongside
Carousel Studio; neither is added to the artwork navigation. The return link is
`../`. All tool assets are relative and work on static GitHub Pages without
rewrites. No tool code is loaded by the homepage. Serve the repository over HTTP
(not `file://`, which blocks ES modules/workers). For an optional local preview:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/paint-studio/`. No terminal is needed for normal use or
future palette edits after the site is published through its normal review flow.

1. Choose/drop a JPEG, PNG or WebP, or try the clearly labelled synthetic bird.
2. Open **My paints**. Uncheck tubes you do not own; edit estimates/identity or
   import your palette. A photo target never becomes an available tube.
3. Set 3–8 visual stages (default 5), detail, simplification and minimum region
   size. The minimum uses pixels in the downscaled analysis, not the full file.
4. **Mark focal detail** and tap small important features before generating.
   Radius is a fraction of the shorter image edge; at most 12 marks. Tap an
   existing mark in that mode to remove it. Generate to apply the change.
5. Browse thumbnails/slider. **Original**, **Current stage** and **New detail**
   are separate sources/views. **Values** changes both display and target.
   Point picks on a stage use its exact displayed region colour. Small-area picks
   average linear-light RGB; radius is in pixels of the sampled source (retained
   reference for Original, 512-edge analysis for stages).
6. Drag to pan, wheel/pinch to zoom; use Fit. Canvas keyboard: arrows pan,
   Shift+arrows pan faster, +/− zoom, 0 fits, Enter/Space picks the view centre.
   **Pick centre** is a labelled alternative. Pointer movement over 6 CSS pixels
   is a drag, not a pick; a pinch never creates a pick.
7. Compare target and predicted mix, alternatives and ΔE OK. Edit whole-number
   parts to recalculate immediately. Save colour notes at their point/stage.
8. To correct a stage: **Merge neighbour**, tap the first region, then a touching
   neighbour. The connected union is locked through later subdivisions and its
   ancestors are merged as needed. Targets, previews, relationships and the
   current recipe update. Undo regenerates without the last correction. Changed
   settings/protection require regeneration; the existing plan stays visible.
9. Save locally, export/import a portable project, export a stage PNG or print a
   reference sheet. Save/export the project to retain unsaved colour notes.

## Model, quantities & honest limits

The pinned, unmodified MIT **Spectral.js 3.0.0** is a pigment-oriented forward
model, not ordinary RGB averaging. It estimates 38 reflectance samples
(380–750 nm) from sRGB using seven basis spectra, then mixes K/S using a
single-constant Kubelka–Munk approximation. These are estimated reflectances,
not measurements of your tubes. See [vendor provenance and licence](vendor/README.md).

Approximate parts are relative **model factors**, not calibrated mass or volume.
Spectral.js internally uses factor² × tinting-strength² × estimated luminance
as optical concentrations. Neutral strength 1 is an assumption, not a measured
equality between different pigments. Transparency is recorded as metadata, not
used to simulate glazing. Future spectra/calibration records are validated and
preserved but currently not interpreted as measured mixer inputs. A swatch photo
alone would not be a spectrophotometer measurement.

The worker enumerates single tubes, pairs on a coarse integer-ratio grid and
triples on a six-part simplex. It refines the best 12 distinct tube sets on finer
integer grids. It evaluates the **simplified displayed ratio**, not a different
ideal ratio. Ranking uses Euclidean OKLab distance ×100 (labelled ΔE OK), plus a
small preference for fewer tubes and simpler parts. It returns up to three
distinct tube-set alternatives. A distance above 5 is labelled **Closest
available mix**. This heuristic is not proof that a target is physically
out-of-gamut, nor is the distance a probability of accuracy. Forward evaluation
and cached tube combinations are deterministic. Paint edits invalidate the bank;
up to 256 target searches are cached within the worker. The palette supports
32 records and up to 32 enabled tubes. The worker remains cancellable and caches
the prepared combinations; using fewer tubes reduces the initial search time.

Real pigment chemistry, brand, strength, scattering, knife loading, ground,
lighting and drying differ. Test a small pile. No exact grams, millilitres,
medium doses, universal drying times, measured brand data or perfect-match
claims are implied.

## How stages work

One deterministic, spatial/perceptual SLIC-like pass makes small superpixels;
four-connected component splitting removes disconnected IDs. Adjacent small
noise regions are merged (marked focal regions are exempt). An edge-aware
region-adjacency hierarchy is then built with a priority queue. A merge joins
only touching connected regions. Colour error, source boundary contrast, size
and focal protection affect the cost. Each stage cuts the **same tree**, with
increasing form counts; it does not independently recluster a new image. Later
regions have an explicit earlier-stage `parentId`. Stable tree IDs are retained
until a manual union needs a new ID. The result is a heuristic painterly guide,
not semantic animal/eye recognition or recovered actual pigment layers.

Focal circles add finer seeds and make feature-to-background merges expensive.
This is a useful bias, not a recognition guarantee. Closely coloured features can
still be simplified; adjust detail/minimum region, enlarge the focal mark, or
compare the Original view. Very small or flat references may have fewer distinct
useful subdivisions. The final stage stays simplified and is never silently
substituted for the original.

Optional first-stage tonal targets use three value bands. Ground foundation uses
the selected ground hue with dark/light tonal variations; it is **not physical
glazing simulation**. The displayed early-stage colours are the recipe targets.
New detail compares consecutive region colours (ΔE OK >3) and newly introduced
boundaries; the rest is pale previous-stage context. Picks use the actual current
stage, not that pale context. It is not a proven physical brushstroke mask.

Manual adjacent unions update every hierarchy cut consistently, including
ancestor unions and descendant locks. Existing saved recipes remain historical
notes when their palette or stage target changes: they are marked **Refresh
required**, never silently relabelled as new results. Opening one re-samples and
searches the current plan; save a new note to keep the updated estimate.

Wet-on-wet, separate sessions and mixed only change working guidance. Visual
stages do not require a dried coat at each step. Follow material manufacturers'
advice for actual films and layering:
[Gamblin](https://gamblincolors.com/underpainting/),
[Winsor & Newton](https://uk.winsornewton.com/blogs/guides/three-oil-painting-rules).

## Images, persistence & safety

JPEG/PNG/WebP, up to 80 MB /100 decoded MP; HEIC/GIF/SVG are rejected. Browser
EXIF orientation and colour-profile conversion are respected. An oriented sRGB
canvas retains up to 2200 px on the long edge; analysis uses up to 512 px. Alpha
is flattened onto warm paper. Samples average in linear sRGB. Portable reference
encoding is lossless PNG so save/restore does not introduce JPEG sample drift.
The source's full-resolution file/EXIF is not retained. Prefer sRGB input; this
is a screen workflow, not colour-managed print proofing. Very large files may
hit a device's decoding/memory limits before the post-decode pixel check.

Projects and the last edited inventory use **only** IndexedDB `ata-paint-studio`
v1, stores `projects` and `preferences`. Other portfolio/Carousel storage is
untouched. Storage failure is visible; portable export remains available.
Browser data is origin-specific and can be cleared/evicted. Existing local
projects are not overwritten unless saving the same project ID. Import/open
replaces the current workspace; save/export first if you need both versions.

`paint-studio-project` v1 JSON includes the normalized reference, paint snapshot,
settings, RLE stage maps/regions/parents, manual corrections, focal points,
pick history and saved recipe snapshots. Imports validate bounds, colour values,
image data-URL types, region maps/areas and parent relationships; the image is
decoded and checked before replacing the current reference. Names are plain
text (`textContent`), never executable HTML. Portable files are limited to 50 MB.
Project files contain your photo: share them only deliberately.

Mix and stage workers yield, cancel obsolete jobs and discard mismatched IDs.
Replacing a photo invalidates both jobs and releases the old canvas. Decoded
bitmaps and fallback image URLs are disposed; download URLs are revoked. Stage
PNG exports are 1600 px long-edge reference diagrams, not new photo detail.
Print/PDF includes every stage and current/saved recipes, or actual searches for
three largest current-stage forms if no colour notes have been selected.

## Add/edit paints using GitHub's web interface

No VS Code or terminal required for routine edits:

1. In the repository, open **paint-studio → data → paints.json**, then the pencil.
2. Copy one paint object in `paints`. Give it a unique simple `id`, your tube's
   `name`, and an estimated six-digit `hex`. Set `enabled` true/false.
3. Add `brand`, `series` and `pigments` only if you know them. Omitted values stay
   unknown. Optionally add `transparency` (`unknown`, `opaque`, `transparent`,
   `semi-transparent`) or an **estimated** `tintingStrength` from 0.1–5.
4. Retain a truthful `provenance`, e.g. `{"kind":"user-estimate","note":"Estimated from my test swatch; not measured spectra."}`.
5. Separate objects with commas; no trailing comma after the last. Do not delete
   the enclosing `paints` array. Use the repository's normal review/commit flow.
6. After publication, a new browser starts with the updated defaults. An existing
   locally edited inventory or saved project's snapshot deliberately takes
   precedence. The exact untouched original generic starter is upgraded to the
   researched palette; any edits prevent automatic replacement. To replace an
   edited inventory, export a backup, then use **My paints → Load researched
   palette → Replace current palette**, or Import an updated palette JSON.
   Saved studies retain their own snapshots. This prevents a default-file edit
   from overwriting your personal tube list.

## Researched starter palette — 19 November 2026

The default inventory contains the 26 colour names supplied by Ata. Nine boesner
Öl Studio identities and Van Gogh Sèvres Blue were confirmed by Ata. Other tube
brands/formulations remain null: their provenance names the closest catalogue
reference, not a confirmed owned product. Colours shared by different brands
remain separate entries (including boesner Echtgelb Zitron and Lemon Yellow).

All colours are uncalibrated website approximations, **not measured tube data**.
For boesner and Winton image swatches, each channel is the median of the central
50% × 50% region after conversion to sRGB. Van Gogh estimates use the product
page's named CSS colour swatches. No external image or service is loaded by the
running app. Each entry preserves its source, swatch URL, method, date and named
reference through palette/project export and import.

- [boesner Öl Studio colour selector](https://www.boesner.com/oel-studio-11044?number=A036666_STK): the nine actual website swatches; pigment codes remain unknown.
- [Winton technical table](https://eu.winsornewton.com/pages/winton-oil-colour) and individual Winton product swatches: named references only where tube identity is unconfirmed.
- [Van Gogh product page](https://www.royaltalens.com/products/van-gogh-oil-colour-tube-60-ml) named CSS swatches and [manufacturer colour chart](https://www.jerrysartarama.com/media/pdfs/royal-talens/van-gogh-oil-color-chart.pdf): Sèvres Blue 530; Phthalo Green 675 and Alizarin Crimson 326 are references with unconfirmed tube brands.

Cerulean Blue, Chrome Green and Vermilion use the named Winton **Hue** references;
those references must not be confused with genuine pigments. Dioxazine is treated
as Dioxazine Blue, following the original list. Alizarin Crimson is **not** silently
substituted with Permanent Alizarin Crimson. Reference pigment codes are kept
separate from the actual `pigments` field unless the tube identity is confirmed.
The mixer still estimates spectra from `hex`; pigment-code records do not change
the optical model. Tinting strength remains the neutral assumption of 1.

Minimal record:

```json
{
  "id": "my-red",
  "name": "My red paint",
  "hex": "#b64536",
  "enabled": true,
  "brand": null,
  "pigments": null,
  "provenance": {"kind": "user-estimate", "note": "Unmeasured screen estimate."}
}
```

This example is an editable format example, not a recommended brand/pigment
measurement. Extensible `calibration` may preserve source/method/note and 38
positive reflectance samples; model integration of such records is future work.

## Modules & checks

Palette update verified on 19 November 2026: 15 Paint Studio core checks and
7 Carousel core regression checks passed. All 15 Paint Studio browser checks
passed in Chromium 157, including actual workers, 26 enabled paints, palette
replacement/cancellation, project and inventory round trips, and responsive
1600/768/390 px layouts. Source links are HTTPS-only. Physical colour accuracy
and real mobile devices are not validated by these screen-based checks.

- `app.js`: UI/file lifecycle, accessible controls, worker orchestration.
- `image.js`, `viewport.js`, `viewer.js`: local decoding, coordinate transforms,
  canvas and pointer/keyboard interaction.
- `color.js`: sRGB/linear/OKLab math and linear sampling.
- `palette.js`, `data/paints.json`: validated tube inventory and provenance.
- `mixing.js`, `mix-worker.js`: forward pigment approximation and bounded search.
- `segmentation.js`, `stage-worker.js`: connected multiscale hierarchy, focal
  protection, manual corrections and change comparison.
- `project.js`, `storage.js`: versioned portable project and separate IndexedDB.
- `exports.js`: stage PNG, downloads and actual recipe reference sheets.
- `styles.css`: isolated tool styling; no homepage style/script imports.

Automated pure-module tests (Node's built-in runner, no packages):

```sh
node --test paint-studio/tests/core.test.mjs
node --test tools/instagram-carousel/tests/core.test.mjs
```

Browser integration tests: open `/paint-studio/tests/` through the same static
server. They use in-memory synthetic fixtures, actual workers and the actual UI;
no sample photographs or fake recipe results are installed in the application.
Re-run before deployment. Browser-specific memory, colour conversion, IndexedDB
and touch behaviour should also be checked on devices you intend to support.

### Verification performed — 17 November 2026

- 12 Paint Studio pure-module tests and 7 existing Carousel core tests passed.
- All 14 Paint Studio browser/UI checks passed in the Codex in-app browser,
  Chromium/Chrome 157 on macOS. They use actual module workers and an iframe of
  the real app at 1600, 768 and 390 CSS px. JPEG/PNG/WebP, EXIF orientation 6,
  4000×3000 input, linear sampling, edited recipes, focal marking, adjacent
  merge/undo, cancellation/stale-job safety, inventory editing, poor matches,
  IndexedDB and portable project round trips, PNG encoding, invalid imports and
  print-sheet content were exercised. Test downloads/print are captured by the
  runner; an OS print/PDF dialog was not automated. Test state is cleaned up.
- Existing Carousel browser canvas/export checks (14) and UI checks (14) passed.
- Manually opened an existing oil-painting reference through the real file
  chooser and inspected its actual five-stage hierarchy and estimated mix.
  Checked the uncached homepage footer entry, return link, gallery viewer
  next/previous controls, Escape and focus return. Gallery scripts/styles/data
  and Carousel source hashes are unchanged by this addition.
- Pointer pinch/pan were simulated in Chromium; **real iOS/Android touch devices,
  Safari and Firefox were not tested**. Cross-browser/device verification remains
  a normal pre-publication check. These checks were completed locally before
  the subsequent, user-approved GitHub Pages publication.
