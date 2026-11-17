// All geometry is shared by the framing previews and the full-resolution export.
export const LIMITS = Object.freeze({ masterPixels: 24_000_000, masterEdge: 16384, slideEdge: 8192 });
export const PRESETS = Object.freeze({ "3:4": [3, 4], "4:5": [4, 5], "1:1": [1, 1], landscape: [1080, 566] });
// Native Instagram carousels; third-party publishing APIs may have lower limits.
export const INSTAGRAM_CAROUSEL_LIMIT = 20;

export function dimensions({ preset, customKind = "ratio", customWidth, customHeight, outputWidth = 1080 }) {
  const pair = PRESETS[preset] || [Number(customWidth), Number(customHeight)];
  if (pair.some(n => !Number.isFinite(n) || n <= 0)) throw new Error("Enter a positive width and height.");
  const exact = preset === "custom" && customKind === "pixels";
  const width = exact ? pair[0] : Number(outputWidth);
  const height = exact ? pair[1] : Math.round(width * pair[1] / pair[0]);
  if (![width, height].every(n => Number.isSafeInteger(n) && n >= 64 && n <= LIMITS.slideEdge)) {
    throw new Error(`Each output dimension must be a whole number between 64 and ${LIMITS.slideEdge} px.`);
  }
  return { width, height, ratio: width / height };
}

export function validateSequence(width, height, columns, rows = 1) {
  if (![columns, rows].every(n => Number.isInteger(n) && n >= 1 && n <= 10)) throw new Error("Choose 1 to 10 columns and 1 to 10 rows.");
  if (![width, height].every(n => Number.isSafeInteger(n) && n >= 64 && n <= LIMITS.slideEdge)) throw new Error("Invalid slide dimensions.");
  const masterWidth = width * columns, masterHeight = height * rows;
  if (Math.max(masterWidth, masterHeight) > LIMITS.masterEdge || masterWidth * masterHeight > LIMITS.masterPixels) {
    throw new Error("This master grid is too large for safe browser processing. Reduce the output resolution, columns or rows.");
  }
  return { width: masterWidth, height: masterHeight };
}

export function gridTiles(width, height, columns, rows = 1) {
  validateSequence(width, height, columns, rows);
  return Array.from({ length: columns * rows }, (_, index) => {
    const row = Math.floor(index / columns), column = index % columns;
    return { index, row, column, x: column * width, y: row * height, width, height };
  });
}

export function geometry(sourceWidth, sourceHeight, width, height, framing) {
  const base = framing.mode === "fit" ? Math.min(width / sourceWidth, height / sourceHeight) : Math.max(width / sourceWidth, height / sourceHeight);
  const scale = base * framing.zoom;
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  return {
    width: drawWidth, height: drawHeight, scale,
    x: (width - drawWidth) / 2 + framing.x * Math.abs(width - drawWidth) / 2,
    y: (height - drawHeight) / 2 + framing.y * Math.abs(height - drawHeight) / 2,
    travelX: Math.abs(width - drawWidth) / 2,
    travelY: Math.abs(height - drawHeight) / 2
  };
}

export function context2d(canvas) {
  const context = canvas.getContext("2d", { colorSpace: "srgb" });
  if (!context) throw new Error("Your browser could not create an image canvas. Try a lower resolution or reload this page.");
  return context;
}

export function drawComposition(canvas, source, width, height, framing, background, previewMax = 0) {
  const factor = previewMax ? Math.min(1, previewMax / Math.max(width, height)) : 1;
  canvas.width = Math.max(1, Math.round(width * factor));
  canvas.height = Math.max(1, Math.round(height * factor));
  const ctx = context2d(canvas);
  ctx.save();
  ctx.scale(canvas.width / width, canvas.height / height);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const g = geometry(source.width, source.height, width, height, framing);
  ctx.drawImage(source, g.x, g.y, g.width, g.height);
  ctx.restore();
  return canvas;
}

export function filename(index, kind, format, digits = 2) {
  return `${String(index + 1).padStart(digits, "0")}-${kind}.${format === "image/png" ? "png" : "jpg"}`;
}

export function encodeCanvas(canvas, format, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob || blob.size === 0 || blob.type !== format) reject(new Error("The browser could not encode this image. Try a smaller output or a different format."));
      else resolve(blob);
    }, format, quality);
  });
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw new DOMException("Generation cancelled.", "AbortError");
}

export async function generateSequence({ source, width, height, count, columns = count ?? 3, rows = 1, includeCover, cover, detail, background, format, quality, signal, onProgress = () => {} }) {
  // `count` remains an alias for legacy single-row callers; the UI uses columns/rows.
  const size = validateSequence(width, height, columns, rows);
  if (!["image/jpeg", "image/png"].includes(format)) throw new Error("Choose JPEG or PNG.");
  const master = document.createElement("canvas");
  const tile = document.createElement("canvas");
  const files = [];
  const total = columns * rows + Number(includeCover);
  const digits = Math.max(2, String(total).length);
  try {
    abortIfNeeded(signal);
    if (includeCover) {
      drawComposition(tile, source, width, height, cover, background);
      const blob = await encodeCanvas(tile, format, quality);
      files.push({ blob, kind: "cover", filename: filename(0, "cover", format, digits) });
      onProgress(files.length, total);
    }
    abortIfNeeded(signal);
    // Draw exactly once at final resolution. NEVER reframe individual grid tiles.
    drawComposition(master, source, size.width, size.height, detail, background);
    tile.width = width;
    tile.height = height;
    const ctx = context2d(tile);
    for (const cut of gridTiles(width, height, columns, rows)) {
      abortIfNeeded(signal);
      ctx.clearRect(0, 0, width, height);
      // Row-major integer rectangles partition BOTH axes without overlap or gaps.
      ctx.drawImage(master, cut.x, cut.y, width, height, 0, 0, width, height);
      const blob = await encodeCanvas(tile, format, quality);
      files.push({ blob, kind: "slide", row: cut.row, column: cut.column, tileIndex: cut.index, filename: filename(files.length, "slide", format, digits) });
      onProgress(files.length, total);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    abortIfNeeded(signal);
    return files;
  } finally {
    // Release the large pixel buffers; keep only compressed result blobs.
    master.width = master.height = tile.width = tile.height = 1;
  }
}
