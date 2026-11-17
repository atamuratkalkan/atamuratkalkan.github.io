import { hexToRgb } from './color.js';

export const PALETTE_VERSION = 1;
const text = (s, max = 160) => typeof s === 'string' ? s.trim().slice(0, max) : '';
export function validatePalette(input) {
  const entries = Array.isArray(input) ? input : input?.paints;
  if (!Array.isArray(entries) || !entries.length || entries.length > 32) throw new Error('A palette must contain 1–32 paints.');
  const ids = new Set();
  const paints = entries.map((p, i) => {
    if (!p || typeof p !== 'object') throw new Error(`Paint ${i + 1} is not an object.`);
    const id = text(p.id, 60), name = text(p.name, 100);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id) || !name) throw new Error(`Paint ${i + 1} needs a name and a unique simple id.`);
    ids.add(id);
    hexToRgb(p.hex);
    const strength = p.tintingStrength == null ? 1 : Number(p.tintingStrength);
    if (!Number.isFinite(strength) || strength < .1 || strength > 5) throw new Error(`${name}: strength must be 0.1–5.`);
    const provenance = { kind: text(p.provenance?.kind, 80) || 'user-estimate', note: text(p.provenance?.note, 500) };
    // Reserved calibration records are preserved, never silently interpreted as measured spectra.
    let calibration = null;
    if (p.calibration != null) {
      if (typeof p.calibration !== 'object') throw new Error(`${name}: invalid calibration record.`);
      calibration = { source: text(p.calibration.source, 300), method: text(p.calibration.method, 300), note: text(p.calibration.note, 500) };
      if (p.calibration.reflectance != null) {
        const r = p.calibration.reflectance;
        if (!Array.isArray(r) || r.length !== 38 || !r.every(v => Number.isFinite(v) && v > 0 && v <= 1)) throw new Error(`${name}: reflectance needs 38 values in (0, 1].`);
        calibration.reflectance = [...r];
        calibration.wavelengths = '380–750 nm, 10 nm steps';
      }
    }
    return { id, name, brand: text(p.brand) || null, series: text(p.series) || null,
      pigments: text(p.pigments) || null, hex: p.hex.toLowerCase(), enabled: p.enabled !== false,
      transparency: ['unknown', 'transparent', 'semi-transparent', 'opaque'].includes(p.transparency) ? p.transparency : 'unknown',
      tintingStrength: strength, isWhite: p.isWhite === true, provenance, calibration };
  });
  if (paints.filter(p => p.enabled).length > 24) throw new Error('Enable at most 24 tubes at once so recipe searches stay responsive.');
  return paints;
}
export const paletteFile = paints => ({ schema: 'paint-studio-palette', version: PALETTE_VERSION,
  quantityBasis: 'Relative model factors; approximate parts, not calibrated mass or volume.', paints: validatePalette(paints) });
export const paletteSignature = paints => JSON.stringify(paints.filter(p => p.enabled).map(p => [p.id, p.hex, p.tintingStrength]));
