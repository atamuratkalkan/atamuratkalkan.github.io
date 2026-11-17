export const IMAGE_LIMITS = Object.freeze({ bytes: 80 * 1024 ** 2, decodedPixels: 100e6, referenceEdge: 2200, analysisEdge: 512 });
export function canvas2D(width, height) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
  if (!context) throw new Error('This browser could not create a 2D canvas.');
  return { canvas, context };
}
export async function decodeReference(file) {
  if (!(file instanceof Blob) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP file. HEIC, GIF and SVG are not supported.');
  if (file.size > IMAGE_LIMITS.bytes) throw new Error('This image exceeds 80 MB. Please export a smaller sRGB copy.');
  let source, cleanup = () => {};
  try {
    if (globalThis.createImageBitmap) {
      source = await createImageBitmap(file, { imageOrientation: 'from-image', colorSpaceConversion: 'default' });
      cleanup = () => source.close();
    } else {
      const url = URL.createObjectURL(file); source = new Image();
      cleanup = () => URL.revokeObjectURL(url);
      source.src = url; await source.decode();
    }
    const originalWidth = source.width, originalHeight = source.height;
    if (!originalWidth || !originalHeight || originalWidth * originalHeight > IMAGE_LIMITS.decodedPixels) throw new Error('Use an image below 100 megapixels.');
    const scale = Math.min(1, IMAGE_LIMITS.referenceEdge / Math.max(originalWidth, originalHeight));
    const { canvas, context } = canvas2D(Math.max(1, Math.round(originalWidth * scale)), Math.max(1, Math.round(originalHeight * scale)));
    context.fillStyle = '#f5f1e8'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    // Lossless oriented reference: portable round trips must not change picks.
    const dataURL = canvas.toDataURL('image/png');
    return { name: typeof file.name === 'string' ? file.name.slice(0, 160) : 'Imported reference', canvas,
      pixels: context.getImageData(0, 0, canvas.width, canvas.height), dataURL,
      width: canvas.width, height: canvas.height, originalWidth, originalHeight };
  } catch (error) {
    if (error.name === 'InvalidStateError' || error.name === 'EncodingError') throw new Error('This file could not be decoded. Export a valid JPEG, PNG or WebP and try again.');
    throw error;
  } finally { cleanup(); }
}
export function analysisImage(reference) {
  const scale = Math.min(1, IMAGE_LIMITS.analysisEdge / Math.max(reference.width, reference.height));
  const { canvas, context } = canvas2D(Math.max(1, Math.round(reference.width * scale)), Math.max(1, Math.round(reference.height * scale)));
  context.drawImage(reference.canvas, 0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
}
export async function referenceFromRecord(record) {
  const response = await fetch(record.dataURL);
  const blob = await response.blob();
  const ref = await decodeReference(blob);
  if (ref.width !== record.width || ref.height !== record.height) throw new Error('The project image dimensions do not match its record.');
  return { ...ref, name: record.name, originalWidth: record.originalWidth, originalHeight: record.originalHeight, dataURL: record.dataURL };
}
export function disposeReference(reference) { if (reference?.canvas) { reference.canvas.width = 1; reference.canvas.height = 1; } }
export async function sampleReferenceFile() {
  // A deliberately synthetic, locally generated reference for first-use exploration.
  const { canvas, context: c } = canvas2D(960, 720);
  c.fillStyle = '#a7b5ac'; c.fillRect(0, 0, 960, 720);
  c.fillStyle = '#647d72'; c.fillRect(0, 410, 960, 310);
  c.fillStyle = '#d9caa7'; c.beginPath(); c.ellipse(480, 440, 315, 140, -.12, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#e4d6b5'; c.beginPath(); c.moveTo(570, 430); c.bezierCurveTo(660, 360, 570, 160, 690, 160); c.bezierCurveTo(820, 160, 755, 270, 725, 280); c.bezierCurveTo(685, 265, 735, 230, 693, 220); c.bezierCurveTo(660, 230, 760, 440, 620, 490); c.closePath(); c.fill();
  c.fillStyle = '#8b7654'; c.beginPath(); c.ellipse(445, 441, 190, 65, -.22, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#efe5cb'; c.beginPath(); c.ellipse(450, 419, 180, 60, -.28, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#b16c40'; c.beginPath(); c.moveTo(752, 198); c.lineTo(817, 223); c.lineTo(750, 234); c.closePath(); c.fill();
  c.fillStyle = '#292d2c'; c.beginPath(); c.arc(732, 196, 7, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#9cafa5'; for (let i = 0; i < 6; i++) c.fillRect(70 + i * 132, 602 + (i % 3) * 26, 86, 7);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  canvas.width = canvas.height = 1;
  return new File([blob], 'Synthetic bird study.png', { type: 'image/png' });
}
