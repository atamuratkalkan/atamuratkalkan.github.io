// All geometry is shared by the framing previews and the full-resolution export.
export const LIMITS = Object.freeze({ masterPixels: 24_000_000, masterEdge: 16384, slideEdge: 8192 });
export const PRESETS = Object.freeze({ "3:4": [3, 4], "4:5": [4, 5], "1:1": [1, 1], landscape: [1080, 566] });

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

export function validateSequence(width, height, count) {
  if (!Number.isInteger(count) || count < 2 || count > 10) throw new Error("Choose 2 to 10 detail slides.");
  if (![width, height].every(n => Number.isSafeInteger(n) && n >= 64 && n <= LIMITS.slideEdge)) throw new Error("Invalid slide dimensions.");
  const masterWidth = width * count;
  if (masterWidth > LIMITS.masterEdge || masterWidth * height > LIMITS.masterPixels) {
    throw new Error("This panorama is too large for safe browser processing. Reduce the output resolution or the number of slides.");
  }
  return { width: masterWidth, height };
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

export function filename(index, kind, format) {
  return `${String(index + 1).padStart(2, "0")}-${kind}.${format === "image/png" ? "png" : "jpg"}`;
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

export async function generateSequence({ source, width, height, count, includeCover, cover, detail, background, format, quality, signal, onProgress = () => {} }) {
  const size = validateSequence(width, height, count);
  if (!["image/jpeg", "image/png"].includes(format)) throw new Error("Choose JPEG or PNG.");
  const master = document.createElement("canvas");
  const tile = document.createElement("canvas");
  const files = [];
  const total = count + Number(includeCover);
  try {
    abortIfNeeded(signal);
    if (includeCover) {
      drawComposition(tile, source, width, height, cover, background);
      const blob = await encodeCanvas(tile, format, quality);
      files.push({ blob, kind: "cover", filename: filename(0, "cover", format) });
      onProgress(files.length, total);
    }
    abortIfNeeded(signal);
    // Draw exactly once at final resolution. NEVER reframe individual details.
    drawComposition(master, source, size.width, size.height, detail, background);
    tile.width = width;
    tile.height = height;
    const ctx = context2d(tile);
    for (let index = 0; index < count; index++) {
      abortIfNeeded(signal);
      ctx.clearRect(0, 0, width, height);
      // Integer cuts [i*w, (i+1)*w) partition the master without overlap or gaps.
      ctx.drawImage(master, index * width, 0, width, height, 0, 0, width, height);
      const blob = await encodeCanvas(tile, format, quality);
      files.push({ blob, kind: "detail", filename: filename(files.length, "detail", format) });
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
