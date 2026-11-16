import { dimensions, validateSequence, geometry, drawComposition, generateSequence } from "./core.js";
import { makeZip } from "./zip.js";

const $ = id => document.getElementById(id);
const state = {
  source: null, sourceURL: null, files: [], busy: false, loadToken: 0,
  cover: { mode: "fit", zoom: 1, x: 0, y: 0 },
  detail: { mode: "fill", zoom: 1, x: 0, y: 0 },
  settings: null, geometryKey: "", active: 0, frame: 0, controller: null,
  downloadURLs: new Set()
};

function error(message = "") {
  $("error").textContent = message;
  $("error").hidden = !message;
}

function releaseResults() {
  for (const file of state.files) URL.revokeObjectURL(file.url);
  state.files = [];
  $("results").hidden = true;
  $("carousel").replaceChildren();
  $("slide-list").replaceChildren();
  $("carousel-dots").replaceChildren();
}

function dirty() {
  if (state.files.length) releaseResults();
  if (state.source) $("status").textContent = "Framing updated. Generate the carousel to preview and download these settings.";
  $("generate").textContent = "Generate carousel";
}

function readSettings() {
  const size = dimensions({
    preset: $("preset").value, customKind: $("custom-kind").value,
    customWidth: $("custom-width").value, customHeight: $("custom-height").value,
    outputWidth: $("resolution").value === "custom" ? Number($("output-width").value) : Number($("resolution").value)
  });
  return { ...size, count: Number($("detail-count").value), includeCover: $("include-cover").checked,
    background: $("background").value, format: $("file-format").value, quality: Number($("quality").value) / 100 };
}

function updateSettings() {
  const custom = $("preset").value === "custom";
  const pixels = custom && $("custom-kind").value === "pixels";
  $("custom-fields").hidden = !custom;
  $("resolution").disabled = pixels || state.busy;
  $("resolution-custom").hidden = pixels || $("resolution").value !== "custom";
  $("custom-help").textContent = pixels ? "Exact output dimensions in pixels, shared by every slide." : "Enter a ratio, for example 3 × 4. Resolution sets the pixel size.";
  $("custom-width").step = $("custom-height").step = pixels ? "1" : "any";
  $("quality").disabled = $("file-format").value === "image/png" || state.busy;
  $("quality-value").textContent = `${$("quality").value}%`;
  $("background-value").textContent = $("background").value;
  $("cover-panel").hidden = !$("include-cover").checked;
  $("ratio-warning").hidden = true;
  $("size-error").hidden = true;
  let valid = false;
  try {
    state.settings = readSettings();
    const { width, height, ratio, count } = state.settings;
    $("dimensions").textContent = `${width} × ${height} px per slide`;
    $("master-dimensions").textContent = `${width * count} × ${height} px · ${count} cuts`;
    // Feed guidance, not an export restriction. See the maintenance README.
    if (ratio < 0.75 - 0.0001 || ratio > 1.91 + 0.0001) {
      $("ratio-warning").textContent = "Outside Instagram’s usual feed range (3:4 to 1.91:1). Instagram may crop this format; you can still export it here.";
      $("ratio-warning").hidden = false;
    }
    const key = `${width}/${height}/${count}`;
    if (state.geometryKey && state.geometryKey !== key && $("auto-centre").checked) {
      for (const editor of ["cover", "detail"]) { state[editor].x = state[editor].y = 0; syncControls(editor); }
    }
    state.geometryKey = key;
    validateSequence(width, height, count);
    valid = true;
  } catch (e) {
    $("size-error").textContent = e.message;
    $("size-error").hidden = false;
    if (!state.settings) $("dimensions").textContent = "Enter valid output dimensions.";
  }
  $("generate").disabled = !state.source || !valid || state.busy;
  scheduleDraft();
}

function syncControls(editor) {
  const controls = document.querySelector(`[data-editor="${editor}"]`);
  for (const key of ["mode", "zoom", "x", "y"]) controls.querySelector(`[data-control="${key}"]`).value = state[editor][key];
  controls.querySelector('[data-value="zoom"]').textContent = `${Math.round(state[editor].zoom * 100)}%`;
}

function scheduleDraft() {
  if (state.frame) return;
  state.frame = requestAnimationFrame(() => { state.frame = 0; renderDraft(); });
}

function renderDraft() {
  if (!state.source || !state.settings) return;
  const s = state.settings;
  const source = state.source;
  try {
    drawComposition($("cover-preview"), source, s.width, s.height, state.cover, s.background, 700);
    $("cover-stage").style.aspectRatio = `${s.width} / ${s.height}`;
    drawComposition($("detail-preview"), source, s.width * s.count, s.height, state.detail, s.background, 2400);
    $("detail-stage").style.aspectRatio = `${s.width * s.count} / ${s.height}`;
    $("detail-stage").style.minWidth = `${s.count * 150}px`;
    $("cut-lines").replaceChildren(...Array.from({ length: s.count }, (_, i) => {
      const cut = document.createElement("span");
      cut.dataset.label = `${String(i + 1 + Number(s.includeCover)).padStart(2, "0")} · detail`;
      return cut;
    }));
  } catch (e) { error(e.message); }
}

function setBusy(value) {
  state.busy = value;
  $("settings-fields").disabled = value;
  $("choose-image").disabled = value;
  $("image-file").disabled = value;
  document.querySelectorAll(".editor-controls input, .editor-controls select, .editor-controls button").forEach(el => { el.disabled = value; });
  $("workspace").setAttribute("aria-busy", String(value));
  $("download-zip").disabled = value;
  updateSettings();
}

function disposeSource() {
  if (state.source && typeof state.source.close === "function") state.source.close();
  if (state.source instanceof HTMLImageElement) state.source.src = "";
  if (state.sourceURL) URL.revokeObjectURL(state.sourceURL);
  state.sourceURL = null;
  state.source = null;
}

async function loadImage(file) {
  if (state.busy || !file) return;
  error();
  const mimeOK = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
  const nameOK = /\.(jpe?g|png|webp)$/i.test(file.name);
  if (!mimeOK && !(file.type === "" && nameOK)) return error("Please choose a JPEG, PNG or WebP image. HEIC, GIF and SVG are not supported; export them as JPEG or PNG first.");
  if (file.size > 80 * 1024 * 1024) return error("This file exceeds 80 MB. Export a smaller JPEG, PNG or WebP and try again.");
  const token = ++state.loadToken;
  $("status").textContent = "Opening your image locally…";
  $("choose-image").disabled = true;
  let source, fallbackURL;
  try {
    if (typeof createImageBitmap === "function") {
      try { source = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* Older browsers use the image fallback. */ }
    }
    if (!source) {
      fallbackURL = URL.createObjectURL(file);
      source = new Image();
      source.src = fallbackURL;
      await source.decode();
    }
    if (source.width * source.height > 100_000_000 || !source.width || !source.height) throw new Error("This image is too large to decode safely. Export a copy below 100 megapixels and try again.");
    if (token !== state.loadToken) { source.close?.(); if (fallbackURL) URL.revokeObjectURL(fallbackURL); return; }
    disposeSource();
    releaseResults();
    state.source = source;
    state.sourceURL = fallbackURL || null;
    state.cover = { mode: "fit", zoom: 1, x: 0, y: 0 };
    state.detail = { mode: "fill", zoom: 1, x: 0, y: 0 };
    syncControls("cover"); syncControls("detail");
    $("source-info").textContent = `${source.width} × ${source.height} px`;
    $("source-name").textContent = file.name;
    $("empty-state").hidden = true;
    $("editors").hidden = false;
    drawComposition($("original-preview"), source, source.width, source.height, { mode: "fit", zoom: 1, x: 0, y: 0 }, "#eee8dc", 600);
    updateSettings();
    await generate();
  } catch (e) {
    if (source !== state.source) source?.close?.();
    if (fallbackURL && fallbackURL !== state.sourceURL) URL.revokeObjectURL(fallbackURL);
    error(e.message || "This image could not be opened. Try re-exporting it as JPEG or PNG.");
    $("status").textContent = "Image could not be opened. Choose another file.";
  } finally { $("choose-image").disabled = state.busy; $("image-file").value = ""; }
}

async function generate() {
  if (!state.source || state.busy || $("generate").disabled) return;
  error();
  releaseResults();
  setBusy(true);
  state.controller = new AbortController();
  const settings = { ...state.settings };
  try {
    const files = await generateSequence({ ...settings, source: state.source,
      cover: { ...state.cover }, detail: { ...state.detail }, signal: state.controller.signal,
      onProgress: (n, total) => { $("status").textContent = `Preparing slide ${n} of ${total}…`; }
    });
    state.files = files.map(file => ({ ...file, url: URL.createObjectURL(file.blob) }));
    renderResults(settings);
    const g = geometry(state.source.width, state.source.height, settings.width * settings.count, settings.height, state.detail);
    $("status").textContent = `${files.length} slides ready.${g.scale > 1.01 ? " The detail view enlarges the source; a higher-resolution original will look sharper." : ""}`;
    $("generate").textContent = "Regenerate carousel";
  } catch (e) {
    if (e.name !== "AbortError") error(e.message || "Could not generate the carousel. Try a smaller output resolution.");
    $("status").textContent = "Generation did not complete. Check the settings and try again.";
  } finally { setBusy(false); state.controller = null; }
}

function download(url, name) {
  const link = document.createElement("a");
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
}

function renderResults(settings) {
  const { width, height, includeCover } = settings;
  $("export-summary").textContent = `${state.files.length} files · ${width} × ${height} px each · ${includeCover ? "Independent cover, followed by continuous details." : "Continuous detail sequence only."} These previews use the actual encoded download files.`;
  state.files.forEach((file, index) => {
    const figure = document.createElement("figure");
    const image = document.createElement("img");
    image.src = file.url; image.width = width; image.height = height;
    image.alt = `Slide ${index + 1}: ${file.kind === "cover" ? "full-artwork cover" : `continuous detail ${index + 1 - Number(includeCover)}`}`;
    figure.append(image); $("carousel").append(figure);
    const dot = document.createElement("button"); dot.type = "button"; dot.textContent = String(index + 1);
    dot.setAttribute("aria-label", `Go to slide ${index + 1}, ${file.kind}`);
    dot.addEventListener("click", () => goToSlide(index)); $("carousel-dots").append(dot);
    const item = document.createElement("div"); item.className = "slide-file";
    const thumb = image.cloneNode(); thumb.alt = "";
    const info = document.createElement("div");
    const name = document.createElement("p"); name.textContent = file.filename;
    const small = document.createElement("small"); small.textContent = `${width} × ${height} px · ${(file.blob.size / 1024 / 1024).toFixed(2)} MB`;
    const button = document.createElement("button"); button.type = "button";
    button.textContent = file.kind === "cover" ? "Download cover" : "Download slide";
    button.setAttribute("aria-label", `Download ${file.filename}`);
    button.addEventListener("click", () => download(file.url, file.filename));
    info.append(name, small, button); item.append(thumb, info); $("slide-list").append(item);
  });
  $("results").hidden = false;
  $("carousel").scrollLeft = 0;
  state.active = 0; syncCarousel();
}

function syncCarousel() {
  $("slide-counter").textContent = `${state.active + 1} / ${state.files.length}`;
  $("previous").disabled = state.active === 0;
  $("next").disabled = state.active >= state.files.length - 1;
  [...$("carousel-dots").children].forEach((dot, index) => dot.setAttribute("aria-pressed", String(index === state.active)));
}

function goToSlide(index) {
  index = Math.max(0, Math.min(state.files.length - 1, index));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  $("carousel").scrollTo({ left: index * $("carousel").clientWidth, behavior: reduced ? "instant" : "smooth" });
}

$("carousel").addEventListener("scroll", () => {
  if (!state.files.length) return;
  state.active = Math.round($("carousel").scrollLeft / $("carousel").clientWidth); syncCarousel();
}, { passive: true });
$("carousel").addEventListener("keydown", event => {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); goToSlide(state.active + (event.key === "ArrowRight" ? 1 : -1)); }
});
$("previous").addEventListener("click", () => goToSlide(state.active - 1));
$("next").addEventListener("click", () => goToSlide(state.active + 1));

$("download-zip").addEventListener("click", async () => {
  if (state.busy || !state.files.length) return;
  error(); setBusy(true);
  try {
    const blob = await makeZip(state.files, (n, total) => { $("status").textContent = `Packing file ${n} of ${total}…`; });
    const url = URL.createObjectURL(blob); state.downloadURLs.add(url);
    download(url, "artwork-carousel.zip");
    setTimeout(() => { URL.revokeObjectURL(url); state.downloadURLs.delete(url); }, 60_000);
    $("status").textContent = "ZIP prepared. Your browser may ask where to save it.";
  } catch (e) { error(e.message || "The ZIP could not be created. Download the individual slides instead."); }
  finally { setBusy(false); }
});

for (const editor of ["cover", "detail"]) {
  const controls = document.querySelector(`[data-editor="${editor}"]`);
  controls.addEventListener("input", event => {
    if (state.busy) return;
    const key = event.target.dataset.control;
    if (!key) return;
    state[editor][key] = key === "mode" ? event.target.value : Number(event.target.value);
    if (key === "mode") { state[editor].zoom = 1; state[editor].x = state[editor].y = 0; }
    syncControls(editor); dirty(); scheduleDraft();
  });
  controls.addEventListener("click", event => {
    if (state.busy || !event.target.dataset.action) return;
    state[editor].x = state[editor].y = 0;
    if (event.target.dataset.action === "reset") { state[editor].zoom = 1; state[editor].mode = editor === "cover" ? "fit" : "fill"; }
    syncControls(editor); dirty(); scheduleDraft();
  });
  const stage = $(editor === "cover" ? "cover-stage" : "detail-stage");
  let drag = null;
  stage.addEventListener("pointerdown", event => {
    if (!state.source || state.busy || event.button !== 0) return;
    event.preventDefault(); stage.focus({ preventScroll: true });
    stage.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    stage.classList.add("is-dragging");
  });
  stage.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId || state.busy) return;
    const s = state.settings, width = s.width * (editor === "detail" ? s.count : 1);
    const g = geometry(state.source.width, state.source.height, width, s.height, state[editor]);
    const box = stage.getBoundingClientRect();
    if (g.travelX > 0.01) state[editor].x = clamp(state[editor].x + (event.clientX - drag.x) * width / box.width / g.travelX, -1, 1);
    if (g.travelY > 0.01) state[editor].y = clamp(state[editor].y + (event.clientY - drag.y) * s.height / box.height / g.travelY, -1, 1);
    drag.x = event.clientX; drag.y = event.clientY;
    syncControls(editor); dirty(); scheduleDraft();
  });
  const endDrag = () => { drag = null; stage.classList.remove("is-dragging"); };
  stage.addEventListener("pointerup", endDrag); stage.addEventListener("pointercancel", endDrag); stage.addEventListener("lostpointercapture", endDrag);
  stage.addEventListener("keydown", event => {
    if (!state.source || state.busy) return;
    const f = state[editor], step = event.shiftKey ? 0.1 : 0.025;
    if (event.key === "ArrowLeft") f.x = clamp(f.x - step, -1, 1);
    else if (event.key === "ArrowRight") f.x = clamp(f.x + step, -1, 1);
    else if (event.key === "ArrowUp") f.y = clamp(f.y - step, -1, 1);
    else if (event.key === "ArrowDown") f.y = clamp(f.y + step, -1, 1);
    else if (["+", "="].includes(event.key)) f.zoom = clamp(f.zoom + 0.1, .5, 4);
    else if (event.key === "-") f.zoom = clamp(f.zoom - 0.1, .5, 4);
    else return;
    event.preventDefault(); syncControls(editor); dirty(); scheduleDraft();
  });
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
$("settings-form").addEventListener("submit", event => event.preventDefault());
$("settings-form").addEventListener("input", () => { dirty(); state.settings = null; updateSettings(); });
$("custom-kind").addEventListener("change", () => {
  $("custom-width").value = $("custom-kind").value === "pixels" ? 1080 : 3;
  $("custom-height").value = $("custom-kind").value === "pixels" ? 1440 : 4;
  state.settings = null; updateSettings();
});
$("generate").addEventListener("click", generate);
$("choose-image").addEventListener("click", () => $("image-file").click());
$("image-file").addEventListener("change", event => loadImage(event.target.files[0]));
$("dropzone").addEventListener("dragover", event => { event.preventDefault(); $("dropzone").classList.add("is-over"); });
$("dropzone").addEventListener("dragleave", event => { if (!$("dropzone").contains(event.relatedTarget)) $("dropzone").classList.remove("is-over"); });
$("dropzone").addEventListener("drop", event => {
  event.preventDefault(); $("dropzone").classList.remove("is-over");
  if (event.dataTransfer.files.length !== 1) return error("Please drop one artwork at a time.");
  loadImage(event.dataTransfer.files[0]);
});
// Prevent accidental navigation when an image is dropped outside the drop zone.
window.addEventListener("dragover", event => event.preventDefault());
window.addEventListener("drop", event => event.preventDefault());
window.addEventListener("pagehide", event => {
  if (event.persisted) return;
  state.loadToken++; state.controller?.abort(); disposeSource(); releaseResults();
  for (const url of state.downloadURLs) URL.revokeObjectURL(url);
});
new ResizeObserver(() => { if (state.files.length) $("carousel").scrollLeft = state.active * $("carousel").clientWidth; }).observe($("workspace"));
updateSettings();
